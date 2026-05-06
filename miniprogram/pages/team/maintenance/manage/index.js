// pages/team/maintenance/manage/index.js
const app = getApp();
const api = require('../../../../utils/apiAdapter');
const swr = require('../../../../utils/swrCache');
const iconManager = require('../../../../utils/iconManager');
const time = require('../../../../utils/time');

const STATUS_MAP = {
  pending: '待受理',
  inProgress: '处理中',
  completed: '已完成',
  cancelled: '已撤销'
};

// const theme = require('../../../../utils/theme');

Page({

  /**
   * 页面的初始数据
   */
  data: {
    themeClass: '',
    activeTab: 'all', // 当前激活的选项卡
    activeTabName: '', // 当前选项卡名称
    allTasks: [], // 所有任务
    filteredTasks: [], // 筛选后的任务
    showEWModal: false, // 是否显示EW设置弹窗
    currentTask: null, // 当前操作的任务
    ewValue: 0.5, // EW值
    ewInputText: '0.5', // EW输入框的受控文本
    userRole: '', // 用户角色
    searchKeyword: '', // 搜索关键词
    originalFilteredTasks: [], // 搜索前的筛选任务，用于重置搜索
    showDeleteConfirmModal: false, // 是否显示删除确认弹窗
    taskToDelete: null, // 要删除的任务
    deleteConfirmInput: '', // 删除确认输入
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
    this.setData({ page: 1, hasMore: true, allTasks: [] });
    this.loadMaintenanceTasks(true);
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 只在非首次进入时刷新，避免 onLoad + onShow 双重加载
    if (!this._isFirstLoad) {
      this.setData({ page: 1, hasMore: true, allTasks: [] });
      this.loadMaintenanceTasks(false);
    }
    this._isFirstLoad = false;
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
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {},

// scroll-view 下拉刷新
onRefresherRefresh: function() {
    this.setData({ refresherTriggered: true, page: 1, hasMore: true, allTasks: [] });
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
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    const userInfo = wx.getStorageSync('userInfo') || {};
    const openid = app.globalData.openid || userInfo.openid || 'anon';
    const cacheKey = `maint:manage:list:${openid}:${role}:page1:sz${this.data.pageSize}`;
    const TTL_SEC = 60;

    const cached = swr.get(cacheKey);

    // 首次进入或用户主动刷新时，一律展示加载中状态，避免误以为数据未更新
    if (force || !cached || !cached.exists) {
      this.setData({ loading: true });
    }

    const nowTs = Date.now();
    if (!force) {
      if (this._fetchingMaintManage) return;
      if (this._lastMaintManageFetch && nowTs - this._lastMaintManageFetch < 1200 && cached && cached.fresh) {
        this.setData({ loading: false });
        return;
      }
    }

    this._fetchingMaintManage = true;
    this._lastMaintManageFetch = nowTs;

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: 1, pageSize: this.data.pageSize }
      });
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
          loading: false
        });
        this.filterTasksByStatus(this.data.activeTab);
        swr.set(cacheKey, tasks, TTL_SEC);
      } else {
        wx.showToast({ title: result.message || '获取任务失败', icon: 'none' });
      }
    } catch (err) {
      console.error('获取维修任务列表失败', err);
      if (cached && cached.exists) {
        // 使用缓存结果兜底展示，同时给出提示
        this.setData({ allTasks: cached.data });
        this.filterTasksByStatus(this.data.activeTab);
        wx.showToast({ title: '网络异常，已展示上次数据', icon: 'none' });
      } else {
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    } finally {
      this._fetchingMaintManage = false;
    }
  },

  // 加载更多（分页加载）
  loadMoreTasks: async function() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    if (this._fetchingMaintManageMore) return;

    this._fetchingMaintManageMore = true;
    this.setData({ loadingMore: true });

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTasksList',
        params: { page: this.data.page, pageSize: this.data.pageSize }
      });
      if (result.success) {
        const rawData = result.data;
        const tasksData = (rawData && Array.isArray(rawData.tasks)) ? rawData.tasks : (Array.isArray(rawData) ? rawData : []);
        const newTasks = tasksData.map(task => ({
          ...task,
          taskStatusText: STATUS_MAP[task.taskStatus] || '未知状态'
        }));
        if (newTasks.length > 0) {
          const merged = [...this.data.allTasks, ...newTasks];
          const hasMore = (rawData && typeof rawData.hasMore === 'boolean') ? rawData.hasMore : newTasks.length >= this.data.pageSize;
          this.setData({
            allTasks: merged,
            hasMore,
            page: this.data.page + 1
          });
          this.filterTasksByStatus(this.data.activeTab);
          const startIndex = this.data.filteredTasks.length - newTasks.length;
          this.triggerCardAnimation(startIndex);
        } else {
          this.setData({ hasMore: false });
        }
      }
    } catch (err) {
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

    // 置顶：紧急且待受理/进行中
    const isPinnedUrgent = t => t.isUrgent === 1 && (t.taskStatus === 'pending' || t.taskStatus === 'inProgress');

    const pinnedUrgent = filteredTasks
      .filter(isPinnedUrgent)
      .sort((a, b) => (time.toDate(b.createTime) || 0) - (time.toDate(a.createTime) || 0));

    const pinnedIds = new Set(pinnedUrgent.map(t => t.maintenanceTaskId));
    const rest = filteredTasks
      .filter(t => !pinnedIds.has(t.maintenanceTaskId))
      .sort((a, b) => (time.toDate(b.createTime) || 0) - (time.toDate(a.createTime) || 0));

    const ordered = pinnedUrgent.concat(rest);

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

    // 导航到任务详情页面，添加fromManage参数标识来源
    wx.navigateTo({
      url: '../detail/index?taskId=' + task.maintenanceTaskId + '&fromManage=true'
    });
  },

  // 设置EW值
  setEW: function(e) {
    const task = e.currentTarget.dataset.task;

    const ew = Number(task.ew || 0.5);
    this.setData({
      currentTask: task,
      ewValue: ew,
      ewInputText: ew % 1 === 0 ? ew.toString() : Number(ew.toFixed(2)).toString(),
      showEWModal: true
    });
  },

  // EW滑块实时变化
  onEWSliderChanging: function(e) {
    const value = Number(e.detail.value) || 0.5
    this.setData({ ewValue: value, ewInputText: value % 1 === 0 ? value.toString() : Number(value.toFixed(2)).toString() })
  },

  // EW滑块值变化（最终）
  onEWSliderChange: function(e) {
    const value = Number(e.detail.value) || 0.5
    this.setData({ ewValue: value, ewInputText: value % 1 === 0 ? value.toString() : Number(value.toFixed(2)).toString() })
  },

  // EW文本输入变化（仅更新受控文本，不立即归一化）
  onEWInputChange: function(e) {
    const text = e.detail.value
    this.setData({ ewInputText: text })
  },

  // 文本框失焦时做归一化（范围与步长）并回填至显示
  onEWInputBlur: function() {
    let value = parseFloat(this.data.ewInputText)
    if (isNaN(value)) value = 0.5
    value = Math.min(10, Math.max(0.5, value))
    value = Math.round(value / 0.5) * 0.5
    this.setData({ ewValue: value, ewInputText: value % 1 === 0 ? value.toString() : Number(value.toFixed(2)).toString() })
  },

  // 取消设置EW
  cancelEWSetting: function() {
    this.setData({
      showEWModal: false,
      currentTask: null,
      ewValue: 0.5,
      ewInputText: '0.5'
    });
  },

  // 阻止穿透滚动（空处理器即可拦截）
  preventTouchMove: function() {
    return
  },

  // 确认设置EW
  confirmEWSetting: async function() {
    if (!this.data.currentTask) return;

    const taskId = this.data.currentTask.maintenanceTaskId;
    const ewValue = this.data.ewValue;

    wx.showLoading({
      title: '保存中...',
    });

    try {
      // 离线处理逻辑保持不变
      const network = require('../../../../utils/network');
      if (!network.isOnline()) {
        const outbox = require('../../../../utils/outbox');
        outbox.add('maintenanceTasks', 'updateMaintenanceTasks', {
          maintenanceTaskId: taskId,
          updateData: { ew: ewValue }
        });
        wx.hideLoading();
        this.cancelEWSetting();
        wx.showToast({ title: '网络不稳，已加入队列', icon: 'none', duration: 2500 });
        return;
      }

      // 步骤1: 更新任务本身的EW值
      const updateTaskRes = await api.call('maintenanceTasks', {
        action: 'updateMaintenanceTasks',
        params: {
          maintenanceTaskId: taskId,
          updateData: { ew: ewValue }
        }
      });

      if (!updateTaskRes.success) {
        throw new Error(updateTaskRes.message || '设置EW失败');
      }

      this.updateLocalTaskEW(taskId, ewValue);

      // 步骤2: 更新等效工作量汇总
      await api.call('equivalentWorkloadAssessment', {
        action: 'updateTasksEW',
        params: {
          maintenanceTaskId: taskId,
          ew: ewValue
        }
      });

      wx.hideLoading();

      // 先关闭弹窗，再显示成功提示
      this.cancelEWSetting();

      // 延迟显示成功提示，确保弹窗关闭完成
      setTimeout(() => {
        wx.showToast({
          title: 'EW值设置成功',
          icon: 'success',
          duration: 2000
        });
      }, 100);

    } catch (err) {
      console.error('设置EW失败', err);
      wx.hideLoading();
      this.cancelEWSetting();

      wx.showToast({
        title: err.message || '网络错误，请重试',
        icon: 'none',
        duration: 3000
      });
    }
  },

  // 更新本地任务的EW值
  updateLocalTaskEW: function(taskId, ewValue) {
    if (!taskId) return;

    // 使用路径更新，避免整表写回
    const updates = {};
    const updateIndex = (list, listName) => {
      const idx = list.findIndex(t => t && t.maintenanceTaskId === taskId);
      if (idx !== -1) {
        updates[`${listName}[${idx}].ew`] = ewValue;
      }
    };

    updateIndex(this.data.allTasks, 'allTasks');
    updateIndex(this.data.filteredTasks, 'filteredTasks');
    updateIndex(this.data.originalFilteredTasks, 'originalFilteredTasks');

    if (Object.keys(updates).length > 0) {
      this.setData(updates);
    }
  },

  // 删除任务
  deleteTask: function(e) {
    const task = e.currentTarget.dataset.task;
    if (!task || !task.maintenanceTaskId) return;

    // 第一次确认
    wx.showModal({
      title: '确认删除',
      content: '确定要删除此维修任务吗？删除后无法恢复。',
      success: res => {
        if (res.confirm) {
          // 显示自定义二次确认弹窗
          this.setData({
            showDeleteConfirmModal: true,
            taskToDelete: task,
            deleteConfirmInput: ''
          });
        }
      }
    });
  },

  // 删除确认输入事件
  onDeleteConfirmInput: function(e) {
    this.setData({
      deleteConfirmInput: e.detail.value
    });
  },

  // 取消删除确认
  cancelDeleteConfirm: function() {
    this.setData({
      showDeleteConfirmModal: false,
      taskToDelete: null,
      deleteConfirmInput: ''
    });
  },

  // 确认删除
  confirmDelete: async function() {
    // 防御性检查：立即读取并清空，避免竞态
    const task = this.data.taskToDelete;
    const taskId = task ? task.maintenanceTaskId : undefined;

    if (!task || !taskId) {
      this.cancelDeleteConfirm();
      return;
    }

    const input = this.data.deleteConfirmInput;

    // 验证输入的任务ID是否正确
    if (input !== taskId) {
      wx.showToast({
        title: '任务编号不匹配，请重新输入',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    this.setData({ showDeleteConfirmModal: false });

    wx.showLoading({
      title: '删除中...',
    });

    try {
      // 离线处理逻辑保持不变
      const network = require('../../../../utils/network');
      if (!network.isOnline()) {
        const outbox = require('../../../../utils/outbox');
        outbox.add('maintenanceTasks', 'deleteMaintenanceTask', { maintenanceTaskId: taskId });
        wx.hideLoading();
        this.cancelDeleteConfirm();
        wx.showToast({ title: '网络不稳，已加入队列', icon: 'none', duration: 2500 });
        return;
      }

      const res = await api.call('maintenanceTasks', {
        action: 'deleteMaintenanceTask',
        params: { maintenanceTaskId: taskId }
      });

      if (res.success) {
        // 立即从本地列表移除，让用户看到即时效果
        this.removeLocalTask(taskId);

        wx.showToast({
          title: '删除成功',
          icon: 'success'
        });

        // 异步全量刷新，确保后端状态与本地完全一致
        setTimeout(() => {
          this.loadMaintenanceTasks();
        }, 500);

        app.getTodoTotalCount && app.getTodoTotalCount();
      } else {
        wx.showToast({
          title: res.message || '删除失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('删除任务失败', err);
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
      this.cancelDeleteConfirm();
    }
  },

  // 从本地列表中移除任务
  removeLocalTask: function(taskId) {
    if (!taskId) return;

    // 从allTasks中移除
    const allTasks = this.data.allTasks.filter(t => t && t.maintenanceTaskId !== taskId);

    // 从filteredTasks中移除
    const filteredTasks = this.data.filteredTasks.filter(t => t && t.maintenanceTaskId !== taskId);

    // 从originalFilteredTasks中移除
    const originalFilteredTasks = this.data.originalFilteredTasks.filter(t => t && t.maintenanceTaskId !== taskId);

    // 更新数据
    this.setData({
      allTasks,
      filteredTasks,
      originalFilteredTasks
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
