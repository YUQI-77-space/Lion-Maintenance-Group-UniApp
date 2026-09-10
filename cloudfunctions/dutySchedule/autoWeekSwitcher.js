// cloudfunctions/dutySchedule/autoWeekSwitcher.js
// 自动切周：每周一 10:30（东八区）把当前值班周次切到下一周
//
// 【部署依赖】真正的“定时唤醒”配置在云开发控制台的定时触发器中，仓库内没有 config.json：
//   触发器名：autoWeekSwitcherTimer（index.js 按名字路由到本文件）
//   cron：0 30 10 ? * MON *（7 段式：秒 分 时 日 月 周 年，按东八区求值）
// 控制台的 cron 决定“函数什么时候被唤醒”，本文件决定“被唤醒后是否真的要切周”。
// 云函数运行环境是 UTC，所以这里所有东八区换算都显式用 CST_OFFSET_MS，不依赖 new Date() 的本地时区。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { switchToWeek } = require('./switchToWeek')

const CST_OFFSET_MS = 8 * 60 * 60 * 1000   // 东八区固定偏移（中国不使用夏令时）
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const SWITCH_HOUR = 10                     // 东八区周一 10:30
const SWITCH_MINUTE = 30
const EARLY_GRACE_MS = 60 * 1000           // 容忍触发器略微提前唤醒
const MIN_SWITCH_INTERVAL_MS = 6 * DAY_MS  // 幂等保护：两次自动切周至少间隔 6 天
const MAX_AUTO_SWITCH_WEEK = 20            // 当前周次达到该值后不再自动往后切

/**
 * 把 YYYY-MM-DD 解析为“东八区当天 00:00”的绝对毫秒时间戳
 * @param {String} dateStr YYYY-MM-DD
 * @returns {Number} 毫秒时间戳，格式非法时为 NaN
 */
function parseCstDayStart(dateStr) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim())
  if (!matched) return NaN
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  return Date.UTC(year, month - 1, day) - CST_OFFSET_MS
}

/**
 * 把绝对毫秒时间戳格式化为东八区 'YYYY-MM-DD HH:mm:ss'（仅用于日志与返回值）
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
 * 把数据库里的时间字段读成毫秒时间戳（兼容 Date / 字符串 / 数字）
 * @param {*} value 数据库字段值
 * @returns {Number} 毫秒时间戳，无法解析时为 NaN
 */
function toMillis(value) {
  if (!value) return NaN
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? NaN : parsed
}

/**
 * 计算第 weekNumber 周的周一 00:00（东八区）的毫秒时间戳
 * startDate 必须是周一，按整周递推不会偏离周一
 * @param {Number} semesterStartMs 学期开始日（东八区周一 00:00）的毫秒时间戳
 * @param {Number} weekNumber 周次
 * @returns {Number}
 */
function getWeekStartMs(semesterStartMs, weekNumber) {
  return semesterStartMs + (weekNumber - 1) * WEEK_MS
}

exports.main = async (event, context) => {
  const nowMs = Date.now() // 绝对时间，与时区无关

  try {
    const configSnap = await db.collection('duty_config').doc('global').get()
    const config = configSnap.data
    if (!config) {
      console.log('[autoWeekSwitcher] duty_config.global 不存在，跳过')
      return { success: false, message: '配置不存在' }
    }

    const { startDate, currentWeek, currentYear, autoSwitchEnabled } = config

    if (!startDate || !currentWeek) {
      console.log('[autoWeekSwitcher] startDate 或 currentWeek 未设置，跳过')
      return { success: false, message: 'startDate 或 currentWeek 未设置' }
    }

    // 默认开启（只有显式写入 false 才算关闭）
    if (autoSwitchEnabled === false) {
      console.log('[autoWeekSwitcher] 自动切周已关闭，跳过')
      return { success: true, message: '自动切周关闭' }
    }

    const weekNumber = Number(currentWeek)
    if (weekNumber >= MAX_AUTO_SWITCH_WEEK) {
      console.log('[autoWeekSwitcher] 当前周已达到或超过上限，不再自动切换', { weekNumber })
      return { success: true, message: '超过最大自动切周周次' }
    }

    const semesterStartMs = parseCstDayStart(startDate)
    if (Number.isNaN(semesterStartMs)) {
      console.log('[autoWeekSwitcher] startDate 格式非法，跳过', { startDate })
      return { success: false, message: `学期开始日期格式非法：${startDate}` }
    }

    // 本周计划切换时刻 = 本周周一 00:00（东八区） + 10:30
    const scheduledMs = getWeekStartMs(semesterStartMs, weekNumber) + (SWITCH_HOUR * 60 + SWITCH_MINUTE) * 60 * 1000

    console.log('[autoWeekSwitcher] 东八区时间核对', {
      本次触发: formatCst(nowMs),
      本周计划切换: formatCst(scheduledMs),
      当前周次: weekNumber,
      startDate
    })

    // 幂等保护一：距上次自动切周不足 6 天，说明本周已经切过，跳过
    const lastSwitchMs = toMillis(config.lastAutoSwitchAt)
    if (Number.isFinite(lastSwitchMs) && nowMs - lastSwitchMs < MIN_SWITCH_INTERVAL_MS) {
      console.log('[autoWeekSwitcher] 距上次自动切周不足6天，跳过', {
        上次自动切周: formatCst(lastSwitchMs)
      })
      return { success: true, message: '距上次自动切周不足6天，跳过' }
    }

    // 幂等保护二：本周计划时刻（含少量提前容忍）之前不切
    // 只设下界、不设上界：如果系统因为故障落后了好几周，也应该在下一个周一照常往后补切一周，
    // 不能因为“计划时刻早就过了”而被永久挡住。
    // 同一周内不会重复切：切周后 currentWeek 前进一周，计划时刻自动跳到下周一，把后续触发挡在下界之外。
    if (nowMs < scheduledMs - EARLY_GRACE_MS) {
      console.log('[autoWeekSwitcher] 尚未到达本周计划切换时间，跳过', {
        本次触发: formatCst(nowMs),
        本周计划切换: formatCst(scheduledMs)
      })
      return { success: true, message: '尚未到达计划切换时间' }
    }

    const nextWeek = weekNumber + 1
    const year = Number(currentYear) || new Date(nowMs + CST_OFFSET_MS).getUTCFullYear()
    console.log('[autoWeekSwitcher] 开始自动切换周次', {
      from: weekNumber,
      to: nextWeek,
      year,
      触发时刻: formatCst(nowMs)
    })

    const switchResult = await switchToWeek(
      { weekNumber: nextWeek, year },
      'AUTO_SWITCH_SYSTEM'
    )

    if (switchResult.code !== 200) {
      console.error('[autoWeekSwitcher] switchToWeek 失败', switchResult)
      return { success: false, message: switchResult.message || 'switchToWeek 失败' }
    }

    await db.collection('duty_config').doc('global').update({
      data: {
        // 仅用于排查“最近一次自动切到了第几周”。
        // 注意：切周会同时把 currentWeek 改成同一个值，所以它和 currentWeek 恒等，
        // 不能拿它做去重判断（历史上正是这样写的，导致切过一次后永久跳过）。
        lastAutoSwitchWeek: nextWeek,
        lastAutoSwitchAt: db.serverDate(),
        updateTime: new Date()
      }
    })

    console.log('[autoWeekSwitcher] 自动切周成功', {
      fromWeek: weekNumber,
      toWeek: nextWeek,
      触发时刻: formatCst(nowMs)
    })

    return {
      success: true,
      message: `自动切换到第${nextWeek}周成功`,
      data: {
        fromWeek: weekNumber,
        toWeek: nextWeek,
        firedAtCst: formatCst(nowMs),
        scheduledAtCst: formatCst(scheduledMs),
        switchResult
      }
    }
  } catch (err) {
    console.error('[autoWeekSwitcher] 执行失败', err)
    return {
      success: false,
      message: err.message || '自动切周失败'
    }
  }
}
