// cloudfunctions/dutySchedule/autoWeekSwitcher.js
// 按配置自动切换当前值班周次（需在云控制台配置定时触发器）

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { switchToWeek } = require('./switchToWeek')

/**
 * 获取东八区当前时间
 */
function getChinaNow() {
  const now = new Date()
  // 将本地时间转换为中国标准时间
  return new Date(now.getTime() + (8 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
}

/**
 * 根据配置计算本周应当自动切周的时间
 * @param {String} startDate 学期开始日期 YYYY-MM-DD（周一）
 * @param {Number} currentWeek 当前周次
 * @param {Number} autoSwitchDayOfWeek 0-6（周日~周六）
 * @param {String} autoSwitchTime 'HH:MM'
 */
function getScheduledSwitchDateTime(startDate, currentWeek, autoSwitchDayOfWeek, autoSwitchTime) {
  const semesterStart = new Date(`${startDate}T00:00:00+08:00`)
  if (Number.isNaN(semesterStart.getTime())) return null

  const weekStart = new Date(semesterStart)
  weekStart.setDate(semesterStart.getDate() + (currentWeek - 1) * 7) // 当前周的周一

  const [hourStr, minuteStr] = (autoSwitchTime || '22:00').split(':')
  const hour = parseInt(hourStr, 10) || 22
  const minute = parseInt(minuteStr, 10) || 0

  // startDate 是周一(day=1)，希望在配置的星期触发：
  // 目标偏移天数：周日(0) 比周一少一天 → +6；其它按顺序递增
  const offsetDays = ((autoSwitchDayOfWeek ?? 0) + 6) % 7
  const target = new Date(weekStart)
  target.setDate(weekStart.getDate() + offsetDays)
  target.setHours(hour, minute, 0, 0)
  return target
}

exports.main = async (event, context) => {
  const now = getChinaNow()

  try {
    const configSnap = await db.collection('duty_config').doc('global').get()
    const config = configSnap.data
    if (!config) {
      console.log('[autoWeekSwitcher] duty_config.global 不存在，跳过')
      return { success: false, message: '配置不存在' }
    }

    const {
      startDate,
      currentWeek,
      currentYear,
      autoSwitchEnabled,
      autoSwitchDayOfWeek,
      autoSwitchTime,
      lastAutoSwitchWeek
    } = config

    if (!startDate || !currentWeek) {
      console.log('[autoWeekSwitcher] startDate 或 currentWeek 未设置，跳过')
      return { success: false, message: 'startDate 或 currentWeek 未设置' }
    }

    // 默认开启、每周日 22:00
    const enabled = autoSwitchEnabled !== false
    const dayOfWeek = typeof autoSwitchDayOfWeek === 'number' ? autoSwitchDayOfWeek : 1 // 默认每周一
    const timeStr = autoSwitchTime || '10:30' // 默认周一上午10:30

    if (!enabled) {
      console.log('[autoWeekSwitcher] 自动切周已关闭，跳过')
      return { success: true, message: '自动切周关闭' }
    }

    // 已经自动切过当前周，避免重复
    if (lastAutoSwitchWeek === currentWeek) {
      console.log('[autoWeekSwitcher] 本周已自动切过，跳过', { currentWeek })
      return { success: true, message: '本周已自动切过' }
    }

    // 简单保护：当前周超过20周则不再自动向后切
    if (currentWeek >= 20) {
      console.log('[autoWeekSwitcher] 当前周已达到或超过20周，不再自动切换', { currentWeek })
      return { success: true, message: '超过最大自动切周周次' }
    }

    const scheduledAt = getScheduledSwitchDateTime(startDate, currentWeek, dayOfWeek, timeStr)
    if (!scheduledAt) {
      console.log('[autoWeekSwitcher] 计算计划切换时间失败，跳过')
      return { success: false, message: '计划切换时间计算失败' }
    }

    console.log('[autoWeekSwitcher] 当前时间与计划时间：', {
      now: now.toISOString(),
      scheduledAt: scheduledAt.toISOString(),
      currentWeek
    })

    if (now < scheduledAt) {
      console.log('[autoWeekSwitcher] 尚未到达计划切换时间，跳过')
      return { success: true, message: '尚未到达计划切换时间' }
    }

    const nextWeek = currentWeek + 1
    const year = currentYear || now.getFullYear()
    console.log('[autoWeekSwitcher] 开始自动切换周次', { from: currentWeek, to: nextWeek, year })

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
        lastAutoSwitchWeek: nextWeek,
        lastAutoSwitchAt: db.serverDate(),
        updateTime: new Date()
      }
    })

    console.log('[autoWeekSwitcher] 自动切周成功', {
      fromWeek: currentWeek,
      toWeek: nextWeek
    })

    return {
      success: true,
      message: `自动切换到第${nextWeek}周成功`,
      data: {
        fromWeek: currentWeek,
        toWeek: nextWeek,
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


