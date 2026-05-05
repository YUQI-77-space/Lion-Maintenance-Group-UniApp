// pages/user/todo/volunteer-detail/index.js
const app = getApp();
const api = require('../../../../utils/apiAdapter');
const time = require('../../../../utils/time');

Page({
  /**
   * 页面的初始数据
   */
  data: {
    taskId: '',
    taskDetail: {},
    activityStatus: 'inPreparation',
    userOpenid: '',
    loading: true,
    refreshing: false, // 添加下拉刷新状态
    formattedStartTime: '',
    formattedEndTime: '',
    canCancel: false, // 是否可以取消报名
    cancelDeadline: '', // 取消报名截止时间
    cancelReasonText: '', // 不能取消报名的原因
    showFeedbackModal: false, // 是否显示反馈弹窗
    feedbackContent: '', // 反馈内容
    myFeedback: '' // 我提交的反馈
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    
    
    if (options.taskId) {
      // 确保app.globalData存在
      if (!app || !app.globalData) {
        console.error('app或app.globalData不存在，延迟重试');
        // 延迟重试
        setTimeout(() => {
          this.onLoad(options);
        }, 500);
        return;
      }
      
      const userOpenid = app.globalData.openid || wx.getStorageSync('openid');
      
      this.setData({
        taskId: options.taskId,
        userOpenid: userOpenid
      });
      
      // 加载任务详情
      this.loadTaskDetail();
    } else {
      console.error('未提供任务ID');
      wx.showToast({
        title: '任务ID不存在',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  /**
   * 加载任务详情
   */
  async loadTaskDetail() {
    wx.showLoading({ title: '加载中...' });
    this.setData({ loading: true });
    
    try {
      // Step 1: Get To-Do detail
      const todoRes = await api.call('userToDoList', {
        action: 'getTodoDetail',
        params: { type: 'volunteer', id: this.data.taskId }
      });

      if (!todoRes.success || !todoRes.data || !todoRes.data.taskId) {
        throw new Error(todoRes.message || '获取待办详情失败');
      }
      
      const todoDetail = todoRes.data;

      // Step 2: Get full activity detail
      const activityRes = await api.call('volunteerActivities', {
        action: 'getVolunteerActivityDetail',
        params: { activityId: todoDetail.taskId }
      });

      if (!activityRes.success || !activityRes.data || !activityRes.data.activity) {
        throw new Error(activityRes.message || '获取活动详情失败');
      }
      
      const activity = activityRes.data.activity;
      
      // Process and set data
      const statusMap = { inPreparation: '筹备中', inProgress: '进行中', ended: '已结束' };
      activity.activityStatusText = statusMap[activity.activityStatus] || '未知';

      const formattedStartTime = time.formatToMinute(activity.startTime);
      const formattedEndTime = time.formatToMinute(activity.endTime);
      
      const startTime = time.toDate(activity.startTime) || new Date();
      const cancelDeadline = new Date(startTime);
      cancelDeadline.setDate(startTime.getDate() - 1);
      cancelDeadline.setHours(17, 0, 0, 0);
      
      const now = new Date();
      const canCancel = now < cancelDeadline && activity.activityStatus !== 'ended';
      
      let myFeedback = '';
      if (Array.isArray(activity.feedbacks) && activity.feedbacks.length > 0) {
        const userFeedback = activity.feedbacks.find(fb => fb.openid === this.data.userOpenid);
        if (userFeedback) {
          myFeedback = userFeedback.feedback;
        }
      }

      let cancelReasonText = '';
      if (now >= cancelDeadline) {
        cancelReasonText = '已超过取消报名截止时间（活动前一天17:00）';
      } else if (activity.activityStatus === 'ended') {
        cancelReasonText = '活动已结束，无法取消报名';
      }
      
      this.setData({
        taskDetail: { ...todoDetail, ...activity },
        activityStatus: activity.activityStatus || 'inPreparation',
        formattedStartTime,
        formattedEndTime,
        canCancel,
        cancelDeadline: time.formatToMinute(cancelDeadline),
        cancelReasonText,
        loading: false,
        refreshing: false,
        myFeedback: myFeedback
      });

    } catch (err) {
      console.error('获取待办/活动详情失败', err);
      wx.showToast({ title: err.message || '网络错误，请重试', icon: 'none', duration: 2000 });
      this.setData({ loading: false, refreshing: false });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 取消报名
   */
  async cancelRegistration() {
    if (!this.data.canCancel) {
      wx.showToast({ title: this.data.cancelReasonText || '无法取消报名', icon: 'none', duration: 2000 });
      return;
    }
    
    const modalRes = await wx.showModal({
      title: '确认取消报名',
      content: '确定要取消报名吗？每个活动只有一次取消报名的机会。',
      confirmColor: '#ff6b6b'
    });

    if (modalRes.confirm) {
      wx.showLoading({ title: '取消报名中...', mask: true });
      try {
        const network = require('../../../../utils/network');
        if (!network.isOnline()) {
          const outbox = require('../../../../utils/outbox');
          outbox.add('volunteerActivities', 'cancelRegistration', {
            activityId: this.data.taskId,
            fromTodo: true
          });
          wx.hideLoading();
          wx.showToast({ title: '网络不稳，已加入队列', icon: 'none', duration: 2500 });
          return;
        }
        
        const res = await api.call('volunteerActivities', {
          action: 'cancelRegistration',
          params: { activityId: this.data.taskId, fromTodo: true }
        });
        
        if (res.success) {
          wx.showToast({ title: '已取消报名', icon: 'success', duration: 2000 });
          
          // 刷新前一页面的数据
          const pages = getCurrentPages();
          const prevPage = pages && pages.length >= 2 ? pages[pages.length - 2] : null;
          if (prevPage) {
            // 如果是待办事项列表页面
            if (typeof prevPage.loadVolunteerTasks === 'function') {
              setTimeout(() => { 
                prevPage.loadVolunteerTasks();
                // 同时刷新所有计数
                if (prevPage.updateAllPendingCounts) {
                  prevPage.updateAllPendingCounts();
                }
              }, 200);
            }
            // 如果是其他页面，触发onShow生命周期
            else if (prevPage.onShow) {
              setTimeout(() => { prevPage.onShow(); }, 200);
            }
          }
          
          // 刷新全局相关计数
          app.getUnreadMessageCount && app.getUnreadMessageCount();
          app.getTodoTotalCount && app.getTodoTotalCount();
          
          // 延迟返回，确保数据刷新完成
          setTimeout(() => { wx.navigateBack(); }, 1800);
        } else {
          wx.showToast({ title: res.message || '取消报名失败', icon: 'none', duration: 2000 });
        }
      } catch (err) {
        console.error('取消报名失败', err);
        wx.showToast({ title: '网络错误，请重试', icon: 'none', duration: 2000 });
      } finally {
        wx.hideLoading();
      }
    }
  },

  /**
   * 显示反馈弹窗
   */
  showFeedbackModal: function() {
    // 如果已有反馈内容，则预填充到输入框中，便于编辑
    this.setData({
      showFeedbackModal: true,
      feedbackContent: this.data.myFeedback || ''
    });
    
  },

  /**
   * 关闭反馈弹窗
   */
  closeFeedbackModal: function() {
    this.setData({
      showFeedbackModal: false
    });
  },

  /**
   * 监听反馈内容输入
   */
  onFeedbackInput: function(e) {
    this.setData({
      feedbackContent: e.detail.value
    });
  },

  /**
   * 提交反馈
   */
  async submitFeedback() {
    const content = this.data.feedbackContent.trim();
    if (!content) {
      wx.showToast({ title: '请输入分工信息', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中...', mask: true });

    try {
      const res = await api.call('volunteerActivities', {
        action: 'submitFeedback',
        params: {
          activityId: this.data.taskId,
          feedback: content
        }
      });
      
      if (res.success) {
        wx.showToast({ title: '分工信息提交成功', icon: 'success', duration: 2000 });
        this.setData({ showFeedbackModal: false, myFeedback: content });
      } else {
        wx.showToast({ title: res.message || '提交失败，请稍后重试', icon: 'none', duration: 2000 });
      }
    } catch (err) {
      console.error('[submitFeedback] 调用云函数失败:', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none', duration: 2000 });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 格式化日期
   */
  formatDate: function(date) {
    // 统一到分钟展示
    return time.formatToMinute(date);
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh: function() {
    this.setData({
      refreshing: true
    });
    this.loadTaskDetail();
    wx.stopPullDownRefresh();
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady: function() {
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow: function() {
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide: function() {
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload: function() {
  }
}); 