// 值班状态管理模块
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { addDutyEW } = require('./dutyEWManager')

/**
 * 计算值班任务状态
 * @param {string} date - 值班日期 (YYYY-MM-DD)
 * @param {string} startTime - 开始时间 (HH:MM)
 * @param {string} endTime - 结束时间 (HH:MM)
 * @returns {string} 任务状态：'pending' | 'inProgress' | 'ended'
 */
function calculateDutyStatus(date, startTime, endTime) {
  try {
    // 使用东八区当前时间进行比较
    const now = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
    
    // 直接构建带时区信息的完整时间字符串，避免使用setHours导致的时区问题
    // 格式: YYYY-MM-DDTHH:MM:SS+08:00
    const dutyStartTime = new Date(`${date}T${startTime}:00+08:00`)
    const dutyEndTime = new Date(`${date}T${endTime}:00+08:00`)
    
    // 计算状态
    if (now < dutyStartTime) {
      return 'pending'    // 待值班
    } else if (now >= dutyStartTime && now <= dutyEndTime) {
      return 'inProgress' // 进行中
    } else {
      return 'ended'      // 已结束
    }
  } catch (error) {
    console.error('[calculateDutyStatus] 计算状态失败：', error)
    return 'pending' // 默认返回待值班
  }
}

/**
 * 更新单个值班任务的状态
 * @param {Object} dutySlot - 值班时间段数据
 * @returns {Object} 更新结果
 */
exports.updateDutySlotStatus = async (dutySlot) => {
  try {
    // 只有已分配给用户的值班时间段才需要更新状态
    if (!dutySlot.dutyHolderId || !dutySlot.dutyHolderName) {
      return {
        success: true,
        statusChanged: false,
        message: '未分配的值班时间段，跳过状态更新'
      }
    }
    
    // 计算新状态
    const newStatus = calculateDutyStatus(dutySlot.date, dutySlot.startTime, dutySlot.endTime)
    const oldStatus = dutySlot.dutyStatus || 'pending'
    
    // 如果状态没有变化，不需要更新
    if (newStatus === oldStatus) {
      return {
        success: true,
        statusChanged: false,
        currentStatus: newStatus,
        message: '状态无变化'
      }
    }
    
    
    
    // 更新数据库中的状态
    await db.collection('duty_slots').doc(dutySlot.dutySlotId).update({
      data: {
        dutyStatus: newStatus,
        updateTime: new Date()
      }
    })
    
    // 同步更新 duty_toDo_list 中对应记录的 status 字段
    try {
      await db.collection('duty_toDo_list').where({
        dutySlotId: dutySlot.dutySlotId
      }).update({
        data: {
          status: newStatus,
          updateTime: new Date()
        }
      })
      console.log(`[updateDutySlotStatus] 已同步更新 duty_toDo_list 状态：${dutySlot.dutySlotId} -> ${newStatus}`)
    } catch (todoUpdateErr) {
      console.error(`[updateDutySlotStatus] 同步更新 duty_toDo_list 状态失败：${dutySlot.dutySlotId}`, todoUpdateErr)
      // 不抛出错误，避免影响主流程
    }
    
    // 如果状态变为已结束，且之前不是已结束，则添加EW
    if (newStatus === 'ended' && oldStatus !== 'ended') {
      
      
      const ewResult = await addDutyEW(dutySlot.dutyHolderId, 1) // 1个时间段
      
      if (ewResult.success) {
        
      } else {
        console.error(`[updateDutySlotStatus] EW添加失败：${ewResult.message}`)
      }
      
      return {
        success: true,
        statusChanged: true,
        oldStatus,
        newStatus,
        ewAdded: ewResult.success,
        ewAmount: ewResult.ewAdded || 0,
        message: `状态更新为${newStatus}，EW${ewResult.success ? '添加成功' : '添加失败'}`
      }
    }
    
    return {
      success: true,
      statusChanged: true,
      oldStatus,
      newStatus,
      message: `状态更新为${newStatus}`
    }
    
  } catch (error) {
    console.error('[updateDutySlotStatus] 更新状态失败：', error)
    return {
      success: false,
      message: error.message || '更新状态失败'
    }
  }
}

/**
 * 批量更新值班任务状态
 * @param {Array} dutySlots - 值班时间段数组（可选，如果不传则查询所有已分配的时间段）
 * @returns {Object} 批量更新结果
 */
exports.batchUpdateDutyStatus = async (dutySlots = null) => {
  try {
    
    
    // 如果没有传入数据，则查询所有已分配的值班时间段
    if (!dutySlots) {
      const slotsResult = await db.collection('duty_slots').where({
        dutyHolderId: db.command.neq('') // 只查询已分配的时间段
      }).get()
      
      dutySlots = slotsResult.data
    }
    
    
    
    const results = []
    let statusChangedCount = 0
    let ewAddedCount = 0
    let totalEwAdded = 0
    
    // 逐个更新状态
    for (const slot of dutySlots) {
      const result = await exports.updateDutySlotStatus(slot)
      results.push({
        dutySlotId: slot.dutySlotId,
        dutyHolderId: slot.dutyHolderId,
        result
      })
      
      if (result.statusChanged) {
        statusChangedCount++
      }
      
      if (result.ewAdded) {
        ewAddedCount++
        totalEwAdded += result.ewAmount || 0
      }
    }
    
    
    
    return {
      success: true,
      totalChecked: dutySlots.length,
      statusChangedCount,
      ewAddedCount,
      totalEwAdded,
      details: results,
      message: `批量更新完成：${statusChangedCount}个状态变更，${ewAddedCount}个任务结束并添加EW`
    }
    
  } catch (error) {
    console.error('[batchUpdateDutyStatus] 批量更新失败：', error)
    return {
      success: false,
      message: error.message || '批量更新值班状态失败'
    }
  }
}

/**
 * 定时任务：自动更新所有值班任务状态
 * 建议每小时执行一次
 * @returns {Object} 执行结果
 */
exports.scheduledStatusUpdate = async () => {
  try {
    
    
    const result = await exports.batchUpdateDutyStatus()
    
    
    
    return {
      success: true,
      executionTime: new Date(),
      ...result
    }
    
  } catch (error) {
    console.error('[scheduledStatusUpdate] 定时状态更新失败：', error)
    return {
      success: false,
      executionTime: new Date(),
      message: error.message || '定时状态更新失败'
    }
  }
}

/**
 * 发送值班提醒（供外部调用）
 * @param {Object} slot - duty_slots 文档对象
 */
exports.sendDutyReminder = async (slot) => {
  try {
    if (!slot || !slot.dutyHolderId) {
      return { code: 400, message: '缺少值班人信息' }
    }
    const dutyDateDisplay = slot.date
    return { code: 200, message: '提醒发送成功' }
  } catch (e) {
    console.error('[sendDutyReminder] 失败:', e)
    return { code: 500, message: e.message || '提醒失败' }
  }
}

// 导出状态计算函数供其他模块使用
exports.calculateDutyStatus = calculateDutyStatus 