// pages/team/maintenance/detail/index.js
const app = getApp();
const api = require('../../../../utils/apiAdapter');
const time = require('../../../../utils/time');
const SubscriptionAuth = require('../../../../utils/subscriptionAuth');

Page({

  /**
   * 页面的初始数据
   */
  data: {
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
    this.setData({ loading: true });
    
    try {
      const result = await api.call('maintenanceTasks', {
        action: 'getMaintenanceTaskDetail',
        params: { maintenanceTaskId: this.data.taskId }
      });

      if (result.success) {
        const taskDetail = result.data || {};
        // 格式化时间字段
        if (taskDetail.applicantTime) taskDetail.applicantTime = this.formatTime(taskDetail.applicantTime);
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
          isUrgent: 0,
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
        this.setData({ 
          taskDetail: safeTaskDetail, 
          canManageAssignees: this.shouldEnableAssigneeManagement(nextStatus)
        });
      } else {
        wx.showToast({ title: '获取任务详情失败', icon: 'none' });
      }
    } catch (err) {
      console.error('获取任务详情失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 认领任务
  claimTask: async function(e) {
    const taskId = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.taskId : this.data.taskId;
    
    // 检查是否为申请人
    const currentUserOpenid = this.data.userOpenid;
    const task = this.data.taskDetail;
    
    if (task && task.applicantId === currentUserOpenid) {
      wx.showModal({
        title: '无法认领',
        content: '申请人无法认领自己的维修任务',
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }
    
    // 请求订阅消息授权
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
      if (authResult.success && authResult.analysis.acceptedCount > 0) {
        wx.showToast({ title: `已授权${authResult.analysis.acceptedCount}个消息通知`, icon: 'success', duration: 1200 });
        await new Promise(resolve => setTimeout(resolve, 1300));
      }
    } catch (error) {
      console.error('订阅授权异常:', error);
      // 授权异常不影响认领流程
    }
    
    // 在 showModal 前再次读取取消模板的最新授权状态，确保基于用户最新选择
    const latestCancelAuth = SubscriptionAuth.getAuthStatus(SubscriptionAuth.TEMPLATES.TASK_CANCELLED);
    needReAuthCancel = !latestCancelAuth.hasAuth || latestCancelAuth.status !== 'accept';

    wx.showModal({
      title: '确认认领',
      content: '确定要认领此维修任务吗？',
      success: async (res) => {
        if (res.confirm) {
          // 确认点击（用户手势）内做一次取消模板补授权，避免“非用户手势”错误
          if (needReAuthCancel) {
            try {
              const reAuth = await SubscriptionAuth.requestSubscribeMessage(
                [SubscriptionAuth.TEMPLATES.TASK_CANCELLED],
                SubscriptionAuth.SCENES.TASK_CLAIM,
                { showTip: false, allowPartialSuccess: true }
              );
            } catch (reErr) {
            }
          }
          wx.showLoading({
            title: '处理中...',
          });
          
          try {
            const result = await api.call('maintenanceTasks', {
              action: 'assignMaintenanceTask',
              params: {
                maintenanceTaskId: taskId,
                assigneeId: this.data.userOpenid
              }
            });

            wx.hideLoading();
            
            if (result.success) {
              // 检查是否是重复认领的情况
              if (result.data && result.data.alreadyClaimed) {
                wx.showModal({
                  title: '任务认领状态',
                  content: result.message || '您已经认领了此维修任务。任务详情已刷新。',
                  showCancel: false,
                  success: (modalRes) => {
                    this.getTaskDetail();
                  }
                });
              } else {
                wx.showModal({
                  title: '认领成功',
                  content: '您已成功认领此维修任务，请及时与申请人联系并完成维修。任务已添加到您的待办事项中。',
                  showCancel: false,
                  success: (modalRes) => {
                    this.getTaskDetail();
                  }
                });
              }
            } else {
              wx.showToast({
                title: result.message || '认领失败',
                icon: 'none'
              });
            }
          } catch (err) {
            wx.hideLoading();
            console.error('认领任务失败', err);
            wx.showToast({
              title: '网络错误，请重试',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  // 返回上一页
  goBack: function() {
    wx.navigateBack();
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
        action: 'removeTaskAssignees',
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