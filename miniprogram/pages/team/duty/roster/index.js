// pages/team/duty/roster/index.js
const api = require('../../../../utils/apiAdapter');
const iconManager = require('../../../../utils/iconManager');
const time = require('../../../../utils/time');

Page({
  data: {
    // 加载状态
    confirming: false, confirmationMessage: '',
    isLoading: true,
    isDataReady: false,

    // 图标资源
    iconEmpty: iconManager.get('common_empty'),

    // 基础信息
    currentWeek: 1,
    currentYear: new Date().getFullYear(),
    weekDateRange: '',
    
    // 表格数据
    weekDates: [],
    tableData: [],
    
    // 配置信息
    configData: null,
    
    // 统计信息
    totalSlots: 0,
    availableSlots: 0,
    assignedSlots: 0,
    
    // 错误状态
    errorMessage: '',
    hasError: false,
    
    // 预选功能相关
    selectedSlots: [], // 预选的时间段ID数组
    selectedSlotsDisplay: [], // 预选时间段的显示信息
    userSlots: {       // 用户已选时间段数据
      preSelectedSlots: [],
      confirmedSlots: [],
      totalSlots: 0,
      canSelectMore: true,
      remainingSlots: 3
    },
    
    // 用户信息
    userInfo: null
  },

  onLoad: function (options) {
    
    this._firstShow = true;
    this.initPage()
  },

  onShow: function () {
    if (this._firstShow) { this._firstShow = false; return; }
    
    // 页面显示时重新获取数据，以确保数据最新，并确保用户时段与当前周一致
    this.loadDutyData()
      .then(() => this.loadUserDutySlots({ weekNumber: this.data.currentWeek, year: this.data.currentYear }))
      .catch(err => {
        console.error('[值班表] 加载数据出错：', err)
      })
  },

  // 下拉刷新
  onPullDownRefresh: function () {
    
    this.loadDutyData(true)
      .then(() => this.loadUserDutySlots({ weekNumber: this.data.currentWeek, year: this.data.currentYear }))
      .finally(() => {
        wx.stopPullDownRefresh()
      })
  },

  // 初始化页面
  initPage: function () {
    // 权限检查：仅成员/组长可查看
    try {
      const app = getApp()
      const hasPermission = app && typeof app.checkPermission === 'function' ? app.checkPermission('member') : true
      if (!hasPermission) {
        wx.showToast({ title: '无权限查看值班表', icon: 'none' })
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/profile/index' }) })
        }, 1200)
        return
      }
    } catch (e) {}
    this.loadDutyData()
  },

  // 加载值班数据（改为适配器）
  loadDutyData: async function (isRefresh = false) {
    if (!isRefresh) {
      this.setData({ 
        isLoading: true,
        hasError: false,
        errorMessage: ''
      });
    }

    try {
      const res = await api.call('dutySchedule', {
        action: 'getDutySlots',
        config: { timeout: 10000 }
      });

      if (res.success) {
        this.processDutyData(res.data);
      } else if (res.code === 404) {
        this.setData({
          isLoading: false,
          isDataReady: false,
          hasError: true,
          errorMessage: res.message || '当前周暂无值班数据',
          configData: res.data?.config || null,
          currentWeek: res.data?.weekNumber || 1,
          currentYear: res.data?.year || new Date().getFullYear()
        });
      } else {
        console.error('[值班表] 获取数据失败：', res.message);
        this.setData({
          isLoading: false,
          isDataReady: false,
          hasError: true,
          errorMessage: res.message || '获取值班数据失败'
        });
      }
    } catch (err) {
      console.error('[值班表] 获取值班数据异常：', err);
      this.setData({
        isLoading: false,
        isDataReady: false,
        hasError: true,
        errorMessage: '网络异常，请检查网络连接'
      });
      // 在 onShow 调用时，让 Promise.all 感知到错误
      throw err;
    }
  },

  // 处理值班数据
  processDutyData: function (data) {
    
    

    // 检查周数是否发生变化，如果变化则清空预选状态
    this.checkAndClearIfWeekChanged(data.weekNumber, data.year)

    // 生成周日期范围显示文本
    const weekDateRange = this.generateWeekDateRange(data.weekDates)

    this.setData({
      isLoading: false,
      isDataReady: true,
      hasError: false,
      currentWeek: data.weekNumber,
      currentYear: data.year,
      weekDateRange: weekDateRange,
      weekDates: data.weekDates,
      tableData: data.tableData,
      configData: data.config,
      totalSlots: data.totalSlots,
      availableSlots: data.availableSlots,
      assignedSlots: data.assignedSlots
    })
    
    // 保证用户时段与新周一致（避免出现底部仍显示旧周的情况）
    this.loadUserDutySlots({ weekNumber: data.weekNumber, year: data.year })

    
    
  },

  // 生成周日期范围文本
  generateWeekDateRange: function (weekDates) {
    if (!weekDates || weekDates.length === 0) {
      return ''
    }

    // 获取周一和周日的日期
    const monday = weekDates.find(d => d.dayOfWeek === 1)
    const sunday = weekDates.find(d => d.dayOfWeek === 0)

    if (monday && sunday) {
      return `${monday.date || monday.dateDisplay} 至 ${sunday.date || sunday.dateDisplay}`
    }

    // 备选方案：使用第一个和最后一个日期
    const firstDate = weekDates[0]
    const lastDate = weekDates[weekDates.length - 1]
    return `${firstDate.dateDisplay} 至 ${lastDate.dateDisplay}`
  },

  // 值班格子点击事件
  onSlotTap: function (e) {
    if (this.data.confirming) return;
    const { rowIndex, colIndex } = e.currentTarget.dataset
    

    // 首先检查编辑权限
    if (!this.checkEditPermission()) {
      return
    }

    // 获取对应的时间段数据
    const timeSlotData = this.data.tableData[rowIndex]
    const slotData = timeSlotData.dailySlots[colIndex]

    

    if (!slotData.canSelect) {
      // 不可选择的格子
      if (slotData.status === 'no-duty') {
        wx.showToast({
          title: '该时间段休假',
          icon: 'none'
        })
      } else if (slotData.status === 'locked') {
        wx.showToast({ title: '该时段操作中，请稍后刷新', icon: 'none' });
      } else if (slotData.status === 'assigned') {
        wx.showToast({
          title: `已被${slotData.statusText}认领`,
          icon: 'none'
        })
      }
      return
    }

    // 可选择的格子 - 执行预选逻辑
    this.handleSlotSelection(slotData, timeSlotData, rowIndex, colIndex)
  },

  // 重新加载数据
  retryLoadData: function () {
    
    this.loadDutyData()
  },

  // 跳转到值班管理页面（仅组长可见）
  goToManagePage: function () {
    try {
      const app = getApp()
      if (app && typeof app.checkPermission === 'function' && app.checkPermission('leader')) {
        wx.navigateTo({ url: '/pages/team/duty/manage/index' })
      } else {
        wx.showToast({ title: '仅组长可进入管理', icon: 'none' })
      }
    } catch (e) {
      wx.navigateTo({ url: '/pages/team/duty/manage/index' })
    }
  },

  // ========== 预选功能相关方法 ==========

  // 加载用户已选时间段数据（改为适配器）
  loadUserDutySlots: async function (opts = {}) {
    try {
      const { weekNumber = this.data.currentWeek, year = this.data.currentYear } = opts
      const res = await api.call('dutySchedule', {
        action: 'getUserDutySlots',
        params: { weekNumber, year },
        config: { timeout: 10000 }
      });

      if (res.success) {
        this.setData({
          userSlots: res.data,
          userInfo: { nickName: res.data.userName }
        });
        this.updateTableDisplayStatus();
      } else if (res.code === 403) {
        // 用户无权限查看或未登录，静默处理
      } else {
        console.error('[值班表] 获取用户时间段失败：', res.message);
        // 此处不抛出错误，避免影响页面整体渲染
      }
    } catch (err) {
      console.error('[值班表] 获取用户时间段异常：', err);
       // 此处不抛出错误，避免影响页面整体渲染
    }
  },

  // 处理时间段选择
  handleSlotSelection: function (slotData, timeSlotData, rowIndex, colIndex) {
    const slotId = slotData.slotData.dutySlotId
    const selectedSlots = this.data.selectedSlots
    const userSlots = this.data.userSlots
    
    // 检查是否已经预选了这个时间段
    const isSelected = selectedSlots.includes(slotId)
    
    if (isSelected) {
      // 取消预选
      this.removeSlotFromSelection(slotId)
    } else {
      // 计算当前总选择数量（包括已确认的、已预选的、当前预选的）
      const totalSelectedCount = userSlots.confirmedSlots.length + userSlots.preSelectedSlots.length + selectedSlots.length
      
      // 检查是否超过3个时间段的限制
      if (totalSelectedCount >= 3) {
        wx.showToast({
          title: '本周最多只能选择3个时间段',
          icon: 'none'
        })
        return
      }
      
      // 添加到预选
      this.addSlotToSelection(slotData, timeSlotData)
    }
  },

  // 添加时间段到预选
  addSlotToSelection: function (slotData, timeSlotData) {
    const slotId = slotData.slotData.dutySlotId
    const selectedSlots = [...this.data.selectedSlots, slotId]
    
    // 构建显示信息
    const slotDisplayInfo = {
      dutySlotId: slotId,
      date: slotData.slotData.date,
      timeSlot: slotData.slotData.timeSlot,
      startTime: slotData.slotData.startTime,
      endTime: slotData.slotData.endTime
    }
    
    const selectedSlotsDisplay = [...this.data.selectedSlotsDisplay, slotDisplayInfo]
    
    
    
    this.setData({
      selectedSlots: selectedSlots,
      selectedSlotsDisplay: selectedSlotsDisplay
    })
    
    // 更新表格显示
    this.updateTableDisplayStatus()
    
    wx.showToast({
      title: `已预选 ${timeSlotData.timeSlotInfo.name}`,
      icon: 'success'
    })
  },

  // 从预选中移除时间段
  removeSlotFromSelection: function (slotId) {
    const selectedSlots = this.data.selectedSlots.filter(id => id !== slotId)
    const selectedSlotsDisplay = this.data.selectedSlotsDisplay.filter(slot => slot.dutySlotId !== slotId)
    
    
    
    this.setData({
      selectedSlots: selectedSlots,
      selectedSlotsDisplay: selectedSlotsDisplay
    })
    
    // 更新表格显示
    this.updateTableDisplayStatus()
    
    wx.showToast({
      title: '已取消预选',
      icon: 'success'
    })
  },

  // 更新表格显示状态
  updateTableDisplayStatus: function () {
    const selectedSlots = this.data.selectedSlots
    const userSlots = this.data.userSlots
    const tableData = this.data.tableData
    const configData = this.data.configData
    
    // 检查编辑权限是否开启
    const isEditingEnabled = configData?.isEditingEnabled !== false
    
    
    // 更新表格数据
    const updatedTableData = tableData.map(timeSlotRow => {
      return {
        ...timeSlotRow,
        dailySlots: timeSlotRow.dailySlots.map(slotInfo => {
          const slotId = slotInfo.slotData?.dutySlotId
          
          if (!slotId) return slotInfo
          
          // 确定新的状态，先重置为原始状态
          let newStatus = slotInfo.slotData?.isAvailable ? 'available' : 'no-duty'
          let newStatusClass = slotInfo.slotData?.isAvailable ? 'can-duty' : 'no-duty'
          let canSelect = slotInfo.slotData?.isAvailable && !slotInfo.slotData?.dutyHolderId
          let newStatusText = slotInfo.slotData?.isAvailable ? '可选' : '休假'
          
          // 检查锁定状态
          const isLocked = slotInfo.slotData?.lockStatus === 'locked'
          const isLockedByOthers = isLocked && slotInfo.slotData?.lockUserId !== getApp().globalData.userInfo?.openid
          
          // 如果被其他用户锁定，且锁未过期，则不可选择
          if (isLockedByOthers) {
            const lockExpireTime = slotInfo.slotData?.lockExpireTime
            // iOS 兼容：使用 time.toDate
            const expireDate = time.toDate(lockExpireTime);
            const isExpired = lockExpireTime && expireDate && new Date() > expireDate;
            
            if (!isExpired) {
              newStatus = 'locked'
              newStatusClass = 'locked'
              newStatusText = '操作中...'
              canSelect = false
            }
          }
          
          if (newStatus === 'locked') return { ...slotInfo, status: 'locked', statusClass: 'locked', statusText: '操作中，请稍后刷新', canSelect: false };

          // 如果编辑权限关闭，则禁用选择功能（但已确认的状态不变）
          if (!isEditingEnabled && !userSlots.confirmedSlots.find(slot => slot.dutySlotId === slotId)) {
            canSelect = false
          }
          
          // 如果时间段已被其他人分配，则显示已分配状态
          if (slotInfo.slotData?.dutyHolderName && !userSlots.confirmedSlots.some(slot => slot.dutySlotId === slotId)) {
            newStatus = 'assigned'
            newStatusClass = 'assigned'
            newStatusText = `${slotInfo.slotData.dutyHolderName}已占用`
            canSelect = false
          }
          // 如果是当前用户的时间段，则根据具体情况设置状态
          else if (selectedSlots.includes(slotId) && slotInfo.slotData?.isAvailable) {
            // 当前预选的
            newStatus = 'selected'
            newStatusClass = 'selected'
          } else if (userSlots.confirmedSlots.find(slot => slot.dutySlotId === slotId)) {
            // 已确认的
            newStatus = 'confirmed'
            newStatusClass = 'assigned'
            canSelect = false  // 已确认的不能再次选择
          } else if (userSlots.preSelectedSlots.find(slot => slot.dutySlotId === slotId)) {
            // 已预选但未确认的
            newStatus = 'preSelected'
            newStatusClass = 'selected'
          }
          
          return {
            ...slotInfo,
            status: newStatus,
            statusClass: newStatusClass,
            statusText: newStatusText,
            canSelect: canSelect
          }
        })
      }
    })
    
    this.setData({
      tableData: updatedTableData
    })
  },

  // 检查编辑权限
  checkEditPermission: function () {
    // 检查配置数据是否存在
    if (!this.data.configData) {
      wx.showToast({
        title: '配置信息尚未加载',
        icon: 'none'
      })
      return false
    }

    // 检查编辑权限是否开启
    if (!this.data.configData.isEditingEnabled) {
      wx.showToast({
        title: '当前周编辑权限已关闭',
        icon: 'none'
      })
      return false
    }

    return true
  },

  // 确认选择
  // 核对固定快照；云端确认仍负责锁、权限和最终结果。
  async confirmSelection() {
    if (this.data.confirming || !this.checkEditPermission()) return;
    const selected = [...this.data.selectedSlotsDisplay, ...(this.data.userSlots.preSelectedSlots || [])];
    const unique = selected.filter((slot,index) => selected.findIndex(other => other.dutySlotId === slot.dutySlotId) === index);
    if (!unique.length) { wx.showToast({ title: '请先预选值班时段', icon: 'none' }); return; }
    const snapshot = {
      week: this.data.currentWeek, year: this.data.currentYear,
      ids: unique.map(slot => slot.dutySlotId),
      summary: unique.map(slot => `${slot.date} ${slot.timeSlot} ${slot.startTime}-${slot.endTime}`).join('\n')
    };
    this.setData({ confirming: true, confirmationMessage: '' });
    try {
      const confirmation = await wx.showModal({ title: `核对第${snapshot.week}周值班`,
        content: `${this.data.weekDateRange}\n${snapshot.summary}\n确认后不能自行取消。`, confirmText: '确认时段', cancelText: '返回修改' });
      if (confirmation.confirm) await this.submitConfirmSelection(snapshot);
    } finally { this.setData({ confirming: false }); }
  },

  async submitConfirmSelection(snapshot) {
    if (!snapshot || !snapshot.ids.length) return;
    const SubscriptionAuth = require('../../../../utils/subscriptionAuth');
    try {
      await SubscriptionAuth.requestSubscribeMessage([SubscriptionAuth.TEMPLATES.DUTY_REMINDER], SubscriptionAuth.SCENES.DUTY_SELECTION, { showTip: true, allowPartialSuccess: true });
    } catch (_) { /* 拒绝通知不阻断值班确认。 */ }
    wx.showLoading({ title: '核对当前周...' });
    try {
      const latest = await api.call('dutySchedule', { action: 'getDutySlots', timeout: 10000 });
      if (!latest.success || !latest.data) throw new Error(latest.message || '无法核对当前周，请重新加载');
      if (latest.data.weekNumber !== snapshot.week || latest.data.year !== snapshot.year) {
        this.processDutyData(latest.data);
        this.setData({ confirmationMessage: '当前周已变化，旧周预选未提交，请核对新周后重新选择。' });
        return;
      }
      const requestId = api.generateRequestId();
      const res = await api.call('dutySchedule', {
        action: 'confirmDutySelection', params: { selectedSlots: snapshot.ids, requestId },
        timeout: 15000, config: { retries: 0, requestId }
      });
      if (res.success) {
        this.setData({ selectedSlots: [], selectedSlotsDisplay: [], confirmationMessage: '这些时段已确认，确认后不能自行取消。' });
        getApp().publish('dutyChanged', { weekNumber: snapshot.week });
        await this.handleDutyReminderScheduling(snapshot.ids);
      } else {
        this.setData({ confirmationMessage: res.code === 503
          ? '暂时无法确认结果，正在重新读取排班。请核对已确认和预选列表，勿盲目重试。'
          : `${res.message || '未能确认全部时段'}。请核对最新排班后重新选择。` });
      }
      // 后端可能逐条写入，必须读取实际结果，不推断整批成功或整批失败。
      await this.loadDutyData(true);
      await this.loadUserDutySlots();
      this.reconcileLocalSelection();
    } catch (error) {
      this.setData({ confirmationMessage: error.message || '结果暂时无法核实，请刷新排班后检查' });
    } finally { wx.hideLoading(); }
  },

  reconcileLocalSelection() {
    const confirmed = new Set((this.data.userSlots.confirmedSlots || []).map(slot => slot.dutySlotId));
    const available = new Set();
    this.data.tableData.forEach(row => row.dailySlots.forEach(slot => {
      if (slot.slotData && (slot.canSelect || slot.status === 'selected')) available.add(slot.slotData.dutySlotId);
    }));
    const keep = this.data.selectedSlots.filter(id => !confirmed.has(id) && available.has(id));
    this.setData({ selectedSlots: keep, selectedSlotsDisplay: this.data.selectedSlotsDisplay.filter(slot => keep.includes(slot.dutySlotId)) });
    this.updateTableDisplayStatus();
  },

  // 处理值班提醒调度
  handleDutyReminderScheduling: async function (selectedSlots) {
    
    const api = require('../../../../utils/apiAdapter.js');
    
    try {
      const res = await api.call('dutySchedule', {
        action: 'scheduleDutyReminder',
        params: { 
          selectedSlots: selectedSlots,
          miniprogramState: 'formal' // 使用正式版订阅消息
        },
        timeout: 10000, config: { retries: 0 }
      });
      
      if (res.success) {
        // 调度设置成功
      } else {
        console.warn('[值班表] 值班提醒调度设置失败:', res.message);
      }
    } catch (error) {
      console.error('[值班表] 值班提醒调度异常:', error);
    }
  },

  // 清空用户选择状态（用于页面切换时重置状态）
  clearUserSelectionState: function () {
    
    // 重置用户的预选状态
    this.setData({
      selectedSlots: [],
      selectedSlotsDisplay: []
    })
  },

  // 检查周数是否发生变化并清空相关状态
  checkAndClearIfWeekChanged: function (newWeekNumber, newYear) {
    const oldWeekNumber = this.data.currentWeek
    const oldYear = this.data.currentYear
    
    // 如果周数或年份发生了变化，清空用户的预选状态
    if (newWeekNumber !== oldWeekNumber || newYear !== oldYear) {
      this.clearUserSelectionState()
      return true
    }
    return false
  },

  // 清空预选
  clearSelection: function () {
    if (this.data.confirming) return;
    // 首先检查编辑权限
    if (!this.checkEditPermission()) {
      return
    }

    if (this.data.selectedSlots.length === 0) {
      wx.showToast({
        title: '暂无预选项',
        icon: 'none'
      })
      return
    }
    
    this.setData({
      selectedSlots: [],
      selectedSlotsDisplay: []
    })
    
    // 更新表格显示
    this.updateTableDisplayStatus()
    
    wx.showToast({
      title: '已清空预选',
      icon: 'success'
    })
  },

  // 移除特定的预选时间段（已确认的时间段不能移除）
  removeUserSlot: function (e) {
    if (this.data.confirming) return;
    const { slotId, slotType } = e.currentTarget.dataset
    
    if (slotType === 'preSelected') {
      // 移除预选项
      this.removeSlotFromSelection(slotId)
    } else if (slotType === 'confirmed') {
      // 已确认的时间段不能取消
      wx.showModal({
        title: '操作提示',
        content: '已确认的值班时间段不能自行取消，如有特殊情况请联系组长处理',
        showCancel: false,
        confirmText: '我知道了'
      })
    }
  }
}) 