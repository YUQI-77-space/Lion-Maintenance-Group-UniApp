// 获取值班时间段数据
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { batchUpdateDutyStatus } = require('./dutyStatusManager')

/**
 * 获取指定周的值班时间段数据
 * @param {Object} event 事件参数
 * @param {Number} event.weekNumber 周次（可选，默认为当前周）
 * @param {Number} event.year 年份（可选，默认当前年份）
 * @param {String} openid 用户openid
 * @returns {Object} 返回值班时间段数据
 */
exports.getDutySlots = async (event, openid) => {
  try {
    console.log('[getDutySlots] 开始获取值班时间段数据')
    console.log('[getDutySlots] 参数：', { weekNumber: event.weekNumber, year: event.year })

    // 获取配置数据，获取当前周
    const configResult = await db.collection('duty_config').doc('global').get()
    if (!configResult.data) {
      return {
        code: 404,
        data: null,
        message: '值班配置不存在，请先初始化系统'
      }
    }

    const config = configResult.data
    
    // 确定查询的周数和年份
    const weekNumber = event.weekNumber || config.currentWeek || 1
    const year = event.year || config.currentYear || new Date().getFullYear()

    console.log('[getDutySlots] 查询参数：', { weekNumber, year })

    // 查询指定周的所有值班时间段，按sortOrder排序确保顺序
    const slotsResult = await db.collection('duty_slots')
      .where({
        weekNumber: weekNumber,
        year: year
      })
      .orderBy('sortOrder', 'asc') // 首先按sortOrder排序
      .orderBy('dayOfWeek', 'asc')  // 然后按dayOfWeek排序（兼容旧数据）
      .orderBy('startTime', 'asc')  // 最后按startTime排序（兼容旧数据）
      .get()

    console.log('[getDutySlots] 查询到的时间段数量：', slotsResult.data.length)

    // 在返回数据前，更新值班任务状态（只更新已分配的时间段）
    const assignedSlots = slotsResult.data.filter(slot => slot.dutyHolderId && slot.dutyHolderName)
    if (assignedSlots.length > 0) {
      console.log('[getDutySlots] 开始更新已分配时间段的状态，数量：', assignedSlots.length)
      try {
        await batchUpdateDutyStatus(assignedSlots)
        console.log('[getDutySlots] 状态更新完成')
        
        // 重新查询数据以获取最新状态
        const updatedSlotsResult = await db.collection('duty_slots')
          .where({
            weekNumber: weekNumber,
            year: year
          })
          .orderBy('sortOrder', 'asc')
          .orderBy('dayOfWeek', 'asc')
          .orderBy('startTime', 'asc')
          .get()
        
        slotsResult.data = updatedSlotsResult.data
        console.log('[getDutySlots] 已重新获取更新后的数据')
      } catch (statusUpdateErr) {
        console.error('[getDutySlots] 状态更新失败，继续返回原数据：', statusUpdateErr)
        // 状态更新失败不影响主流程，继续使用原数据
      }
    }

    // 验证数据排序
    if (slotsResult.data.length > 0) {
      const firstSlot = slotsResult.data[0]
      const lastSlot = slotsResult.data[slotsResult.data.length - 1]
      console.log(`[getDutySlots] 排序验证：第一条 ${firstSlot?.date} ${firstSlot?.startTime} (sortOrder: ${firstSlot?.sortOrder})，最后一条 ${lastSlot?.date} ${lastSlot?.startTime} (sortOrder: ${lastSlot?.sortOrder})`)
    }

    // 如果没有数据，返回空的结构化数据
    if (slotsResult.data.length === 0) {
      console.log('[getDutySlots] 该周暂无值班数据')
      return {
        code: 404,
        data: {
          weekNumber,
          year,
          weekDates: [],
          timeSlots: [],
          slotsData: [],
          config: config
        },
        message: `第${weekNumber}周暂无值班数据，请联系组长生成`
      }
    }

    // 处理数据结构，按表格形式组织
    const processedData = processSlotDataForTable(slotsResult.data, weekNumber, year, config)

    console.log('[getDutySlots] 数据处理完成')

    return {
      code: 200,
      data: processedData,
      message: '获取值班时间段数据成功'
    }

  } catch (err) {
    console.error('[getDutySlots] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '获取值班时间段数据失败'
    }
  }
}

/**
 * 处理时间段数据为表格格式
 * @param {Array} slots 原始时间段数据（已排序）
 * @param {Number} weekNumber 周数
 * @param {Number} year 年份
 * @param {Object} config 配置数据
 * @returns {Object} 处理后的表格数据
 */
function processSlotDataForTable(slots, weekNumber, year, config) {
  console.log('[getDutySlots] 开始处理表格数据（数据已排序）')

  // 定义时间段配置
  const timeSlotConfigs = [
    { name: '上午', startTime: '07:30', endTime: '09:30', index: 0 },
    { name: '上午', startTime: '09:30', endTime: '11:30', index: 1 },
    { name: '下午', startTime: '13:30', endTime: '15:30', index: 2 },
    { name: '下午', startTime: '15:30', endTime: '17:30', index: 3 },
    { name: '晚上', startTime: '18:30', endTime: '20:30', index: 4 }
  ]

  // 按dayOfWeek分组
  const slotsByDay = {}
  slots.forEach(slot => {
    if (!slotsByDay[slot.dayOfWeek]) {
      slotsByDay[slot.dayOfWeek] = []
    }
    slotsByDay[slot.dayOfWeek].push(slot)
  })

  // 生成一周的日期信息（按照周一到周日的顺序）
  const weekDates = []
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  
  // 计算该周的日期范围
  if (config.startDate && slots.length > 0) {
    const semesterStartDate = new Date(config.startDate)
    const weekStartDate = new Date(semesterStartDate)
    weekStartDate.setDate(semesterStartDate.getDate() + (weekNumber - 1) * 7)

    // 按照周一到周日的顺序生成日期 (1,2,3,4,5,6,0)
    const dayOrder = [1, 2, 3, 4, 5, 6, 0] // 周一到周日
    
    for (let i = 0; i < dayOrder.length; i++) {
      const targetDayOfWeek = dayOrder[i]
      
      // 计算目标日期：周一是weekStartDate，其他天相对计算
      const dayOffset = i // 周一是0，周二是1，...，周日是6
      const currentDate = new Date(weekStartDate)
      currentDate.setDate(weekStartDate.getDate() + dayOffset)
      
      // 验证计算是否正确
      const actualDayOfWeek = currentDate.getDay()
      if (actualDayOfWeek !== targetDayOfWeek) {
        console.warn(`[getDutySlots] 日期计算警告：期望${targetDayOfWeek}，实际${actualDayOfWeek}`)
      }
      
      weekDates.push({
        dayOfWeek: targetDayOfWeek,
        dayName: dayNames[targetDayOfWeek],
        date: currentDate.toISOString().split('T')[0], // YYYY-MM-DD
        dateDisplay: `${currentDate.getMonth() + 1}-${currentDate.getDate()}` // M-D
      })
    }
  }

  // 构建表格数据 - 5行×7列的二维数组
  const tableData = []
  
  for (let timeSlotIndex = 0; timeSlotIndex < 5; timeSlotIndex++) {
    const rowData = {
      timeSlotInfo: timeSlotConfigs[timeSlotIndex],
      dailySlots: []
    }

    // 按照weekDates的顺序（周一到周日）生成每行的列数据
    for (let i = 0; i < weekDates.length; i++) {
      const dayInfo = weekDates[i]
      const dayOfWeek = dayInfo.dayOfWeek
      const daySlots = slotsByDay[dayOfWeek] || []
      
      // 找到当前时间段的数据（兼容旧数据：下午第二场可能为16:00或15:30）
      let slot = null
      if (timeSlotIndex === 3) {
        slot = daySlots.find(s => s.startTime === '15:30') || daySlots.find(s => s.startTime === '16:00')
      } else {
        slot = daySlots.find(s => s.startTime === timeSlotConfigs[timeSlotIndex].startTime)
      }
      
      if (slot) {
        // 确定状态
        let status = 'no-duty' // 默认休假
        let statusText = '休假'
        let statusClass = 'no-duty'
        
        if (slot.isAvailable) {
          if (slot.dutyHolderId && slot.dutyHolderName) {
            status = 'assigned'
            statusText = slot.dutyHolderName
            statusClass = 'assigned'
          } else {
            status = 'available'
            statusText = '可选'
            statusClass = 'can-duty'
          }
        }

        rowData.dailySlots.push({
          slotData: slot,
          status: status,
          statusText: statusText,
          statusClass: statusClass,
          dayOfWeek: dayOfWeek,
          canSelect: slot.isAvailable && !slot.dutyHolderId
        })
      } else {
        // 没有数据的情况
        rowData.dailySlots.push({
          slotData: null,
          status: 'no-duty',
          statusText: '休假',
          statusClass: 'no-duty',
          dayOfWeek: dayOfWeek,
          canSelect: false
        })
      }
    }

    tableData.push(rowData)
  }

  console.log('[getDutySlots] 表格数据处理完成')

  return {
    weekNumber,
    year,
    weekDates, // 按照周一到周日的顺序
    tableData,
    config,
    totalSlots: slots.length,
    availableSlots: slots.filter(s => s.isAvailable && !s.dutyHolderId).length,
    assignedSlots: slots.filter(s => s.dutyHolderId).length
  }
} 