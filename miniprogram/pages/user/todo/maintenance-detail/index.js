// pages/user/todo/maintenance-detail/index.js
const app = getApp();
const api = require('../../../../utils/apiAdapter');
const time = require('../../../../utils/time');
const SubscriptionAuth = require('../../../../utils/subscriptionAuth');
const iconManager = require('../../../../utils/iconManager');

Page({
  /**
   * 页面的初始数据
   */
  data: {
    taskId: '',
    taskDetail: {},
    loading: true,
    isApplicant: false,
    isAssignee: false,
    canComplete: false,
    canCancel: false,
    showCancelModal: false,
    cancelReason: '',
    completionInProgress: false,
    // 图标资源
    iconRepair: iconManager.get('biz_repair')
  },

  /**
   * 格式化时间为标准显示格式
   * @param {string|Date|number} inputTime
   * @returns {string}
   */
  formatTime: function(inputTime) {
    if (!inputTime) return '';
    return time.formatDateTime(inputTime);
  },

  /**
   * 生命周期
   */
  onLoad(options) {
    if (options && options.taskId) {
      this.setData({ taskId: options.taskId });
      this.loadTaskDetail();
    } else {
      wx.showToast({ title: '未找到任务ID', icon: 'none' });
      setTimeout(() => { wx.navigateBack(); }, 1500);
    }
  },

  /**
   * 加载任务详情（使用统一适配器 + async/await）
   */
  async loadTaskDetail() {
    const { taskId } = this.data;
    wx.showLoading({ title: '加载中...' });
    this.setData({ loading: true });

    try {
      const result = await api.call('userToDoList', {
        action: 'getTodoDetail',
        params: { type: 'maintenance', id: taskId }
      });

      if (result.success && result.data) {
        const taskDetail = result.data;
        console.log('[加载任务详情] taskDetail:', taskDetail);
        console.log('[加载任务详情] isManagementCreated:', taskDetail.isManagementCreated);
        const userOpenid = app.globalData.openid;

        const isApplicant = taskDetail.applicantId === userOpenid;
        const isAssignee = taskDetail.assigneeId === userOpenid;
        const canComplete = isApplicant && taskDetail.taskStatus === 'inProgress';
        const canCancel = isApplicant && taskDetail.taskStatus !== 'completed' && taskDetail.taskStatus !== 'cancelled';

        if (taskDetail.completeTime) {
          taskDetail.completeTime = this.formatTime(taskDetail.completeTime);
        }
        if (taskDetail.assigneeTime) {
          taskDetail.assigneeTime = this.formatTime(taskDetail.assigneeTime);
        }
        if (taskDetail.additionalAssignees && taskDetail.additionalAssignees.length > 0) {
          taskDetail.additionalAssignees.forEach(assignee => {
            if (assignee.assigneeTime) {
              assignee.assigneeTime = this.formatTime(assignee.assigneeTime);
            }
          });
        }

        this.setData({
          taskDetail,
          loading: false,
          isApplicant,
          isAssignee,
          canComplete,
          canCancel
        });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.message || '获取任务详情失败', icon: 'none' });
      }
    } catch (err) {
      console.error('获取任务详情失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 确认完成任务
   */
  async confirmCompleteTask() {
    const { taskId, taskDetail } = this.data;

    if (!(taskDetail.applicantId === app.globalData.openid && taskDetail.taskStatus === 'inProgress')) {
      wx.showToast({ title: '您无法完成此操作', icon: 'none' });
      return;
    }
    
    if (taskDetail.taskStatus === 'cancelled') {
      wx.showToast({ title: '已撤销的任务无法完成', icon: 'none' });
      return;
    }

    const modalRes = await wx.showModal({
      title: '确认完成',
      content: '确认此维修任务已完成吗？'
    });
    
    if (modalRes.confirm) {
      wx.showLoading({ title: '处理中...' });
      try {
        // 离线处理
        const network = require('../../../../utils/network');
        if (!network.isOnline()) {
          const outbox = require('../../../../utils/outbox');
          outbox.add('maintenanceTasks', 'completeMaintenanceTask', {
            maintenanceTaskId: taskId,
            completeTime: this.formatTime(new Date())
          });
          wx.hideLoading();
          wx.showToast({ title: '网络不稳，已加入队列', icon: 'none', duration: 2500 });
          return;
        }

        const res = await api.call('maintenanceTasks', {
          action: 'completeMaintenanceTask',
          params: {
            maintenanceTaskId: taskId,
            completeTime: this.formatTime(new Date())
          }
        });
        
        if (res.success) {
          // 更新任务状态
          const updatedTaskDetail = { ...this.data.taskDetail, taskStatus: 'completed', completeTime: this.formatTime(new Date()) };
          this.setData({ 
            taskDetail: updatedTaskDetail, 
            canComplete: false,
            canCancel: false,
            completionInProgress: true
          });
          
          // 任务完成后直接处理完成逻辑
          this.handleTaskCompleted();
        } else {
          wx.showToast({ title: res.message || '操作失败', icon: 'none' });
        }
      } catch (err) {
        console.error('确认完成失败:', err);
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    }
  },

  // 打开撤销弹窗
  openCancelModal() {
    const { taskDetail } = this.data;

    if (!(taskDetail.applicantId === app.globalData.openid && taskDetail.taskStatus !== 'completed' && taskDetail.taskStatus !== 'cancelled')) {
      wx.showToast({ title: '您无法完成此操作', icon: 'none' });
      return;
    }

    this.setData({
      showCancelModal: true,
      cancelReason: ''
    });
  },

  // 关闭撤销弹窗
  closeCancelModal() {
    this.setData({
      showCancelModal: false,
      cancelReason: ''
    });
  },

  // 撤销原因输入
  onCancelReasonInput(e) {
    this.setData({
      cancelReason: e.detail.value
    });
  },

  // 确认撤销任务
  async confirmCancelTask() {
    const { taskId, cancelReason } = this.data;

    if (!cancelReason || cancelReason.trim() === '') {
      wx.showToast({ title: '请输入撤销原因', icon: 'none' });
      return;
    }

    // 关闭弹窗
    this.closeCancelModal();

    // 确认撤销
    const confirmRes = await wx.showModal({
      title: '确认撤销任务',
      content: `撤销原因：${cancelReason.trim()}\n\n确认撤销此维修任务？撤销后将无法恢复。`
    });

    if (confirmRes.confirm) {
      // 先请求订阅消息授权（保持功能完整性）
      try {
        wx.showLoading({ title: '请求消息授权...' });
        
        // 请求任务取消相关的订阅消息授权
        const authResult = await SubscriptionAuth.requestSubscribeMessage(
          [SubscriptionAuth.TEMPLATES.TASK_CANCELLED],
          SubscriptionAuth.SCENES.TASK_CANCEL,
          { 
            showTip: true,
            allowPartialSuccess: true 
          }
        );

        
        // 优化：快速切换到撤销操作，减少加载状态切换的视觉延迟
        wx.showLoading({ title: '处理中...' });
        
      } catch (authError) {
        console.error('订阅消息授权失败:', authError);
        // 授权失败也继续执行撤销操作
        wx.showLoading({ title: '处理中...' });
      }
      try {
        const network = require('../../../../utils/network');
        if (!network.isOnline()) {
          const outbox = require('../../../../utils/outbox');
          outbox.add('maintenanceTasks', 'cancelMaintenanceTask', { 
            maintenanceTaskId: taskId,
            cancelReason: cancelReason.trim()
          });
          wx.hideLoading();
          wx.showToast({ title: '网络不稳，已加入队列', icon: 'none', duration: 2500 });
          return;
        }

        const res = await api.call('maintenanceTasks', {
          action: 'cancelMaintenanceTask',
          params: { 
            maintenanceTaskId: taskId,
            cancelReason: cancelReason.trim()
          }
        });

        if (res.success) {
          wx.showToast({ title: '已撤销', icon: 'success' });
          
          // 更新当前页面状态
          const updatedTaskDetail = { ...this.data.taskDetail, taskStatus: 'cancelled' };
          this.setData({ 
            taskDetail: updatedTaskDetail, 
            canComplete: false,
            canCancel: false 
          });
          
          // 刷新前一页面的数据
          const pages = getCurrentPages();
          const prevPage = pages && pages.length >= 2 ? pages[pages.length - 2] : null;
          if (prevPage) {
            // 如果是待办事项列表页面
            if (typeof prevPage.loadMaintenanceTasks === 'function') {
              setTimeout(() => { 
                prevPage.loadMaintenanceTasks();
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
          
          // 立即返回，减少用户等待时间
          setTimeout(() => { wx.navigateBack(); }, 100);
        } else {
          wx.showToast({ title: res.message || '撤销失败', icon: 'none' });
        }
      } catch (err) {
        console.error('撤销任务失败:', err);
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    }
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return { title: '维修任务详情', path: '/pages/user/todo/maintenance-detail/index?taskId=' + this.data.taskId };
  },



  // 复制QQ号
  copyQQ: function(e) {
    const qq = e.currentTarget.dataset.qq;
    const type = e.currentTarget.dataset.type || '';
    if (qq) {
      wx.setClipboardData({
        data: qq,
        success: function() {
          wx.showToast({ title: `${type}QQ号已复制`, icon: 'success', duration: 2000 });
        },
        fail: function() {
          wx.showToast({ title: '复制失败', icon: 'none' });
        }
      });
    }
  },

  // 阻止事件穿透（弹窗遮罩使用）
  noop() {},



  /**
   * 通知个人资料页面刷新用户信息
   */
  notifyProfilePageRefresh() {
    try {
      // 设置全局刷新标志
      const app = getApp();
      if (app.globalData) {
        app.globalData.needRefreshProfile = true;
        
        // 如果有个人资料页面的刷新回调，立即调用
        if (app.globalData.profileRefreshCallback) {
          app.globalData.profileRefreshCallback();
        }
      }
    } catch (error) {
      console.error('通知个人资料页面刷新失败:', error);
    }
  },

  /**
   * 处理任务完成后的操作
   */
  handleTaskCompleted() {
    wx.showToast({
      title: '任务已完成',
      icon: 'success',
      duration: 1500
    });
    
    // 刷新前一页面的数据
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage) {
      // 如果是待办事项列表页面
      if (prevPage.loadMaintenanceTasks) {
        setTimeout(() => { 
          prevPage.loadMaintenanceTasks();
          // 同时刷新所有计数
          if (prevPage.updateAllPendingCounts) {
            prevPage.updateAllPendingCounts();
          }
        }, 300);
      }
      // 如果是其他页面，触发onShow生命周期
      else if (prevPage.onShow) {
        setTimeout(() => { prevPage.onShow(); }, 300);
      }
    }
    
    // 刷新全局相关计数
    app.getUnreadMessageCount && app.getUnreadMessageCount();
    app.getTodoTotalCount && app.getTodoTotalCount();
  }
}); 