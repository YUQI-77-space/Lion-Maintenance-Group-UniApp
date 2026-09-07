// 预选值班时间段
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { lockManager } = require('./lockManager')

/**
 * 预选值班时间段（暂存到用户的预选列表中）
 * @param {Object} event 事件参数
 * @param {Array} event.selectedSlots 选中的时间段ID数组
 * @param {String} openid 用户openid
 * @returns {Object} 返回预选结果
 */
exports.selectDutySlots = async (event, openid) => {
  try {
    console.log('[selectDutySlots] 开始预选值班时间段')
    console.log('[selectDutySlots] 参数：', { selectedSlots: event.selectedSlots, openid })

    // 参数验证
    if (!event.selectedSlots || !Array.isArray(event.selectedSlots)) {
      return {
        code: 400,
        data: null,
        message: '请提供有效的选择时间段数组'
      }
    }

    // 限制最多选择3个时间段
    if (event.selectedSlots.length > 3) {
      return {
        code: 400,
        data: null,
        message: '每周最多只能选择3个值班时间段'
      }
    }

    // 获取用户信息（验证身份并获取真实姓名）
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
    
    // 验证用户是否有权限选择值班（必须是member或leader）
    if (!user.role || (user.role !== 'member' && user.role !== 'leader')) {
      return {
        code: 403,
        data: null,
        message: '只有维修组成员才能选择值班'
      }
    }

    // 获取配置数据，检查编辑权限
    const configResult = await db.collection('duty_config').doc('global').get()
    if (!configResult.data) {
      return {
        code: 404,
        data: null,
        message: '值班配置不存在，请先初始化系统'
      }
    }

    const config = configResult.data

    // 检查编辑权限是否开启
    if (!config.isEditingEnabled) {
      return {
        code: 403,
        data: null,
        message: '当前周编辑权限已关闭，无法预选值班时间段'
      }
    }

    // 验证所选时间段是否存在且可选
    const slotsResult = await db.collection('duty_slots')
      .where({
        dutySlotId: db.command.in(event.selectedSlots)
      })
      .get()

    if (slotsResult.data.length !== event.selectedSlots.length) {
      return {
        code: 404,
        data: null,
        message: '部分选择的时间段不存在'
      }
    }

    // 验证时间段是否可选
    for (const slot of slotsResult.data) {
      if (!slot.isAvailable) {
        return {
          code: 400,
          data: null,
          message: `${slot.date} ${slot.timeSlot} ${slot.startTime}-${slot.endTime} 不可选择值班`
        }
      }
      
      // 检查是否已被其他用户选择（兼容两种字段）
      if ((slot.assignedUser && slot.assignedUser !== openid) || 
          (slot.dutyHolderId && slot.dutyHolderId !== openid)) {
        return {
          code: 400,
          data: null,
          message: `${slot.date} ${slot.timeSlot} ${slot.startTime}-${slot.endTime} 已被其他人选择`
        }
      }

      // 检查锁状态 - 如果被其他用户锁定，不能选择
      if (slot.lockStatus === 'locked' && slot.lockUserId !== openid) {
        // 检查锁是否过期
        const isExpired = slot.lockExpireTime && new Date() > new Date(slot.lockExpireTime)
        if (!isExpired) {
          return {
            code: 400,
            data: null,
            message: `${slot.date} ${slot.timeSlot} ${slot.startTime}-${slot.endTime} 正在被其他用户操作，请稍后再试`
          }
        }
      }
    }

    // 检查是否为同一周的时间段
    const weekNumbers = [...new Set(slotsResult.data.map(slot => slot.weekNumber))]
    if (weekNumbers.length > 1) {
      return {
        code: 400,
        data: null,
        message: '不能同时选择不同周的值班时间段'
      }
    }

    const currentWeek = weekNumbers[0]
    const currentYear = slotsResult.data[0].year

    // 检查该用户在该周是否已经选择了其他时间段（包括已确认的），使用复合查询确保兼容性
    const userExistingSlotsResult = await db.collection('duty_slots')
      .where({
        weekNumber: currentWeek,
        year: currentYear
      })
      .where(db.command.or([
        { assignedUser: openid },
        { dutyHolderId: openid }
      ]))
      .get()

    // 计算总选择数量（现有的 + 新选择的，排除重复的）
    const existingSlotIds = userExistingSlotsResult.data.map(slot => slot.dutySlotId)
    const newSlotIds = event.selectedSlots.filter(id => !existingSlotIds.includes(id))
    const totalSlots = existingSlotIds.length + newSlotIds.length

    if (totalSlots > 3) {
      return {
        code: 400,
        data: null,
        message: `该周您已选择了${existingSlotIds.length}个时间段，最多只能再选择${3 - existingSlotIds.length}个`
      }
    }

    // 第一步：尝试获取悲观锁
    console.log('[selectDutySlots] 尝试获取时间段锁...')
    const lockResult = await lockManager.acquireLocks(event.selectedSlots, openid)
    
    if (!lockResult.success) {
      // 如果有部分锁获取失败，需要释放已获取的锁
      if (lockResult.lockedSlots.length > 0) {
        console.log('[selectDutySlots] 部分锁获取失败，释放已获取的锁')
        await lockManager.releaseLocks(lockResult.lockedSlots, openid)
      }
      
      return {
        code: 400,
        data: null,
        message: lockResult.failedSlots.length > 0 ? 
          `无法选择时间段：${lockResult.failedSlots[0].reason}` : 
          lockResult.message
      }
    }

    console.log('[selectDutySlots] 成功获取所有时间段锁')

    try {
      // 第二步：在锁保护下进行预选操作
      const batch = db.batch()
      
      for (const slotId of event.selectedSlots) {
        const updateData = {
          assignedUser: openid,
          dutyHolderId: openid,  // 兼容字段，保证数据一致性
          updateTime: new Date()
        }
        
        batch.update(db.collection('duty_slots').doc(slotId), updateData)
      }

      await batch.commit()
      console.log('[selectDutySlots] 预选数据更新完成')

      // 预选成功后，锁将在确认或取消时释放，这里不释放锁
      console.log('[selectDutySlots] 保持锁定状态，等待用户确认或取消')

    } catch (updateError) {
      console.error('[selectDutySlots] 预选数据更新失败：', updateError)
      
      // 数据更新失败，释放锁
      await lockManager.releaseLocks(event.selectedSlots, openid)
      
      throw new Error(`预选数据更新失败：${updateError.message}`)
    }

    console.log('[selectDutySlots] 预选完成，slotIds:', event.selectedSlots)

    // 返回预选的时间段详情
    const selectedSlotsDetails = slotsResult.data.map(slot => ({
      dutySlotId: slot.dutySlotId,
      date: slot.date,
      dayOfWeek: slot.dayOfWeek,
      timeSlot: slot.timeSlot,
      startTime: slot.startTime,
      endTime: slot.endTime,
      weekNumber: slot.weekNumber,
      year: slot.year
    }))

    return {
      code: 200,
      data: {
        selectedSlots: selectedSlotsDetails,
        totalSelected: event.selectedSlots.length,
        weekNumber: currentWeek,
        year: currentYear,
        userName: user.nickName || '未知用户'
      },
      message: `成功预选${event.selectedSlots.length}个值班时间段`
    }

  } catch (err) {
    console.error('[selectDutySlots] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '预选值班时间段失败'
    }
  }
} 