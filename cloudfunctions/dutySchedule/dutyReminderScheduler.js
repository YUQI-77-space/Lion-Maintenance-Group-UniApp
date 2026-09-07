// cloudfunctions/dutySchedule/dutyReminderScheduler.js
// 值班提醒定时任务处理器

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 检查并发送即将开始的值班提醒（开始前1小时）
 * @param {Object} event - 定时触发器事件
 * @returns {Object} 处理结果
 */
exports.main = async (event, context) => {
  
  
  try {
    // 使用东八区时间处理
    const currentTime = getCurrentChinaTime()
    const currentTimeMs = currentTime.getTime()
    const oneHourLater = new Date(currentTimeMs + 55 * 60 * 1000)  // 55分钟后
    const oneHourLaterMax = new Date(currentTimeMs + 65 * 60 * 1000)  // 65分钟后
    
    
    
    // 查询即将开始的值班时间段（已分配值班人员的）
    const dutySlots = await findUpcomingDutySlots(oneHourLater, oneHourLaterMax)
    
    
    
    if (dutySlots.length === 0) {
      return {
        success: true,
        message: '没有需要发送提醒的值班时间段',
        data: {
          checkedCount: 0,
          remindersSent: 0
        }
      }
    }
    
    let totalRemindersSent = 0
    let successfulSlots = 0
    const results = []
    
    // 为每个值班时间段发送提醒
    for (const dutySlot of dutySlots) {
      try {
        
        
        // 检查是否已经发送过提醒（防重复）
        const existingLogResult = await db.collection('message_send_logs')
          .where({
            type: 'DUTY_REMINDER',
            dutySlotId: dutySlot.dutySlotId,
            success: true
          })
          .get()
        
        if (existingLogResult.data.length > 0) {
          
          results.push({
            dutySlotId: dutySlot.dutySlotId,
            dutyHolderName: dutySlot.dutyHolderName,
            success: true,
            message: '已发送过提醒',
            remindersSent: 0
          })
          continue
        }
        
        // 再次检查值班时间段是否仍然存在且分配给相同的人员（防止被删除或重新分配）
        const currentSlotResult = await db.collection('duty_slots')
          .where({
            dutySlotId: dutySlot.dutySlotId,
            dutyHolderId: dutySlot.dutyHolderId,
            dutyHolderName: dutySlot.dutyHolderName
          })
          .get()
        
        if (currentSlotResult.data.length === 0) {
          
          results.push({
            dutySlotId: dutySlot.dutySlotId,
            dutyHolderName: dutySlot.dutyHolderName,
            success: true,
            message: '值班时间段已被删除或重新分配',
            remindersSent: 0
          })
          continue
        }
        
        // 调用订阅消息云函数发送提醒
        const reminderResult = await cloud.callFunction({
          name: 'subscriptionMessage',
          data: {
            action: 'sendDutyReminderNotification',
            params: {
              dutySlots: [dutySlot], // 只发送当前时间段
              miniprogramState: 'formal' // 使用正式版订阅消息
            }
          }
        })
        
        if (reminderResult.result && reminderResult.result.success) {
          const sentCount = reminderResult.result.data.successCount || 0
          totalRemindersSent += sentCount
          successfulSlots++
          
          
          
          // 记录成功发送的日志
          await db.collection('message_send_logs').add({
            data: {
              type: 'DUTY_REMINDER',
              templateId: 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8',
              dutySlotId: dutySlot.dutySlotId,
              recipient: dutySlot.dutyHolderId,
              recipientName: dutySlot.dutyHolderName,
              dutyDate: dutySlot.date,
              dutyTime: `${dutySlot.startTime}-${dutySlot.endTime}`,
              success: true,
              successCount: sentCount,
              timestamp: db.serverDate(),
              schedulerExecution: true,
              miniprogramState: 'formal'
            }
          })
          
          results.push({
            dutySlotId: dutySlot.dutySlotId,
            dutyHolderName: dutySlot.dutyHolderName,
            success: true,
            message: `成功发送提醒`,
            remindersSent: sentCount
          })
        } else {
          console.error(`值班时间段 ${dutySlot.dutySlotId} 提醒发送失败:`, reminderResult.result)
          results.push({
            dutySlotId: dutySlot.dutySlotId,
            dutyHolderName: dutySlot.dutyHolderName,
            success: false,
            message: reminderResult.result ? reminderResult.result.message : '发送失败',
            remindersSent: 0
          })
          
          // 记录失败日志
          await db.collection('message_send_logs').add({
            data: {
              type: 'DUTY_REMINDER',
              templateId: 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8',
              dutySlotId: dutySlot.dutySlotId,
              recipient: dutySlot.dutyHolderId,
              recipientName: dutySlot.dutyHolderName,
              dutyDate: dutySlot.date,
              dutyTime: `${dutySlot.startTime}-${dutySlot.endTime}`,
              error: reminderResult.result ? reminderResult.result.message : '发送失败',
              success: false,
              timestamp: db.serverDate(),
              schedulerExecution: true,
              miniprogramState: 'formal'
            }
          })
        }
        
      } catch (error) {
        console.error(`处理值班时间段 ${dutySlot.dutySlotId} 时出错:`, error)
        results.push({
          dutySlotId: dutySlot.dutySlotId,
          dutyHolderName: dutySlot.dutyHolderName,
          success: false,
          message: error.message,
          remindersSent: 0
        })
        
        // 记录异常日志
        await db.collection('message_send_logs').add({
          data: {
            type: 'DUTY_REMINDER',
            templateId: 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8',
            dutySlotId: dutySlot.dutySlotId,
            recipient: dutySlot.dutyHolderId || '',
            recipientName: dutySlot.dutyHolderName || '',
            dutyDate: dutySlot.date,
            dutyTime: `${dutySlot.startTime}-${dutySlot.endTime}`,
            error: error.message,
            success: false,
            timestamp: db.serverDate(),
            schedulerExecution: true
          }
        })
      }
    }
    
    
    
    return {
      success: true,
      message: `处理完成: 检查了${dutySlots.length}个值班时间段，成功处理${successfulSlots}个，发送了${totalRemindersSent}条提醒`,
      data: {
        checkedCount: dutySlots.length,
        successfulSlots: successfulSlots,
        totalRemindersSent: totalRemindersSent,
        results: results
      }
    }
    
  } catch (error) {
    console.error('值班提醒定时任务执行失败:', error)
    return {
      success: false,
      message: '定时任务执行失败: ' + error.message,
      error: error
    }
  }
}

/**
 * 查找即将开始的值班时间段
 * @param {Date} startTime - 开始时间范围
 * @param {Date} endTime - 结束时间范围
 * @returns {Array} 值班时间段数组
 */
async function findUpcomingDutySlots(startTime, endTime) {
  // 由于值班时间段数据中日期和时间是分开存储的，需要特殊处理查询逻辑
  const startDate = formatDateOnly(startTime)
  const endDate = formatDateOnly(endTime)
  
  
  
  // 查询当天和可能的第二天的值班时间段
  const dates = [startDate]
  if (startDate !== endDate) {
    dates.push(endDate)
  }
  
  const slotsResult = await db.collection('duty_slots')
    .where({
      date: _.in(dates),
      dutyHolderId: _.neq(''), // 已分配值班人员
      dutyHolderName: _.neq('') // 已分配值班人员
    })
    .get()
  
  
  
  // 过滤出真正在时间范围内的值班时间段
  const filteredSlots = slotsResult.data.filter(slot => {
    const slotStartTime = getDutyStartDateTime(slot.date, slot.startTime)
    return slotStartTime >= startTime && slotStartTime <= endTime
  })
  
  
  
  return filteredSlots
}

/**
 * 获取当前中国时间
 * @returns {Date} 中国时间的Date对象
 */
function getCurrentChinaTime() {
  const now = new Date()
  // 转换为东八区时间
  return new Date(now.getTime() + (8 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
}

/**
 * 格式化中国时间为字符串
 * @param {Date} date - 时间对象
 * @returns {string} 格式化的时间字符串
 */
function formatChinaTime(date) {
  return date.toISOString().replace('Z', '+08:00')
}

/**
 * 格式化日期为 YYYY-MM-DD 格式
 * @param {Date} date - 时间对象
 * @returns {string} 日期字符串
 */
function formatDateOnly(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 根据日期和时间构建值班开始的完整时间
 * @param {String} dateStr 日期字符串 (YYYY-MM-DD)
 * @param {String} timeStr 时间字符串 (HH:MM)
 * @returns {Date} 值班开始时间的Date对象（东八区）
 */
function getDutyStartDateTime(dateStr, timeStr) {
  try {
    // 构建完整的日期时间字符串，并指定为东八区时间
    const dateTimeStr = `${dateStr}T${timeStr}:00+08:00`
    return new Date(dateTimeStr)
  } catch (error) {
    console.error('构建值班开始时间失败:', error)
    return new Date() // 降级返回当前时间
  }
}
