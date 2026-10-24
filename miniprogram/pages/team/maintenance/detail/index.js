// pages/team/maintenance/detail/index.js
const app = getApp();
const api = require('../../../../utils/apiAdapter');
const time = require('../../../../utils/time');
const SubscriptionAuth = require('../../../../utils/subscriptionAuth');

// 任务状态文案，与列表页 / 管理页保持一致
const STATUS_MAP = {
  pending: '待受理',
  inProgress: '进行中',
  completed: '已完成',
  cancelled: '已取消'
};

Page({

  /**
   * 页面的初始数据
   */
  returnToList() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/profile/index' }) }); },
  data: {
    detailError: '',
    taskId: '', // 任务ID
    taskDetail: {}, // 任务详情
    userRole: '', // 用户角色
    userOpenid: '', // 用户openid
    fromManage: false, // 是否从管理界面进入
    // 编辑受理人相关数据
    showAssigneeDrawer: false,
    showSelectedPanel: false,
    membersList: [],
    filteredMembers: [],
    selectedMembers: [],
    selectedMemberList: [],
    selectedMemberPreview: [],
    selectedMemberExtraCount: 0,
    pendingChangeCount: 0,
    hasPendingChanges: false,
    assigneeLoading: false,
    memberLookup: {},
    assigneeDrawerClosing: false,
    canManageAssignees: false,
    // 管理操作（设置EW / 删除 / 完成）
    showEWModal: false,
    currentTask: null,
    ewValue: 0.5,
    ewInputText: '0.5',
    ewSaving: false,
    showDeleteConfirmModal: false,
    taskToDelete: null,
    deleteConfirmInput: '',
    deleting: false,
    completing: false,
    loading: false, // 加载状态
    // 部门筛选相关
    departmentFilter: 'all', // 当前筛选的部门：'all', '运营管理部', '电子技术部', '机电维修部'
    departmentList: ['全部', '电子技术部', '机电维修部', '运营管理部']
  },

  /**
   * 格式化时间为标准显示格式
   * @param {string|Date} time - 时间字符串或Date对象
   * @returns {string} 格式化后的时间字符串
   */
  formatTime: function(input) {
    if (!input) return '';
    // 统一使用时间工具，保持到秒
    return time.formatDateTime(input);
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 获取任务ID
    const taskId = options.taskId;
    if (!taskId) {
      wx.showToast({
        title: '任务ID不存在',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
      return;
    }

    // 获取是否从管理界面进入
    const fromManage = options.fromManage === 'true';

    // 确保app.globalData存在（app是页面顶层变量，同步可用）
    if (!app || !app.globalData) {
      console.error('app或app.globalData不存在');
      wx.showToast({ title: '系统异常，请重启小程序', icon: 'none', duration: 2000 });
      setTimeout(() => { wx.navigateBack(); }, 2000);
      return;
    }

    const userRole = app.globalData.role || 'user';
    const userOpenid = app.globalData.openid || '';

    this.setData({
      taskId: taskId,
      userRole: userRole,
      userOpenid: userOpenid,
      fromManage: fromManage
    });

    // 管理入口只允许组长访问，避免组员通过直链看到管理信息或操作按钮
    if (fromManage && userRole !== 'leader') {
      wx.showToast({
        title: '权限不足',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
      return;
    }

    // 获取任务详情
    this.getTaskDetail();
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
  onPullDownRefresh() {

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

  },

  // 获取任务详情
  getTaskDetail: async function() {
    this.setData({ loading: true, detailError: '' });
    
    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTaskDetail',
        params: { maintenanceTaskId: this.data.taskId }
      });

      if (result.success) {
        const taskDetail = result.data || {};
        // 格式化时间字段
        if (taskDetail.applicantTime) taskDetail.applicantTime = this.formatTime(taskDetail.applicantTime);
        if (taskDetail.completeTime) taskDetail.completeTime = this.formatTime(taskDetail.completeTime);
        if (taskDetail.assigneeTime) taskDetail.assigneeTime = this.formatTime(taskDetail.assigneeTime);
        if (taskDetail.additionalAssignees && taskDetail.additionalAssignees.length > 0) {
          taskDetail.additionalAssignees.forEach(assignee => {
            if (assignee && assignee.assigneeTime) assignee.assigneeTime = this.formatTime(assignee.assigneeTime);
          });
        }
        // 确保taskDetail有所有必要的字段
        const safeTaskDetail = {
          maintenanceTaskId: '',
          level1: '',
          level2: '',
          level3: '',
          otherDescription: '',
          appointmentTime: '',
          comments: '',
          cost: 0,
          ew: 0,
          completeTime: '',
          applicantName: '',
          applicantStudentId: '', // 添加申请人学号字段
          applicantQqId: '',
          applicantTime: '',
          assigneeId: '',
          assigneeName: '',
          assigneeStudentId: '', // 添加受理人学号字段
          assigneeQqId: '',
          assigneeTime: '',
          cancelReason: '',
          additionalAssignees: [],
          specialFields: {},
          ...taskDetail // 用实际数据覆盖默认值
        };
        
        const nextStatus = safeTaskDetail.taskStatus || 'pending';
        // 状态文案与列表页一致：详情页不再只靠卡片描边颜色表达状态
        safeTaskDetail.taskStatusText = STATUS_MAP[nextStatus] || '未知状态';
        this.setData({ 
          taskDetail: safeTaskDetail, 
          canManageAssignees: this.shouldEnableAssigneeManagement(nextStatus)
        });
      } else {
        this.setData({ detailError: result.message || '无法查看此记录，可能已删除或权限已变化' });
      }
    } catch (err) {
      console.error('获取任务详情失败', err);
      this.setData({ detailError: '读取失败，请重新加载或返回列表' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 认领任务
  async claimTask(e) {
    if (this.data.claiming) return;
    const taskId = this.data.taskId;
    const task = this.data.taskDetail;
    if (!taskId || !task || task.applicantId === app.globalData.openid) { wx.showToast({ title: '不能受理自己的报修', icon: 'none' }); return; }
    this.setData({ claiming: true });
    try {
      const confirmation = await wx.showModal({ title: '受理维修任务', content: `受理任务 ${taskId}？请核对问题与预约时间。`, confirmText: '受理任务', cancelText: '返回' });
      if (!confirmation.confirm) return;
      try { await SubscriptionAuth.requestAssigneeAuth({ showTip: true, allowPartialSuccess: true }); } catch (_) {}
      const latest = await api.call('maintenanceTasks', { action: 'getMaintenanceTaskDetail', params: { maintenanceTaskId: taskId } });
      if (!latest.success || !latest.data || latest.data.taskStatus !== 'pending') {
        wx.showToast({ title: latest.success ? '该任务状态已变化，请查看最新受理信息' : (latest.message || '无法核对任务状态'), icon: 'none' });
        await this.getTaskDetail(); return;
      }
      const result = await api.call('maintenanceTasks', { action: 'assignMaintenanceTask', params: { maintenanceTaskId: taskId, assigneeId: app.globalData.openid }, config: { retries: 0 } });
      wx.showToast({ title: result.success ? '受理成功' : (result.code === 503 ? '结果待核实，正在刷新任务' : (result.message || '未能受理，请核对最新任务')), icon: result.success ? 'success' : 'none' });
      await this.getTaskDetail();
      if (result.success) app.publish('maintenanceChanged', { taskId });
    } finally { this.setData({ claiming: false }); }
  },
  // 返回上一页
  goBack: function() {
    wx.navigateBack();
  },
  // 是否为管理详情页的组长操作
  canManageTask: function() {
    return this.data.fromManage && this.data.userRole === 'leader';
  },

  // 组长完成维修任务：仅进行中的任务可走此路径
  async completeTask() {
    if (this.data.operationBusy) return;
    this.setData({ operationBusy: true });
    try { return await this._guardedCompleteTask(); }
    finally { this.setData({ operationBusy: false }); }
  },
  async _guardedCompleteTask() {
    console.log('[完成任务] 点击，taskId=', this.data.taskId, 'status=', (this.data.taskDetail || {}).taskStatus, 'fromManage=', this.data.fromManage, 'role=', this.data.userRole);

    if (!this.canManageTask()) {
      wx.showToast({ title: '暂无操作权限', icon: 'none' });
      return;
    }
    if (this.data.completing) return;

    const task = this.data.taskDetail || {};
    if (task.taskStatus !== 'inProgress') {
      wx.showToast({ title: '仅进行中的任务可以完成', icon: 'none' });
      return;
    }

    const modalRes = await new Promise(resolve => {
      wx.showModal({
        title: '确认完成',
        content: '确认此维修任务已完成吗？',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes || !modalRes.confirm) return;

    this.setData({ completing: true });
    wx.showLoading({ title: '处理中...' });

    try {
      // 离线处理：进入队列，等网络恢复后由服务端校验状态与权限
      const network = require('../../../../utils/network');
      if (!network.isOnline()) {

        wx.hideLoading();
        wx.showToast({ title: '当前离线，尚未提交，输入已保留', icon: 'none', duration: 2500 });
        return;
      }

      const completeTime = this.formatTime(new Date());
      const res = await api.call('maintenanceTasks', {
        action: 'completeMaintenanceTask', config: { retries: 0 },
        params: {
          maintenanceTaskId: this.data.taskId,
          completeTime: completeTime
        }
      });

      if (res.success) {
        const updatedTask = {
          ...this.data.taskDetail,
          taskStatus: 'completed',
          taskStatusText: STATUS_MAP.completed,
          completeTime: completeTime
        };
        this.setData({
          taskDetail: updatedTask,
          canManageAssignees: false
        });
        this.handleTaskCompleted();
        // 强制重新拉取详情，确保界面以服务端最新状态为准
        setTimeout(() => { this.getTaskDetail(); }, 300);
      } else {
        console.warn('[完成任务] 服务端拒绝:', res);
        wx.showModal({
          title: '无法完成任务',
          content: res.message || '操作失败，请稍后重试',
          showCancel: false,
          confirmText: '我知道了'
        });
      }
    } catch (err) {
      console.error('组长完成任务失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ completing: false });
    }
  },

  // 打开EW设置弹窗
  setEW: function() {
    if (!this.canManageTask()) {
      wx.showToast({ title: '暂无操作权限', icon: 'none' });
      return;
    }
    if (this.data.completing) return;

    const task = this.data.taskDetail || {};
    if (task.taskStatus !== 'completed') {
      wx.showToast({ title: '任务完成后才能设置EW', icon: 'none' });
      return;
    }

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
    const value = Number(e.detail.value) || 0.5;
    this.setData({ ewValue: value, ewInputText: value % 1 === 0 ? value.toString() : Number(value.toFixed(2)).toString() });
  },

  // EW滑块值变化（最终）
  onEWSliderChange: function(e) {
    const value = Number(e.detail.value) || 0.5;
    this.setData({ ewValue: value, ewInputText: value % 1 === 0 ? value.toString() : Number(value.toFixed(2)).toString() });
  },

  // EW文本输入变化
  onEWInputChange: function(e) {
    this.setData({ ewInputText: e.detail.value });
  },

  // EW文本框失焦时归一化
  onEWInputBlur: function() {
    let value = parseFloat(this.data.ewInputText);
    if (isNaN(value)) value = 0.5;
    value = Math.min(10, Math.max(0.5, value));
    value = Math.round(value / 0.5) * 0.5;
    this.setData({ ewValue: value, ewInputText: value % 1 === 0 ? value.toString() : Number(value.toFixed(2)).toString() });
  },

  // 取消设置EW
  cancelEWSetting: function() {
    this.setData({
      showEWModal: false,
      currentTask: null,
      ewValue: 0.5,
      ewInputText: '0.5',
      ewSaving: false
    });
  },

  // 确认设置EW
  async confirmEWSetting() {
    if (this.data.operationBusy) return;
    this.setData({ operationBusy: true });
    try { return await this._guardedConfirmEWSetting(); }
    finally { this.setData({ operationBusy: false }); }
  },
  async _guardedConfirmEWSetting() {
    if (!this.canManageTask()) {
      wx.showToast({ title: '暂无操作权限', icon: 'none' });
      return;
    }
    if (this.data.ewSaving || !this.data.currentTask) return;

    const taskId = this.data.currentTask.maintenanceTaskId;
    const ewValue = this.data.ewValue;
    this.setData({ ewSaving: true });
    wx.showLoading({ title: '保存中...' });

    try {
      const network = require('../../../../utils/network');
      if (!network.isOnline()) {

        this.updateLocalTaskEW(taskId, ewValue);
        this.refreshPreviousPage(true);
        wx.hideLoading();
        this.cancelEWSetting();
        wx.showToast({ title: '当前离线，尚未提交，输入已保留', icon: 'none', duration: 2500 });
        return;
      }

      // 第一步：更新任务本身的EW值
      const updateTaskRes = await api.call('maintenanceTasks', {
        action: 'updateMaintenanceTasks', config: { retries: 0 },
        params: {
          maintenanceTaskId: taskId,
          updateData: { ew: ewValue }
        }
      });
      if (!updateTaskRes.success) {
        throw new Error(updateTaskRes.message || '设置EW失败');
      }

      // 第二步：更新等效工作量汇总
      const updateEwaRes = await api.call('equivalentWorkloadAssessment', {
        action: 'updateTasksEW', config: { retries: 0 },
        params: {
          maintenanceTaskId: taskId,
          ew: ewValue
        }
      });
      if (!updateEwaRes.success) {
        throw new Error(updateEwaRes.message || '更新等效工作量汇总失败');
      }

      this.updateLocalTaskEW(taskId, ewValue);
      this.refreshPreviousPage(true);
      wx.hideLoading();
      this.cancelEWSetting();
      setTimeout(() => {
        wx.showToast({ title: 'EW值设置成功', icon: 'success', duration: 2000 });
      }, 100);
    } catch (err) {
      console.error('设置EW失败', err);
      wx.hideLoading();
      this.cancelEWSetting();
      wx.showToast({ title: err.message || '网络错误，请重试', icon: 'none', duration: 3000 });
    } finally {
      wx.hideLoading();
      this.setData({ ewSaving: false });
    }
  },

  // 更新当前详情页的EW值
  updateLocalTaskEW: function(taskId, ewValue) {
    if (!taskId) return;
    const currentTask = this.data.taskDetail || {};
    if (currentTask.maintenanceTaskId !== taskId) return;
    const updatedTask = { ...currentTask, ew: ewValue };
    this.setData({
      taskDetail: updatedTask,
      currentTask: updatedTask
    });
  },

  // 删除任务（管理详情页）
  deleteTask: function() {
    if (!this.canManageTask()) {
      wx.showToast({ title: '暂无操作权限', icon: 'none' });
      return;
    }
    if (this.data.completing) return;

    const task = this.data.taskDetail || {};
    if (!task || !task.maintenanceTaskId) {
      wx.showToast({ title: '无法获取任务信息', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: '确定要删除此维修任务吗？删除后无法恢复。',
      success: res => {
        if (res.confirm) {
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
    this.setData({ deleteConfirmInput: e.detail.value });
  },

  // 取消删除确认
  cancelDeleteConfirm: function() {
    this.setData({
      showDeleteConfirmModal: false,
      taskToDelete: null,
      deleteConfirmInput: ''
    });
  },

  // 确认删除任务
  async confirmDelete() {
    if (this.data.operationBusy) return;
    this.setData({ operationBusy: true });
    try { return await this._guardedConfirmDelete(); }
    finally { this.setData({ operationBusy: false }); }
  },
  async _guardedConfirmDelete() {
    if (!this.canManageTask()) {
      wx.showToast({ title: '暂无操作权限', icon: 'none' });
      return;
    }
    if (this.data.deleting) return;

    const task = this.data.taskToDelete;
    const taskId = task ? task.maintenanceTaskId : undefined;
    if (!task || !taskId) {
      this.cancelDeleteConfirm();
      return;
    }

    const input = this.data.deleteConfirmInput;
    if (input !== taskId) {
      wx.showToast({ title: '任务编号不匹配，请重新输入', icon: 'none', duration: 2000 });
      return;
    }

    this.setData({ deleting: true, showDeleteConfirmModal: false });
    wx.showLoading({ title: '删除中...' });

    try {
      const network = require('../../../../utils/network');
      if (!network.isOnline()) {

        wx.hideLoading();
        this.cancelDeleteConfirm();
        wx.showToast({ title: '当前离线，尚未提交，输入已保留', icon: 'none', duration: 2500 });
        return;
      }

      const res = await api.call('maintenanceTasks', {
        action: 'deleteMaintenanceTask', config: { retries: 0 },
        params: { maintenanceTaskId: taskId }
      });

      if (res.success) {
        wx.showToast({ title: '删除成功', icon: 'success' });
        app.getTodoTotalCount && app.getTodoTotalCount();
        this.refreshPreviousPage(true);
        setTimeout(() => { wx.navigateBack(); }, 500);
      } else {
        wx.showToast({ title: res.message || '删除失败', icon: 'none' });
      }
    } catch (err) {
      console.error('删除任务失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.cancelDeleteConfirm();
      this.setData({ deleting: false });
    }
  },

  // 任务完成后刷新前一页与全局待办/消息计数
  handleTaskCompleted: function() {
    wx.showToast({ title: '任务已完成', icon: 'success', duration: 1500 });
    this.refreshPreviousPage(true);
    app.getUnreadMessageCount && app.getUnreadMessageCount();
    app.getTodoTotalCount && app.getTodoTotalCount();
  },

  // 刷新上一页（管理列表），避免返回后看到旧数据
  refreshPreviousPage: function(force = false) {
    const pages = getCurrentPages();
    const prevPage = pages && pages.length >= 2 ? pages[pages.length - 2] : null;
    if (!prevPage) return;
    setTimeout(() => {
      try {
        if (typeof prevPage.loadMaintenanceTasks === 'function') {
          prevPage.loadMaintenanceTasks(force);
        } else if (typeof prevPage.onShow === 'function') {
          prevPage.onShow();
        }
      } catch (err) {
        console.error('刷新上一页失败', err);
      }
    }, 200);
  },



  // 复制QQ号
  copyQQ: function(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset : {};
    const qq = dataset.qq;
    const type = dataset.type || '';
    
    if (qq) {
      wx.setClipboardData({
        data: qq,
        success: function() {
          wx.showToast({
            title: `${type}QQ号已复制`,
            icon: 'success',
            duration: 2000
          });
        },
        fail: function() {
          wx.showToast({
            title: '复制失败',
            icon: 'none'
          });
        }
      });
    }
  },

  // 显示编辑受理人弹窗（兼容旧入口）
  showAddAssigneeModal: function() {
    this.openAssigneeDrawer();
  },

  // 显示编辑受理人抽屉
  openAssigneeDrawer: function() {
    if (!this.data.canManageAssignees) {
      wx.showToast({
        title: '只有组长可在进行中的任务中添加协助受理人',
        icon: 'none'
      });
      return;
    }

    // 显示弹窗并加载成员列表
    this.setData({
      showAssigneeDrawer: true,
      showSelectedPanel: false,
      selectedMembers: [],
      selectedMemberList: [],
      selectedMemberPreview: [],
      selectedMemberExtraCount: 0,
      pendingChangeCount: 0,
      hasPendingChanges: false,
      membersList: [],
      filteredMembers: [],
      assigneeLoading: true,
      memberLookup: {},
      assigneeDrawerClosing: false,
      departmentFilter: 'all' // 重置部门筛选
    });

    // 获取成员列表
    this.getMembersList();
  },

  // 关闭编辑受理人弹窗
  closeAssigneeModal: function(options = {}) {
    this.closeAssigneeDrawer(options);
  },

  // 关闭抽屉
  closeAssigneeDrawer: function(arg = {}) {
    const isEvent = arg && arg.type;
    const options = isEvent ? {} : (arg || {});
    const immediate = !!options.immediate;

    if (immediate) {
      this.resetAssigneeDrawerState();
      return;
    }

    if (!this.data.showAssigneeDrawer || this.data.assigneeDrawerClosing) {
      return;
    }

    this.setData({
      assigneeDrawerClosing: true,
      showSelectedPanel: false
    });

    clearTimeout(this._drawerCloseTimer);
    this._drawerCloseTimer = setTimeout(() => {
      this.resetAssigneeDrawerState();
    }, 280);
  },

  resetAssigneeDrawerState: function() {
    clearTimeout(this._drawerCloseTimer);
    this._drawerCloseTimer = null;
    this.setData({
      showAssigneeDrawer: false,
      showSelectedPanel: false,
      membersList: [],
      filteredMembers: [],
      selectedMembers: [],
      selectedMemberList: [],
      selectedMemberPreview: [],
      selectedMemberExtraCount: 0,
      pendingChangeCount: 0,
      hasPendingChanges: false,
      assigneeLoading: false,
      memberLookup: {},
      assigneeDrawerClosing: false,
      departmentFilter: 'all' // 重置部门筛选
    });
  },

  // 获取维修组成员列表
  getMembersList: async function(showLoading = false) {
    if (showLoading) {
      wx.showLoading({
        title: '加载中...',
        mask: true
      });
    }

    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMembersList',
        params: {
          taskId: this.data.taskId,
          searchKeyword: '' // 移除搜索关键字参数
        }
      });
      if (result.success) {
        const members = (result.data && result.data.members) || [];
        const currentAssigneeIds = this.getCurrentAssigneeIds();
        const selectedMembers = this.data.selectedMembers || [];

        const memberLookup = {};
        const membersWithSelection = members.map(member => {
          const enhanced = {
            ...member,
            isSelected: selectedMembers.includes(member.openid),
            isCurrentAssignee: currentAssigneeIds.includes(member.openid)
          };
          memberLookup[enhanced.openid] = enhanced;
          return enhanced;
        });

        // 排序：按部门排序（电子技术部 -> 机电维修部 -> 运营管理部），每个部门内按角色排序（组长 -> 组员）
        const sortedMembers = this.sortMembersByDepartmentAndRole(membersWithSelection);

        this.setData({
          membersList: sortedMembers,
          filteredMembers: this.filterMembersByDepartment(sortedMembers, this.data.departmentFilter),
          memberLookup: memberLookup
        });
      } else {
        wx.showToast({
          title: result.message || '获取成员列表失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('获取成员列表失败', err);
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none'
      });
    } finally {
      if (showLoading) {
        wx.hideLoading();
      }
      this.setData({
        assigneeLoading: false
      });
    }
  },

  // 添加成员到协助列表
  addMemberToSelection: function(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset : {};
    const { openid } = dataset;
    
    if (!openid) {
      wx.showToast({
        title: '选择失败，请重试',
        icon: 'none'
      });
      return;
    }
    
    if (this.data.selectedMembers.includes(openid)) {
      return;
    }

    // 不允许选择申请人作为协助受理人（防止异常场景）
    const applicantId = (this.data.taskDetail && this.data.taskDetail.applicantId) || '';
    if (openid === applicantId) {
      wx.showToast({
        title: '申请人不能作为协助受理人',
        icon: 'none'
      });
      return;
    }
    
    // 检查是否是已经是受理人的成员
    const member = (this.data.memberLookup && this.data.memberLookup[openid]) || {};
    if (member && member.isCurrentAssignee) {
      wx.showToast({
        title: '该成员已经是受理人',
        icon: 'none'
      });
      return;
    }
    
    const selectedMembers = [...this.data.selectedMembers, openid];
    this.updateSelectedState(selectedMembers);
  },

  // 移除已选成员
  removeSelectedMember: function(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset : {};
    const { openid } = dataset;
    if (!openid) return;

    const selectedMembers = (this.data.selectedMembers || []).filter(id => id !== openid);
    this.updateSelectedState(selectedMembers);
  },

  // 清空所有选择
  clearAllSelected: function() {
    if ((this.data.selectedMembers || []).length === 0) {
      return;
    }
    this.updateSelectedState([]);
  },

  // 打开/关闭已选列表
  toggleSelectedPanel: function() {
    if (!this.data.hasPendingChanges) {
      return;
    }
    const nextState = !this.data.showSelectedPanel;
    this.setData({
      showSelectedPanel: nextState
    });
  },

  // 同步选择状态
  updateSelectedState: function(selectedMembers = []) {
    const baseMembers = this.data.membersList || [];
    const updatedMembers = baseMembers.map(member => ({
      ...member,
      isSelected: selectedMembers.includes(member.openid)
    }));

    const memberLookup = {};
    updatedMembers.forEach(member => {
      memberLookup[member.openid] = member;
    });

    const selectedMemberList = selectedMembers
      .map(openid => memberLookup[openid])
      .filter(Boolean);

    const previewAdd = selectedMemberList.slice(0, 3);
    const extraCount = selectedMembers.length > previewAdd.length ? (selectedMembers.length - previewAdd.length) : 0;
    const pendingChangeCount = selectedMembers.length;
    const hasPendingChanges = pendingChangeCount > 0;

    this.setData({
      selectedMembers,
      membersList: updatedMembers,
      filteredMembers: this.filterMembersByDepartment(updatedMembers, this.data.departmentFilter),
      memberLookup: memberLookup,
      selectedMemberList,
      selectedMemberPreview: previewAdd,
      selectedMemberExtraCount: extraCount,
      pendingChangeCount,
      hasPendingChanges,
      showSelectedPanel: hasPendingChanges ? this.data.showSelectedPanel : false
    });
  },

  // 按部门和角色排序
  sortMembersByDepartmentAndRole: function(members) {
    // 部门排序权重：电子技术部(1) -> 机电维修部(2) -> 运营管理部(3) -> 无部门(4)
    const getDepartmentWeight = (department) => {
      if (!department) return 4;
      if (department === '电子技术部') return 1;
      if (department === '机电维修部') return 2;
      if (department === '运营管理部') return 3;
      return 4;
    };

    // 角色排序权重：组长(1) -> 组员(2)
    const getRoleWeight = (role) => {
      if (role === 'leader') return 1;
      if (role === 'member') return 2;
      return 3;
    };

    return [...members].sort((a, b) => {
      // 先按部门排序
      const deptWeightA = getDepartmentWeight(a.department);
      const deptWeightB = getDepartmentWeight(b.department);
      if (deptWeightA !== deptWeightB) {
        return deptWeightA - deptWeightB;
      }
      
      // 部门相同，按角色排序
      const roleWeightA = getRoleWeight(a.role);
      const roleWeightB = getRoleWeight(b.role);
      if (roleWeightA !== roleWeightB) {
        return roleWeightA - roleWeightB;
      }
      
      // 部门和角色都相同，按姓名排序
      const nameA = (a.nickName || '').toLowerCase();
      const nameB = (b.nickName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  },

  // 按部门筛选成员
  filterMembersByDepartment: function(members, filter) {
    if (filter === 'all') {
      return members;
    }
    return members.filter(member => member.department === filter);
  },

  // 切换部门筛选
  switchDepartmentFilter: function(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    let filter = 'all';
    if (index === 1) {
      filter = '电子技术部';
    } else if (index === 2) {
      filter = '机电维修部';
    } else if (index === 3) {
      filter = '运营管理部';
    }
    
    this.setData({
      departmentFilter: filter,
      filteredMembers: this.filterMembersByDepartment(this.data.membersList, filter)
    });
  },

  // 确认添加协助受理人
  confirmAddAssignees: function() {
    // 防止重复点击
    if (this.data.assigneeLoading) {
      wx.showToast({
        title: '正在处理中，请稍候',
        icon: 'none'
      });
      return;
    }
    const toAdd = this.data.selectedMembers;
    
    if (toAdd.length === 0) {
      wx.showToast({
        title: '请先选择成员',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认添加',
      content: `确定要添加${toAdd.length}名协助受理人吗？`,
      success: (res) => {
        if (res.confirm) {
          this.submitSelectedAssignees();
        }
      }
    });
  },

  // 提交新增的协助受理人
  submitSelectedAssignees: async function() {
    if (this.data.assigneeLoading) {
      return;
    }
    
    this.setData({ assigneeLoading: true });
    
    if (!Array.isArray(this.data.selectedMembers) || this.data.selectedMembers.length === 0) {
      this.setData({ assigneeLoading: false });
      return;
    }
    
    wx.showLoading({
      title: '保存中...',
      mask: true
    });
    
    try {
      const addRes = await api.call('maintenanceTasks', {
        action: 'addTaskAssignees',
        params: {
          taskId: this.data.taskId,
          selectedMembers: this.data.selectedMembers
        }
      });
      
      if (!addRes.success) {
        throw new Error(addRes.message || '添加受理人失败');
      }
      
      this.closeAssigneeModal({ immediate: true });
      
      wx.hideLoading();
      
      this.showEWReminderModal();
      
      // 重新加载任务详情
      this.getTaskDetail();
      
    } catch (err) {
      console.error('编辑受理人失败', err);
      wx.hideLoading();
      wx.showToast({
        title: err.message || '编辑失败，请重试',
        icon: 'none',
        duration: 3000
      });
    } finally {
      this.setData({ assigneeLoading: false });
    }
  },

  // 显示EW值重新提交提醒
  showEWReminderModal: function() {
    wx.showModal({
      title: 'EW值提醒',
      content: '受理人已更新，建议重新提交该任务的EW值以确保等效工作量计算准确。',
      confirmText: '我知道了',
      showCancel: false,
      success: function(res) {
        if (res.confirm) {
          // 用户确认了EW提醒
        }
      }
    });
  },

  // 底部确认区域点击
  handleSelectedConfirm: function() {
    if (this.data.assigneeLoading || !this.data.hasPendingChanges) {
      return;
    }
    this.confirmAddAssignees();
  },

  // detail页面直接移除协助受理人
  handleRemoveAdditionalAssignee: function(e) {
    if (!this.data.canManageAssignees) {
      wx.showToast({
        title: '暂无操作权限',
        icon: 'none'
      });
      return;
    }
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset : {};
    const openid = dataset.openid;
    const name = dataset.name || '该协助受理人';
    if (!openid) {
      wx.showToast({
        title: '无法获取受理人信息',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '移除协助受理人',
      content: `确定要移除 ${name} 吗？`,
      confirmText: '移除',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          this.removeAssigneeById(openid);
        }
      }
    });
  },

  removeAssigneeById: async function(openid) {
    if (!openid) return;
    this.setData({ assigneeLoading: true });
    
    wx.showLoading({
      title: '移除中...',
      mask: true
    });
    
    try {
      const removeRes = await api.call('maintenanceTasks', {
        action: 'removeTaskAssignees', config: { retries: 0 },
        params: {
          taskId: this.data.taskId,
          assigneesToRemove: [openid]
        }
      });
      
      if (!removeRes.success) {
        throw new Error(removeRes.message || '移除失败');
      }
      
      wx.hideLoading();
      this.showEWReminderModal();
      this.getTaskDetail();
    } catch (err) {
      console.error('移除协助受理人失败', err);
      wx.hideLoading();
      wx.showToast({
        title: err.message || '移除失败，请稍后重试',
        icon: 'none'
      });
    } finally {
      this.setData({ assigneeLoading: false });
    }
  },

  getCurrentAssigneeIds: function() {
    const task = this.data.taskDetail || {};
    const ids = [];
    if (task.assigneeId) {
      ids.push(task.assigneeId);
    }
    if (Array.isArray(task.additionalAssignees)) {
      task.additionalAssignees.forEach(assignee => {
        if (assignee && assignee.assigneeId) {
          ids.push(assignee.assigneeId);
        }
      });
    }
    return ids;
  },

  shouldEnableAssigneeManagement: function(status) {
    const currentStatus = status || 'pending';
    return this.data.fromManage && this.data.userRole === 'leader' && currentStatus === 'inProgress';
  },

  // 防止滚动穿透
  preventScrollThrough: function(e) {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    return false;
  },

  // 阻止事件穿透（空方法）
  noop: function() {}
})
