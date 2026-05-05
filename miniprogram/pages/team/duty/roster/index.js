// pages/team/duty/roster/index.js
const api = require('../../../../utils/apiAdapter');
const iconManager = require('../../../../utils/iconManager');
const time = require('../../../../utils/time');

Page({
  data: {
    // 加载状态
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
    
    this.initPage()
  },

  onShow: function () {
    
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
      return `${monday.dateDisplay} 至 ${sunday.dateDisplay}`
    }

    // 备选方案：使用第一个和最后一个日期
    const firstDate = weekDates[0]
    const lastDate = weekDates[weekDates.length - 1]
    return `${firstDate.dateDisplay} 至 ${lastDate.dateDisplay}`
  },

  // 值班格子点击事件
  onSlotTap: function (e) {
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
    
    // 创建一个包含所有用户相关时间段的集合
    const userSlotIds = new Set([
      ...userSlots.preSelectedSlots.map(slot => slot.dutySlotId),
      ...userSlots.confirmedSlots.map(slot => slot.dutySlotId),
      ...selectedSlots
    ])
    
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
          let newStatusText = slotInfo.statusText // 保持原有状态文本
          
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
          
          // 如果编辑权限关闭，则禁用选择功能（但已确认的状态不变）
          if (!isEditingEnabled && !userSlots.confirmedSlots.find(slot => slot.dutySlotId === slotId)) {
            canSelect = false
          }
          
          // 如果时间段已被其他人分配，则显示已分配状态
          if (slotInfo.slotData?.dutyHolderName && !userSlotIds.has(slotId)) {
            newStatus = 'assigned'
            newStatusClass = 'assigned'
            canSelect = false
          }
          // 如果是当前用户的时间段，则根据具体情况设置状态
          else if (selectedSlots.includes(slotId)) {
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
  confirmSelection: async function () {
    // 首先检查编辑权限
    if (!this.checkEditPermission()) {
      return
    }

    const selectedSlots = this.data.selectedSlots
    
    if (selectedSlots.length === 0) {
      wx.showToast({
        title: '请先选择值班时间段',
        icon: 'none'
      })
      return
    }
    

    
    wx.showModal({
      title: '确认值班选择',
      content: `确定要选择这${selectedSlots.length}个时间段值班吗？确认后将添加到您的待办事项中。`,
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.submitConfirmSelection()
        }
      }
    })
  },

  // 提交确认选择
  submitConfirmSelection: async function () {
    const selectedSlots = this.data.selectedSlots;
    const SubscriptionAuth = require('../../../../utils/subscriptionAuth.js');
    
    // 请求值班提醒订阅消息授权
    try {
      const authResult = await SubscriptionAuth.requestSubscribeMessage(
        [SubscriptionAuth.TEMPLATES.DUTY_REMINDER], 
        SubscriptionAuth.SCENES.DUTY_SELECTION,
        {
          // 展示前置说明，并在用户确认后触发系统授权弹窗
          showTip: true,
          allowPartialSuccess: true
        }
      );
      // 若本次一个也未授权，给出设置引导（不阻断后续流程）
      if (authResult && authResult.analysis && authResult.analysis.acceptedCount === 0) {
        wx.showToast({ title: '未开启值班提醒，可能收不到通知', icon: 'none', duration: 1800 });
        try {
          wx.getSetting({
            withSubscriptions: true,
            success: (setting) => {
              const tmplId = SubscriptionAuth.TEMPLATES.DUTY_REMINDER;
              const item = setting.subscriptionsSetting && setting.subscriptionsSetting.itemSettings ? setting.subscriptionsSetting.itemSettings[tmplId] : undefined;
              const needGuide = setting.subscriptionsSetting && setting.subscriptionsSetting.mainSwitch === false || item === 'reject' || item === 'ban';
              if (needGuide) {
                wx.showModal({
                  title: '开启值班提醒',
                  content: '未授权或被系统拦截，您可以在设置中开启订阅消息权限。',
                  confirmText: '去设置',
                  cancelText: '稍后',
                  success: (m) => {
                    if (m.confirm) {
                      wx.openSetting({ withSubscriptions: true });
                    }
                  }
                });
              }
            }
          });
        } catch (e) {}
      }
      
      // 即使授权失败也继续提交，不阻断核心业务流程
    } catch (error) {
      console.error('值班提醒订阅授权异常:', error);
      // 授权异常不影响提交流程
    }
    
    wx.showLoading({
      title: '确认中...'
    });
    
    const requestId = api.generateRequestId();

    try {
      const res = await api.call('dutySchedule', {
        action: 'confirmDutySelection',
        params: { selectedSlots, requestId },
        config: { timeout: 15000 }
      });

      wx.hideLoading();
      
      if (res.success) {
        wx.showToast({
          title: '确认成功',
          icon: 'success'
        });
        
        // 确认成功后，处理值班提醒调度
        try {
          await this.handleDutyReminderScheduling(selectedSlots);
        } catch (error) {
          console.error('[值班表] 处理值班提醒调度失败:', error);
          // 提醒调度失败不影响主流程
        }
        
        this.setData({
          selectedSlots: [],
          selectedSlotsDisplay: []
        });
        
        Promise.all([
          this.loadDutyData(),
          this.loadUserDutySlots()
        ]);
      } else {
        wx.showModal({
          title: '确认失败',
          content: res.message || '确认值班选择失败，请重试',
          showCancel: false
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[值班表] 确认选择异常：', err);
      wx.showModal({
        title: '确认失败',
        content: '网络异常，请检查网络连接后重试',
        showCancel: false
      });
    }
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
        config: { timeout: 10000 }
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