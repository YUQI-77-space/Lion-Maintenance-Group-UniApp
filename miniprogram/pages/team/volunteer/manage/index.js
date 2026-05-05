// pages/team/volunteer/manage/index.js
const app = getApp()
const { ActivityStatusManager, ActivityStatusMixin } = require('../../../../utils/activityStatusManager')
const api = require('../../../../utils/apiAdapter')
const time = require('../../../../utils/time')
const swr = require('../../../../utils/swrCache')
const iconManager = require('../../../../utils/iconManager')

Page(Object.assign({
  /**
   * 页面的初始数据
   */
  data: {
    currentStatus: 'all',
    searchKeyword: '',
    activities: [],
    stats: {
      total: 0,
      pending: 0,
      inPreparation: 0,
      inProgress: 0,
      ended: 0
    },
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    initialLoading: true,
    toggleLoading: false,
    toggleLoadingId: null,
    // 卡片入场动画延迟（毫秒）
    cardDelays: {},
    refresherTriggered: false,
    // 图标资源
    iconCalendar: iconManager.get('team_calendar'),
    iconLocation: iconManager.get('status_location'),
    iconPeople: iconManager.get('status_people'),
    iconEmpty: iconManager.get('common_empty'),
    iconAdd: iconManager.get('common_add')
  },

  /**
   * 为待发布活动添加倒计时
   */
  addCountdownToPendingActivities(activities) {
    return activities.map(activity => {
      if (activity.activityStatus === 'pending' && activity.publishTime) {
        activity.countdownText = this.calculateCountdown(activity.publishTime);
      }
      return activity;
    });
  },

  /**
   * 计算倒计时文本
   */
  calculateCountdown(publishTime) {
    if (!publishTime) return '计算中...';
    
    const now = new Date();
    // iOS 兼容：使用 time.toDate
    const publish = time.toDate(publishTime);
    if (!publish) return '计算中...';
    
    const diff = publish.getTime() - now.getTime();
    
    if (diff <= 0) {
      return '即将发布';
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    if (days > 0) {
      return `${days}天${hours}小时${minutes}分钟`;
    } else if (hours > 0) {
      return `${hours}小时${minutes}分钟${seconds}秒`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 检查用户角色，只有组长可以访问管理页面
    this.checkUserRole()
    
    // 如果有状态参数，则设置当前状态
    if (options.status) {
      this.setData({
        currentStatus: options.status
      })
    }
    
    // 获取活动统计数据
    this.getActivityStats()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 初始化状态管理器
    this.initActivityStatusManager()
    
    // 静默刷新：保留现有列表，重置分页为第一页并后台更新
    this.setData({
      page: 1,
      hasMore: true
    })
    this.getActivitiesList(true)
    
    // 启动倒计时更新定时器
    this.startCountdownTimer()
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    // 清理状态管理器资源
    this.cleanupActivityStatusManager()
    
    // 清理倒计时定时器
    this.stopCountdownTimer()
  },

  /**
   * 启动倒计时更新定时器
   */
  startCountdownTimer() {
    // 清除旧的定时器
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
    }
    
    // 每秒更新一次倒计时
    this.countdownTimer = setInterval(() => {
      const activities = this.data.activities || []
      const updatedActivities = activities.map(activity => {
        if (activity.activityStatus === 'pending' && activity.publishTime) {
          return {
            ...activity,
            countdownText: this.calculateCountdown(activity.publishTime)
          }
        }
        return activity
      })
      
      // 检查是否有变化
      const hasChanges = updatedActivities.some((activity, index) => {
        return activity.countdownText !== activities[index]?.countdownText
      })
      
      if (hasChanges) {
        this.setData({ activities: updatedActivities })
      }
    }, 1000)
  },

  /**
   * 停止倒计时更新定时器
   */
  stopCountdownTimer() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  },

  /**
   * 检查用户角色
   */
  checkUserRole() {
    // 修复权限验证逻辑：role和userInfo是分别存储的
    const app = getApp()
    const role = app.globalData.role || wx.getStorageSync('role') || 'user'
    
    
    if (role !== 'leader') {
      
      wx.showToast({
        title: '只有组长可以访问管理页面',
        icon: 'none',
        duration: 2000
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 2000)
    } else {
      
    }
  },

  /**
   * 获取活动统计数据
   */
  getActivityStats: async function() {
    try {
      const result = await api.call('volunteerActivities', { action: 'getVolunteerActivitiesList', params: { pageSize: 999, countOnly: true, includePending: true } });
      if (result.success && result.data && result.data.stats) {
        this.setData({ stats: result.data.stats, initialLoading: false });
      } else {
        this.setData({ stats: { total: 0, pending: 0, inPreparation: 0, inProgress: 0, ended: 0 }, initialLoading: false });
      }
    } catch (err) {
      console.error('💥 [manage-getActivityStats] 获取统计数据失败', err);
      this.setData({ stats: { total: 0, pending: 0, inPreparation: 0, inProgress: 0, ended: 0 }, initialLoading: false });
    }
  },

  /**
   * 获取活动列表
   */
  getActivitiesList: async function(force = false) {
    if (!this.data.hasMore || this.data.loading) {
      return;
    }

    const status = this.data.currentStatus || 'all';
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    const cacheKey = `vol:manage:list:${status}:${this.data.page}:${this.data.searchKeyword || ''}`;
    const TTL_SEC = 60;

    // 仅首屏用缓存快速展示
    const cached = swr.get(cacheKey);
    if (cached && cached.exists && this.data.page === 1 && this.data.activities.length === 0) {
      this.setData({ activities: cached.data });
    }

    if (!cached || !cached.exists) {
      this.setData({ loading: true });
    }

    if (!force) {
      if (this._fetchingVolManage) return;
    }
    this._fetchingVolManage = true;

    const params = {
      page: this.data.page,
      pageSize: this.data.pageSize,
      includePending: true // 管理界面需要包含待发布状态
    };
    if (status !== 'all') params.status = status;
    if (this.data.searchKeyword) params.keyword = this.data.searchKeyword;

    try {
      const result = await api.call('volunteerActivities', { action: 'getVolunteerActivitiesList', params });
      if (result.success) {
        const activities = (result.data && result.data.activities) || [];
        const processedActivities = ActivityStatusManager.processActivitiesForDisplay(activities);
        // 为待发布活动添加倒计时
        const activitiesWithCountdown = this.addCountdownToPendingActivities(processedActivities);
        const merged = this.data.page === 1 ? activitiesWithCountdown : [...this.data.activities, ...activitiesWithCountdown];
        const backendHasMore = result.data && typeof result.data.hasMore === 'boolean' ? result.data.hasMore : undefined;
        const hasMore = typeof backendHasMore === 'boolean' ? backendHasMore : (activities.length >= this.data.pageSize);
        this.setData({
          activities: merged,
          hasMore,
          page: this.data.page + 1
        });
        swr.set(cacheKey, merged, TTL_SEC);
        this.triggerCardAnimation(0);
      } else {
        wx.showToast({ title: result.message || '获取活动列表失败', icon: 'none' });
      }
    } catch (err) {
      console.error('💥 [manage-getActivitiesList] 请求失败', err);
      wx.showToast({ title: '获取活动列表失败', icon: 'none' });
    } finally {
      this._fetchingVolManage = false;
      this.setData({ loading: false });
    }
  },

  /**
   * 切换状态筛选
   */
  switchStatus(e) {
    const status = e.currentTarget.dataset.status
    if (status === this.data.currentStatus) return
    
    this.setData({
      currentStatus: status,
      page: 1,
      hasMore: true,
      activities: [],
      initialLoading: false
    });
    this.getActivitiesList();
    this.prefetchOtherStatuses();
  },

  // 后台预取其它状态列表第一页以加速后续切换
  prefetchOtherStatuses() {
    const statuses = ['all', 'pending', 'inPreparation', 'inProgress', 'ended'];
    const current = this.data.currentStatus || 'all';
    const others = statuses.filter(s => s !== current);
    const pageSize = this.data.pageSize;
    others.forEach((status) => {
      const cacheKey = `vol:manage:list:${status}:1:${this.data.searchKeyword || ''}`;
      const cached = swr.get(cacheKey);
      if (cached && cached.fresh) return;
      const params = { page: 1, pageSize, includePending: true };
      if (status !== 'all') params.status = status;
      if (this.data.searchKeyword) params.keyword = this.data.searchKeyword;
      api.call('volunteerActivities', { action: 'getVolunteerActivitiesList', params })
        .then((result) => {
          if (result && result.success) {
            const activities = (result.data && result.data.activities) || [];
            const processed = ActivityStatusManager.processActivitiesForDisplay(activities);
            const withCountdown = this.addCountdownToPendingActivities(processed);
            swr.set(cacheKey, withCountdown, 60);
          }
        })
        .catch(() => {});
    });
  },

  /**
   * 跳转到详情页
   */
  goToDetail(e) {
    const activityId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/team/volunteer/detail/index?id=${activityId}&fromManage=true`
    })
  },

  /**
   * 跳转到编辑页
   */
  goToEdit(e) {
    // 阻止事件冒泡
    e.stopPropagation && e.stopPropagation();
    
    const activityId = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;
    
    // 获取当前活动信息
    const activity = this.data.activities.find(item => item.activityId === activityId);
    if (!activity) {
      wx.showToast({
        title: '找不到活动信息',
        icon: 'none'
      });
      return;
    }
    
    // 检查用户角色
    const app = getApp();
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    
    if (role !== 'leader') {
      wx.showToast({
        title: '只有组长可以编辑活动',
        icon: 'none'
      });
      return;
    }
    
    const lockTimeFields = activity.activityStatus === 'inProgress' || activity.activityStatus === 'ended';
    
    wx.navigateTo({
      url: `/pages/team/volunteer/create/index?id=${activityId}${lockTimeFields ? '&lockTime=1' : ''}`,
      events: {
        activityUpdated: (payload = {}) => {
          // 从编辑页回传的更新字段，按需路径更新
          const updates = payload.updates || {};
          const targetIndex = Number.isInteger(index) ? index : this.data.activities.findIndex(i => i.activityId === activityId);
          if (targetIndex >= 0) {
            const pathBase = `activities[${targetIndex}]`;
            const setDataPayload = {};
            Object.keys(updates).forEach((key) => {
              setDataPayload[`${pathBase}.${key}`] = updates[key];
            });
            if (Object.keys(setDataPayload).length > 0) {
              this.setData(setDataPayload);
            }
          }
        }
      }
    });
  },

  /**
   * 跳转到创建活动页面
   */
  goToCreate() {
    wx.navigateTo({
      url: '/pages/team/volunteer/create/index'
    })
  },

  /**
   * 检查数据库权限
   */
  checkDbPermission() {
    // 检查是否已经初始化云环境
    if (!wx.cloud) {
      console.error('云开发未初始化')
      return false
    }
    return true
  },

  /**
   * 删除活动
   */
  deleteActivity(e) {
    // 阻止事件冒泡
    e.stopPropagation && e.stopPropagation();
    
    // 检查用户角色
    const app = getApp()
    const role = app.globalData.role || wx.getStorageSync('role') || 'user'
    
    if (role !== 'leader') {
      wx.showToast({
        title: '只有组长可以删除活动',
        icon: 'none'
      })
      return
    }
    
    // 获取活动ID
    const activityId = e.currentTarget.dataset.id
    
    // 获取当前活动信息
    const activity = this.data.activities.find(item => item.activityId === activityId)
    if (!activity) {
      wx.showToast({
        title: '找不到活动信息',
        icon: 'none'
      })
      return
    }
    
    // 显示确认对话框
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该活动吗？此操作不可恢复。',
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: '删除中...',
            mask: true
          });
          
          try {
            const requestId = api.generateRequestId();
            const result = await api.call('volunteerActivities', {
              action: 'deleteVolunteerActivity',
              params: {
                activityId: activityId,
                requestId
              }
            });

            wx.hideLoading();
            
                          if (result.success) {
                wx.showToast({
                  title: '删除成功',
                  icon: 'success'
                });
                
                // 刷新活动数据
                await this.refreshActivityData();
                
            } else {
              wx.showToast({
                title: result.message || '删除失败',
                icon: 'none'
              });
            }
          } catch (err) {
            wx.hideLoading();
            console.error('删除活动失败:', err);
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  /**
   * 招募状态开关切换
   */
  handleRecruitmentSwitch(e) {
    // 阻止事件冒泡
    e.stopPropagation && e.stopPropagation();
    
    const activityId = e.currentTarget.dataset.id;
    const targetStatus = !!(e.detail && e.detail.value);
    
    // 检查用户角色
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    if (role !== 'leader') {
      wx.showToast({
        title: '只有组长可以切换招募状态',
        icon: 'none'
      });
      this.setActivityRecruitmentState(activityId, !targetStatus);
      return;
    }
    
    // 获取当前活动信息
    const activity = this.data.activities.find(item => item.activityId === activityId);
    if (!activity) {
      wx.showToast({
        title: '找不到活动信息',
        icon: 'none'
      });
      return;
    }
    
    const previousStatus = !!activity.recruitmentOpen;
    
    // 若状态未变化则无需处理
    if (previousStatus === targetStatus) {
      return;
    }
    
    // 状态限制
    if (activity.activityStatus === 'ended') {
      wx.showToast({
        title: '已结束的活动无法切换招募状态',
        icon: 'none'
      });
      this.setActivityRecruitmentState(activityId, previousStatus);
      return;
    }
    
    if (activity.activityStatus === 'pending') {
      wx.showToast({
        title: '待发布的活动无法切换招募状态，请先发布活动',
        icon: 'none'
      });
      this.setActivityRecruitmentState(activityId, previousStatus);
      return;
    }
    
    const statusText = targetStatus ? '开启' : '关闭';
    const confirmText = targetStatus
      ? '确定要开启招募吗？开启后用户可以报名参加此活动。'
      : '确定要关闭招募吗？关闭后用户将无法报名参加此活动，但已报名用户不受影响。';
    
    // 先还原到上一次状态，等待用户确认后再触发动画
    this.setActivityRecruitmentState(activityId, previousStatus);
    
    wx.showModal({
      title: `${statusText}招募`,
      content: confirmText,
      confirmColor: targetStatus ? '#52c41a' : '#ff6b6b',
      success: (res) => {
        if (res.confirm) {
          // 用户确认后再触发动画，确保只播放一次
          this.setActivityRecruitmentState(activityId, targetStatus);
          this.performRecruitmentToggle(activityId, targetStatus, previousStatus);
        } else {
          this.setActivityRecruitmentState(activityId, previousStatus);
        }
      },
      fail: () => {
        this.setActivityRecruitmentState(activityId, previousStatus);
      }
    });
  },

  /**
   * 执行招募状态切换
   */
  performRecruitmentToggle: async function(activityId, newStatus, previousStatus) {
    const statusText = newStatus ? '开启' : '关闭';
    let toggleSucceeded = false;
    const fallbackState = typeof previousStatus === 'boolean' ? previousStatus : !newStatus;
    
    // 设置loading状态，使用统一的加载组件
    this.setData({ 
      toggleLoading: true,
      toggleLoadingId: activityId 
    });
    
    try {
      const requestId = api.generateRequestId();
      const res = await api.call('volunteerActivities', {
        action: 'toggleRecruitmentStatus',
        params: {
          activityId: activityId,
          recruitmentOpen: newStatus,
          requestId
        }
      });
      
      if (res.success) {
        wx.showToast({
          title: `${statusText}招募成功`,
          icon: 'success'
        });
        toggleSucceeded = true;
        
        // 重新获取最新的活动数据，确保状态同步
        await this.refreshActivityData();
        
      } else {
        wx.showToast({
          title: res.message || `${statusText}招募失败`,
          icon: 'none',
          duration: 3000
        });
        console.error('切换招募状态失败:', res);
      }
    } catch (err) {
      console.error('切换招募状态失败:', err);
      wx.showToast({
        title: `${statusText}招募失败`,
        icon: 'none',
        duration: 3000
      });
    } finally {
      this.setData({ 
        toggleLoading: false,
        toggleLoadingId: null 
      });
      if (toggleSucceeded) {
        this.setActivityRecruitmentState(activityId, newStatus);
      } else {
        this.setActivityRecruitmentState(activityId, fallbackState);
      }
    }
  },

  setActivityRecruitmentState(activityId, state) {
    const index = this.data.activities.findIndex(item => item.activityId === activityId);
    if (index >= 0) {
      this.setData({
        [`activities[${index}].recruitmentOpen`]: state
      });
    }
  },

  stopEvent(e) {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
  },

  /**
   * 刷新活动数据
   */
  refreshActivityData: async function() {
    // 重置分页并重新获取活动列表
    this.setData({
      page: 1,
      hasMore: true,
      activities: []
    });
    
    // 并行获取活动列表和统计数据
    await Promise.all([
      this.getActivitiesList(),
      this.getActivityStats()
    ]);
  },

  /**
   * 搜索输入
   */
  handleSearchInput(e) {
    this.setData({
      searchKeyword: e.detail.value
    })
  },

  /**
   * 搜索确认
   */
  handleSearchConfirm(e) {
    const keyword = e.detail.value || this.data.searchKeyword
    this.setData({
      searchKeyword: keyword,
      page: 1,
      hasMore: true,
      activities: [],
      initialLoading: false
    });
    this.getActivitiesList();
    this.triggerCardAnimation(0);
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {},

  // scroll-view 下拉刷新
  onRefresherRefresh: function() {
    this.refreshActivityData().finally(() => {
      this.setData({ refresherTriggered: false });
    });
  },

  // 触发卡片入场动画（依次入场）
  // startIndex: 从第几张开始动画（用于加载更多场景）
  triggerCardAnimation: function(startIndex = 0) {
    const activities = this.data.activities;
    if (!activities || activities.length === 0) return;

    // 如果不是从头开始，保留已有的动画状态
    if (startIndex === 0) {
      this._animatedCount = 0;
    } else {
      this._animatedCount = this._animatedCount || 0;
    }

    // 为每一张卡片设置动画延迟
    const endIndex = activities.length;
    const delays = {};
    for (let i = startIndex; i < endIndex; i++) {
      const delay = (i - startIndex) * 100; // 每张卡片延迟 100ms
      delays[`cardDelays[${i}]`] = delay;
    }

    // 设置延迟数据，触发动画
    this.setData(delays);
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.getActivitiesList()
    }
  }

}, ActivityStatusMixin))