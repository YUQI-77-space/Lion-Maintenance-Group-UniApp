const loadingFeedback = require('../../../utils/loading');
// pages/user/message/index.js
const app = getApp();
const api = require('../../../utils/apiAdapter');
const time = require('../../../utils/time');

// const theme = require('../../../utils/theme');

Page({
  behaviors: [require('../../../utils/pageRefresh')],
  /**
   * 页面的初始数据
   */
  data: {
    messages: [],
    loadError: '',
    messageNumber: 0,
    unreadCount: 0,
    isLoading: true,
    isEmpty: true,
    userOpenid: '',
    themeClass: '',
    // 消息详情浮窗
    showDetail: false,
    detailMessage: null
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.setData({
      userOpenid: app.globalData.openid || wx.getStorageSync('openid')
    });
    // 主题移除：不再绑定
  },

  /**
   * 生命周期函数--监听页面显示
   * 每次显示页面时重新加载消息，确保时间显示是最新的
   */
  onShow() {
    this.loadMessages();
  },

  /**
   * 打开消息详情浮窗
   * 点击卡片任意位置触发；打开的同时把该条消息标记为已读
   * @param {Object} e - 事件对象，dataset.index 为列表中的显示下标
   */
  openMessageDetail: function(e) {
    const displayIndex = e.currentTarget.dataset.index;
    const message = this.data.messages[displayIndex];

    if (!message) return;

    this.setData({
      showDetail: true,
      detailMessage: {
        ...message,
        // 详情里展示精确到分钟的完整时间
        timeText: time.formatToMinute(message.sendTime) || message.timeDisplay || ''
      }
    });

    // 打开详情即视为已读（未读时才走网络请求）
    if (!message.isRead) {
      this.markAsRead(e);
    }
  },

  /**
   * 关闭消息详情浮窗（点击遮罩或右上角叉号）
   */
  closeMessageDetail: function() {
    this.setData({
      showDetail: false,
      detailMessage: null
    });
  },

  /**
   * 空操作：用于浮窗遮罩/内容区阻止事件穿透
   */
  noop: function() {},

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    // 页面隐藏时收起详情浮窗，避免返回页面时仍停留在浮窗
    if (this.data.showDetail) {
      this.closeMessageDetail();
    }
  },

  /**
   * 加载消息列表（改为适配器）
   */
  loadMessages: async function() {
    if (this._loadingMessages) return;
    this._loadingMessages = true;
    this.setData({ isLoading: this.data.messages.length === 0, loadError: '' });
    
    try {
      const result = await api.call('messages', {
        action: 'getMessage',
        params: { messageUserId: this.data.userOpenid }
      });
      if (result.success) {
        const { messages = [], messageNumber = 0 } = result.data || {};
        const processedMessages = (messages || []).map(msg => {
          // 处理消息类型图标和文本
          let typeIcon = '', typeText = '';
          switch (msg.messagetype) {
            case 'maintenance': 
              typeIcon = '修';
              typeText = '维修'; 
              break;
            case 'volunteer': 
              typeIcon = '志';
              typeText = '志愿'; 
              break;
            case 'duty':
              typeIcon = '班';
              typeText = '值班';
              break;
            case 'system': 
            default: 
              typeIcon = '信';
              typeText = '系统'; 
              break;
          }
          
          // 处理时间显示 - 每次加载时重新计算，确保时间是最新的
          const timeDisplay = time.formatToMinute(msg.sendTime);
          
          return { 
            ...msg, 
            typeIcon, 
            typeText, 
            timeDisplay
          };
        });
        
        const sortedMessages = processedMessages.reverse();
        const unreadCount = sortedMessages.filter(msg => !msg.isRead).length;
        
        this.setData({
          messages: sortedMessages,
          messageNumber,
          unreadCount,
          isEmpty: sortedMessages.length === 0,
          isLoading: false
        });
        app.getUnreadMessageCount && app.getUnreadMessageCount();
      } else {
        if (result.message === '未找到消息') {
          this.setData({ messages: [], messageNumber: 0, unreadCount: 0, isEmpty: true });
        } else this.setData({ loadError: result.message || '消息加载失败，保留上次内容' });
      }
    } catch (err) {
      console.error('获取消息失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      this.setData({ loadError: '网络异常，保留上次内容，可重新加载' });
    } finally {
      this._loadingMessages = false;
      this.setData({ isLoading: false });
    }
  },

  /**
   * 标记消息为已读（保留写操作）
   */
  markAsRead: async function(e) {
    const displayIndex = e.currentTarget.dataset.index;
    const message = this.data.messages[displayIndex];
    
    if (message.isRead) return;
    
    const originalIndex = this.data.messageNumber - displayIndex - 1;
    
    try {
      const res = await api.call('messages', {
        action: 'markTheMessageAsRead', config: { retries: 0 },
        params: { messageUserId: this.data.userOpenid, messageIndex: originalIndex }
      });
      if (res.success) {
        const updatedMessages = [...this.data.messages];
        updatedMessages[displayIndex].isRead = true;
        const unreadCount = updatedMessages.filter(msg => !msg.isRead).length;
        this.setData({ 
          messages: updatedMessages,
          unreadCount
        });
        app.getUnreadMessageCount && app.getUnreadMessageCount();
      } else {
        wx.showToast({ title: res.message || '标记已读失败', icon: 'none' });
      }
    } catch (err) {
      console.error('标记已读失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    }
  },



  /**
   * 清空所有消息（保留写操作）
   */
  clearAllMessages: function() {
    if (this.data.messages.length === 0) return;
    
    wx.showModal({
      title: '清空消息',
      content: '确定要清空所有消息吗？',
      success: async (res) => {
        if (res.confirm) {
          loadingFeedback.show({ title: '处理中...' });
          
          try {
            const result = await api.call('messages', {
              action: 'removalMessages',
              params: { messageUserId: this.data.userOpenid, deleteAllMessages: true }
            });

            loadingFeedback.hide();
            
            if (result.success) {
              this.setData({ 
                messages: [], 
                messageNumber: 0, 
                unreadCount: 0,
                isEmpty: true 
              });
              wx.showToast({ title: '已清空所有消息', icon: 'success' });
              app.getUnreadMessageCount && app.getUnreadMessageCount();
            } else {
              wx.showToast({ title: result.message || '操作失败', icon: 'none' });
            }
          } catch (err) {
            loadingFeedback.hide();
            console.error('清空消息失败', err);
            wx.showToast({ title: '网络错误，请重试', icon: 'none' });
          }
        }
      }
    });
  },

  /**
   * 标记所有消息为已读（保留写操作）
   */
  markAllAsRead: async function() {
    if (this.data.messages.length === 0) return;
    
    const hasUnread = this.data.messages.some(msg => !msg.isRead);
    if (!hasUnread) {
      wx.showToast({ title: '没有未读消息', icon: 'none' });
      return;
    }
    
    loadingFeedback.show({ title: '处理中...' });
    
    try {
      const res = await api.call('messages', {
        action: 'markTheMessageAsRead', config: { retries: 0 },
        params: { messageUserId: this.data.userOpenid, markAllAsRead: true }
      });
      loadingFeedback.hide();
      
      if (res.success) {
        const updatedMessages = this.data.messages.map(msg => ({ ...msg, isRead: true }));
        const unreadCount = 0; // 全部已读后未读数为0
        this.setData({ 
          messages: updatedMessages,
          unreadCount 
        });
        wx.showToast({ title: '全部标记为已读', icon: 'success' });
        app.getUnreadMessageCount && app.getUnreadMessageCount();
      } else {
        wx.showToast({ title: res.message || '操作失败', icon: 'none' });
      }
    } catch (err) {
      loadingFeedback.hide();
      console.error('标记全部已读失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  async onPullDownRefresh() {
    await this.loadMessages();
    this.setData({ unifiedRefreshing: false });
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})
