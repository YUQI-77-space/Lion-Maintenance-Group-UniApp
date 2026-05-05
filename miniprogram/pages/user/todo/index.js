const app = getApp();
const api = require('../../../utils/apiAdapter');
const SubscriptionAuth = require('../../../utils/subscriptionAuth');
const iconManager = require('../../../utils/iconManager');

Page({
  data: {
    // 左侧导航分类
    categories: [
      { key: 'maintenance', label: '维修任务', count: 0 },
      { key: 'volunteer', label: '志愿活动', count: 0 },
      { key: 'duty', label: '值班任务', count: 0 }
    ],
    activeCategory: 'maintenance',
    isInternal: false,
    themeClass: '',

    // 任务数据
    maintenanceTasks: [],
    volunteerTasks: [],
    dutyTasks: [],

    // 撤销弹窗
    showCancelModal: false,
    cancelReason: '',
    cancelTaskId: '',

    // 加载状态
    loading: false,

    // 下拉刷新状态
    refresherTriggered: false,

    // 卡片入场动画延迟（毫秒）- 三种类型各自独立
    maintenanceDelays: {},
    volunteerDelays: {},
    dutyDelays: {},

    // 图标资源
    iconRepair: iconManager.get('biz_repair'),
    iconVolunteer: iconManager.get('biz_volunteer'),
    iconCalendar: iconManager.get('team_calendar'),
    iconEmpty: iconManager.get('common_empty')
  },

  onLoad(options) {
    this.initRoleFlag();

    // 根据选项卡参数设置默认分类
    if (options.tab) {
      const requestedTab = options.tab;
      const allowTab = this.data.isInternal ? requestedTab : 'maintenance';
      this.setData({ activeCategory: allowTab });
    }

    this.loadAllTasks();
  },

  // 角色权限初始化
  initRoleFlag() {
    const role = (app && app.globalData && app.globalData.role) || wx.getStorageSync('role') || 'user';
    const isInternal = (role === 'member' || role === 'leader' || role === 'admin');
    const categories = this.data.isInternal
      ? [
          { key: 'maintenance', label: '维修任务', count: 0 },
          { key: 'volunteer', label: '志愿活动', count: 0 },
          { key: 'duty', label: '值班任务', count: 0 }
        ]
      : [
          { key: 'maintenance', label: '维修任务', count: 0 }
        ];
    this.setData({ isInternal, categories });
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 刷新角色（防止在别处切换后未更新）
    this.initRoleFlag();

    // 加载所有类型的待办事项
    this.loadAllTasks();
  },

  /**
   * 一次性加载所有待办事项
   */
  loadAllTasks() {
    this.loadMaintenanceTasks();
    if (this.data.isInternal) {
      this.loadVolunteerTasks();
      this.loadDutyTasks();
    } else {
      this.setData({ volunteerTasks: [], dutyTasks: [] });
    }
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {},

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.onRefresherRefresh();
  },

  /**
   * 左侧分类切换
   */
  onCategoryChange: function(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.activeCategory === key) return;

    this.setData({ activeCategory: key });

    // 加载对应分类数据
    this.loadDataByCategory(key);
  },

  /**
   * 根据分类加载数据
   */
  loadDataByCategory(category) {
    switch (category) {
      case 'maintenance':
        this.loadMaintenanceTasks();
        break;
      case 'volunteer':
        if (this.data.isInternal) this.loadVolunteerTasks();
        break;
      case 'duty':
        if (this.data.isInternal) this.loadDutyTasks();
        break;
    }
  },

  /**
   * 下拉刷新处理
   */
  onRefresherRefresh: function() {
    this.setData({ refresherTriggered: true });

    this.loadDataByCategory(this.data.activeCategory)
      .finally(() => {
        this.setData({ refresherTriggered: false });
        this.updateAllPendingCounts();
        this.triggerCardAnimation(this.data.activeCategory, 0);
      });
  },

  /**
   * 触发指定分类的卡片入场动画
   * type: 'maintenance' | 'volunteer' | 'duty'
   * startIndex: 从第几张开始动画
   */
  triggerCardAnimation: function(type, startIndex = 0) {
    let tasks;
    switch (type) {
      case 'maintenance':
        tasks = this.data.maintenanceTasks;
        break;
      case 'volunteer':
        tasks = this.data.volunteerTasks;
        break;
      case 'duty':
        tasks = this.data.dutyTasks;
        break;
      default:
        return;
    }

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
    const delayKey = type + 'Delays';
    for (let i = startIndex; i < endIndex; i++) {
      const delay = (i - startIndex) * 100; // 每张卡片延迟 100ms
      delays[`${delayKey}[${i}]`] = delay;
    }

    // 设置延迟数据，触发动画
    this.setData(delays);
  },

  // 加载维修任务待办
  async loadMaintenanceTasks() {
    this.setData({ loading: true });
    const openid = app.globalData.openid;
    try {
      const result = await api.call('userToDoList', {
        action: 'getTodoList',
        params: { type: 'maintenance', userId: openid }
      });
      if (result.success) {
        this.setData({ maintenanceTasks: result.data || [] });
        this.calculatePendingMaintenanceCount();
        this.triggerCardAnimation('maintenance', 0);
      } else {
        wx.showToast({ title: '获取维修任务失败', icon: 'none' });
      }
    } catch (err) {
      console.error('[loadMaintenanceTasks] 调用失败', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 加载志愿活动待办
  async loadVolunteerTasks() {
    const openid = app.globalData.openid;
    try {
      const result = await api.call('userToDoList', {
        action: 'getTodoList',
        params: { type: 'volunteer', userId: openid }
      });
      if (result.success) {
        this.setData({ volunteerTasks: result.data || [] });
        this.calculatePendingVolunteerCount();
        this.triggerCardAnimation('volunteer', 0);
      } else {
        console.error('获取志愿活动失败', result.message);
      }
    } catch (err) {
      console.error('[loadVolunteerTasks] 调用失败', err);
    }
  },

  // 加载值班任务待办
  async loadDutyTasks() {
    const openid = app.globalData.openid;
    try {
      const result = await api.call('userToDoList', {
        action: 'getTodoList',
        params: { type: 'duty', userId: openid }
      });
      if (result.success) {
        const processedDutyTasks = this.processDutyTasksStatus(result.data || []);
        this.setData({ dutyTasks: processedDutyTasks });
        this.calculatePendingDutyCount();
        this.triggerCardAnimation('duty', 0);
      } else {
        console.error('获取值班任务失败', result.message);
      }
    } catch (err) {
      console.error('[loadDutyTasks] 调用失败', err);
    }
  },

  // 处理值班任务状态
  processDutyTasksStatus: function(dutyTasks) {
    return dutyTasks.map(duty => {
      const dutyStatus = duty.dutyStatus || 'pending';
      let dutyStatusText;
      switch (dutyStatus) {
        case 'pending':
          dutyStatusText = '待值班';
          break;
        case 'inProgress':
          dutyStatusText = '进行中';
          break;
        case 'ended':
          dutyStatusText = '已结束';
          break;
        default:
          dutyStatusText = '待值班';
      }
      return { ...duty, dutyStatus, dutyStatusText };
    });
  },

  // 查看维修任务详情
  viewMaintenanceDetail: function(e) {
    const taskId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/user/todo/maintenance-detail/index?taskId=' + taskId
    });
  },

  // 确认完成维修任务
  confirmCompleteTask: async function(e) {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }

    const taskId = e.currentTarget ? e.currentTarget.dataset.id : (e.id || e);
    const isApplicant = e.currentTarget ? e.currentTarget.dataset.isApplicant === 'true' : (e.isApplicant || true);

    if (!isApplicant) {
      wx.showToast({ title: '只有申请人可以确认任务完成', icon: 'none' });
      return;
    }

    const modalRes = await wx.showModal({
      title: '确认完成',
      content: '确认此维修任务已完成吗？',
    });

    if (modalRes.confirm) {
      wx.showLoading({ title: '处理中...' });
      try {
        const res = await api.call('maintenanceTasks', {
          action: 'completeMaintenanceTask',
          params: {
            maintenanceTaskId: taskId,
            completeTime: new Date().toISOString()
          }
        });

        wx.hideLoading();

        if (res.success) {
          const tasks = [...this.data.maintenanceTasks];
          const taskIndex = tasks.findIndex(task => task && task.taskId === taskId);
          if (taskIndex !== -1) {
            tasks.splice(taskIndex, 1);
            this.setData({ maintenanceTasks: tasks });
            this.calculatePendingMaintenanceCount();
            this.updateAllPendingCounts();
            app.getTodoTotalCount && app.getTodoTotalCount();
          }
          wx.showToast({ title: '任务已完成', icon: 'success', duration: 2000 });
          app.getUnreadMessageCount && app.getUnreadMessageCount();
          setTimeout(() => { this.loadMaintenanceTasks(); }, 300);
        } else {
          wx.showToast({ title: res.message || '操作失败', icon: 'none', duration: 2000 });
        }
      } catch (err) {
        wx.hideLoading();
        console.error('[confirmCompleteTask] 调用失败', err);
        wx.showToast({ title: '网络错误', icon: 'none', duration: 2000 });
      }
    }
  },

  // 打开撤销弹窗
  openCancelModalFromList: function(e) {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    const taskId = e.currentTarget ? e.currentTarget.dataset.id : (e.id || e);
    this.setData({ showCancelModal: true, cancelReason: '', cancelTaskId: taskId });
  },

  // 关闭撤销弹窗
  closeCancelModal: function() {
    this.setData({ showCancelModal: false, cancelReason: '', cancelTaskId: '' });
  },

  // 输入撤销原因
  onCancelReasonInput: function(e) {
    this.setData({ cancelReason: e.detail.value });
  },

  // 确认撤销
  confirmCancelTaskFromList: async function() {
    const taskId = this.data.cancelTaskId;
    const cancelReason = (this.data.cancelReason || '').trim();

    if (!cancelReason) {
      wx.showToast({ title: '请输入撤销原因', icon: 'none' });
      return;
    }

    this.closeCancelModal();

    const modalRes = await wx.showModal({
      title: '确认撤销任务',
      content: `撤销原因：${cancelReason}\n\n确认撤销此维修任务？撤销后将无法恢复。`,
    });

    if (modalRes.confirm) {
      try {
        wx.showLoading({ title: '请求消息授权...' });

        const authResult = await SubscriptionAuth.requestSubscribeMessage(
          [SubscriptionAuth.TEMPLATES.TASK_CANCELLED],
          SubscriptionAuth.SCENES.TASK_CANCEL,
          { showTip: true, allowPartialSuccess: true }
        );

        wx.showLoading({ title: '处理中...' });

      } catch (authError) {
        console.error('订阅消息授权失败:', authError);
        wx.showLoading({ title: '处理中...' });
      }
      try {
        const res = await api.call('maintenanceTasks', {
          action: 'cancelMaintenanceTask',
          params: { maintenanceTaskId: taskId, cancelReason }
        });

        wx.hideLoading();
        if (res.success) {
          const tasks = [...this.data.maintenanceTasks];
          const index = tasks.findIndex(task => task && task.taskId === taskId);
          if (index !== -1) {
            tasks.splice(index, 1);
            this.setData({ maintenanceTasks: tasks });
            this.calculatePendingMaintenanceCount();
            this.updateAllPendingCounts();
            app.getTodoTotalCount && app.getTodoTotalCount();
          }
          wx.showToast({ title: '已撤销', icon: 'success', duration: 2000 });
          app.getUnreadMessageCount && app.getUnreadMessageCount();
          setTimeout(() => { this.loadMaintenanceTasks(); }, 100);
        } else {
          wx.showToast({ title: res.message || '撤销失败', icon: 'none', duration: 2000 });
        }
      } catch (err) {
        wx.hideLoading();
        console.error('[confirmCancelTaskFromList] 调用失败', err);
        wx.showToast({ title: '网络错误', icon: 'none', duration: 2000 });
      }
    }
  },

  // 查看志愿活动详情
  viewVolunteerDetail: function(e) {
    const taskId = e.currentTarget.dataset.taskid;
    wx.navigateTo({
      url: '/pages/user/todo/volunteer-detail/index?taskId=' + taskId
    });
  },

  /**
   * 计算待处理维修任务数量
   */
  calculatePendingMaintenanceCount() {
    const pendingTasks = this.data.maintenanceTasks.filter(task => {
      const status = task && task.taskStatus;
      return status === 'pending' || status === 'inProgress';
    });
    this.updateCategoryCount('maintenance', pendingTasks.length);
  },

  /**
   * 计算待处理志愿活动数量
   */
  calculatePendingVolunteerCount() {
    const pendingActivities = this.data.volunteerTasks.filter(activity =>
      activity.activityStatus !== 'ended'
    );
    this.updateCategoryCount('volunteer', pendingActivities.length);
  },

  /**
   * 计算待处理值班任务数量
   */
  calculatePendingDutyCount() {
    const pendingDuties = this.data.dutyTasks.filter(duty => {
      return duty.dutyStatus === 'pending' || duty.dutyStatus === 'inProgress';
    });
    this.updateCategoryCount('duty', pendingDuties.length);
  },

  /**
   * 更新分类计数
   */
  updateCategoryCount(key, count) {
    const categories = this.data.categories.map(cat => {
      if (cat.key === key) {
        return { ...cat, count };
      }
      return cat;
    });
    this.setData({ categories });
  },

  /**
   * 更新所有待处理任务计数
   */
  updateAllPendingCounts() {
    this.calculatePendingMaintenanceCount();
    if (this.data.isInternal) {
      this.calculatePendingVolunteerCount();
      this.calculatePendingDutyCount();
    } else {
      this.updateCategoryCount('volunteer', 0);
      this.updateCategoryCount('duty', 0);
    }
  },

  // 阻止事件穿透
  noop() {}
})
