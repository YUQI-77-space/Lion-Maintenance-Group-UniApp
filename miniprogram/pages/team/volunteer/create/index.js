// pages/team/volunteer/create/index.js
const app = getApp()
const api = require('../../../../utils/apiAdapter')
const time = require('../../../../utils/time')

Page({
  /**
   * 页面的初始数据
   */
  data: {
    isEdit: false, // 是否为编辑模式
    activityId: '',
    lockTimeFields: false, // 进行中/已结束活动锁定时间
    currentNumberOfVolunteers: 0, // 当前已报名人数（用于验证）
    formData: {
      title: '',
      startTime: '',
      endTime: '',
      location: '',
      duration: '',
      volunteerHours: '',
      volunteerCount: '',
      // ew 字段废除：按人设置于活动结束后
      description: '',
      scheduledPublish: false, // 是否定时发布
      publishTime: '' // 发布时间
    },
    descriptionLength: 0,
    timeArray: [[], [], [], [], []],  // 年、月、日、时、分
    startTimeIndex: [0, 0, 0, 0, 0],
    endTimeIndex: [0, 0, 0, 0, 0],
    publishTimeIndex: [0, 0, 0, 0, 0], // 发布时间选择器索引
    // 🔥 新增：志愿者数量选择器数据
    volunteerCountArray: [],
    volunteerCountIndex: 0,
    loading: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 检查用户角色，只有组长可以创建/编辑活动
    this.checkUserRole();

    // 初始化时间选择器数据
    this.initTimePickerArray();

    if (options.lockTime === '1' || options.lockTime === 'true') {
      this.setData({ lockTimeFields: true });
    }

    if (options.id) {
      this.setData({
        isEdit: true,
        activityId: options.id
      });
      wx.setNavigationBarTitle({
        title: '编辑志愿活动'
      });
      
      this.getActivityDetail(options.id);
    } else {
      wx.setNavigationBarTitle({
        title: '创建志愿活动'
      });
      
    }
    
    // 监听描述文本变化
    this.watchDescription()
    
  },

  /**
   * 检查用户角色
   */
  checkUserRole() {
    const app = getApp()
    const role = app.globalData.role || wx.getStorageSync('role') || 'user'
    
    
    if (role !== 'leader') {
      
      wx.showToast({
        title: '只有组长可以创建活动',
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    } else {
      
    }
  },

  /**
   * 初始化时间选择器数据
   */
  initTimePickerArray() {
    const date = new Date()
    const years = []
    const months = []
    const days = []
    const hours = []
    const minutes = []
    
    // 生成年份数据，当前年份和未来2年
    for (let i = 0; i < 3; i++) {
      years.push(date.getFullYear() + i + '年')
    }
    
    // 生成月份数据，1-12月
    // 注意：这里i的值是1-12，与JavaScript的Date对象月份(0-11)不同
    // 但在timeArray中，索引0对应1月，索引1对应2月，依此类推
    for (let i = 1; i <= 12; i++) {
      months.push(i + '月')
    }
    
    // 生成日期数据，先默认31天，后面会根据年月动态调整
    for (let i = 1; i <= 31; i++) {
      days.push(i + '日')
    }
    
    // 生成小时数据
    for (let i = 0; i < 24; i++) {
      hours.push(i.toString().padStart(2, '0') + '时')
    }
    
    // 生成分钟数据，每10分钟一个选项
    for (let i = 0; i < 60; i += 10) {
      minutes.push(i.toString().padStart(2, '0') + '分')
    }

    // 🔥 新增：初始化志愿者数量选择器数据（1-50人）
    const volunteerCountArray = []
    for (let i = 1; i <= 50; i++) {
      volunteerCountArray.push(i + '人')
    }
    
    // 默认选择5人，索引应该是4（因为数组是["1人", "2人", "3人", "4人", "5人", ...]）
    const defaultVolunteerCount = 5
    const defaultVolunteerCountIndex = defaultVolunteerCount - 1 // 5人对应索引4
    
    this.setData({
      timeArray: [years, months, days, hours, minutes],
      volunteerCountArray: volunteerCountArray,
      volunteerCountIndex: defaultVolunteerCountIndex, // 默认选择5人，索引为4
      startTimeIndex: [0, date.getMonth(), date.getDate() - 1, date.getHours(), Math.floor(date.getMinutes() / 10)],
      endTimeIndex: [0, date.getMonth(), date.getDate() - 1, date.getHours() + 1, Math.floor(date.getMinutes() / 10)],
      'formData.volunteerCount': defaultVolunteerCount.toString() // 设置默认值为5
    })
    
    // 根据当前选择的年月更新日期选项
    this.updateDays(0, date.getMonth())
    
    // 设置默认的开始和结束时间
    this.updateStartTime()
    this.updateEndTime()
  },

  /**
   * 根据年月更新日期选项
   */
  updateDays(year, month) {
    const date = new Date()
    const currentYear = date.getFullYear() + year
    const days = []
    
    // 🔥 修复：month参数是选择器的索引值(0-11)，直接传给Date构造函数
    // 使用month+1来获取下个月的0号，即当月的最后一天
    const daysInMonth = new Date(currentYear, month + 1, 0).getDate()
    
    
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i + '日')
    }
    
    // 更新日期选项
    const timeArray = this.data.timeArray
    timeArray[2] = days
    
    this.setData({
      timeArray: timeArray
    })
  },

  /**
   * 时间选择器列变化事件
   */
  bindTimeColumnChange(e) {
    if (this.data.lockTimeFields && (!e || !e.currentTarget || e.currentTarget.dataset.type !== 'publish')) {
      return;
    }
    const column = e.detail.column
    const value = e.detail.value
    
    // 如果是年或月变化，需要更新日期选项
    if (column === 0 || column === 1) {
      this.updateDays(column === 0 ? value : this.data.startTimeIndex[0], 
                      column === 1 ? value : this.data.startTimeIndex[1])
    }
    
    // 🔥 如果是发布时间选择器的列变化，需要动态过滤过去时间
    const pickerId = e.currentTarget.id || ''
    if (pickerId.includes('publish') || (this.data.formData.scheduledPublish && e.currentTarget.dataset.type === 'publish')) {
      this.updatePublishTimePickerOptions(column, value)
    }
  },

  /**
   * 开始时间变化事件
   */
  bindStartTimeChange(e) {
    if (this.data.lockTimeFields) {
      wx.showToast({
        title: '该活动已开始或结束，时间不可修改',
        icon: 'none'
      })
      return
    }
    
    this.setData({
      startTimeIndex: e.detail.value
    })
    this.updateStartTime()
    
    // 如果开始时间晚于结束时间，自动调整结束时间
    // iOS 兼容：使用 time.toDate
    const formStartTime = time.toDate(this.data.formData.startTime);
    const formEndTime = time.toDate(this.data.formData.endTime);
    const startTimeMs = formStartTime ? formStartTime.getTime() : 0;
    const endTimeMs = formEndTime ? formEndTime.getTime() : 0;
    
    if (startTimeMs >= endTimeMs) {
      // 结束时间设为开始时间后1小时
      const newEndTime = new Date(startTimeMs + 60 * 60 * 1000)
      const endTimeIndex = [
        this.data.startTimeIndex[0],
        this.data.startTimeIndex[1],
        this.data.startTimeIndex[2],
        Math.min(23, this.data.startTimeIndex[3] + 1),
        this.data.startTimeIndex[4]
      ]
      
      
      this.setData({
        endTimeIndex: endTimeIndex
      })
      this.updateEndTime()
    }
  },

  /**
   * 结束时间变化事件
   */
  bindEndTimeChange(e) {
    if (this.data.lockTimeFields) {
      wx.showToast({
        title: '该活动已开始或结束，时间不可修改',
        icon: 'none'
      })
      return
    }
    
    this.setData({
      endTimeIndex: e.detail.value
    })
    this.updateEndTime()
    
    // 如果结束时间早于开始时间，显示错误提示
    // iOS 兼容：使用 time.toDate
    const formStartTime2 = time.toDate(this.data.formData.startTime);
    const formEndTime2 = time.toDate(this.data.formData.endTime);
    const startTimeMs2 = formStartTime2 ? formStartTime2.getTime() : 0;
    const endTimeMs2 = formEndTime2 ? formEndTime2.getTime() : 0;
    
    if (endTimeMs2 <= startTimeMs2) {
      wx.showToast({
        title: '结束时间必须晚于开始时间',
        icon: 'none'
      })
    }
  },

  /**
   * 🔥 新增：志愿者数量选择器变化事件
   */
  bindVolunteerCountChange(e) {
    if (this.data.lockTimeFields) {
      wx.showToast({
        title: '该活动已开始或结束，志愿者数量不可修改',
        icon: 'none'
      })
      return
    }
    
    const index = parseInt(e.detail.value)
    const count = index + 1 // 因为数组从1开始，索引需要+1
    
    // 🔥 验证：编辑模式下，新设置的人数不能小于当前已报名人数
    if (this.data.isEdit && this.data.currentNumberOfVolunteers > 0) {
      if (count < this.data.currentNumberOfVolunteers) {
        wx.showModal({
          title: '无法调整人数',
          content: `当前已有 ${this.data.currentNumberOfVolunteers} 人报名，志愿者人数不能设置为少于已报名人数。`,
          showCancel: false,
          confirmText: '我知道了',
          confirmColor: '#191970'
        })
        // 回退到之前的值
        const previousCount = parseInt(this.data.formData.volunteerCount) || 5
        const previousIndex = Math.max(0, Math.min(49, previousCount - 1))
        this.setData({
          volunteerCountIndex: previousIndex,
          'formData.volunteerCount': previousCount.toString()
        })
        return
      }
    }
    
    this.setData({
      volunteerCountIndex: index,
      'formData.volunteerCount': count.toString()
    })
  },

  /**
   * 定时发布开关变化事件
   */
  bindScheduledPublishChange(e) {
    const checked = e.detail.value
    this.setData({
      'formData.scheduledPublish': checked
    })
    
    // 如果开启定时发布，设置默认发布时间为当前时间后1小时
    if (checked && !this.data.formData.publishTime) {
      const date = new Date()
      date.setHours(date.getHours() + 1)
      const defaultPublishTime = this.formatDate(date)
      this.setData({
        'formData.publishTime': defaultPublishTime
      })
      // 设置发布时间选择器索引
      this.setPublishTimePickerIndex(defaultPublishTime)
    } else if (!checked) {
      // 关闭定时发布时清空发布时间
      this.setData({
        'formData.publishTime': '',
        publishTimeIndex: [0, 0, 0, 0, 0]
      })
    }
  },

  /**
   * 发布时间变化事件
   */
  bindPublishTimeChange(e) {
    this.setData({
      publishTimeIndex: e.detail.value
    })
    this.updatePublishTime()
    
    // 验证选择的时间不能是过去时间
    const index = e.detail.value
    const timeArray = this.data.timeArray
    
    const year = parseInt(timeArray[0][index[0]]) || new Date().getFullYear()
    const month = parseInt(timeArray[1][index[1]]) || 1
    const day = parseInt(timeArray[2][index[2]]) || 1
    const hour = parseInt(timeArray[3][index[3]]) || 0
    const minute = parseInt(timeArray[4][index[4]]) || 0
    
    const selectedTime = new Date(year, month - 1, day, hour, minute)
    const now = new Date()
    
    if (selectedTime.getTime() <= now.getTime()) {
      // 如果选择的是过去时间，自动调整为当前时间后1小时
      const futureTime = new Date(now.getTime() + 60 * 60 * 1000)
      this.setPublishTimePickerIndex(this.formatDate(futureTime))
      wx.showToast({
        title: '发布时间不能早于当前时间',
        icon: 'none'
      })
    }
  },

  /**
   * 更新发布时间选择器选项（动态过滤过去时间）
   */
  updatePublishTimePickerOptions(changedColumn, changedValue) {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const currentDay = now.getDate()
    const currentHour = now.getHours()
    const currentMinute = Math.floor(now.getMinutes() / 10) * 10
    
    const timeArray = [...this.data.timeArray]
    const index = [...this.data.publishTimeIndex]
    
    // 更新变化列的索引
    index[changedColumn] = changedValue
    
    // 获取当前选择的年月日时分
    const selectedYear = parseInt(timeArray[0][index[0]]) || currentYear
    const selectedMonth = parseInt(timeArray[1][index[1]]) || currentMonth
    const selectedDay = parseInt(timeArray[2][index[2]]) || currentDay
    const selectedHour = parseInt(timeArray[3][index[3]]) || currentHour
    const selectedMinute = parseInt(timeArray[4][index[4]]) || 0
    
    // 根据选择的年月日，动态过滤小时和分钟
    if (selectedYear === currentYear && selectedMonth === currentMonth && selectedDay === currentDay) {
      // 如果是今天，过滤掉过去的小时和分钟
      const filteredHours = []
      const filteredMinutes = []
      
      for (let i = currentHour; i < 24; i++) {
        filteredHours.push(i.toString().padStart(2, '0') + '时')
      }
      
      // 如果选择的是当前小时，过滤分钟
      if (selectedHour === currentHour) {
        for (let i = 0; i < 60; i += 10) {
          if (i >= currentMinute) {
            filteredMinutes.push(i.toString().padStart(2, '0') + '分')
          }
        }
      } else {
        // 如果不是当前小时，所有分钟都可用
        for (let i = 0; i < 60; i += 10) {
          filteredMinutes.push(i.toString().padStart(2, '0') + '分')
        }
      }
      
      // 如果过滤后没有选项，使用默认值
      if (filteredHours.length === 0) {
        filteredHours.push((currentHour + 1).toString().padStart(2, '0') + '时')
        index[3] = 0
      }
      if (filteredMinutes.length === 0) {
        filteredMinutes.push('00分')
        index[4] = 0
      }
      
      timeArray[3] = filteredHours
      timeArray[4] = filteredMinutes
      
      // 确保索引不越界
      if (index[3] >= filteredHours.length) {
        index[3] = 0
      }
      if (index[4] >= filteredMinutes.length) {
        index[4] = 0
      }
    } else {
      // 如果不是今天，所有小时和分钟都可用
      const hours = []
      const minutes = []
      for (let i = 0; i < 24; i++) {
        hours.push(i.toString().padStart(2, '0') + '时')
      }
      for (let i = 0; i < 60; i += 10) {
        minutes.push(i.toString().padStart(2, '0') + '分')
      }
      timeArray[3] = hours
      timeArray[4] = minutes
    }
    
    this.setData({
      timeArray: timeArray,
      publishTimeIndex: index
    })
  },

  /**
   * 更新发布时间
   */
  updatePublishTime() {
    const index = this.data.publishTimeIndex
    const timeArray = this.data.timeArray
    
    const year = parseInt(timeArray[0][index[0]]) || new Date().getFullYear()
    const month = parseInt(timeArray[1][index[1]]) || 1
    const day = parseInt(timeArray[2][index[2]]) || 1
    const hour = parseInt(timeArray[3][index[3]]) || 0
    const minute = parseInt(timeArray[4][index[4]]) || 0
    
    const publishTime = new Date(year, month - 1, day, hour, minute)
    const now = new Date()
    
    // 🔥 关键修复：如果选择的时间是过去时间，自动调整为当前时间后1小时
    if (publishTime.getTime() <= now.getTime()) {
      const futureTime = new Date(now.getTime() + 60 * 60 * 1000) // 当前时间后1小时
      const futureYear = futureTime.getFullYear()
      const futureMonth = futureTime.getMonth() + 1
      const futureDay = futureTime.getDate()
      const futureHour = futureTime.getHours()
      const futureMinute = Math.floor(futureTime.getMinutes() / 10) * 10
      
      // 更新选择器索引
      const currentYear = new Date().getFullYear()
      const yearIndex = Math.max(0, futureYear - currentYear)
      
      this.setData({
        publishTimeIndex: [yearIndex, futureMonth - 1, futureDay - 1, futureHour, Math.floor(futureMinute / 10)],
        'formData.publishTime': this.formatDate(new Date(futureYear, futureMonth - 1, futureDay, futureHour, futureMinute))
      })
      
      wx.showToast({
        title: '发布时间不能早于当前时间，已自动调整',
        icon: 'none',
        duration: 2000
      })
      return
    }
    
    const formattedPublishTime = this.formatDate(publishTime)
    
    this.setData({
      'formData.publishTime': formattedPublishTime
    })
  },

  /**
   * 设置发布时间选择器索引（编辑模式）
   */
  setPublishTimePickerIndex(publishTimeStr) {
    if (!publishTimeStr) return
    
    // iOS 兼容：使用 time.toDate
    const publishTime = time.toDate(publishTimeStr);
    if (!publishTime) return;
    
    const year = publishTime.getFullYear()
    const month = publishTime.getMonth() + 1
    const day = publishTime.getDate()
    const hour = publishTime.getHours()
    const minute = Math.floor(publishTime.getMinutes() / 10)
    
    const currentYear = new Date().getFullYear()
    const yearIndex = Math.max(0, year - currentYear)
    
    this.setData({
      publishTimeIndex: [yearIndex, month - 1, day - 1, hour, minute]
    })
    
    this.updateDays(yearIndex, month - 1)
  },

  /**
   * 更新开始时间
   */
  updateStartTime() {
    const index = this.data.startTimeIndex
    const timeArray = this.data.timeArray
    
    const year = parseInt(timeArray[0][index[0]]) || new Date().getFullYear()
    const month = parseInt(timeArray[1][index[1]]) || 1
    const day = parseInt(timeArray[2][index[2]]) || 1
    const hour = parseInt(timeArray[3][index[3]]) || 0
    const minute = parseInt(timeArray[4][index[4]]) || 0
    
    // 🔥 修复：月份数组确实是从1开始的("1月", "2月", ...)，所以需要减1来适应Date对象
    const startTime = new Date(year, month - 1, day, hour, minute)
    const formattedStartTime = this.formatDate(startTime)
    
    this.setData({
      'formData.startTime': formattedStartTime
    })
    
    // 自动计算活动时长
    this.calculateDuration()
  },

  /**
   * 更新结束时间
   */
  updateEndTime() {
    const index = this.data.endTimeIndex
    const timeArray = this.data.timeArray
    
    const year = parseInt(timeArray[0][index[0]]) || new Date().getFullYear()
    const month = parseInt(timeArray[1][index[1]]) || 1
    const day = parseInt(timeArray[2][index[2]]) || 1
    const hour = parseInt(timeArray[3][index[3]]) || 0
    const minute = parseInt(timeArray[4][index[4]]) || 0
    
    // 🔥 修复：月份数组确实是从1开始的("1月", "2月", ...)，所以需要减1来适应Date对象
    const endTime = new Date(year, month - 1, day, hour, minute)
    const formattedEndTime = this.formatDate(endTime)
    
    this.setData({
      'formData.endTime': formattedEndTime
    })
    
    // 自动计算活动时长
    this.calculateDuration()
  },

  /**
   * 计算活动时长
   */
  calculateDuration() {
    if (this.data.formData.startTime && this.data.formData.endTime) {
      // iOS 兼容：使用 time.toDate
      const formStartTime = time.toDate(this.data.formData.startTime);
      const formEndTime = time.toDate(this.data.formData.endTime);
      if (!formStartTime || !formEndTime) return;
      
      const startTimeMs = formStartTime.getTime();
      const endTimeMs = formEndTime.getTime();
      
      if (endTimeMs > startTimeMs) {
        // 计算时长（小时）
        const duration = ((endTimeMs - startTimeMs) / (1000 * 60 * 60)).toFixed(1)
        
        
        // 🔥 修改：如果志愿时长为空，则自动设置为活动时长
        const volunteerHours = this.data.formData.volunteerHours || duration;
        
        this.setData({
          'formData.duration': duration,
          'formData.volunteerHours': volunteerHours
        })
      }
    }
  },

  /**
   * 监听描述文本变化
   */
  watchDescription() {
    // 创建一个观察者对象（保存引用，便于卸载时断开）
    this.descriptionObserver = this.createIntersectionObserver()
    
    // 监听描述文本框
    this.descriptionObserver.relativeTo().observe('.form-textarea', (res) => {
      // 获取当前描述文本长度
      const descriptionLength = this.data.formData.description.length
      
      // 更新描述文本长度
      this.setData({
        descriptionLength: descriptionLength
      })
    })
  },

  /**
   * 设置时间选择器索引（编辑模式）
   */
  setTimePickerIndex(startTimeStr, endTimeStr) {
    if (!startTimeStr || !endTimeStr) return
    
    // iOS 兼容：使用 time.toDate
    const startTime = time.toDate(startTimeStr);
    const endTime = time.toDate(endTimeStr);
    if (!startTime || !endTime) return;
    
    // 设置开始时间索引
    const startYear = startTime.getFullYear()
    const startMonth = startTime.getMonth() + 1  // 转换为1-12的月份表示
    const startDay = startTime.getDate()
    const startHour = startTime.getHours()
    const startMinute = Math.floor(startTime.getMinutes() / 10)
    
    // 设置结束时间索引
    const endYear = endTime.getFullYear()
    const endMonth = endTime.getMonth() + 1  // 转换为1-12的月份表示
    const endDay = endTime.getDate()
    const endHour = endTime.getHours()
    const endMinute = Math.floor(endTime.getMinutes() / 10)
    
    // 计算年份索引
    const currentYear = new Date().getFullYear()
    const startYearIndex = Math.max(0, startYear - currentYear)
    const endYearIndex = Math.max(0, endYear - currentYear)
    
    this.setData({
      startTimeIndex: [startYearIndex, startMonth - 1, startDay - 1, startHour, startMinute],
      endTimeIndex: [endYearIndex, endMonth - 1, endDay - 1, endHour, endMinute]
    })
    
    // 🔥 修复：updateDays函数接收的月份参数应该是索引值(0-11)
    this.updateDays(startYearIndex, startMonth - 1)
  },

  /**
   * 获取活动详情（编辑模式）
   */
  getActivityDetail: async function(activityId) {
    wx.showLoading({
      title: '加载中...',
    });
    try {
      const result = await api.call('volunteerActivities', { action: 'getVolunteerActivityDetail', params: { activityId } });
      if (result.success) {
        const activity = (result.data && result.data.activity) || {};
        const volunteerCount = parseInt(activity.volunteerCount) || 5;
        const volunteerCountIndex = Math.max(0, Math.min(49, volunteerCount - 1));
        
        const shouldLockTime = this.data.lockTimeFields || ['inProgress', 'ended'].includes(activity.activityStatus);
        const currentNumberOfVolunteers = activity.numberOfVolunteers || 0;

        this.setData({
          formData: {
            title: activity.title || '',
            startTime: activity.startTime || '',
            endTime: activity.endTime || '',
            location: activity.location || '',
            duration: activity.duration || '',
            volunteerHours: activity.volunteerHours || '',
            volunteerCount: volunteerCount.toString(),
            ew: activity.ew || '0',
            description: activity.description || '',
            scheduledPublish: activity.scheduledPublish || false,
            publishTime: activity.publishTime || ''
          },
          volunteerCountIndex: volunteerCountIndex,
          descriptionLength: (activity.description || '').length,
          lockTimeFields: shouldLockTime,
          currentNumberOfVolunteers: currentNumberOfVolunteers // 保存当前已报名人数
        });
        
        // 如果编辑模式且有发布时间，设置发布时间选择器索引
        if (activity.publishTime) {
          this.setPublishTimePickerIndex(activity.publishTime);
        }
        
        if (activity.startTime && activity.endTime) {
          this.setTimePickerIndex(activity.startTime, activity.endTime);
        }
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 表单提交
   */
  submitForm: async function(e) {
    const formData = e.detail.value;
    formData.volunteerCount = this.data.formData.volunteerCount;

    if (!this.validateForm(formData)) {
      return;
    }

    this.setData({ loading: true });

    const calculatedDuration = parseFloat(this.data.formData.duration);

    const params = {
      title: formData.title,
      description: formData.description,
      startTime: this.data.formData.startTime,
      endTime: this.data.formData.endTime,
      location: formData.location,
      duration: calculatedDuration,
      volunteerCount: parseInt(formData.volunteerCount),
      volunteerHours: parseFloat(formData.volunteerHours) || calculatedDuration,
      scheduledPublish: this.data.isEdit ? false : (this.data.formData.scheduledPublish || false), // 编辑模式下不允许修改定时发布
      publishTime: this.data.isEdit ? '' : (this.data.formData.publishTime || '') // 编辑模式下清空发布时间
    };
    
    // 🔥 编辑模式下，验证志愿者人数不能小于已报名人数
    if (this.data.isEdit && this.data.currentNumberOfVolunteers > 0) {
      if (params.volunteerCount < this.data.currentNumberOfVolunteers) {
        wx.showModal({
          title: '无法保存',
          content: `当前已有 ${this.data.currentNumberOfVolunteers} 人报名，志愿者人数不能设置为少于已报名人数。`,
          showCancel: false,
          confirmText: '我知道了',
          confirmColor: '#191970'
        })
        this.setData({ loading: false })
        return
      }
    }
    
    // 如果开启了定时发布，验证发布时间（仅在创建模式下）
    if (!this.data.isEdit && params.scheduledPublish) {
      if (!params.publishTime) {
        wx.showToast({
          title: '请选择发布时间',
          icon: 'none'
        });
        this.setData({ loading: false });
        return;
      }
      
      // 验证发布时间不能早于当前时间
      // iOS 兼容：使用 time.toDate
      const publishTimeParsed = time.toDate(params.publishTime);
      const publishTimeMs = publishTimeParsed ? publishTimeParsed.getTime() : 0;
      const now = new Date().getTime();
      if (publishTimeMs <= now) {
        wx.showToast({
          title: '发布时间必须晚于当前时间',
          icon: 'none'
        });
        this.setData({ loading: false });
        return;
      }
    }

    const action = this.data.isEdit ? 'updateVolunteerActivity' : 'createVolunteerActivity';
    if (this.data.isEdit) {
      params.activityId = this.data.activityId;
    }

    // 离线处理逻辑保持不变
    try {
      const network = require('../../../../utils/network');
      if (!network.isOnline()) {
        const outbox = require('../../../../utils/outbox');
        outbox.add('volunteerActivities', action, params);
        this.setData({ loading: false });
        wx.showToast({ title: '网络不稳，已加入队列', icon: 'none', duration: 2500 });
        return;
      }
    } catch (e) {}

    try {
      const res = await api.call('volunteerActivities', {
        action: action,
        params: params
      });

      if (res.success) {
        wx.showToast({
          title: this.data.isEdit ? '修改成功' : '创建成功',
          icon: 'success'
        });
        setTimeout(() => {
          // 向前一个页面派发更新事件（仅编辑时），让管理列表按路径更新
          if (this.data.isEdit) {
            const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel();
            if (eventChannel && eventChannel.emit) {
              eventChannel.emit('activityUpdated', {
                updates: {
                  title: params.title,
                  startTime: params.startTime,
                  endTime: params.endTime,
                  location: params.location,
                  duration: params.duration,
                  volunteerHours: params.volunteerHours,
                  volunteerCount: params.volunteerCount,
                  formattedStartTime: this.formatDate(time.toDate(params.startTime) || new Date())
                }
              });
            }
          }
          wx.navigateBack();
        }, 1500);
      } else {
        // 🔥 如果是志愿者人数验证失败，使用模态框显示详细错误
        const errorMessage = res.message || '操作失败';
        if (errorMessage.includes('志愿者人数不能设置为少于已报名人数')) {
          wx.showModal({
            title: '无法保存',
            content: errorMessage,
            showCancel: false,
            confirmText: '我知道了',
            confirmColor: '#191970'
          })
        } else {
          wx.showToast({
            title: errorMessage,
            icon: 'none',
            duration: 3000
          });
        }
      }
    } catch (err) {
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 表单验证
   */
  validateForm(formData) {
    // 检查必填字段
    if (!formData.title) {
      wx.showToast({
        title: '请输入活动标题',
        icon: 'none'
      })
      return false
    }
    
    if (!this.data.formData.startTime) {
      wx.showToast({
        title: '请选择开始时间',
        icon: 'none'
      })
      return false
    }
    
    if (!this.data.formData.endTime) {
      wx.showToast({
        title: '请选择结束时间',
        icon: 'none'
      })
      return false
    }
    
    if (!formData.location) {
      wx.showToast({
        title: '请输入活动地点',
        icon: 'none'
      })
      return false
    }
    
    // 🔥 移除活动时长的直接验证，因为现在是自动计算的
    // 但需要检查时间有效性来确保活动时长有效
    // iOS 兼容：使用 time.toDate
    const formStartTime3 = time.toDate(this.data.formData.startTime);
    const formEndTime3 = time.toDate(this.data.formData.endTime);
    const startTimeMs3 = formStartTime3 ? formStartTime3.getTime() : 0;
    const endTimeMs3 = formEndTime3 ? formEndTime3.getTime() : 0;
    
    if (endTimeMs3 <= startTimeMs3) {
      wx.showToast({
        title: '结束时间必须晚于开始时间',
        icon: 'none'
      })
      return false
    }
    
    const calculatedDuration = ((formEndTime3 && formStartTime3) ? (formEndTime3.getTime() - formStartTime3.getTime()) / (1000 * 60 * 60) : 0)
    if (calculatedDuration <= 0) {
      wx.showToast({
        title: '活动时长必须大于0小时',
        icon: 'none'
      })
      return false
    }
    
    // 🔥 优化志愿者数量验证
    if (!formData.volunteerCount || parseInt(formData.volunteerCount) <= 0) {
      wx.showToast({
        title: '请选择志愿者数量',
        icon: 'none'
      })
      return false
    }
    
    if (!formData.description) {
      wx.showToast({
        title: '请输入活动详细描述',
        icon: 'none'
      })
      return false
    }
    
    // 检查志愿时长
    if (formData.volunteerHours && (isNaN(parseFloat(formData.volunteerHours)) || parseFloat(formData.volunteerHours) < 0)) {
      wx.showToast({
        title: '志愿时长必须为非负数',
        icon: 'none'
      })
      return false
    }
    
    // 🔥 志愿者数量验证范围
    const volunteerCount = parseInt(formData.volunteerCount)
    if (isNaN(volunteerCount) || volunteerCount < 1 || volunteerCount > 50) {
      wx.showToast({
        title: '志愿者数量必须在1-50人之间',
        icon: 'none'
      })
      return false
    }
    

    
    return true
  },

  /**
   * 取消表单
   */
  cancelForm() {
    wx.navigateBack()
  },

  /**
   * 格式化日期
   */
  formatDate(date) {
    return time.formatToMinute(date)
  },

  /**
   * EW 输入限制（最大50）
   */


  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    // 清除描述文本监听器
    if (this.descriptionObserver && this.descriptionObserver.disconnect) {
      try { this.descriptionObserver.disconnect(); } catch (e) {}
      this.descriptionObserver = null
    }
  }
})