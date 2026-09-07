// 重新生成值班时间段
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
 * 生成有序的值班时间段数据
 * @param {Number} startWeek 开始周次
 * @param {Number} totalWeeks 总周数
 * @param {Number} year 年份
 * @param {Date} semesterStartDate 学期开始日期
 * @returns {Array} 按日期和时间排序的值班时间段数组
 */
function generateOrderedDutySlots(startWeek, totalWeeks, year, semesterStartDate) {
  console.log('[regenerateDutySlots] 开始生成有序的值班时间段数据')
  
  // 定义时间段配置
  const timeSlotConfigs = [
    { name: '上午', start: '07:30', end: '09:30' },
    { name: '上午', start: '09:30', end: '11:30' },
    { name: '下午', start: '13:30', end: '15:30' },
    { name: '下午', start: '15:30', end: '17:30' },
    { name: '晚上', start: '18:30', end: '20:30' }
  ]

  let generatedSlots = []
  let sortOrderCounter = 1

  // 按周循环
  for (let week = startWeek; week < startWeek + totalWeeks; week++) {
    console.log(`[regenerateDutySlots] 开始生成第 ${week} 周`)

    // 计算该周的起始日期
    const weekStartDate = new Date(semesterStartDate)
    weekStartDate.setDate(semesterStartDate.getDate() + (week - 1) * 7)

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
        console.warn(`[regenerateDutySlots] 日期计算警告：期望${targetDayOfWeek}，实际${actualDayOfWeek}`)
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
          weekNumber: week,
          year: year,
          dayOfWeek: targetDayOfWeek,
          date: dateStr,
          timeSlot: slotConfig.name,
          startTime: slotConfig.start,
          endTime: slotConfig.end,
          ew: 2,
          dutyHolderId: '',
          dutyHolderName: '',
          dutyStatus: 'pending', // 新增：值班任务状态字段
          isAvailable: isAvailable,
          sortOrder: sortOrderCounter++, // 添加排序字段
          // 悲观锁相关字段
          lockStatus: 'unlocked',
          lockUserId: '',
          lockTime: null,
          lockExpireTime: null,
          createTime: new Date(),
          updateTime: new Date()
        }

        generatedSlots.push(dutySlot)

        // 减少日志输出，提高性能
        if (generatedSlots.length % 50 === 0) {
          console.log(`[regenerateDutySlots] 已生成 ${generatedSlots.length} 个时间段...`)
        }
      }
    }
  }

  console.log(`[regenerateDutySlots] 生成完成，总计 ${generatedSlots.length} 个有序时间段`)
  
  // 验证排序是否正确
  const firstSlot = generatedSlots[0]
  const lastSlot = generatedSlots[generatedSlots.length - 1]
  console.log(`[regenerateDutySlots] 排序验证：第一条 ${firstSlot?.date} ${firstSlot?.startTime}，最后一条 ${lastSlot?.date} ${lastSlot?.startTime}`)
  
  return generatedSlots
}

/**
 * 批量插入值班数据（保持顺序）
 * @param {Array} slots 有序的值班时间段数组
 * @returns {Object} 插入结果
 */
async function batchInsertSlotsOrdered(slots) {
  console.log(`[regenerateDutySlots] 开始有序插入${slots.length}条记录`)

  try {
    // 使用并行插入保持性能，sortOrder字段确保顺序
    const insertPromises = slots.map(async (slot) => {
      try {
        await db.collection('duty_slots').doc(slot.dutySlotId).set({ data: slot })
        return { success: true, slotId: slot.dutySlotId, sortOrder: slot.sortOrder }
      } catch (err) {
        console.log(`[regenerateDutySlots] 时间段 ${slot.dutySlotId} 插入失败：${err.message}`)
        return { success: false, slotId: slot.dutySlotId, sortOrder: slot.sortOrder, error: err.message }
      }
    })

    const results = await Promise.all(insertPromises)
    
    // 统计结果
    const successResults = results.filter(r => r.success)
    const failedResults = results.filter(r => !r.success)
    
    console.log(`[regenerateDutySlots] 插入完成：成功 ${successResults.length}，失败 ${failedResults.length}`)
    
    if (failedResults.length > 0) {
      console.log('[regenerateDutySlots] 失败的记录：', failedResults.map(r => `${r.slotId}(${r.sortOrder})`))
    }

    return {
      totalCount: slots.length,
      successCount: successResults.length,
      failedCount: failedResults.length,
      failedRecords: failedResults
    }
    
  } catch (globalErr) {
    console.error('[regenerateDutySlots] 批量插入全局错误：', globalErr)
    throw globalErr
  }
}

/**
 * 重新生成值班时间段
 * 新策略：只生成初始周的数据，避免大批量操作
 * @param {Object} event 事件参数
 * @param {Number} event.weekNumber 周数（可选，默认为1）
 * @param {Number} event.totalWeeks 总周数（可选，默认为1周）
 * @param {String} openid 用户openid
 * @returns {Object} 返回生成结果
 */
exports.regenerateDutySlots = async (event, openid) => {
  const overallStartTime = Date.now()
  
  try {
    console.log('[regenerateDutySlots] 开始生成值班时间段（有序生成策略）')
    console.log('[regenerateDutySlots] 参数：', { weekNumber: event.weekNumber, totalWeeks: event.totalWeeks })

    // TODO: 这里应该添加权限检查，确保只有组长可以生成时间段
    // const userResult = await checkLeaderPermission(openid)

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

    console.log('[regenerateDutySlots] 当前配置：', config)

    // 确定生成参数 - 只生成第一周
    const startWeek = event.weekNumber || 1 // 默认第1周
    const totalWeeks = event.totalWeeks || 1 // 默认只生成1周
    const year = new Date().getFullYear()
    const semesterStartDate = new Date(config.startDate)

    console.log('[regenerateDutySlots] 生成参数：', { startWeek, totalWeeks, year, semesterStartDate })

    // 生成有序的值班时间段数据
    const generatedSlots = generateOrderedDutySlots(startWeek, totalWeeks, year, semesterStartDate)

    console.log(`[regenerateDutySlots] 总共生成 ${generatedSlots.length} 个有序时间段`)

    // 批量插入记录
    const insertStartTime = Date.now()
    console.log(`[regenerateDutySlots] 开始插入 ${generatedSlots.length} 条记录`)

    const insertResult = await batchInsertSlotsOrdered(generatedSlots)
    
    const totalElapsed = Date.now() - overallStartTime
    console.log(`[regenerateDutySlots] 生成完成，总共插入 ${insertResult.successCount} 个时间段，总用时 ${totalElapsed}ms`)

    // 处理部分失败的情况
    if (insertResult.failedCount > 0) {
      return {
        code: 206,
        data: {
          totalGenerated: generatedSlots.length,
          insertedCount: insertResult.successCount,
          failedCount: insertResult.failedCount,
          startWeek: startWeek,
          endWeek: startWeek + totalWeeks - 1,
          generatedWeeks: totalWeeks,
          executionTime: totalElapsed
        },
        message: `部分成功生成 ${insertResult.successCount} 个值班时间段，失败 ${insertResult.failedCount} 个，用时 ${(totalElapsed/1000).toFixed(2)}秒`
      }
    }

    return {
      code: 200,
      data: {
        totalGenerated: generatedSlots.length,
        insertedCount: insertResult.successCount,
        startWeek: startWeek,
        endWeek: startWeek + totalWeeks - 1,
        generatedWeeks: totalWeeks,
        executionTime: totalElapsed
      },
      message: `成功生成 ${insertResult.successCount} 个有序值班时间段，用时 ${(totalElapsed/1000).toFixed(2)}秒`
    }

  } catch (err) {
    console.error('[regenerateDutySlots] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '生成值班时间段失败'
    }
  }
} 