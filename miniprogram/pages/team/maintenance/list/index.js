const app = getApp();
const api = require('../../../../utils/apiAdapter');
const SubscriptionAuth = require('../../../../utils/subscriptionAuth');
const swr = require('../../../../utils/swrCache');
const time = require('../../../../utils/time');

// 撕拉动画时长，与 index.wxss 中 ticket-tear-wipe 的 460ms 保持一致
const TICKET_TEAR_MS = 460;

const STATUS_MAP = {
  pending: '待受理',
  inProgress: '进行中',
  completed: '已完成',
  cancelled: '已取消'
};

// 首屏、分页及离线缓存统一派生展示字段，不改写业务时间。
function formatTask(task) {
  const createTime = time.toDate(task.createTime);
  return {
    ...task,
    taskStatusText: STATUS_MAP[task.taskStatus] || '未知状态',
    createTimeFormatted: createTime && !isNaN(createTime.getTime()) ? time.formatToMinute(createTime) : '暂无记录'
  };
}

Page({
  data: {
    readOnly: false,
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
    cardDelays: {},
    // 已点击认领、正在播放撕拉动画的任务；与 WXSS 的 460ms 时序一致
    tornTaskIds: {}
  },

  onLoad(options) {
    this.setData({ role: app.globalData.role || 'user', animateCards: false, page: 1, hasMore: true });
    this._isFirstLoad = true;
    this._pageDestroyed = false;
    this.loadMaintenanceTasks(true);
  },

  onUnload() {
    // 标注页面已销毁：认领结果返回后不再写已销毁页面的 data
    this._pageDestroyed = true;
  },

  retryList() { return this.data.appendFailed ? this.loadMoreTasks() : this.loadMaintenanceTasks(true); },
  onShow() {
    this.setData({ readOnly: require('../../../../utils/memberStatus').isRetired() });
    if (!this._isFirstLoad) {
      this.setData({ page: 1, hasMore: true });
      this.loadMaintenanceTasks(true);
    }
    this._isFirstLoad = false;
  },

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
        const tasks = tasksData.map(formatTask);
        const hasMore = (rawData && typeof rawData.hasMore === 'boolean') ? rawData.hasMore : tasks.length >= this.data.pageSize;
        this.setData({
          allTasks: tasks,
          hasMore,
          page: 2,
          loading: false,
          cardDelays: this.buildCardDelays(0, tasks.length)
        });
        swr.set(cacheKey, tasks, TTL_SEC);
      } else {
        this.setData({ loadError: result.message || '获取任务失败，请重试' });
      }
    } catch (err) {
      if (generation !== this._listGeneration) return;
      this.setData({ loadError: '加载失败，已保留上次内容，请重试' });
      console.error('获取维修任务列表失败', err);
      if (cached && cached.exists) {
        const cachedTasks = cached.data.map(formatTask);
        this.setData({ allTasks: cachedTasks, loading: false, cardDelays: this.buildCardDelays(0, cachedTasks.length) });
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
        const newTasks = tasksData.map(formatTask);
        if (newTasks.length > 0) {
          const merged = [...this.data.allTasks, ...newTasks.filter(task => !this.data.allTasks.some(old => old.maintenanceTaskId === task.maintenanceTaskId))];
          const hasMore = (rawData && typeof rawData.hasMore === 'boolean') ? rawData.hasMore : newTasks.length >= this.data.pageSize;
          const startIndex = this.data.allTasks.length;
          this.setData({
            allTasks: merged,
            hasMore,
            page: this.data.page + 1,
            cardDelays: { ...this.data.cardDelays, ...this.buildCardDelays(startIndex, merged.length) }
          });
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

  // 生成卡片入场延迟（依次入场）
  // 必须与列表数据在同一次 setData 中下发：先渲染终态再补动画类会让卡片闪一下再跳到起始位置。
  // startIndex: 从第几张开始计入（加载更多时传旧列表长度）
  buildCardDelays: function(startIndex = 0, total = 0) {
    const begin = Math.max(0, startIndex);
    const delays = {};
    for (let i = begin; i < total; i++) {
      delays[i] = (i - begin) * 180; // 每张卡片延迟 180ms，逐条入场节奏更分明
    }
    return delays;
  },

  // 查看任务详情
  viewTaskDetail: function(e) {
    const task = e.currentTarget.dataset.task;
    wx.navigateTo({
      url: '../detail/index?taskId=' + task.maintenanceTaskId + '&fromManage=false'
    });
  },

  // 认领任务：确认后先撕票（立即反馈），授权与提交随后并行，最终状态以服务端为准
  async claimTask(e) {
    if (!require('../../../../utils/memberStatus').canWrite()) return;
    if (this.data.claiming) return;
    const taskId = e && e.currentTarget ? e.currentTarget.dataset.taskId : e;
    if (!taskId || this.data.tornTaskIds[taskId]) return;
    const task = this.data.allTasks.find(item => item.maintenanceTaskId === taskId);
    if (!task) { wx.showToast({ title: '任务信息未就绪', icon: 'none' }); return; }
    // 自己的报修默认不可受理；组长及以上可自领，便于测试与后续拓展
    const isSelfTask = task.applicantId === app.globalData.openid;
    const canSelfClaim = ['leader', 'admin'].includes(app.globalData.role || this.data.role);
    if (isSelfTask && !canSelfClaim) { wx.showToast({ title: '不能受理自己的报修', icon: 'none' }); return; }

    let confirmation;
    try {
      confirmation = await wx.showModal({ title: '受理维修任务', content: `受理任务 ${taskId}？请核对问题与预约时间。`, confirmText: '受理任务', cancelText: '返回' });
    } catch (_) { return; }
    if (!confirmation || !confirmation.confirm) return;
    // 弹窗期间可能已有其他点击或任务被他人受理
    if (this.data.claiming || this.data.tornTaskIds[taskId]) return;
    // 离线时不播撕拉：直接告知未提交，避免“看起来已受理”的误读
    if (!require('../../../../utils/network').isOnline()) {
      wx.showToast({ title: '当前离线，尚未受理', icon: 'none', duration: 2500 });
      return;
    }

    // 1. 先撕票：立刻给出视觉反馈，不等授权与网络
    const tearStartedAt = Date.now();
    this.setData({ claiming: true, [`tornTaskIds.${taskId}`]: true });

    // 2. 订阅授权不阻塞受理：拒绝、取消或失败都继续认领
    try { SubscriptionAuth.requestAssigneeAuth({ showTip: false, allowPartialSuccess: true }).catch(() => {}); } catch (_) {}

    // 3. 提交认领：服务端事务内校验任务状态与权限，因此不再前置拉详情
    let result;
    try {
      result = await api.call('maintenanceTasks', { action: 'assignMaintenanceTask', params: { maintenanceTaskId: taskId, assigneeId: app.globalData.openid }, config: { retries: 0 } });
    } catch (err) {
      console.error('认领维修任务异常', err);
      result = { success: false, code: 0, message: '网络异常，未能确认受理结果' };
    }

    const claimed = !!(result && result.success);
    // 先通知其他页面失效，即使列表页已被销毁也要广播
    if (claimed) app.publish('maintenanceChanged', { taskId });
    if (this._pageDestroyed) return;

    // 动画播完再刷新或复原，避免刷新打断撕拉；网络快于动画时补足剩余时长
    const remaining = TICKET_TEAR_MS - (Date.now() - tearStartedAt);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    if (this._pageDestroyed) return;

    if (claimed) {
      await this.loadMaintenanceTasks(true);
      if (this._pageDestroyed) return;
      this.setData({ claiming: false, [`tornTaskIds.${taskId}`]: false });
      return;
    }

    // 失败：票根复原，再以服务端为准刷新（可能已被他人受理或状态已变化）
    this.setData({ claiming: false, [`tornTaskIds.${taskId}`]: false });
    const unknownResult = !result || result.code === 0 || result.code === 503;
    wx.showToast({ title: unknownResult ? '结果待核实，正在刷新任务' : (result.message || '未能受理，请核对最新任务'), icon: 'none' });
    await this.loadMaintenanceTasks(true);
  },})
