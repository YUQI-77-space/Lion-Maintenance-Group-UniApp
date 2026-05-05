// pages/team/volunteer/detail/index.js
const app = getApp()
const api = require('../../../../utils/apiAdapter')
const time = require('../../../../utils/time')

Page({
  /**
   * 页面的初始数据
   */
  data: {
    activityId: '',
    activity: null,
    participants: [],
    userRole: '',
    openid: '',
    isRegistered: false,
    loading: true,

    formattedStartTime: '',
    formattedEndTime: '',
    showMessageModal: false,
    messageTitle: '',
    messageContent: '',
    isFromManagePage: false, // 是否从管理页面进入
    // 导入志愿者相关数据
    showImportModal: false,
    membersList: [],
    filteredMembers: [],
    selectedMembers: [],
    importLoading: false,
    showSelectedPanel: false,
    selectedMemberList: [],
    selectedMemberPreview: [],
    selectedMemberExtraCount: 0,
    pendingSelectionCount: 0,
    hasPendingSelections: false,
    memberLookup: {},
    importSheetClosing: false,
    // 新增：按人EW弹窗与数据
    showPerUserEWModal: false,
    perUserEWMap: {}
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const { id, fromManage } = options
    
    if (!id) {
      wx.showToast({
        title: '缺少活动ID',
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
      return
    }
    
    this.setData({
      activityId: id,
      isFromManagePage: fromManage === 'true',
      loading: true
    })
    
    // 获取用户角色
    this.getUserRole()
    
    // 获取活动详情
    this.getActivityDetail()
    

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
    // 如果已经有活动ID，刷新活动详情
    if (this.data.activityId) {
      this.getActivityDetail()

      // 如果是组长，刷新参与者信息
      if (this.data.userRole === 'leader') {
        this.getParticipants()
      }
    }
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
   * 获取用户角色
   */
  getUserRole() {
    const app = getApp()
    const userInfo = wx.getStorageSync('userInfo')
    const role = app.globalData.role || wx.getStorageSync('role') || 'user'
    
    if (userInfo) {
      this.setData({
        userRole: role,
        openid: userInfo.openid
      })
    }
  },

  /**
   * 获取活动详情
   */
  getActivityDetail: async function() {
    this.setData({ loading: true });
    try {
      const result = await api.call('volunteerActivities', {
        action: 'getVolunteerActivityDetail',
        params: { activityId: this.data.activityId }
      });
      if (result.success) {
        const { activity, isRegistered } = result.data || {};
        const statusMap = {
          pending: '待发布',
          inPreparation: '筹备中',
          inProgress: '进行中',
          ended: '已结束'
        };
        if (activity) {
          activity.activityStatusText = statusMap[activity.activityStatus] || '未知';
        }
        const formattedStartTime = this.formatDate(activity && activity.startTime);
        const formattedEndTime = this.formatDate(activity && activity.endTime);
        
        this.setData({
          activity,
          isRegistered: !!isRegistered,
          formattedStartTime,
          formattedEndTime
        });

        if (this.data.userRole === 'leader') {
          await this.getParticipants();
        }
      } else {
        wx.showToast({
          title: result.message || '获取活动详情失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('获取活动详情失败', err);
      wx.showToast({ title: '获取活动详情失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  /**
   * 获取参与者信息（仅组长可用）
   */
  getParticipants: async function() {
    if (this.data.userRole !== 'leader' || !this.data.activityId) return;
    try {
      const result = await api.call('volunteerActivities', { action: 'getParticipantsInfo', params: { activityId: this.data.activityId } });
      if (result.success) {
        const participants = (result.data && result.data.participants) || [];
        const activity = this.data.activity;
        if (activity && activity.feedbacks && activity.feedbacks.length > 0) {
          const feedbackMap = new Map();
          activity.feedbacks.forEach(fb => { feedbackMap.set(fb.openid, fb.feedback); });
          participants.forEach(p => { p.feedback = feedbackMap.get(p.openid) || '未填写'; });
        } else {
          participants.forEach(p => { p.feedback = '未填写'; });
        }
        const perUserEWMap = {};
        const fromActivityMap = (this.data.activity && this.data.activity.participantEWMap) || {};
        participants.forEach(p => {
          if (fromActivityMap[p.openid] != null) {
            perUserEWMap[p.openid] = fromActivityMap[p.openid];
          }
        });
        this.setData({ participants, perUserEWMap });
      } else {
        console.error('获取参与者信息失败', result.message);
      }
    } catch (err) {
      console.error('获取参与者信息失败', err);
    }
  },

  /**
   * 导出参与者信息（仅组长可用）
   */
  exportParticipants: async function() {
    if (this.data.userRole !== 'leader') return;
    wx.showLoading({ title: '正在生成...', mask: true });
    try {
      const result = await api.call('volunteerActivities', { action: 'exportParticipants', params: { activityId: this.data.activityId } });
      if (result.success && result.data && result.data.fileID) {
        const fileID = result.data.fileID;
        wx.hideLoading();
        wx.showLoading({ title: '正在下载...', mask: true });
        try {
          const downloadRes = await wx.cloud.downloadFile({ fileID });
          wx.hideLoading();
          const path = downloadRes.tempFilePath;
          wx.openDocument({
            filePath: path,
            showMenu: true,
            fail: function (openErr) {
              console.error('打开文档失败', openErr);
              wx.showToast({ title: '打开文件失败，请确保已安装WPS或Office等应用', icon: 'none', duration: 3000 });
            }
          });
        } catch (downloadErr) {
          wx.hideLoading();
          console.error('下载文件失败', downloadErr);
          wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' });
        }
      } else {
        wx.hideLoading();
        wx.showToast({ title: result.message || '导出失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('导出参与者信息失败', err);
      wx.showToast({ title: '导出接口调用失败', icon: 'none' });
    }
  },

  /**
   * 显示导入志愿者弹窗
   */
  showImportVolunteersModal() {
    if (this.data.userRole !== 'leader') return
    const activity = this.data.activity
    
    if (!activity) {
      wx.showToast({
        title: '活动信息加载中，请稍后再试',
        icon: 'none'
      })
      return
    }
    
    // 防止重复点击
    if (this.data.showImportModal || this.isOpeningImportModal) {
      return
    }
    
    // 检查活动状态
    if (activity.activityStatus === 'ended') {
      wx.showToast({
        title: '活动已结束，无法导入志愿者',
        icon: 'none'
      })
      return
    }
    
    // 检查剩余名额
    const remainingSlots = (activity.volunteerCount || 0) - (activity.numberOfVolunteers || 0)
    if (remainingSlots <= 0) {
      wx.showToast({
        title: '活动名额已满，无法导入志愿者',
        icon: 'none'
      })
      return
    }
    
    // 设置打开状态标记
    this.isOpeningImportModal = true
    
    // 立即显示弹窗和加载状态，给用户即时反馈
    this.setData({
      showImportModal: true,
      importSheetClosing: false,
      selectedMembers: [],
      selectedMemberList: [],
      selectedMemberPreview: [],
      selectedMemberExtraCount: 0,
      pendingSelectionCount: 0,
      hasPendingSelections: false,
      showSelectedPanel: false,
      membersList: [],
      filteredMembers: [],
      memberLookup: {},
      importLoading: true // 显示加载状态
    })
    
    this.getMembersList()
      .then(() => {
        this.setData({ importLoading: false })
      })
      .catch(err => {
        console.error('初始化导入弹窗失败:', err)
        wx.showToast({
          title: '操作失败，请重试',
          icon: 'none'
        })
        this.closeImportModal()
      })
      .finally(() => {
        this.isOpeningImportModal = false
      })
  },

  /**
   * 关闭导入志愿者弹窗
   */
  closeImportModal(options = {}) {
    const immediate = !!options.immediate
    if (!this.data.showImportModal && !immediate) return

    const finalizeClose = () => {
      clearTimeout(this._importCloseTimer)
      this._importCloseTimer = null
      this.setData({
        showImportModal: false,
        importSheetClosing: false,
        membersList: [],
        filteredMembers: [],
        selectedMembers: [],
        selectedMemberList: [],
        selectedMemberPreview: [],
        selectedMemberExtraCount: 0,
        pendingSelectionCount: 0,
        hasPendingSelections: false,
        showSelectedPanel: false,
        importLoading: false,
        memberLookup: {}
      })
    }

    const startClosingAnimation = () => {
      if (immediate) {
        finalizeClose()
        return
      }
      this.setData({
        importSheetClosing: true,
        showSelectedPanel: false
      })
      clearTimeout(this._importCloseTimer)
      this._importCloseTimer = setTimeout(finalizeClose, 260)
    }

    startClosingAnimation()
  },

  /**
   * 获取维修组成员列表
   */
  getMembersList: async function(showLoading = false) {
    if (showLoading) {
      wx.showLoading({
        title: '加载中...',
        mask: true
      });
    }
    
    try {
      const result = await api.call('volunteerActivities', {
        action: 'getMembersList',
        params: {
          activityId: this.data.activityId
        }
      });
      if (result.success) {
        const members = (result.data && result.data.members) || [];
        const currentSelected = [...(this.data.selectedMembers || [])];
        const lookup = { ...(this.data.memberLookup || {}) };

        const membersWithSelection = members.map(member => {
          const enhanced = {
            ...member,
            isSelected: currentSelected.includes(member.openid)
          };
          lookup[enhanced.openid] = enhanced;
          return enhanced;
        });

        this.refreshSelectionSnapshot(currentSelected, lookup, membersWithSelection, membersWithSelection);
        return result;
      } else {
        wx.showToast({
          title: result.message || '获取成员列表失败',
          icon: 'none'
        });
        throw new Error(result.message || '获取成员列表失败');
      }
    } catch (err) {
      console.error('获取成员列表失败', err);
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none'
      });
      throw err;
    } finally {
      if (showLoading) {
        wx.hideLoading();
      }
    }
  },

  /**
   * 选择/取消选择成员
   */
  toggleMemberSelection(e) {
    const { openid } = e.currentTarget.dataset
    
    if (!openid) {
      wx.showToast({
        title: '选择失败，请重试',
        icon: 'none'
      })
      return
    }
    
    // 检查是否是已参与的成员
    const member = (this.data.memberLookup && this.data.memberLookup[openid]) || this.data.filteredMembers.find(m => m.openid === openid)
    if (member && member.isParticipant) {
      wx.showToast({
        title: '该成员已参与此活动',
        icon: 'none'
      })
      return
    }
    
    const selectedMembers = [...(this.data.selectedMembers || [])]
    const index = selectedMembers.indexOf(openid)
    
    if (index > -1) {
      wx.showToast({
        title: '请在下方已选列表中移除',
        icon: 'none'
      })
      return
    } else {
      // 选择成员前检查人数限制
      const activity = this.data.activity || {}
      const currentParticipants = activity.numberOfVolunteers || 0
      const selectedCount = selectedMembers.length
      const remainingSlots = (activity.volunteerCount || 0) - currentParticipants
      
      if (selectedCount >= remainingSlots) {
        wx.showToast({
          title: `名额不足，剩余${remainingSlots}个名额`,
          icon: 'none'
        })
        return
      }
      
      selectedMembers.push(openid)
    }
    
    this.applySelectionState(selectedMembers)
  },

  applySelectionState(selectedMembers = []) {
    const safeSelected = Array.isArray(selectedMembers) ? selectedMembers : []
    const updateListSelection = (list = []) => {
      if (!Array.isArray(list)) return []
      return list.map(member => ({
        ...member,
        isSelected: safeSelected.includes(member.openid)
      }))
    }

    const updatedMembersList = updateListSelection(this.data.membersList || [])
    const updatedFilteredMembers = updateListSelection(this.data.filteredMembers || [])
    const lookup = { ...(this.data.memberLookup || {}) }

    updatedMembersList.forEach(member => {
      lookup[member.openid] = member
    })

    this.refreshSelectionSnapshot(safeSelected, lookup, updatedMembersList, updatedFilteredMembers)
  },

  refreshSelectionSnapshot(selectedMembers = [], lookup = {}, membersList, filteredMembers) {
    const safeSelected = Array.isArray(selectedMembers) ? selectedMembers : []
    const selectedMemberList = safeSelected
      .map(openid => lookup[openid])
      .filter(Boolean)

    const preview = selectedMemberList.slice(0, 3)
    const extra = safeSelected.length > preview.length ? safeSelected.length - preview.length : 0

    const dataToSet = {
      selectedMembers: safeSelected,
      memberLookup: lookup,
      selectedMemberList,
      selectedMemberPreview: preview,
      selectedMemberExtraCount: extra,
      pendingSelectionCount: safeSelected.length,
      hasPendingSelections: safeSelected.length > 0
    }

    if (membersList) {
      dataToSet.membersList = membersList
    }
    if (filteredMembers) {
      dataToSet.filteredMembers = filteredMembers
    }

    if (!dataToSet.hasPendingSelections) {
      dataToSet.showSelectedPanel = false
    } else if (this.data.showSelectedPanel) {
      dataToSet.showSelectedPanel = true
    }

    this.setData(dataToSet)
  },

  toggleSelectedPanel() {
    if (!this.data.hasPendingSelections) return
    this.setData({
      showSelectedPanel: !this.data.showSelectedPanel
    })
  },

  removeSelectedMember(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset : {}
    const { openid } = dataset
    if (!openid) return
    const selectedMembers = (this.data.selectedMembers || []).filter(id => id !== openid)
    this.applySelectionState(selectedMembers)
  },

  clearAllSelected() {
    if ((this.data.selectedMembers || []).length === 0) {
      return
    }
    this.applySelectionState([])
  },

  handleSelectedConfirm() {
    if (this.data.importLoading || !this.data.hasPendingSelections) {
      return
    }
    this.confirmImport()
  },

  /**
   * 确认导入选中的志愿者
   */
  confirmImport() {
    if (this.data.selectedMembers.length === 0) {
      wx.showToast({
        title: '请选择要导入的成员',
        icon: 'none'
      })
      return
    }
    
    // 检查人数限制
    const activity = this.data.activity || {}
    const remainingSlots = (activity.volunteerCount || 0) - (activity.numberOfVolunteers || 0)
    if (this.data.selectedMembers.length > remainingSlots) {
      wx.showToast({
        title: `名额不足，剩余${remainingSlots}个名额`,
        icon: 'none'
      })
      return
    }
    
    wx.showModal({
      title: '确认导入',
      content: `确定要导入${this.data.selectedMembers.length}名志愿者吗？`,
      success: (res) => {
        if (res.confirm) {
          this.batchImportVolunteers()
        }
      }
    })
  },

  /**
   * 批量导入志愿者
   */
  batchImportVolunteers: async function() {
    this.setData({ importLoading: true });
    
    wx.showLoading({
      title: '导入中...',
      mask: true
    });
    
    try {
      const res = await api.call('volunteerActivities', {
        action: 'batchImportVolunteers',
        params: {
          activityId: this.data.activityId,
          selectedMembers: this.data.selectedMembers
        }
      });

      if (res.success) {
        wx.showToast({
          title: res.message || '导入成功',
          icon: 'success'
        });
        await this.closeImportModal();
        await this.getActivityDetail();
      } else {
        wx.showToast({
          title: res.message || '导入失败',
          icon: 'none'
        });
        await this.closeImportModal();
      }
    } catch (err) {
      console.error('批量导入志愿者失败', err);
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none'
      });
      await this.closeImportModal();
    } finally {
      wx.hideLoading();
      this.setData({ importLoading: false });
    }
  },

  /**
   * 格式化日期
   */
  formatDate(date) {
    return time.formatToMinute(date)
  },

  /**
   * 打开按人EW弹窗
   */
  openSetPerUserEWModal() {
    if (this.data.userRole !== 'leader') return
    this.setData({ showPerUserEWModal: true })
  },
  /**
   * 关闭按人EW弹窗
   */
  closeSetPerUserEWModal() {
    this.setData({ showPerUserEWModal: false })
  },
  preventTouch(e) {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
  },
  /**
   * 监听按人EW输入
   */
  onPerUserEWInput(e) {
    const openid = e.currentTarget.dataset.openid
    let val = e.detail.value
    if (val === '') {
      const map = { ...this.data.perUserEWMap }
      delete map[openid]
      this.setData({ perUserEWMap: map })
      return
    }
    let num = Number(val)
    if (!isFinite(num) || num < 0) num = 0
    if (num > 50) num = 50
    this.setData({ perUserEWMap: { ...this.data.perUserEWMap, [openid]: num } })
  },
  /**
   * 确认设置按人EW
   */
  async confirmSetPerUserEW() {
    const assignments = this.data.participants.map(p => ({
      openid: p.openid,
      ew: Number(this.data.perUserEWMap[p.openid] || 0)
    }));

    wx.showLoading({ title: '提交中...', mask: true });
    try {
      const res = await api.call('volunteerActivities', {
        action: 'setParticipantsEW',
        params: {
          activityId: this.data.activityId,
          assignments
        }
      });
      if (res.success) {
        wx.showToast({ title: '设置成功', icon: 'success' });
        this.setData({ showPerUserEWModal: false });
        await this.getActivityDetail();
      } else {
        wx.showToast({ title: res.message || '提交失败', icon: 'none' });
      }
    } catch (err) {
      console.error('提交每人EW失败', err);
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.getActivityDetail()

    // 如果是组长，刷新参与者信息 (getActivityDetail成功后会自动调用)
    // if (this.data.userRole === 'leader') {
    //   this.getParticipants()
    // }
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
    const activity = this.data.activity
    return {
      title: activity ? `志愿活动：${activity.title}` : '志愿活动详情',
      path: `/pages/team/volunteer/detail/index?id=${this.data.activityId}`
    }
  }
})