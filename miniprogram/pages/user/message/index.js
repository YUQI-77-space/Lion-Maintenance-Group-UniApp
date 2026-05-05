// pages/user/message/index.js
const app = getApp();
const api = require('../../../utils/apiAdapter');
const time = require('../../../utils/time');

// const theme = require('../../../utils/theme');

Page({
  /**
   * 页面的初始数据
   */
  data: {
    messages: [],
    messageNumber: 0,
    unreadCount: 0,
    isLoading: false,
    isEmpty: false,
    userOpenid: '',
    themeClass: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.setData({
      userOpenid: app.globalData.openid || wx.getStorageSync('openid')
    });
    // 主题移除：不再绑定
    this.loadMessages();
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   * 每次显示页面时重新加载消息，确保时间显示是最新的
   */
  onShow() {
    this.loadMessages();
  },

  /**
   * 格式化消息时间显示
   * 根据当前时间动态计算相对时间
   * @param {String|Date} timeStr - 消息发送时间
   * @returns {String} 格式化后的时间字符串
   */
  formatMessageTime: function(timeStr) {
    if (!timeStr) return '';
    
    const now = new Date();
    // iOS 兼容：使用 time.toDate
    const msgTime = time.toDate(timeStr);
    if (!msgTime) return '';
    
    const diffMs = now.getTime() - msgTime.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 1) {
      return '刚刚';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}分钟前`;
    } else if (diffHours < 24) {
      return `${diffHours}小时前`;
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      // 超过7天显示具体日期
      const month = msgTime.getMonth() + 1;
      const day = msgTime.getDate();
      return `${month}月${day}日`;
    }
  },





  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
  },

  /**
   * 加载消息列表（改为适配器）
   */
  loadMessages: async function() {
    this.setData({ isLoading: true });
    
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
              typeIcon = '🔧'; 
              typeText = '维修'; 
              break;
            case 'volunteer': 
              typeIcon = '💝'; 
              typeText = '志愿'; 
              break;
            case 'duty':
              typeIcon = '📅';
              typeText = '值班';
              break;
            case 'system': 
            default: 
              typeIcon = '📢'; 
              typeText = '系统'; 
              break;
          }
          
          // 处理时间显示 - 每次加载时重新计算，确保时间是最新的
          const timeDisplay = this.formatMessageTime(msg.sendTime);
          
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
        this.setData({ 
          messages: [], 
          messageNumber: 0, 
          unreadCount: 0,
          isEmpty: true, 
          isLoading: false 
        });
        if (result.message !== '未找到消息') {
          wx.showToast({ title: result.message || '获取消息失败', icon: 'none' });
        }
      }
    } catch (err) {
      console.error('获取消息失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      this.setData({ isLoading: false, isEmpty: true });
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
        action: 'markTheMessageAsRead',
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
          wx.showLoading({ title: '处理中...' });
          
          try {
            const result = await api.call('messages', {
              action: 'removalMessages',
              params: { messageUserId: this.data.userOpenid, deleteAllMessages: true }
            });

            wx.hideLoading();
            
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
            wx.hideLoading();
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
    
    wx.showLoading({ title: '处理中...' });
    
    try {
      const res = await api.call('messages', {
        action: 'markTheMessageAsRead',
        params: { messageUserId: this.data.userOpenid, markAllAsRead: true }
      });
      wx.hideLoading();
      
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
      wx.hideLoading();
      console.error('标记全部已读失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  async onPullDownRefresh() {
    await this.loadMessages();
    wx.stopPullDownRefresh();
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})