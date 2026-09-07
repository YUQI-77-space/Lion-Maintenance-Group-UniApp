// 切换到指定周
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 判断时间段是否可用
 * 根据星期和时间段索引判断该时间段是否开放值班
 * @param {Number} dayOfWeek 星期几 (0=周日, 1=周一, ..., 6=周六)
 * @param {Number} slotIndex 时间段索引 (0-4)
 * @returns {Boolean} 是否可用
 */
function isSlotAvailable(dayOfWeek, slotIndex) {
  // 时间段对应关系：
  // 0: 上午 07:30-09:30
  // 1: 上午 09:30-11:30  
  // 2: 下午 13:30-15:30
  // 3: 下午 15:30-17:30
  // 4: 晚上 18:30-20:30

  if (dayOfWeek === 0) {
    // 周日：休假，所有时间段不可用
    return false
  } else if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // 工作日(周一~周五): 15:30-17:30, 18:30-20:30
    return slotIndex === 3 || slotIndex === 4
  } else if (dayOfWeek === 6) {
    // 周六: 13:30-15:30, 15:30-17:30
    return slotIndex === 2 || slotIndex === 3
  }
  
  return false
}

/**
 * 创建指定周的有序值班数据
 * @param {Number} weekNumber 周次
 * @param {Number} year 年份
 * @param {Date} semesterStartDate 学期开始日期
 * @returns {Array} 生成的有序值班时间段数组
 */
async function createWeekData(weekNumber, year, semesterStartDate) {
  console.log(`[switchToWeek] 开始创建第${weekNumber}周的有序数据`)

  // 定义时间段配置
  const timeSlotConfigs = [
    { name: '上午', start: '07:30', end: '09:30' },
    { name: '上午', start: '09:30', end: '11:30' },
    { name: '下午', start: '13:30', end: '15:30' },
    { name: '下午', start: '15:30', end: '17:30' },
    { name: '晚上', start: '18:30', end: '20:30' }
  ]

  let generatedSlots = []
  
  // 为了确保与其他周的sortOrder连续，需要计算基础sortOrder
  // 假设每周有35个时间段（7天 × 5时间段）
  const slotsPerWeek = 35
  const baseSortOrder = (weekNumber - 1) * slotsPerWeek + 1
  let sortOrderCounter = baseSortOrder

  // 计算该周的起始日期
  const weekStartDate = new Date(semesterStartDate)
  weekStartDate.setDate(semesterStartDate.getDate() + (weekNumber - 1) * 7)

  // 按天循环（周一到周日的顺序：1,2,3,4,5,6,0）
  const dayOrder = [1, 2, 3, 4, 5, 6, 0] // 周一到周日
  
  for (let dayIndex = 0; dayIndex < dayOrder.length; dayIndex++) {
    const targetDayOfWeek = dayOrder[dayIndex]
    
    // 计算实际日期
    const currentDate = new Date(weekStartDate)
    currentDate.setDate(weekStartDate.getDate() + dayIndex)
    
    // 验证日期计算是否正确
    const actualDayOfWeek = currentDate.getDay()
    if (actualDayOfWeek !== targetDayOfWeek) {
      console.warn(`[switchToWeek] 日期计算警告：期望${targetDayOfWeek}，实际${actualDayOfWeek}`)
    }
    
    const dateStr = currentDate.toISOString().split('T')[0] // YYYY-MM-DD

    // 按时间段循环（从早到晚：0,1,2,3,4）
    for (let slotIndex = 0; slotIndex < timeSlotConfigs.length; slotIndex++) {
      const slotConfig = timeSlotConfigs[slotIndex]
      const slotId = `${year}${String(currentDate.getMonth() + 1).padStart(2, '0')}${String(currentDate.getDate()).padStart(2, '0')}${slotIndex + 1}`

      // 根据星期和时间段确定是否可用
      const isAvailable = isSlotAvailable(targetDayOfWeek, slotIndex)

      const dutySlot = {
        dutySlotId: slotId,
        weekNumber: weekNumber,
        year: year,
        dayOfWeek: targetDayOfWeek,
        date: dateStr,
        timeSlot: slotConfig.name,
        startTime: slotConfig.start,
        endTime: slotConfig.end,
        ew: 2,
        dutyHolderId: '',
        dutyHolderName: '',
        isAvailable: isAvailable,
        sortOrder: sortOrderCounter++, // 添加排序字段
        createTime: new Date(),
        updateTime: new Date()
      }

      generatedSlots.push(dutySlot)
    }
  }

  console.log(`[switchToWeek] 第${weekNumber}周生成了${generatedSlots.length}条有序记录`)
  
  // 验证排序是否正确
  const firstSlot = generatedSlots[0]
  const lastSlot = generatedSlots[generatedSlots.length - 1]
  console.log(`[switchToWeek] 排序验证：第一条 ${firstSlot?.date} ${firstSlot?.startTime} (sortOrder: ${firstSlot?.sortOrder})，最后一条 ${lastSlot?.date} ${lastSlot?.startTime} (sortOrder: ${lastSlot?.sortOrder})`)
  
  return generatedSlots
}

/**
 * 批量插入值班数据（保持顺序）
 * @param {Array} slots 值班时间段数组
 * @returns {Object} 插入结果
 */
async function batchInsertSlots(slots) {
  console.log(`[switchToWeek] 开始有序插入${slots.length}条记录`)

  try {
    // 使用并行插入保持性能，sortOrder字段确保顺序
    const insertPromises = slots.map(async (slot) => {
      try {
        await db.collection('duty_slots').doc(slot.dutySlotId).set({ data: slot })
        return { success: true, slotId: slot.dutySlotId, sortOrder: slot.sortOrder }
      } catch (err) {
        console.log(`[switchToWeek] 时间段 ${slot.dutySlotId} 插入失败：${err.message}`)
        return { success: false, slotId: slot.dutySlotId, sortOrder: slot.sortOrder, error: err.message }
      }
    })

    const results = await Promise.all(insertPromises)
    
    // 统计结果
    const successResults = results.filter(r => r.success)
    const failedResults = results.filter(r => !r.success)
    
    console.log(`[switchToWeek] 插入完成：成功 ${successResults.length}，失败 ${failedResults.length}`)
    
    if (failedResults.length > 0) {
      console.log('[switchToWeek] 失败的记录：', failedResults.map(r => `${r.slotId}(${r.sortOrder})`))
    }

    return {
      totalCount: slots.length,
      successCount: successResults.length,
      failedCount: failedResults.length,
      failedRecords: failedResults
    }
    
  } catch (globalErr) {
    console.error('[switchToWeek] 批量插入全局错误：', globalErr)
    throw globalErr
  }
}

/**
 * 切换到指定周
 * @param {Object} event 事件参数
 * @param {Number} event.weekNumber 目标周次
 * @param {Number} event.year 年份（可选，默认当前年份）
 * @param {String} openid 用户openid
 * @returns {Object} 返回切换结果
 */
exports.switchToWeek = async (event, openid) => {
  const startTime = Date.now()
  
  try {
    console.log('[switchToWeek] 开始切换到指定周（有序生成策略）')
    console.log('[switchToWeek] 参数：', { weekNumber: event.weekNumber, year: event.year })

    // 验证必要参数
    if (!event.weekNumber) {
      return {
        code: 400,
        data: null,
        message: '缺少周次参数 weekNumber'
      }
    }

    // TODO: 这里应该添加权限检查，确保只有组长可以切换周次
    // const userResult = await checkLeaderPermission(openid)

    // 获取年份，默认为当前年份
    const year = event.year || new Date().getFullYear()
    const weekNumber = parseInt(event.weekNumber)

    console.log('[switchToWeek] 切换参数：', { weekNumber, year })

    // 获取配置
    const configResult = await db.collection('duty_config').doc('global').get()
    if (!configResult.data) {
      return {
        code: 404,
        data: null,
        message: '值班配置不存在，请先初始化系统'
      }
    }

    const config = configResult.data
    if (!config.startDate) {
      return {
        code: 400,
        data: null,
        message: '学期开始日期未设置，请先设置 startDate'
      }
    }

    console.log('[switchToWeek] 当前配置：', config)

    // 第一步：检查目标周是否已存在数据
    console.log('[switchToWeek] 检查目标周数据是否存在')
    const queryResult = await db.collection('duty_slots')
      .where({
        weekNumber: weekNumber,
        year: year
      })
      .limit(1)
      .get()

    const weekExists = queryResult.data.length > 0
    console.log('[switchToWeek] 目标周存在状态：', weekExists)

    let createResult = null

    // 第二步：如果目标周不存在，则创建有序数据
    if (!weekExists) {
      console.log('[switchToWeek] 目标周不存在，开始创建有序数据')
      
      const semesterStartDate = new Date(config.startDate)
      const slots = await createWeekData(weekNumber, year, semesterStartDate)
      
      // 插入数据
      createResult = await batchInsertSlots(slots)
      
      console.log('[switchToWeek] 有序数据创建结果：', createResult)
      
      if (createResult.failedCount > 0) {
        return {
          code: 206,
          data: {
            weekNumber,
            year,
            created: true,
            createResult
          },
          message: `第${weekNumber}周有序数据创建部分成功，成功${createResult.successCount}条，失败${createResult.failedCount}条`
        }
      }
    }

    // 第三步：更新当前周配置
    console.log('[switchToWeek] 开始更新当前周配置')
    const updateResult = await db.collection('duty_config').doc('global').update({
      data: {
        currentWeek: weekNumber,
        currentYear: year,
        updateTime: new Date()
      }
    })

    console.log('[switchToWeek] 配置更新结果：', updateResult)

    // 获取更新后的配置
    const newConfigResult = await db.collection('duty_config').doc('global').get()

    const totalTime = Date.now() - startTime
    console.log(`[switchToWeek] 切换完成，总用时 ${totalTime}ms`)

    return {
      code: 200,
      data: {
        weekNumber,
        year,
        created: !weekExists,
        createResult,
        config: newConfigResult.data,
        executionTime: totalTime
      },
      message: weekExists 
        ? `成功切换到第${weekNumber}周（已存在数据）` 
        : `成功切换到第${weekNumber}周并创建了${createResult?.successCount || 0}条有序新记录`
    }

  } catch (err) {
    console.error('[switchToWeek] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '切换周次失败'
    }
  }
} 