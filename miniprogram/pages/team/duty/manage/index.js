// pages/team/duty/manage/index.js
const api = require('../../../../utils/apiAdapter');
const iconManager = require('../../../../utils/iconManager');

Page({
  data: {
    // 页面数据
    isLoading: false,
    configData: null,
    setupProgress: null,
    showDatePickerModal: false,
    tempDate: '',

    // 图标资源
    iconLoading: iconManager.get('common_loading'),
    iconEmpty: iconManager.get('common_empty'),
    iconCheck: iconManager.get('common_check'),
    iconDelete: iconManager.get('common_delete'),
    iconClose: iconManager.get('common_close'),
    iconCalendar: iconManager.get('team_calendar'),
    iconSwitch: iconManager.get('other_switch'),
    iconTools: iconManager.get('other_info'),
    iconLock: iconManager.get('status_lock'),
    iconUnlock: iconManager.get('status_unlock'),
    iconTime: iconManager.get('other_time'),

    // 简化的周次切换相关数据
    showWeekSwitcherModal: false,
    selectedWeek: '',
    selectedWeekIndex: 0,
    weekOptions: [],
    
    // 重置确认相关数据
    showResetConfirmModal: false,
    // 编辑权限切换相关数据
    showEditPermissionModal: false,
    permissionActionText: '',
    
    // 删除功能相关数据
    isDeleteMode: false,
    selectedSlots: [],
    showDeleteConfirmModal: false,
    deletePreviewList: [],
    // 删除确认按钮防抖禁用
    confirmDeleteDisabled: false,
    
    // 值班表格相关数据
    dutyTableData: null,
    tableLoading: false,
    tableError: false,
    tableErrorMessage: '',
    currentWeek: 1,
    currentYear: new Date().getFullYear(),
    weekDateRange: '',
    weekDates: [],
    tableData: [],
    totalSlots: 0,
    availableSlots: 0,
    assignedSlots: 0,

    // 自动切周配置相关
    showAutoSwitchModal: false,
    autoSwitchEnabledTemp: true,
    autoSwitchDayOfWeekTemp: 1,
    autoSwitchTimeTemp: '10:30',
    autoSwitchDayOptions: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    autoSwitchDayIndexTemp: 1,

    // 顶部分页导航
    tabs: ['本周值班', '值班设置', '当前配置'],
    currentTab: 0,
    swiperCurrent: 0,

    // 危险设置折叠
    showDangerZone: false
  },

  onLoad: function (options) {
    
    this.initWeekOptions()
    this.initPage()
  },

  // 顶部标签点击切换
  onTabClick: function (e) {
    const index = Number(e.currentTarget.dataset.index)
    if (isNaN(index)) return
    this.setData({
      currentTab: index,
      swiperCurrent: index
    })
  },

  // swiper 滑动切换
  onSwiperChange: function (e) {
    const index = e.detail.current || 0
    this.setData({
      currentTab: index,
      swiperCurrent: index
    })
  },

  // 切换危险设置区域展开/收起
  toggleDangerZone: function () {
    this.setData({
      showDangerZone: !this.data.showDangerZone
    })
  },

  onShow: function () {
    
  },

  // 初始化周次选项
  initWeekOptions: function() {
    const options = []
    for (let i = 1; i <= 20; i++) {
      options.push(`第${i}周`)
    }
    this.setData({ weekOptions: options })
  },

  // 初始化页面
  initPage: function () {
    
    
    // TODO: 检查组长权限
    this.loadCurrentConfig()
    this.loadDutyTableData()
  },

  // 加载当前配置
  loadCurrentConfig: async function () {
    this.setData({ isLoading: true });
    try {
      const res = await api.call('dutySchedule', {
        action: 'getDutyConfig'
      });
      if (res.success) {
        this.setData({ 
          configData: res.data,
          isLoading: false
        });
      } else {
        this.setData({ isLoading: false });
        console.error('[值班管理] 获取配置失败');
      }
    } catch (err) {
      console.error('[值班管理] 获取配置失败：', err);
      this.setData({ isLoading: false });
    }
  },

  // ============ 自动切周设置 ============

  // 打开自动切周设置弹窗
  openAutoSwitchSettings: function () {
    const cfg = this.data.configData || {}
    const enabled = cfg.autoSwitchEnabled !== false
    const dayOfWeek = typeof cfg.autoSwitchDayOfWeek === 'number' ? cfg.autoSwitchDayOfWeek : 1
    const timeStr = cfg.autoSwitchTime || '10:30'

    this.setData({
      showAutoSwitchModal: true,
      autoSwitchEnabledTemp: enabled,
      autoSwitchDayOfWeekTemp: dayOfWeek,
      autoSwitchDayIndexTemp: dayOfWeek,
      autoSwitchTimeTemp: timeStr
    })
  },

  // 关闭自动切周设置弹窗
  cancelAutoSwitchSettings: function () {
    this.setData({ showAutoSwitchModal: false })
  },

  // 开关自动切周
  onAutoSwitchEnabledChange: function (e) {
    this.setData({ autoSwitchEnabledTemp: !!e.detail.value })
  },

  // 选择每周哪一天自动切周
  onAutoSwitchDayChange: function (e) {
    const index = parseInt(e.detail.value, 10) || 0
    this.setData({
      autoSwitchDayIndexTemp: index,
      autoSwitchDayOfWeekTemp: index
    })
  },

  // 选择自动切周时间（HH:MM）
  onAutoSwitchTimeChange: function (e) {
    this.setData({ autoSwitchTimeTemp: e.detail.value })
  },

  // 保存自动切周配置
  saveAutoSwitchSettings: async function () {
    const enabled = this.data.autoSwitchEnabledTemp
    const dayOfWeek = this.data.autoSwitchDayOfWeekTemp
    const timeStr = this.data.autoSwitchTimeTemp || '10:30'

    this.setData({ 
      isLoading: true,
      setupProgress: '正在保存自动切周设置...'
    })

    try {
      // 逐项更新配置，后端会返回最新 config
      await api.call('dutySchedule', {
        action: 'updateDutyConfig',
        params: { configType: 'autoSwitchEnabled', value: enabled }
      })
      await api.call('dutySchedule', {
        action: 'updateDutyConfig',
        params: { configType: 'autoSwitchDayOfWeek', value: dayOfWeek }
      })
      await api.call('dutySchedule', {
        action: 'updateDutyConfig',
        params: { configType: 'autoSwitchTime', value: timeStr }
      })

      wx.showToast({ title: '自动切周设置已保存', icon: 'success' })
      this.setData({ showAutoSwitchModal: false })
      // 重新加载配置，刷新显示
      await this.loadCurrentConfig()
    } catch (err) {
      console.error('[值班管理] 保存自动切周设置失败：', err)
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ 
        isLoading: false,
        setupProgress: null
      })
    }
  },

  // ============ 设置页开关联动 ============

  // 编辑权限开关切换
  onEditPermissionSwitchChange: function (e) {
    const cfg = this.data.configData
    if (!cfg) return
    const currentEnabled = !!cfg.isEditingEnabled
    const targetEnabled = !!e.detail.value
    // 如果状态没有变化，直接返回
    if (currentEnabled === targetEnabled) return
    // 复用已有的权限切换逻辑
    this.performEditPermissionToggle()
  },

  // 自动切周开关切换
  onAutoSwitchToggleChange: async function (e) {
    const cfg = this.data.configData || {}
    const currentEnabled = cfg.autoSwitchEnabled !== false
    const targetEnabled = !!e.detail.value

    // 没有变化则不处理
    if (currentEnabled === targetEnabled) return

    if (targetEnabled) {
      // 从关闭 -> 开启：先打开配置弹窗让用户选择具体时间
      this.openAutoSwitchSettings()
    } else {
      // 从开启 -> 关闭：仅切换状态即可
      this.setData({
        isLoading: true,
        setupProgress: '正在关闭自动切周...'
      })
      try {
        await api.call('dutySchedule', {
          action: 'updateDutyConfig',
          params: { configType: 'autoSwitchEnabled', value: false }
        })
        wx.showToast({ title: '已关闭自动切周', icon: 'success' })
        await this.loadCurrentConfig()
      } catch (err) {
        console.error('[值班管理] 关闭自动切周失败：', err)
        wx.showToast({ title: '关闭失败，请稍后重试', icon: 'none' })
      } finally {
        this.setData({
          isLoading: false,
          setupProgress: null
        })
      }
    }
  },

  // ============ 设置初始日期功能 ============

  // 设置学期初始日期并重新生成值班表
  setupSemester: function () {
    
    // 直接显示日期选择器
    this.showSimpleDatePicker()
  },

  // 显示简化的日期选择器
  showSimpleDatePicker: function () {
    
    
    // 设置默认日期
    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')
    const defaultDate = this.data.configData?.startDate || `${year}-${month}-${day}`
    
    this.setData({
      showDatePickerModal: true,
      tempDate: defaultDate
    })
  },

  // 日期选择器变化事件
  onTempDateChange: function (e) {
    const selectedDate = e.detail.value
    
    this.setData({
      tempDate: selectedDate
    })
  },

  // 确认选择日期
  confirmDateSelection: function () {
    const selectedDate = this.data.tempDate
    if (!selectedDate) {
      wx.showToast({
        title: '请选择日期',
        icon: 'none'
      })
      return
    }

    this.setData({ showDatePickerModal: false })
    this.handleDateSelected(selectedDate)
  },

  // 取消日期选择
  cancelDateSelection: function () {
    this.setData({ showDatePickerModal: false })
  },

  // 处理选择的日期
  handleDateSelected: function (selectedDate) {
    

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      wx.showToast({
        title: '日期格式错误',
        icon: 'none'
      })
      return
    }

    // 验证是否为周一
    const date = new Date(selectedDate)
    const dayOfWeek = date.getDay()
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const weekdayName = weekdays[dayOfWeek]

    if (dayOfWeek !== 1) {
      wx.showModal({
        title: '日期错误',
        content: `所选日期 ${selectedDate} 是${weekdayName}，学期开始日期必须是周一。`,
        showCancel: false
      })
      return
    }

    // 二次确认
    wx.showModal({
      title: '确认设置',
      content: `确定将 ${selectedDate}（${weekdayName}）设置为学期开始日期吗？\n\n此操作将清除所有现有值班数据。`,
      confirmText: '确定',
      confirmColor: '#007aff',
      success: (res) => {
        if (res.confirm) {
          this.performSemesterSetup(selectedDate)
        }
      }
    })
  },

  // 执行学期设置
  performSemesterSetup: async function (selectedDate) {
    this.setData({ 
      isLoading: true,
      setupProgress: '正在设置学期初始日期...'
    });

    try {
      this.setData({ setupProgress: '正在清除现有数据...' });
      await api.call('dutySchedule', {
        action: 'clearAllDutySlots',
        params: { forceDelete: true, batchSize: 50, maxRetries: 3 },
        config: { timeout: 30000 }
      });

      this.setData({ setupProgress: '正在设置学期开始日期...' });
      await api.call('dutySchedule', {
        action: 'updateDutyConfig',
        params: { configType: 'startDate', value: selectedDate },
        config: { timeout: 10000 }
      });

      this.setData({ setupProgress: '正在生成第一周值班表...' });
      await api.call('dutySchedule', {
        action: 'regenerateDutySlots',
        params: { weekNumber: 1, year: new Date().getFullYear() },
        config: { timeout: 15000 }
      });

      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      wx.showModal({
        title: '设置完成',
        content: '学期初始日期设置成功！',
        showCancel: false,
        success: () => {
          this.loadCurrentConfig();
          this.loadDutyTableData();
        }
      });
    } catch (err) {
      console.error('[值班管理] 学期设置失败：', err);
      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      wx.showModal({
        title: '设置失败',
        content: err.message || '学期设置过程中发生错误',
        showCancel: false
      });
    }
  },

  // 清除现有数据
  clearExistingData: function () {
    this.setData({ setupProgress: '正在清除现有数据...' });
    return api.call('dutySchedule', {
      action: 'clearAllDutySlots',
      params: { forceDelete: true, batchSize: 50, maxRetries: 3 },
      config: { timeout: 30000 }
    });
  },

  // 更新开始日期
  updateStartDate: function (selectedDate) {
    this.setData({ setupProgress: '正在设置学期开始日期...' });
    return api.call('dutySchedule', {
      action: 'updateDutyConfig',
      params: { configType: 'startDate', value: selectedDate },
      config: { timeout: 10000 }
    });
  },

  // 重新生成值班表
  regenerateSchedule: function () {
    this.setData({ setupProgress: '正在生成第一周值班表...' });
    return api.call('dutySchedule', {
      action: 'regenerateDutySlots',
      params: { weekNumber: 1, year: new Date().getFullYear() },
      config: { timeout: 15000 }
    });
  },

  // ============ 简化的周次切换功能 ============

  // 显示简化的周次切换器
  showSimpleWeekSwitcher: function () {
    
    this.setData({
      showWeekSwitcherModal: true,
      selectedWeek: '',
      selectedWeekIndex: 0
    })
  },

  // 周次选择器变化事件
  onWeekPickerChange: function (e) {
    const index = parseInt(e.detail.value) // 确保index为数字类型
    const week = index + 1 // 选项索引从0开始，周次从1开始
    
    this.setData({
      selectedWeekIndex: index,
      selectedWeek: week
    })
  },

  // 取消周次切换
  cancelWeekSwitcher: function () {
    this.setData({
      showWeekSwitcherModal: false
    })
  },

  // 确认简化的周次切换
  confirmSimpleWeekSwitch: function () {
    const weekNumber = this.data.selectedWeek
    
    if (!weekNumber) {
      wx.showToast({
        title: '请选择周次',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认切换',
      content: `确定切换到第${weekNumber}周吗？`,
      confirmText: '确定',
      confirmColor: '#007aff',
      success: (res) => {
        if (res.confirm) {
          this.setData({ showWeekSwitcherModal: false })
          this.performWeekSwitch(weekNumber)
        }
      }
    })
  },

  // 执行周次切换
  performWeekSwitch: async function (weekNumber) {
    this.setData({ 
      isLoading: true,
      setupProgress: `正在切换到第${weekNumber}周...`
    });
    
    try {
      const res = await api.call('dutySchedule', {
        action: 'switchToWeek',
        params: { weekNumber: weekNumber, year: new Date().getFullYear() },
        config: { timeout: 15000 }
      });

      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      
      if (res.success) {
        wx.showModal({
          title: '切换成功',
          content: `成功切换到第${weekNumber}周`,
          showCancel: false,
          success: () => {
            this.loadCurrentConfig();
            this.loadDutyTableData();
          }
        });
      } else {
        wx.showModal({
          title: '切换失败',
          content: res.message || '切换周次失败',
          showCancel: false
        });
      }
    } catch (err) {
      console.error('[值班管理] 切换周次失败：', err);
      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      wx.showModal({
        title: '切换失败',
        content: err.message || '切换周次过程中发生错误',
        showCancel: false
      });
    }
  },

  // ============ 简化的重置本周数据功能 ============

  // 显示简化的重置确认
  showSimpleResetConfirm: function () {
    
    
    if (!this.data.configData?.currentWeek) {
      wx.showToast({
        title: '当前周次未设置',
        icon: 'none'
      })
      return
    }
    
    this.setData({
      showResetConfirmModal: true
    })
  },

  // 取消重置
  cancelReset: function () {
    
    this.setData({
      showResetConfirmModal: false
    })
  },

  // 确认重置
  confirmReset: function () {
    
    
    this.setData({
      showResetConfirmModal: false
    })
    
    this.performReset()
  },

  // 执行重置操作
  performReset: async function () {
    const currentWeek = this.data.configData?.currentWeek;
    
    this.setData({ 
      isLoading: true,
      setupProgress: `正在重置第${currentWeek}周数据...`
    });
    
    try {
      const res = await api.call('dutySchedule', {
        action: 'resetCurrentWeekData',
        params: {},
        config: { timeout: 10000 }
      });

      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      
      if (res.success) {
        wx.showModal({
          title: '重置成功',
          content: `第${currentWeek}周数据已重置`,
          showCancel: false,
          success: () => {
            this.loadCurrentConfig();
            this.loadDutyTableData();
          }
        });
      } else {
        wx.showModal({
          title: '重置失败',
          content: res.message || '重置失败',
          showCancel: false
        });
      }
    } catch (err) {
      console.error('[值班管理] 重置失败：', err);
      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      wx.showModal({
        title: '重置失败',
        content: err.message || '重置过程中发生错误',
        showCancel: false
      });
    }
  },

  // ============ 简化的编辑权限切换功能 ============

  // 显示简化的权限切换
  showSimplePermissionToggle: function () {
    
    
    if (!this.data.configData?.currentWeek) {
      wx.showToast({
        title: '当前周次未设置',
        icon: 'none'
      })
      return
    }
    
    const currentEnabled = this.data.configData.isEditingEnabled
    const actionText = currentEnabled ? '关闭' : '开启'
    
    this.setData({
      showEditPermissionModal: true,
      permissionActionText: actionText
    })
  },

  // 取消编辑权限切换
  cancelEditPermissionToggle: function () {
    
    this.setData({
      showEditPermissionModal: false,
      permissionActionText: ''
    })
  },

  // 确认编辑权限切换
  confirmEditPermissionToggle: function () {
    
    
    this.setData({
      showEditPermissionModal: false
    })
    
    this.performEditPermissionToggle()
  },

  // 执行编辑权限切换操作
  performEditPermissionToggle: async function () {
    const currentEnabled = this.data.configData.isEditingEnabled;
    const newEnabled = !currentEnabled;
    const actionText = newEnabled ? '开启' : '关闭';
    const currentWeek = this.data.configData?.currentWeek;
    
    this.setData({ 
      isLoading: true,
      setupProgress: `正在${actionText}编辑权限...`
    });
    
    try {
      const res = await api.call('dutySchedule', {
        action: 'updateDutyConfig',
        params: {
            configType: 'isEditingEnabled',
            value: newEnabled
        },
        config: { timeout: 8000 }
      });

      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      
      if (res.success) {
        wx.showModal({
          title: `${actionText}成功`,
          content: `第${currentWeek}周编辑权限已${actionText}`,
          showCancel: false,
          success: () => {
            this.loadCurrentConfig();
            this.loadDutyTableData();
          }
        });
      } else {
        wx.showModal({
          title: `${actionText}失败`,
          content: res.message || `${actionText}编辑权限失败`,
          showCancel: false
        });
      }
    } catch (err) {
      console.error('[值班管理] 编辑权限切换失败：', err);
      this.setData({ 
        isLoading: false,
        setupProgress: null
      });
      wx.showModal({
        title: `${actionText}失败`,
        content: err.message || `${actionText}编辑权限过程中发生错误`,
        showCancel: false
      });
    }
  },

  // ============ 值班表格数据功能 ============

  // 加载值班表格数据
  loadDutyTableData: async function () {
    this.setData({ 
      tableLoading: true,
      tableError: false,
      tableErrorMessage: ''
    });

    try {
      const res = await api.call('dutySchedule', {
        action: 'getDutySlots',
        config: { timeout: 10000 }
      });

      if (res.success) {
        this.processTableData(res.data);
      } else if (res.code === 404) {
        this.setData({
          tableLoading: false,
          tableError: true,
          tableErrorMessage: res.message || '当前周暂无值班数据',
          currentWeek: res.data?.weekNumber || 1,
          currentYear: res.data?.year || new Date().getFullYear()
        });
      } else {
        console.error('[值班管理] 获取表格数据失败：', res.message);
        this.setData({
          tableLoading: false,
          tableError: true,
          tableErrorMessage: res.message || '获取值班数据失败'
        });
      }
    } catch (err) {
      console.error('[值班管理] 获取值班表格数据异常：', err);
      this.setData({
        tableLoading: false,
        tableError: true,
        tableErrorMessage: '网络异常，请检查网络连接'
      });
    }
  },

  // 处理表格数据
  processTableData: function (data) {
    
    

    // 处理表格数据，为每个时间段添加删除相关属性
    const processedTableData = data.tableData.map((timeSlotData, rowIndex) => {
      return {
        ...timeSlotData,
        dailySlots: timeSlotData.dailySlots.map((slotData, colIndex) => {
          // 从slotData.slotData中提取真正的slot数据
          const originalSlot = slotData.slotData
          
          // 判断是否可删除：已分配的时间段才能删除
          // 检查多个可能的字段，确保能识别已分配的值班
          const hasAssignedUser = !!(originalSlot?.dutyHolderId || originalSlot?.assignedUser)
          const hasAssignedName = !!(originalSlot?.dutyHolderName && originalSlot?.dutyHolderName !== '' && originalSlot?.dutyHolderName !== '可选')
          const isAssigned = slotData.statusClass === 'assigned'
          
          const canDelete = hasAssignedUser || hasAssignedName || isAssigned
          
          // 提取关键字段
          const dutySlotId = originalSlot?.dutySlotId || originalSlot?._id
          const dutyHolderId = originalSlot?.dutyHolderId
          const dutyHolderName = originalSlot?.dutyHolderName
          
          // 调试日志 - 只显示可删除的时间段
          if (canDelete) {
            
          }
          
          return {
            ...slotData,
            // 提升关键字段到顶级
            dutySlotId,
            dutyHolderId,
            dutyHolderName,
            canDelete: canDelete,
            // 删除选择状态
            isSelected: false
          }
        })
      }
    })

    // 生成周日期范围显示文本
    const weekDateRange = this.generateWeekDateRange(data.weekDates)

    this.setData({
      tableLoading: false,
      tableError: false,
      dutyTableData: data,
      currentWeek: data.weekNumber,
      currentYear: data.year,
      weekDateRange: weekDateRange,
      weekDates: data.weekDates,
      tableData: processedTableData,
      totalSlots: data.totalSlots,
      availableSlots: data.availableSlots,
      assignedSlots: data.assignedSlots,
      // 重置删除相关状态
      isDeleteMode: false,
      selectedSlots: [],
      showDeleteConfirmModal: false,
      deletePreviewList: []
    })

    
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

  // 重新加载表格数据
  retryLoadTableData: function () {
    
    this.loadDutyTableData()
  },

  // ============ 删除值班分配功能 ============

  // 切换删除模式
  toggleDeleteMode: function () {
    
    
    if (this.data.isDeleteMode) {
      // 当前是删除模式，点击确认删除
      if (this.data.selectedSlots.length === 0) {
        wx.showToast({
          title: '请选择要删除的值班',
          icon: 'none'
        })
        return
      }
      this.showDeleteConfirm()
    } else {
      // 进入删除模式
      this.setData({
        isDeleteMode: true,
        selectedSlots: []
      })
      
      // 清除所有选择状态
      this.clearAllSelections()
      
      // 显示操作提示
      wx.showToast({
        title: '请点击要删除的值班时段',
        icon: 'none',
        duration: 2000
      })
    }
  },

  // 取消删除模式
  cancelDeleteMode: function () {
    
    this.setData({
      isDeleteMode: false,
      selectedSlots: []
    })
    
    // 清除所有选择状态
    this.clearAllSelections()
  },

  // 清除所有选择状态
  clearAllSelections: function () {
    const tableData = this.data.tableData.map(timeSlotData => {
      return {
        ...timeSlotData,
        dailySlots: timeSlotData.dailySlots.map(slotData => {
          return {
            ...slotData,
            isSelected: false
          }
        })
      }
    })
    
    this.setData({ tableData })
  },

  // 切换时间段选择状态
  toggleSlotSelection: function (e) {
    const { slotId, canDelete } = e.currentTarget.dataset
    
    
    
    // 检查是否在删除模式
    if (!this.data.isDeleteMode) {
      return
    }
    
    // 检查时间段ID
    if (!slotId || slotId === '') {
      console.warn('[值班管理] 未找到时间段ID，dataset：', e.currentTarget.dataset)
      wx.showToast({
        title: '获取时间段信息失败',
        icon: 'none'
      })
      return
    }
    
    // 检查是否可删除
    if (!canDelete || canDelete === 'false' || canDelete === false) {
      wx.showToast({
        title: '该时间段无法删除',
        icon: 'none'
      })
      return
    }
    
    let selectedSlots = [...this.data.selectedSlots]
    let isSelected = false
    
    // 更新表格数据中的选择状态
    const tableData = this.data.tableData.map(timeSlotData => {
      return {
        ...timeSlotData,
        dailySlots: timeSlotData.dailySlots.map(slotData => {
          if (slotData.dutySlotId === slotId && slotData.canDelete) {
            isSelected = !slotData.isSelected
            
            if (isSelected) {
              // 添加到选择列表
              if (!selectedSlots.includes(slotId)) {
                selectedSlots.push(slotId)
              }
            } else {
              // 从选择列表移除
              selectedSlots = selectedSlots.filter(id => id !== slotId)
            }
            
            return {
              ...slotData,
              isSelected: isSelected
            }
          }
          return slotData
        })
      }
    })
    
    this.setData({
      tableData,
      selectedSlots
    })
    
    
  },

  // 显示删除确认弹窗
  showDeleteConfirm: function () {
    
    
    if (this.data.selectedSlots.length === 0) {
      wx.showToast({
        title: '请选择要删除的值班',
        icon: 'none'
      })
      return
    }

    // 生成删除预览列表
    const deletePreviewList = this.generateDeletePreviewList()
    
    this.setData({
      showDeleteConfirmModal: true,
      deletePreviewList,
      confirmDeleteDisabled: false
    })
  },

  // 生成删除预览列表
  generateDeletePreviewList: function () {
    const selectedSlots = this.data.selectedSlots
    const weekDates = this.data.weekDates
    const previewList = []
    
    // 遍历表格数据，找到被选中的时间段
    this.data.tableData.forEach((timeSlotData, rowIndex) => {
      timeSlotData.dailySlots.forEach((slotData, colIndex) => {
        if (selectedSlots.includes(slotData.dutySlotId) && slotData.isSelected) {
          const weekDate = weekDates[colIndex]
          previewList.push({
            dutySlotId: slotData.dutySlotId,
            dayName: weekDate.dayName,
            dateDisplay: weekDate.dateDisplay,
            timeSlot: timeSlotData.timeSlotInfo.name,
            startTime: timeSlotData.timeSlotInfo.startTime,
            endTime: timeSlotData.timeSlotInfo.endTime,
            assignedName: slotData.dutyHolderName || slotData.statusText || '预选状态',
            wasConfirmed: !!(slotData.dutyHolderName && slotData.dutyHolderName !== '')
          })
        }
      })
    })
    
    return previewList
  },

  // 取消删除确认
  cancelDeleteConfirm: function () {
    
    this.setData({ showDeleteConfirmModal: false, deletePreviewList: [] });
  },

  // 确认删除值班分配
  confirmDeleteAssignment: async function () {
    if (this.data.selectedSlots.length === 0) {
      wx.showToast({
        title: '没有选择要删除的值班',
        icon: 'none'
      });
      return;
    }

    // 1秒防抖：若正在禁用则直接返回
    if (this.data.confirmDeleteDisabled) {
      return;
    }
    this.setData({ confirmDeleteDisabled: true });
    setTimeout(() => {
      // 安全恢复按钮（即使弹窗已关闭也无副作用）
      this.setData({ confirmDeleteDisabled: false });
    }, 1000);

    this.setData({ 
      showDeleteConfirmModal: false,
      isLoading: true,
      setupProgress: `正在删除 ${this.data.selectedSlots.length} 个值班分配...`
    });

    const requestId = api.generateRequestId();
    
    try {
      const res = await api.call('dutySchedule', {
        action: 'removeDutyAssignment',
        params: { selectedSlots: this.data.selectedSlots, requestId },
        config: { timeout: 15000 }
      });

      this.setData({
        isLoading: false,
        setupProgress: null
      });
      
      if (res.success) {
        const result = res.data;
        wx.showModal({
          title: '删除成功',
          content: `成功删除 ${result.totalDeleted} 个值班分配\n（包括 ${result.confirmedDeleted} 个已确认、${result.preSelectedDeleted} 个预选）`,
          showCancel: false,
          success: () => {
            this.setData({
              isDeleteMode: false,
              selectedSlots: [],
              deletePreviewList: []
            });
            this.loadCurrentConfig();
            this.loadDutyTableData();
          }
        });
      } else {
        wx.showModal({
          title: '删除失败',
          content: res.message || '删除值班分配失败',
          showCancel: false
        });
      }
    } catch (err) {
      console.error('[值班管理] 删除值班分配失败：', err);
      this.setData({
        isLoading: false,
        setupProgress: null
      });
      wx.showModal({
        title: '删除失败',
        content: err.message || '删除过程中发生错误',
        showCancel: false
      });
    }
  }
}) 