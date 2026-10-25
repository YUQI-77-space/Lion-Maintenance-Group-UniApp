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
    iconEmpty: iconManager.get('common_empty'),
    iconCheck: iconManager.get('common_check'),
    iconDelete: iconManager.get('common_delete'),
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
    // 切周日程固定为每周一 10:30（东八区），由云端定时触发器 autoWeekSwitcherTimer 决定，
    // 这里只展示、不可改；改动需同时调整云开发控制台的 cron 与云函数里的常量
    showAutoSwitchModal: false,
    autoSwitchEnabledTemp: true,
    autoSwitchScheduleText: '每周一 10:30',

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
    // 离开本周值班页时结束删除模式，避免选择状态被带到后台
    this.exitDeleteModeIfLeaving(index)
    this.setData({
      currentTab: index,
      swiperCurrent: index
    })
  },

  // swiper 滑动切换
  onSwiperChange: function (e) {
    const index = e.detail.current || 0
    this.exitDeleteModeIfLeaving(index)
    this.setData({
      currentTab: index,
      swiperCurrent: index
    })
  },

  // 切换到本周值班以外的页面时自动退出删除模式
  exitDeleteModeIfLeaving: function (index) {
    if (index !== 0 && this.data.isDeleteMode) {
      this.cancelDeleteMode()
    }
  },

  // 切换危险设置区域展开/收起
  toggleDangerZone: function () {
    this.setData({
      showDangerZone: !this.data.showDangerZone
    })
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

    this.setData({
      showAutoSwitchModal: true,
      autoSwitchEnabledTemp: enabled
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

  // 保存自动切周配置
  saveAutoSwitchSettings: async function () {
    const enabled = this.data.autoSwitchEnabledTemp

    this.setData({ 
      isLoading: true,
      setupProgress: '正在保存自动切周设置...'
    })

    try {
      // 逐项更新配置，后端会返回最新 config
      await api.call('dutySchedule', {
        action: 'updateDutyConfig', config: { retries: 0 },
        params: { configType: 'autoSwitchEnabled', value: enabled }
      })
      // 切周日程固定为周一(1) 10:30，这里把库里可能残留的旧值校准回来，避免与实际触发时间不一致
      await api.call('dutySchedule', {
        action: 'updateDutyConfig', config: { retries: 0 },
        params: { configType: 'autoSwitchDayOfWeek', value: 1 }
      })
      await api.call('dutySchedule', {
        action: 'updateDutyConfig', config: { retries: 0 },
        params: { configType: 'autoSwitchTime', value: '10:30' }
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
          action: 'updateDutyConfig', config: { retries: 0 },
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
      confirmColor: '#0369D7',
      success: (res) => {
        if (res.confirm) {
          this.performSemesterSetup(selectedDate)
        }
      }
    })
  },

  // 执行学期设置
  async performSemesterSetup(selectedDate) {
    if (this._dutyWriting) return;
    this._dutyWriting = true;
    try { return await this._performPerformSemesterSetup(selectedDate); }
    finally { this._dutyWriting = false; }
  },
  async _performPerformSemesterSetup(selectedDate) {
    this.setData({ 
      isLoading: true,
      setupProgress: '正在设置学期初始日期...'
    });

    try {
      this.setData({ setupProgress: '正在清除现有数据...' });
      await api.call('dutySchedule', {
        action: 'clearAllDutySlots',
        params: { forceDelete: true, batchSize: 50, maxRetries: 3 },
        timeout: 30000, config: { retries: 0 }
      });

      this.setData({ setupProgress: '正在设置学期开始日期...' });
      await api.call('dutySchedule', {
        action: 'updateDutyConfig',
        params: { configType: 'startDate', value: selectedDate },
        timeout: 10000, config: { retries: 0 }
      });

      this.setData({ setupProgress: '正在生成第一周值班表...' });
      await api.call('dutySchedule', {
        action: 'regenerateDutySlots',
        params: { weekNumber: 1, year: new Date().getFullYear() },
        timeout: 15000, config: { retries: 0 }
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
      content: `当前第${this.data.configData.currentWeek}周，切换至第${weekNumber}周。切换后请重新核对日期与已有排班，是否继续？`,
      confirmText: '确定',
      confirmColor: '#0369D7',
      success: (res) => {
        if (res.confirm) {
          this.setData({ showWeekSwitcherModal: false })
          this.performWeekSwitch(weekNumber)
        }
      }
    })
  },

  // 执行周次切换
  async performWeekSwitch(weekNumber) {
    if (this._dutyWriting) return;
    this._dutyWriting = true;
    try { return await this._performPerformWeekSwitch(weekNumber); }
    finally { this._dutyWriting = false; }
  },
  async _performPerformWeekSwitch(weekNumber) {
    this.setData({ 
      isLoading: true,
      setupProgress: `正在切换到第${weekNumber}周...`
    });
    
    try {
      const res = await api.call('dutySchedule', {
        action: 'switchToWeek', config: { retries: 0 },
        params: { weekNumber: weekNumber },
        timeout: 30000
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

  // 先取得云端日期与配置快照，再由组长确认，不使用手机时间推算。
  calibrateCurrentWeek: async function () {
    if (this.data.isLoading) return
    this.setData({ isLoading: true, setupProgress: '正在核对云端北京时间...' })
    try {
      const preview = await api.call('dutySchedule', { action: 'calibrateCurrentWeek' })
      if (!preview.success || !preview.data) throw new Error(preview.message || '无法取得校准预览')
      const target = preview.data
      const confirmation = await new Promise(resolve => wx.showModal({
        title: '校准到实际本周',
        content: `云端北京时间日期：${target.today}\n当前配置：第${target.expected.currentWeek}周\n校准目标：第${target.weekNumber}周（${target.startDate} 至 ${target.endDate}）\n保留各周已有排班、待办与工作量，只切换当前周并补齐缺失时段。开学日如有错误，请取消并先核查。`,
        confirmText: '确认校准',
        success: resolve,
        fail: () => resolve({ confirm: false })
      }))
      if (!confirmation.confirm) return
      this.setData({ setupProgress: '正在安全校准当前周...' })
      const res = await api.call('dutySchedule', {
        action: 'calibrateCurrentWeek',
        params: { preview: false, expected: target.expected, targetWeek: target.weekNumber },
        timeout: 30000,
        config: { retries: 0 }
      })
      if (!res.success || !res.data) throw new Error(res.message || '校准失败，请刷新后核对')
      await this.loadCurrentConfig()
      await this.loadDutyTableData()
      wx.showToast({ title: '当前周已校准', icon: 'success' })
    } catch (err) {
      wx.showModal({ title: '校准未完成', content: err.message || '请刷新后核对当前周', showCancel: false })
    } finally {
      this.setData({ isLoading: false, setupProgress: null })
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
  async performReset() {
    if (this._dutyWriting) return;
    this._dutyWriting = true;
    try { return await this._performPerformReset(); }
    finally { this._dutyWriting = false; }
  },
  async _performPerformReset() {
    const currentWeek = this.data.configData?.currentWeek;
    
    this.setData({ 
      isLoading: true,
      setupProgress: `正在重置第${currentWeek}周数据...`
    });
    
    try {
      const res = await api.call('dutySchedule', {
        action: 'resetCurrentWeekData',
        params: {},
        timeout: 10000, config: { retries: 0 }
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
  async performEditPermissionToggle() {
    if (this._dutyWriting) return;
    this._dutyWriting = true;
    try { return await this._performPerformEditPermissionToggle(); }
    finally { this._dutyWriting = false; }
  },
  async _performPerformEditPermissionToggle() {
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
        timeout: 8000, config: { retries: 0 }
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
          
          // 提取关键字段
          const dutySlotId = originalSlot?.dutySlotId || originalSlot?._id
          const dutyHolderId = originalSlot?.dutyHolderId
          const dutyHolderName = originalSlot?.dutyHolderName
          
          // 判断是否可删除：已分配、且能拿到 dutySlotId（没有 ID 无法提交删除）
          // 检查多个可能的字段，确保能识别已分配的值班
          const hasAssignedUser = !!(dutyHolderId || originalSlot?.assignedUser)
          const hasAssignedName = !!(dutyHolderName && dutyHolderName !== '' && dutyHolderName !== '可选')
          const isAssigned = slotData.statusClass === 'assigned'

          const canDelete = !!dutySlotId && (hasAssignedUser || hasAssignedName || isAssigned)
          
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

  // 底部删除入口：进入删除模式
  onDeleteEntryTap: function () {
    if (this.data.isLoading) {
      return
    }
    this.enterDeleteMode()
  },

  // 进入删除模式
  enterDeleteMode: function () {
    this.setData({
      isDeleteMode: true,
      selectedSlots: [],
      tableData: this.resetSelectionState()
    })
  },

  // 取消删除模式
  cancelDeleteMode: function () {
    if (this.data.isLoading) {
      return
    }
    this.setData({
      isDeleteMode: false,
      selectedSlots: [],
      tableData: this.resetSelectionState()
    })
  },

  // 重置所有格子的选中状态，返回新的表格数据
  resetSelectionState: function () {
    return this.data.tableData.map(timeSlotData => {
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
  },

  // 全选可删除的值班时段
  selectAllSlots: function () {
    const selectedSlots = []

    const tableData = this.data.tableData.map(timeSlotData => {
      return {
        ...timeSlotData,
        dailySlots: timeSlotData.dailySlots.map(slotData => {
          if (!slotData.canDelete || !slotData.dutySlotId) {
            return { ...slotData, isSelected: false }
          }
          if (!selectedSlots.includes(slotData.dutySlotId)) {
            selectedSlots.push(slotData.dutySlotId)
          }
          return { ...slotData, isSelected: true }
        })
      }
    })

    if (selectedSlots.length === 0) {
      wx.showToast({
        title: '没有可删除的值班时段',
        icon: 'none'
      })
      return
    }

    this.setData({ tableData, selectedSlots })
  },

  // 清空已选时段
  clearSelectedSlots: function () {
    if (this.data.selectedSlots.length === 0) {
      return
    }
    this.setData({
      tableData: this.resetSelectionState(),
      selectedSlots: []
    })
  },

  // 点到不可删除的时段时的轻反馈：优先震动，避免弹窗打断
  notifyUnselectable: function () {
    try {
      if (wx.vibrateShort) {
        wx.vibrateShort({ type: 'light' })
      }
    } catch (err) {
      // 开发者工具等不支持震动的环境下静默忽略
    }
  },

  // 切换时间段选择状态
  toggleSlotSelection: function (e) {
    const { slotId, canDelete } = e.currentTarget.dataset
    
    // 检查是否在删除模式
    if (!this.data.isDeleteMode) {
      return
    }
    
    // 不可删除或数据异常的时段：静默忽略（仅震动反馈），不弹窗打断
    const cannotDelete = !canDelete || canDelete === 'false' || canDelete === false
    if (!slotId || slotId === '' || cannotDelete) {
      if (!slotId || slotId === '') {
        console.warn('[值班管理] 未找到时间段ID，dataset：', e.currentTarget.dataset)
      }
      this.notifyUnselectable()
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
    if (this.data.isLoading) {
      return
    }

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
    if (this._dutyWriting) return;
    
    this.setData({ showDeleteConfirmModal: false, deletePreviewList: [] });
  },

  // 确认删除值班分配
  async confirmDeleteAssignment() {
    if (this._dutyWriting) return;
    this._dutyWriting = true;
    try { return await this._performConfirmDeleteAssignment(); }
    finally { this._dutyWriting = false; }
  },
  async _performConfirmDeleteAssignment() {
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
        timeout: 15000, config: { retries: 0 }
      });

      this.setData({
        isLoading: false,
        setupProgress: null
      });
      
      if (res.success) {
        const result = res.data || {};
        const totalDeleted = result.totalDeleted || 0;
        const breakdown = `已确认 ${result.confirmedDeleted || 0} · 预选 ${result.preSelectedDeleted || 0}`;
        
        this.setData({
          isDeleteMode: false,
          selectedSlots: [],
          deletePreviewList: []
        });
        
        // 用 toast 替代弹窗：少一次点击，表格立即刷新
        wx.showToast({
          title: `已删除 ${totalDeleted} 个值班分配\n${breakdown}`,
          icon: 'none',
          duration: 2500
        });
        
        this.loadCurrentConfig();
        this.loadDutyTableData();
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