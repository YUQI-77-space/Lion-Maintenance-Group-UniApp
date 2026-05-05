const app = getApp();
const api = require('../../../../utils/apiAdapter');
const SubscriptionAuth = require('../../../../utils/subscriptionAuth');
const swr = require('../../../../utils/swrCache');

Page({
  data: {
    // 分类配置
    categories: [
      { key: 'all', label: '全部' },
      { key: 'electronic', label: '电子数码类' },
      { key: 'mechanical', label: '电路机械类' },
      { key: 'tools', label: '工具借用类' }
    ],
    activeCategory: 'all',
    allTasks: [],
    role: '',
    loading: false,
    animateCards: false,
    refresherTriggered: false,
    // 分页
    page: 1,
    pageSize: 12,
    hasMore: true,
    loadingMore: false,
    // 卡片入场动画延迟（毫秒）
    cardDelays: {}
  },

  onLoad(options) {
    this.setData({ role: app.globalData.role || 'user', animateCards: false, page: 1, hasMore: true, allTasks: [] });
    this._isFirstLoad = true;
    this.loadMaintenanceTasks(true);
  },

  onReady() {},

  onShow() {
    if (!this._isFirstLoad) {
      this.setData({ page: 1, hasMore: true, allTasks: [] });
      this.loadMaintenanceTasks(true);
    }
    this._isFirstLoad = false;
  },

  onHide() {},

  onUnload() {},

  onPullDownRefresh() {},

  // scroll-view 下拉刷新
  onRefresherRefresh: function() {
    this.setData({ refresherTriggered: true, page: 1, hasMore: true, allTasks: [] });
    this.loadMaintenanceTasks(true).finally(() => {
      this.setData({ refresherTriggered: false });
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadMoreTasks();
    }
  },

  onShareAppMessage() {},

  // 切换分类：重置分页，请求服务端分类过滤
  onCategoryChange: function(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.activeCategory === key) return;
    this.setData({
      activeCategory: key,
      page: 1,
      hasMore: true,
      allTasks: [],
      loading: true
    });
    this.loadMaintenanceTasks(true);
  },

  // 加载维修任务列表（带分类参数，服务端分页）
  loadMaintenanceTasks: async function(force = false) {
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    const userInfo = wx.getStorageSync('userInfo') || {};
    const openid = app.globalData.openid || userInfo.openid || 'anon';
    const { activeCategory } = this.data;
    const cacheKey = `maint:list:${openid}:${role}:${activeCategory}:1`;
    const TTL_SEC = 60;

    const cached = swr.get(cacheKey);

    if (force || !cached || !cached.exists) {
      this.setData({ loading: true, animateCards: false });
    }

    const nowTs = Date.now();
    if (!force) {
      if (this._fetchingMaintList) return;
      if (this._lastMaintFetch && nowTs - this._lastMaintFetch < 1200 && cached && cached.fresh) {
        this.setData({ loading: false });
        return;
      }
    }

    this._fetchingMaintList = true;
    this._lastMaintFetch = nowTs;

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: 1, pageSize: this.data.pageSize, category: activeCategory }
      });
      if (result.success) {
        const statusMap = {
          pending: '待受理',
          inProgress: '处理中',
          completed: '已完成',
          cancelled: '已撤销'
        };
        const rawData = result.data;
        const tasksData = (rawData && Array.isArray(rawData.tasks)) ? rawData.tasks : (Array.isArray(rawData) ? rawData : []);
        const tasks = tasksData.map(task => ({
          ...task,
          taskStatusText: statusMap[task.taskStatus] || '未知状态'
        }));
        const hasMore = (rawData && typeof rawData.hasMore === 'boolean') ? rawData.hasMore : tasks.length >= this.data.pageSize;
        this.setData({
          allTasks: tasks,
          hasMore,
          page: 2,
          loading: false,
          cardDelays: {}
        });
        this.triggerCardAnimation();
        swr.set(cacheKey, tasks, TTL_SEC);
      } else {
        wx.showToast({ title: result.message || '获取任务失败', icon: 'none' });
      }
    } catch (err) {
      console.error('获取维修任务列表失败', err);
      if (cached && cached.exists) {
        this.setData({ allTasks: cached.data, loading: false, cardDelays: {} });
        this.triggerCardAnimation();
        wx.showToast({ title: '网络异常，已展示上次数据', icon: 'none' });
      } else {
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    } finally {
      this._fetchingMaintList = false;
    }
  },

  // 加载更多（分页加载，携带分类参数）
  loadMoreTasks: async function() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    if (this._fetchingMaintListMore) return;

    this._fetchingMaintListMore = true;
    this.setData({ loadingMore: true });

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: this.data.page, pageSize: this.data.pageSize, category: this.data.activeCategory }
      });
      if (result.success) {
        const statusMap = {
          pending: '待受理',
          inProgress: '处理中',
          completed: '已完成',
          cancelled: '已撤销'
        };
        const rawData = result.data;
        const tasksData = (rawData && Array.isArray(rawData.tasks)) ? rawData.tasks : (Array.isArray(rawData) ? rawData : []);
        const newTasks = tasksData.map(task => ({
          ...task,
          taskStatusText: statusMap[task.taskStatus] || '未知状态'
        }));
        if (newTasks.length > 0) {
          const merged = [...this.data.allTasks, ...newTasks];
          const hasMore = (rawData && typeof rawData.hasMore === 'boolean') ? rawData.hasMore : newTasks.length >= this.data.pageSize;
          const startIndex = this.data.allTasks.length;
          this.setData({
            allTasks: merged,
            hasMore,
            page: this.data.page + 1
          });
          this.triggerCardAnimation(startIndex);
        } else {
          this.setData({ hasMore: false });
        }
      }
    } catch (err) {
      console.error('加载更多失败', err);
    } finally {
      this._fetchingMaintListMore = false;
      this.setData({ loadingMore: false });
    }
  },

  // 触发卡片入场动画（依次入场）
  // startIndex: 从第几张开始动画（用于加载更多场景）
  triggerCardAnimation: function(startIndex = 0) {
    const tasks = this.data.allTasks;
    if (!tasks || tasks.length === 0) return;

    // 如果不是从头开始，保留已有的动画状态
    if (startIndex === 0) {
      this._animatedCount = 0;
    } else {
      this._animatedCount = this._animatedCount || 0;
    }

    // 为每一张卡片设置动画延迟
    const endIndex = tasks.length;
    const delays = {};
    for (let i = startIndex; i < endIndex; i++) {
      const delay = (i - startIndex) * 100; // 每张卡片延迟 100ms
      delays[`cardDelays[${i}]`] = delay;
    }

    // 设置延迟数据，触发动画
    this.setData(delays);
  },

  // 查看任务详情
  viewTaskDetail: function(e) {
    const task = e.currentTarget.dataset.task;
    wx.navigateTo({
      url: '../detail/index?taskId=' + task.maintenanceTaskId + '&fromManage=false'
    });
  },

  // 认领任务
  claimTask: async function(e) {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }

    const taskId = e.currentTarget ? e.currentTarget.dataset.taskId : e;

    const currentUserOpenid = app.globalData.openid;
    const task = this.data.allTasks.find(t => t.maintenanceTaskId === taskId);

    if (task && task.applicantId === currentUserOpenid) {
      wx.showModal({
        title: '无法认领',
        content: '申请人无法认领自己的维修任务',
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }

    let authResult = null;
    let needReAuthCancel = false;
    try {
      authResult = await SubscriptionAuth.requestAssigneeAuth({
        showTip: true,
        allowPartialSuccess: true
      });
      const details = (authResult && authResult.analysis && authResult.analysis.details) || [];
      const cancelTemplateId = SubscriptionAuth.TEMPLATES.TASK_CANCELLED;
      const cancelAuth = details.find(d => d.templateId === cancelTemplateId);
      needReAuthCancel = !cancelAuth || cancelAuth.status !== 'accept';
    } catch (error) {
      console.error('订阅授权异常:', error);
    }

    wx.showModal({
      title: '确认认领',
      content: '确定要认领此维修任务吗？',
      success: async (res) => {
        if (res.confirm) {
          if (needReAuthCancel) {
            try {
              await SubscriptionAuth.requestSubscribeMessage(
                [SubscriptionAuth.TEMPLATES.TASK_CANCELLED],
                SubscriptionAuth.SCENES.TASK_CLAIM,
                { showTip: false, allowPartialSuccess: true }
              );
            } catch (reErr) {}
          }

          wx.showLoading({ title: '处理中...' });

          try {
            const result = await api.call('maintenanceTasks', {
              action: 'assignMaintenanceTask',
              params: {
                maintenanceTaskId: taskId,
                assigneeId: app.globalData.openid
              }
            });

            wx.hideLoading();

            if (result.success) {
              if (result.data && result.data.alreadyClaimed) {
                wx.showToast({ title: result.message || '您已认领此任务', icon: 'success' });
              } else {
                wx.showToast({ title: '认领成功', icon: 'success' });
              }
              this.loadMaintenanceTasks(true);
            } else {
              wx.showToast({ title: result.message || '认领失败', icon: 'none' });
            }
          } catch (err) {
            wx.hideLoading();
            console.error('认领任务失败', err);
            wx.showToast({ title: '网络错误，请重试', icon: 'none' });
          }
        }
      }
    });
  }
})
