// 获取用户值班时间段
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取用户在指定周的值班时间段（包括预选和已确认的）
 * @param {Object} event 事件参数
 * @param {Number} event.weekNumber 周次（可选，默认为当前周）
 * @param {Number} event.year 年份（可选，默认当前年份）
 * @param {String} openid 用户openid
 * @returns {Object} 返回用户值班时间段数据
 */
exports.getUserDutySlots = async (event, openid) => {
  try {
    console.log('[getUserDutySlots] 开始获取用户值班时间段')
    console.log('[getUserDutySlots] 参数：', { weekNumber: event.weekNumber, year: event.year, openid })

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

    console.log('[getUserDutySlots] 查询参数：', { weekNumber, year, openid })

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

    // 验证用户权限
    if (!user.role || (user.role !== 'member' && user.role !== 'leader')) {
      return {
        code: 403,
        data: null,
        message: '只有维修组成员才能查看值班安排'
      }
    }

    // 查询用户在指定周的所有值班时间段（包括预选和已确认的）
    // 之前使用连续 where 的方式，第二次 where 可能覆盖第一次，导致丢失 week/year 限制，从而跨周返回。
    // 这里改为显式 AND(week, year) + OR(user) 的组合。若运行环境不支持 _.and/_.or，则退化为两次查询合并。
    const _ = db.command

    let userSlots = []
    let usedFallbackMerge = false

    try {
      // 优先使用 AND + OR 组合查询（性能更好）
      const res = await db.collection('duty_slots')
        .where(
          _.and([
            { weekNumber: weekNumber, year: year },
            _.or([{ assignedUser: openid }, { dutyHolderId: openid }])
          ])
        )
        .orderBy('sortOrder', 'asc')
        .get()

      userSlots = res.data || []
    } catch (andOrErr) {
      console.warn('[getUserDutySlots] AND/OR 组合查询不被支持，使用兼容合并策略：', andOrErr?.message)
      usedFallbackMerge = true

      const [assignedRes, holderRes] = await Promise.all([
        db.collection('duty_slots')
          .where({ weekNumber: weekNumber, year: year, assignedUser: openid })
          .orderBy('sortOrder', 'asc')
          .get(),
        db.collection('duty_slots')
          .where({ weekNumber: weekNumber, year: year, dutyHolderId: openid })
          .orderBy('sortOrder', 'asc')
          .get()
      ])

      // 合并并去重（按 dutySlotId）
      const map = new Map()
      for (const s of [...(assignedRes.data || []), ...(holderRes.data || [])]) {
        if (!map.has(s.dutySlotId)) {
          map.set(s.dutySlotId, s)
        }
      }
      userSlots = Array.from(map.values()).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    }

    console.log('[getUserDutySlots] 查询到的用户时间段数量：', userSlots.length, usedFallbackMerge ? '(fallback 合并)' : '')

    // 处理数据，区分预选和已确认的时间段
    const preSelectedSlots = []  // 预选的时间段（有assignedUser但没有dutyHolderName）
    const confirmedSlots = []    // 已确认的时间段（有assignedUser和dutyHolderName）

    userSlots.forEach(slot => {
      const slotInfo = {
        dutySlotId: slot.dutySlotId,
        date: slot.date,
        dayOfWeek: slot.dayOfWeek,
        timeSlot: slot.timeSlot,
        startTime: slot.startTime,
        endTime: slot.endTime,
        weekNumber: slot.weekNumber,
        year: slot.year,
        ew: slot.ew || 2
      }

      if (slot.dutyHolderName) {
        // 已确认的时间段
        confirmedSlots.push({
          ...slotInfo,
          dutyHolderName: slot.dutyHolderName,
          status: 'confirmed'
        })
      } else {
        // 预选的时间段
        preSelectedSlots.push({
          ...slotInfo,
          status: 'preSelected'
        })
      }
    })

    console.log('[getUserDutySlots] 处理完成，预选：', preSelectedSlots.length, '已确认：', confirmedSlots.length)

    return {
      code: 200,
      data: {
        weekNumber,
        year,
        userName: user.nickName || '未知用户',
        preSelectedSlots,
        confirmedSlots,
        totalSlots: userSlots.length,
        canSelectMore: (userSlots.length < 3), // 是否还能继续选择（每周）
        remainingSlots: Math.max(0, 3 - userSlots.length) // 还能选择的数量（每周）
      },
      message: `获取用户值班时间段成功（第${weekNumber}周），共${userSlots.length}个`
    }

  } catch (err) {
    console.error('[getUserDutySlots] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '获取用户值班时间段失败'
    }
  }
} 