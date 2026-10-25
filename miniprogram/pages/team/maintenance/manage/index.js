// pages/team/maintenance/manage/index.js
const app = getApp();
const api = require('../../../../utils/apiAdapter');
const swr = require('../../../../utils/swrCache');
const iconManager = require('../../../../utils/iconManager');
const time = require('../../../../utils/time');

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

  /**
   * 页面的初始数据
   */
  data: {
    activeTab: 'all', // 当前激活的选项卡
    activeTabName: '', // 当前选项卡名称
    allTasks: [], // 所有任务
    filteredTasks: [], // 筛选后的任务
    userRole: '', // 用户角色
    searchKeyword: '', // 搜索关键词
    originalFilteredTasks: [], // 搜索前的筛选任务，用于重置搜索
    loadError: '',
    loading: false, // 加载状态
    refresherTriggered: false,
    // 卡片入场动画延迟（毫秒）
    cardDelays: {},
    // 分页
    page: 1,
    pageSize: 12,
    hasMore: true,
    loadingMore: false,
    // 图标资源
    iconAdd: iconManager.get('common_add')
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 获取用户角色，只有组长才能访问此页面
    const userRole = app.globalData.role || '';

    if (userRole !== 'leader') {
      wx.showToast({
        title: '权限不足',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
      return;
    }

    this.setData({
      userRole: userRole,
      activeTabName: '全部'
    });

    // 加载任务列表：首次进入强制走「加载中 → 数据就绪」流程
    this._isFirstLoad = true;
    this.setData({ page: 1, hasMore: true });
    this.loadMaintenanceTasks(true);
  },

  retryList() { return this.data.appendFailed ? this.loadMoreTasks() : this.loadMaintenanceTasks(true); },
  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 只在非首次进入时刷新，避免 onLoad + onShow 双重加载
    if (!this._isFirstLoad) {
      this.setData({ page: 1, hasMore: true });
      this.loadMaintenanceTasks(false);
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

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadMoreTasks();
    }
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '维修任务管理',
      path: '/pages/team/maintenance/manage/index'
    }
  },

  // 切换选项卡
  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    const tabNameMap = {
      'all': '全部',
      'pending': '待认领',
      'inProgress': '进行中',
      'completed': '已完成',
      'cancelled': '已撤销'
    };

    this.setData({
      activeTab: tab,
      activeTabName: tabNameMap[tab],
      searchKeyword: '' // 切换选项卡时重置搜索关键词
    });

    // 根据选项卡过滤任务
    this.filterTasksByStatus(tab);
  },

  // 触发卡片入场动画（依次入场）
  // startIndex: 从第几张开始动画（用于加载更多场景）
  triggerCardAnimation: function(startIndex = 0) {
    const tasks = this.data.filteredTasks;
    if (!tasks || tasks.length === 0) return;

    // 防御：startIndex 可能因筛选/搜索导致为负，或超过列表长度，
    // 统一钳制到合法范围，避免拼出 cardDelays[-N] 这类非法 data path。
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

  // 加载维修任务列表（SWR缓存 + 显式加载提示 + 防抖）
  loadMaintenanceTasks: async function(force = false) {
    this.setData({ loadError: '' });
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    const userInfo = wx.getStorageSync('userInfo') || {};
    const openid = app.globalData.openid || userInfo.openid || 'anon';
    const cacheKey = `maint:manage:list:${openid}:${role}:page1:sz${this.data.pageSize}`;
    const TTL_SEC = 60;

    const cached = swr.get(cacheKey);

    // 首次进入或用户主动刷新时，一律展示加载中状态，避免误以为数据未更新
    if (force || !cached || !cached.exists) {
      this.setData({ loading: this.data.allTasks.length === 0 });
    }

    const nowTs = Date.now();
    if (!force) {
      if (this._fetchingMaintManage) return;
      if (this._lastMaintManageFetch && nowTs - this._lastMaintManageFetch < 1200 && cached && cached.fresh) {
        this.setData({ loading: false });
        return;
      }
    }

    const generation = this._listGeneration = (this._listGeneration || 0) + 1;
    this._fetchingMaintManage = true;
    this._lastMaintManageFetch = nowTs;

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: 1, pageSize: this.data.pageSize }
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
          loading: false
        });
        this.filterTasksByStatus(this.data.activeTab);
        swr.set(cacheKey, tasks, TTL_SEC);
      } else {
        this.setData({ loadError: result.message || '获取任务失败，请重试' });
      }
    } catch (err) {
      if (generation !== this._listGeneration) return;
      this.setData({ loadError: '加载失败，已保留上次内容，请重试' });
      console.error('获取维修任务列表失败', err);
      if (cached && cached.exists) {
        // 使用缓存结果兜底展示，同时给出提示
        this.setData({ allTasks: cached.data.map(formatTask) });
        this.filterTasksByStatus(this.data.activeTab);
        wx.showToast({ title: '网络异常，已展示上次数据', icon: 'none' });
      } else {
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    } finally {
      if (generation === this._listGeneration) { this._fetchingMaintManage = false; this.setData({ loading: false }); }
    }
  },

  // 加载更多（分页加载）
  loadMoreTasks: async function() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    if (this._fetchingMaintManageMore) return;

    this._fetchingMaintManageMore = true;
    const generation = this._listGeneration;
    const requestedPage = this.data.page;
    this.setData({ loadingMore: true, loadError: '', appendFailed: false });

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: this.data.page, pageSize: this.data.pageSize }
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
          const prevFilteredCount = this.data.filteredTasks.length;
          this.setData({
            allTasks: merged,
            hasMore,
            page: this.data.page + 1
          });
          this.filterTasksByStatus(this.data.activeTab);
          // 以「筛选后列表」的旧有边界作为新卡片动画起点；
          // 兼容筛选/搜索导致的新增数量与 newTasks.length 不一致的情况，避免负索引。
          const startIndex = Math.max(0, Math.min(prevFilteredCount, this.data.filteredTasks.length));
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
      this._fetchingMaintManageMore = false;
      this.setData({ loadingMore: false });
    }
  },

  // 根据状态过滤任务
  filterTasksByStatus: function(status) {
    let filteredTasks = [];

    // 根据选项卡状态筛选任务
    if (status === 'all') {
      filteredTasks = this.data.allTasks;
    } else {
      filteredTasks = this.data.allTasks.filter(task => task.taskStatus === status);
    }

    const ordered = filteredTasks
      .sort((a, b) => (time.toDate(b.createTime) || 0) - (time.toDate(a.createTime) || 0));

    this.setData({
      filteredTasks: ordered,
      originalFilteredTasks: ordered // 保存原始筛选结果，用于重置搜索
    }, () => {
      const keyword = (this.data.searchKeyword || '').trim();
      if (keyword) {
        this.applySearchFilter(keyword, { silent: true });
      }
      this.triggerCardAnimation(0);
    });
  },

  // 搜索输入事件
  onSearchInput: function(e) {
    this.setData({
      searchKeyword: e.detail.value
    });

    // 如果输入框为空，恢复原始筛选结果
    if (!e.detail.value) {
      this.setData({
        filteredTasks: this.data.originalFilteredTasks
      });
    }
  },

  // 执行搜索
  onSearch: function() {
    const keyword = this.data.searchKeyword || '';
    const results = this.applySearchFilter(keyword, { silent: false });
    if (results !== null) {
      wx.showToast({
        title: `找到 ${results} 条结果`,
        icon: 'none',
        duration: 1500
      });
    }
  },

  applySearchFilter: function(keyword, options = {}) {
    const trimmed = (keyword || '').trim().toLowerCase();
    if (!trimmed) {
      this.setData({
        filteredTasks: this.data.originalFilteredTasks
      });
      return null;
    }

    const searchResults = (this.data.originalFilteredTasks || []).filter(task => {
      return (
        (task.maintenanceTaskId && task.maintenanceTaskId.toLowerCase().includes(trimmed)) ||
        (task.level1 && task.level1.toLowerCase().includes(trimmed)) ||
        (task.level2 && task.level2.toLowerCase().includes(trimmed)) ||
        (task.level3 && task.level3.toLowerCase().includes(trimmed)) ||
        (task.otherDescription && task.otherDescription.toLowerCase().includes(trimmed)) ||
        (task.applicantName && task.applicantName.toLowerCase().includes(trimmed)) ||
        (task.assigneeName && task.assigneeName.toLowerCase().includes(trimmed))
      );
    });

    this.setData({
      filteredTasks: searchResults
    }, () => {
      if (!options.silent) {
        wx.showToast({
          title: `找到 ${searchResults.length} 条结果`,
          icon: 'none',
          duration: 1500
        });
      }
      this.triggerCardAnimation(0);
    });
  },

  clearSearchInput: function() {
    this.setData({
      searchKeyword: '',
      filteredTasks: this.data.originalFilteredTasks
    });
  },

  // 查看任务详情
  viewTaskDetail: function(e) {
    const task = e.currentTarget.dataset.task;

    // 管理列表只负责浏览与跳转，设置EW、删除、完成任务等操作统一在管理详情页底部展示
    // 导航到任务详情页面，添加fromManage参数标识来源
    wx.navigateTo({
      url: '../detail/index?taskId=' + task.maintenanceTaskId + '&fromManage=true'
    });
  },

  /**
   * 跳转到创建任务页面
   */
  goToCreateTask: function() {
    wx.navigateTo({
      url: '/pages/team/maintenance/create/index'
    });
  }
});
