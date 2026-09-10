// cloudfunctions/dutySchedule/dutyReminderScheduler.js
// 值班提醒定时任务处理器：给“55~65 分钟后开始”的值班时间段发送订阅消息提醒
//
// 【部署依赖】由云开发控制台的定时触发器唤醒（仓库内没有 config.json）：
//   触发器名：dutyReminderTimer（index.js 按名字路由到本文件）
//   cron：0 */5 * * * * *（每 5 分钟一次；提前量窗口宽 10 分钟，5 分钟一轮能稳定覆盖）
// 云函数运行环境是 UTC，所以这里只用绝对毫秒时间戳做比较，东八区只用于取“日期”和打日志。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CST_OFFSET_MS = 8 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const REMINDER_MIN_LEAD_MS = 55 * MINUTE_MS // 窗口下界：距开始 55 分钟
const REMINDER_MAX_LEAD_MS = 65 * MINUTE_MS // 窗口上界：距开始 65 分钟
const DUTY_REMINDER_TEMPLATE_ID = 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8'

/**
 * 把绝对毫秒时间戳格式化成东八区 'YYYY-MM-DD HH:mm:ss'（仅用于日志）
 * @param {Number} ms 毫秒时间戳
 * @returns {String}
 */
function formatCst(ms) {
  const shifted = new Date(ms + CST_OFFSET_MS)
  const pad = (num) => String(num).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
}

/**
 * 取绝对毫秒时间戳对应的东八区日期串 YYYY-MM-DD（用于缩小数据库查询范围）
 * @param {Number} ms 毫秒时间戳
 * @returns {String}
 */
function formatCstDate(ms) {
  return new Date(ms + CST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 把 duty_slots 里的 date + startTime 解析成“东八区该时刻”的绝对毫秒时间戳
 * @param {String} dateStr YYYY-MM-DD
 * @param {String} timeStr HH:MM
 * @returns {Number} 毫秒时间戳，无法解析时为 NaN
 */
function getDutyStartMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return NaN
  const parsed = Date.parse(`${dateStr}T${timeStr}:00+08:00`)
  return Number.isNaN(parsed) ? NaN : parsed
}

/**
 * 查找在给定窗口内即将开始、且已分配值班人员的时间段
 * @param {Number} windowStartMs 窗口下界（绝对毫秒）
 * @param {Number} windowEndMs 窗口上界（绝对毫秒）
 * @returns {Array} 值班时间段数组
 */
async function findUpcomingDutySlots(windowStartMs, windowEndMs) {
  // 日期和时间在库里是分开存的，先用东八区日期缩小查询范围（窗口可能跨零点，所以要取两端的日期）
  const dates = [...new Set([formatCstDate(windowStartMs), formatCstDate(windowEndMs)])]

  const slotsResult = await db.collection('duty_slots')
    .where({
      date: _.in(dates),
      dutyHolderId: _.neq(''),   // 已分配值班人员
      dutyHolderName: _.neq('')
    })
    .get()

  // 再按绝对时刻精确过滤
  return slotsResult.data.filter((slot) => {
    const slotStartMs = getDutyStartMs(slot.date, slot.startTime)
    return Number.isFinite(slotStartMs) && slotStartMs >= windowStartMs && slotStartMs <= windowEndMs
  })
}

/**
 * 定时触发器入口：检查并发送即将开始的值班提醒
 * @param {Object} event - 定时触发器事件（云端测试时可传 { TriggerName: 'dutyReminderTimer' }）
 * @returns {Object} 处理结果
 */
exports.main = async (event, context) => {
  const nowMs = Date.now()
  // 定时触发时 event 里没有该字段，默认正式版；手动排查时可传 developer/trial
  const miniprogramState = (event && event.miniprogramState) || 'formal'

  try {
    const windowStartMs = nowMs + REMINDER_MIN_LEAD_MS
    const windowEndMs = nowMs + REMINDER_MAX_LEAD_MS

    console.log('[dutyReminderScheduler] 东八区时间核对', {
      本次执行: formatCst(nowMs),
      提醒窗口: `${formatCst(windowStartMs)} ~ ${formatCst(windowEndMs)}`
    })

    const dutySlots = await findUpcomingDutySlots(windowStartMs, windowEndMs)

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

    for (const dutySlot of dutySlots) {
      try {
        // 检查是否已经发送过提醒（防重复）
        // 注意：subscriptionMessage 发送成功时也会写一条 type 为 DUTY_REMINDER 的日志，
        // 所以“预选时立即发送”过的时段在这里同样会被识别为已发送，两条链路不会重复提醒
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

        // 再次确认该时间段仍然存在且仍分配给了同一人（防止期间被删除或重新分配）
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
              miniprogramState
            }
          }
        })

        if (reminderResult.result && reminderResult.result.success) {
          const sentCount = reminderResult.result.data.successCount || 0
          totalRemindersSent += sentCount
          successfulSlots++

          console.log(`[dutyReminderScheduler] 已发送提醒 ${dutySlot.dutySlotId}`, {
            值班人: dutySlot.dutyHolderName,
            开始时间: `${dutySlot.date} ${dutySlot.startTime}`
          })

          // 记录成功发送的日志
          await db.collection('message_send_logs').add({
            data: {
              type: 'DUTY_REMINDER',
              templateId: DUTY_REMINDER_TEMPLATE_ID,
              dutySlotId: dutySlot.dutySlotId,
              recipient: dutySlot.dutyHolderId,
              recipientName: dutySlot.dutyHolderName,
              dutyDate: dutySlot.date,
              dutyTime: `${dutySlot.startTime}-${dutySlot.endTime}`,
              success: true,
              successCount: sentCount,
              timestamp: db.serverDate(),
              schedulerExecution: true,
              miniprogramState
            }
          })

          results.push({
            dutySlotId: dutySlot.dutySlotId,
            dutyHolderName: dutySlot.dutyHolderName,
            success: true,
            message: '成功发送提醒',
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

          // 记录失败日志（success: false，下一轮还会重试）
          await db.collection('message_send_logs').add({
            data: {
              type: 'DUTY_REMINDER',
              templateId: DUTY_REMINDER_TEMPLATE_ID,
              dutySlotId: dutySlot.dutySlotId,
              recipient: dutySlot.dutyHolderId,
              recipientName: dutySlot.dutyHolderName,
              dutyDate: dutySlot.date,
              dutyTime: `${dutySlot.startTime}-${dutySlot.endTime}`,
              error: reminderResult.result ? reminderResult.result.message : '发送失败',
              success: false,
              timestamp: db.serverDate(),
              schedulerExecution: true,
              miniprogramState
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
            templateId: DUTY_REMINDER_TEMPLATE_ID,
            dutySlotId: dutySlot.dutySlotId,
            recipient: dutySlot.dutyHolderId || '',
            recipientName: dutySlot.dutyHolderName || '',
            dutyDate: dutySlot.date,
            dutyTime: `${dutySlot.startTime}-${dutySlot.endTime}`,
            error: error.message,
            success: false,
            timestamp: db.serverDate(),
            schedulerExecution: true,
            miniprogramState
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
        windowStartCst: formatCst(windowStartMs),
        windowEndCst: formatCst(windowEndMs),
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
