// 检查指定周是否存在值班数据
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 检查指定周是否已有值班数据
 * @param {Object} event 事件参数
 * @param {Number} event.weekNumber 目标周次
 * @param {Number} event.year 年份（可选，默认当前年份）
 * @param {String} openid 用户openid
 * @returns {Object} 返回检查结果
 */
exports.checkWeekExists = async (event, openid) => {
  try {
    console.log('[checkWeekExists] 开始检查周数据是否存在')
    console.log('[checkWeekExists] 参数：', { weekNumber: event.weekNumber, year: event.year })

    // 验证必要参数
    if (!event.weekNumber) {
      return {
        code: 400,
        data: null,
        message: '缺少周次参数 weekNumber'
      }
    }

    // 获取年份，默认为当前年份
    const year = event.year || new Date().getFullYear()
    const weekNumber = parseInt(event.weekNumber)

    console.log('[checkWeekExists] 检查参数：', { weekNumber, year })

    // 查询指定周的数据
    const queryResult = await db.collection('duty_slots')
      .where({
        weekNumber: weekNumber,
        year: year
      })
      .limit(1)
      .get()

    const exists = queryResult.data.length > 0

    console.log('[checkWeekExists] 检查结果：', { exists, recordCount: queryResult.data.length })

    // 如果存在，获取该周的详细统计信息
    let weekStats = null
    if (exists) {
      const statsResult = await db.collection('duty_slots')
        .where({
          weekNumber: weekNumber,
          year: year
        })
        .get()

      const totalSlots = statsResult.data.length
      const occupiedSlots = statsResult.data.filter(slot => slot.dutyHolderId && slot.dutyHolderId.trim() !== '').length
      const availableSlots = statsResult.data.filter(slot => slot.isAvailable).length

      weekStats = {
        totalSlots,
        occupiedSlots,
        availableSlots,
        occupancyRate: totalSlots > 0 ? Math.round((occupiedSlots / availableSlots) * 100) : 0
      }

      console.log('[checkWeekExists] 周统计信息：', weekStats)
    }

    return {
      code: 200,
      data: {
        exists,
        weekNumber,
        year,
        stats: weekStats
      },
      message: exists ? `第${weekNumber}周数据已存在` : `第${weekNumber}周数据不存在`
    }

  } catch (err) {
    console.error('[checkWeekExists] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '检查周数据失败'
    }
  }
} 