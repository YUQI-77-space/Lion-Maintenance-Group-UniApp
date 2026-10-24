const app = getApp();
const api = require('../../../../utils/apiAdapter');
const SubscriptionAuth = require('../../../../utils/subscriptionAuth');
const swr = require('../../../../utils/swrCache');

const STATUS_MAP = {
  pending: '待受理',
  inProgress: '进行中',
  completed: '已完成',
  cancelled: '已取消'
};

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
    loadError: '',
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
    this.setData({ role: app.globalData.role || 'user', animateCards: false, page: 1, hasMore: true });
    this._isFirstLoad = true;
    this.loadMaintenanceTasks(true);
  },

  retryList() { return this.data.appendFailed ? this.loadMoreTasks() : this.loadMaintenanceTasks(true); },
  onReady() {},

  onShow() {
    if (!this._isFirstLoad) {
      this.setData({ page: 1, hasMore: true });
      this.loadMaintenanceTasks(true);
    }
    this._isFirstLoad = false;
  },

  onHide() {},

  onUnload() {},

  onPullDownRefresh() {},

  // scroll-view 下拉刷新
  onRefresherRefresh: function() {
    this.setData({ refresherTriggered: true, page: 1, hasMore: true });
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
    this.setData({ loadError: '' });
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    const userInfo = wx.getStorageSync('userInfo') || {};
    const openid = app.globalData.openid || userInfo.openid || 'anon';
    const { activeCategory } = this.data;
    const cacheKey = `maint:list:${openid}:${role}:${activeCategory}:page1:sz${this.data.pageSize}`;
    const TTL_SEC = 60;

    const cached = swr.get(cacheKey);

    if (force || !cached || !cached.exists) {
      this.setData({ loading: this.data.allTasks.length === 0, animateCards: false });
    }

    const nowTs = Date.now();
    if (!force) {
      if (this._fetchingMaintList) return;
      if (this._lastMaintFetch && nowTs - this._lastMaintFetch < 1200 && cached && cached.fresh) {
        this.setData({ loading: false });
        return;
      }
    }

    const generation = this._listGeneration = (this._listGeneration || 0) + 1;
    this._fetchingMaintList = true;
    this._lastMaintFetch = nowTs;

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: 1, pageSize: this.data.pageSize, category: activeCategory }
      });
      if (generation !== this._listGeneration) return;
      if (result.success) {
        const rawData = result.data;
        const tasksData = (rawData && Array.isArray(rawData.tasks)) ? rawData.tasks : (Array.isArray(rawData) ? rawData : []);
        const tasks = tasksData.map(task => ({
          ...task,
          taskStatusText: STATUS_MAP[task.taskStatus] || '未知状态'
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
        this.setData({ loadError: result.message || '获取任务失败，请重试' });
      }
    } catch (err) {
      if (generation !== this._listGeneration) return;
      this.setData({ loadError: '加载失败，已保留上次内容，请重试' });
      console.error('获取维修任务列表失败', err);
      if (cached && cached.exists) {
        this.setData({ allTasks: cached.data, loading: false, cardDelays: {} });
        this.triggerCardAnimation();
        wx.showToast({ title: '网络异常，已展示上次数据', icon: 'none' });
      } else {
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    } finally {
      if (generation === this._listGeneration) { this._fetchingMaintList = false; this.setData({ loading: false }); }
    }
  },

  // 加载更多（分页加载，携带分类参数）
  loadMoreTasks: async function() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    if (this._fetchingMaintListMore) return;

    this._fetchingMaintListMore = true;
    const generation = this._listGeneration;
    const requestedPage = this.data.page;
    this.setData({ loadingMore: true, loadError: '', appendFailed: false });

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: this.data.page, pageSize: this.data.pageSize, category: this.data.activeCategory }
      });
      if (generation !== this._listGeneration || requestedPage !== this.data.page) return;
      if (!result.success) { this.setData({ loadError: result.message || '追加失败，请重试', appendFailed: true }); return; }
      if (result.success) {
        const rawData = result.data;
        const tasksData = (rawData && Array.isArray(rawData.tasks)) ? rawData.tasks : (Array.isArray(rawData) ? rawData : []);
        const newTasks = tasksData.map(task => ({
          ...task,
          taskStatusText: STATUS_MAP[task.taskStatus] || '未知状态'
        }));
        if (newTasks.length > 0) {
          const merged = [...this.data.allTasks, ...newTasks.filter(task => !this.data.allTasks.some(old => old.maintenanceTaskId === task.maintenanceTaskId))];
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
      this.setData({ loadError: '追加失败，请重试', appendFailed: true });
      console.error('加载更多失败', err);
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none', duration: 2000 });
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

    // 防御：钳制到合法范围，避免拼出 cardDelays[-N] 这类非法 data path。
    if (startIndex < 0) startIndex = 0;
    if (startIndex >= tasks.length) return;

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
  async claimTask(e) {
    if (this.data.claiming) return;
    const taskId = e.currentTarget ? e.currentTarget.dataset.taskId : e;
    const task = this.data.allTasks.find(item => item.maintenanceTaskId === taskId);
    if (!taskId || !task || task.applicantId === app.globalData.openid) { wx.showToast({ title: '不能受理自己的报修', icon: 'none' }); return; }
    this.setData({ claiming: true });
    try {
      const confirmation = await wx.showModal({ title: '受理维修任务', content: `受理任务 ${taskId}？请核对问题与预约时间。`, confirmText: '受理任务', cancelText: '返回' });
      if (!confirmation.confirm) return;
      try { await SubscriptionAuth.requestAssigneeAuth({ showTip: true, allowPartialSuccess: true }); } catch (_) {}
      const latest = await api.call('maintenanceTasks', { action: 'getMaintenanceTaskDetail', params: { maintenanceTaskId: taskId } });
      if (!latest.success || !latest.data || latest.data.taskStatus !== 'pending') {
        wx.showToast({ title: latest.success ? '该任务状态已变化，请查看最新受理信息' : (latest.message || '无法核对任务状态'), icon: 'none' });
        await this.loadMaintenanceTasks(true); return;
      }
      const result = await api.call('maintenanceTasks', { action: 'assignMaintenanceTask', params: { maintenanceTaskId: taskId, assigneeId: app.globalData.openid }, config: { retries: 0 } });
      wx.showToast({ title: result.success ? '受理成功' : (result.code === 503 ? '结果待核实，正在刷新任务' : (result.message || '未能受理，请核对最新任务')), icon: result.success ? 'success' : 'none' });
      await this.loadMaintenanceTasks(true);
      if (result.success) app.publish('maintenanceChanged', { taskId });
    } finally { this.setData({ claiming: false }); }
  },})
