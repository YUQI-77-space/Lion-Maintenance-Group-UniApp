// cloudfunctions/dutySchedule/scheduleDutyReminder.js
// 值班提醒调度功能

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 处理值班提醒调度
 * 根据值班开始时间决定是立即发送还是等待定时任务发送
 * @param {Object} event 事件参数
 * @param {Array} event.selectedSlots 选择的值班时间段ID数组
 * @param {String} event.miniprogramState 小程序版本状态
 * @param {String} openid 用户openid
 * @returns {Object} 调度结果
 */
exports.scheduleDutyReminder = async (event, openid) => {
  try {
    

    // 参数验证
    if (!event.selectedSlots || !Array.isArray(event.selectedSlots) || event.selectedSlots.length === 0) {
      return {
        code: 400,
        data: null,
        message: '缺少值班时间段参数'
      }
    }

    // 获取用户信息
    const userResult = await db.collection('users').where({
      openid: openid
    }).get()

    if (userResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '用户信息不存在'
      }
    }

    const user = userResult.data[0]

    // 查询选择的值班时间段详细信息
    const dutySlotIds = event.selectedSlots
    const slotsResult = await db.collection('duty_slots')
      .where({
        dutySlotId: db.command.in(dutySlotIds),
        dutyHolderId: openid // 确保只处理当前用户的值班时间段
      })
      .get()

    if (slotsResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到相关的值班时间段'
      }
    }

    

    // 统一用绝对毫秒时间戳比较；东八区换算只用在解析“值班开始时刻”上
    const nowMs = Date.now()
    const oneHourInMs = 60 * 60 * 1000

    const immediateSendSlots = [] // 需要立即发送的时间段
    const scheduledSlots = [] // 由定时任务处理的时间段
    const skippedSlots = [] // 已经过开始时间的时间段，不再发送提醒

    // 分析每个时间段的时间差
    for (const slot of slotsResult.data) {
      const dutyStartMs = getDutyStartMs(slot.date, slot.startTime)
      if (!Number.isFinite(dutyStartMs)) {
        console.warn('[scheduleDutyReminder] 值班开始时间解析失败，跳过', {
          dutySlotId: slot.dutySlotId,
          date: slot.date,
          startTime: slot.startTime
        })
        skippedSlots.push(slot)
        continue
      }
      const timeDifference = dutyStartMs - nowMs

      // 已经开始或已过开始时间，跳过，不发送订阅消息
      if (timeDifference <= 0) {
        skippedSlots.push(slot)
        continue
      }

      if (timeDifference <= oneHourInMs) {
        // 距离开始时间不足1小时，立即发送
        immediateSendSlots.push(slot)
      } else {
        // 距离开始时间超过1小时，由定时任务处理
        scheduledSlots.push(slot)
      }
    }

    let immediateResults = null
    let scheduledCount = scheduledSlots.length

    // 处理需要立即发送的时间段
    if (immediateSendSlots.length > 0) {
      
      
      try {
        // 调用订阅消息云函数立即发送
        const sendResult = await cloud.callFunction({
          name: 'subscriptionMessage',
          data: {
            action: 'sendDutyReminderNotification',
            params: {
              dutySlots: immediateSendSlots,
              miniprogramState: event.miniprogramState || 'formal'
            }
          }
        })

        immediateResults = sendResult.result
        
        // 记录立即发送的日志
        for (const slot of immediateSendSlots) {
          await db.collection('message_send_logs').add({
            data: {
              type: 'DUTY_REMINDER_IMMEDIATE',
              templateId: 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8',
              dutySlotId: slot.dutySlotId,
              recipient: slot.dutyHolderId,
              recipientName: slot.dutyHolderName,
              dutyDate: slot.date,
              dutyTime: `${slot.startTime}-${slot.endTime}`,
              success: sendResult.result && sendResult.result.success,
              message: '立即发送值班提醒',
              authTime: db.serverDate(),
              sendTime: db.serverDate(),
              scheduledBy: 'immediate_send',
              miniprogramState: event.miniprogramState || 'formal'
            }
          })
        }
        
      } catch (error) {
        console.error('[scheduleDutyReminder] 立即发送值班提醒失败:', error)
        immediateResults = {
          success: false,
          message: '立即发送失败: ' + error.message
        }
      }
    }

    // 为定时任务处理的时间段记录日志
    if (scheduledSlots.length > 0) {
      
      
      for (const slot of scheduledSlots) {
        await db.collection('message_send_logs').add({
          data: {
            type: 'DUTY_REMINDER_SCHEDULED',
            templateId: 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8',
            dutySlotId: slot.dutySlotId,
            recipient: slot.dutyHolderId,
            recipientName: slot.dutyHolderName,
            dutyDate: slot.date,
            dutyTime: `${slot.startTime}-${slot.endTime}`,
            success: true,
            message: '已安排定时任务发送值班提醒',
            authTime: db.serverDate(),
            scheduledBy: 'scheduler_task',
            miniprogramState: event.miniprogramState || 'formal'
          }
        })
      }
    }

    return {
      code: 200,
      data: {
        totalSlots: slotsResult.data.length,
        immediateSendCount: immediateSendSlots.length,
        scheduledCount: scheduledCount,
        skippedCount: skippedSlots.length,
        immediateResults: immediateResults,
        scheduledSlots: scheduledSlots.map(slot => ({
          dutySlotId: slot.dutySlotId,
          date: slot.date,
          timeSlot: `${slot.startTime}-${slot.endTime}`
        }))
      },
      message: `值班提醒调度完成：立即发送${immediateSendSlots.length}个，定时发送${scheduledCount}个，已过期跳过${skippedSlots.length}个`
    }

  } catch (err) {
    console.error('[scheduleDutyReminder] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '值班提醒调度失败'
    }
  }
}

/**
 * 把 duty_slots 里的 date + startTime 解析成“东八区该时刻”的绝对毫秒时间戳
 * @param {String} dateStr 日期字符串 (YYYY-MM-DD)
 * @param {String} timeStr 时间字符串 (HH:MM)
 * @returns {Number} 毫秒时间戳，无法解析时为 NaN
 */
function getDutyStartMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return NaN
  const parsed = Date.parse(`${dateStr}T${timeStr}:00+08:00`)
  return Number.isNaN(parsed) ? NaN : parsed
}
