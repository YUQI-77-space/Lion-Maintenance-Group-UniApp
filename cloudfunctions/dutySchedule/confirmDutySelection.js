// 确认值班选择
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { addDutyEW } = require('./dutyEWManager')
const { lockManager } = require('./lockManager')

/**
 * 确认值班选择（将预选的时间段正式确认）
 * @param {Object} event 事件参数
 * @param {Array} event.selectedSlots 确认的时间段ID数组（可选，如果不传则确认该用户所有预选的时间段）
 * @param {String} openid 用户openid
 * @returns {Object} 返回确认结果
 */
exports.confirmDutySelection = async (event, openid) => {
  try {
    console.log('[confirmDutySelection] 开始确认值班选择')
    console.log('[confirmDutySelection] 参数：', { selectedSlots: event.selectedSlots, openid })

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
        message: '只有维修组成员才能确认值班选择'
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
        message: '当前周编辑权限已关闭，无法确认值班选择'
      }
    }

    // 如果没有传入selectedSlots，则查找该用户所有预选的时间段
    let slotsToConfirm
    
    if (event.selectedSlots && Array.isArray(event.selectedSlots) && event.selectedSlots.length > 0) {
      // 确认指定的时间段，先按 ID 查询所有匹配的记录
      console.log('[confirmDutySelection] 查询指定时间段:', event.selectedSlots)
      
      const allSlotsResult = await db.collection('duty_slots')
        .where({
          dutySlotId: db.command.in(event.selectedSlots)
        })
        .get()
      
      console.log('[confirmDutySelection] 找到匹配ID的记录数量:', allSlotsResult.data.length)
      console.log('[confirmDutySelection] 匹配的记录详情:', allSlotsResult.data.map(slot => ({
        dutySlotId: slot.dutySlotId,
        dutyHolderId: slot.dutyHolderId,
        dutyHolderName: slot.dutyHolderName,
        assignedUser: slot.assignedUser,
        isAvailable: slot.isAvailable
      })))
      
      if (allSlotsResult.data.length !== event.selectedSlots.length) {
        return {
          code: 404,
          data: null,
          message: '部分选择的时间段不存在'
        }
      }
      
      // 筛选出属于当前用户且处于预选状态的记录，或者可用且未被占用的记录
      // 预选状态的判断：dutyHolderName 为空且记录可用
      slotsToConfirm = allSlotsResult.data.filter(slot => {
        const belongsToUser = (slot.assignedUser === openid) || 
                             (slot.dutyHolderId === openid)
        const isAvailableAndEmpty = slot.isAvailable && (!slot.dutyHolderName || slot.dutyHolderName === '')
        const isPreSelected = !slot.dutyHolderName || slot.dutyHolderName === ''
        
        console.log('[confirmDutySelection] 检查记录:', {
          dutySlotId: slot.dutySlotId,
          belongsToUser,
          isAvailableAndEmpty,
          isPreSelected,
          assignedUser: slot.assignedUser,
          dutyHolderId: slot.dutyHolderId,
          dutyHolderName: slot.dutyHolderName,
          isAvailable: slot.isAvailable
        })
        
        // 如果记录属于用户且是预选状态，或者记录可用且未被占用，都允许确认
        return (belongsToUser && isPreSelected) || isAvailableAndEmpty
      })
      
      console.log('[confirmDutySelection] 筛选后可确认的记录数量:', slotsToConfirm.length)
      
      if (slotsToConfirm.length !== event.selectedSlots.length) {
        return {
          code: 404,
          data: null,
          message: '部分选择的时间段不存在或不属于您'
        }
      }
      
    } else {
      // 确认该用户所有预选的时间段
      console.log('[confirmDutySelection] 查询用户所有预选时间段')
      
      const slotsResult = await db.collection('duty_slots')
        .where({
          dutyHolderName: db.command.or([
            db.command.eq(''),
            db.command.exists(false)
          ])
        })
        .where(db.command.or([
          { assignedUser: openid },
          { dutyHolderId: openid }
        ]))
        .get()
      
      console.log('[confirmDutySelection] 找到预选记录数量:', slotsResult.data.length)
      
      if (slotsResult.data.length === 0) {
        return {
          code: 404,
          data: null,
          message: '没有待确认的预选时间段'
        }
      }
      
      slotsToConfirm = slotsResult.data
    }

    // 验证时间段状态
    for (const slot of slotsToConfirm) {
      if (!slot.isAvailable) {
        return {
          code: 400,
          data: null,
          message: `${slot.date} ${slot.timeSlot} ${slot.startTime}-${slot.endTime} 已不可选择`
        }
      }
    }

    const userName = user.nickName || '未知用户'
    
    // 开始确认流程 - 改为单个操作避免batch API问题
    console.log('[confirmDutySelection] 开始确认流程，总共', slotsToConfirm.length, '个时间段')
    
    // 1. 逐一更新duty_slots表，设置dutyHolderName
    for (const slot of slotsToConfirm) {
      const updateData = {
        assignedUser: openid,     // 确保设置
        dutyHolderId: openid,     // 兼容字段，确保设置
        dutyHolderName: userName,
        dutyStatus: 'pending',    // 新增：设置初始状态为待值班
        updateTime: new Date()
      }
      
      console.log('[confirmDutySelection] 更新记录:', slot.dutySlotId, updateData)
      
      try {
        await db.collection('duty_slots').doc(slot.dutySlotId).update({
          data: updateData
        })
        console.log('[confirmDutySelection] 更新成功:', slot.dutySlotId)
      } catch (updateErr) {
        console.error('[confirmDutySelection] 更新失败:', slot.dutySlotId, updateErr)
        throw new Error(`更新时间段 ${slot.dutySlotId} 失败: ${updateErr.message}`)
      }
    }

    // 2. 逐一添加到用户待办事项
    for (const slot of slotsToConfirm) {
      const todoData = {
        toDoListUserId: openid,
        taskId: slot.dutySlotId,
        dutySlotId: slot.dutySlotId,
        title: `值班任务：${slot.date} ${slot.timeSlot}`,
        date: slot.date,
        weekNumber: slot.weekNumber,
        dayOfWeek: slot.dayOfWeek,
        timeSlot: slot.timeSlot,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: 'pending',
        createTime: new Date(),
        updateTime: new Date()
      }
      
      try {
        await db.collection('duty_toDo_list').add({
          data: todoData
        })
        console.log('[confirmDutySelection] 添加待办成功:', slot.dutySlotId)
      } catch (todoErr) {
        console.error('[confirmDutySelection] 添加待办失败:', slot.dutySlotId, todoErr)
        // 待办事项添加失败不影响主流程，只记录错误
      }
    }

    console.log('[confirmDutySelection] 确认完成，slotIds:', slotsToConfirm.map(s => s.dutySlotId))

    // 3. 释放时间段锁（确认后不再需要锁保护）
    const slotIdsToRelease = slotsToConfirm.map(slot => slot.dutySlotId)
    if (slotIdsToRelease.length > 0) {
      console.log('[confirmDutySelection] 开始释放时间段锁：', slotIdsToRelease)
      const lockReleaseResult = await lockManager.releaseLocks(slotIdsToRelease, openid)
      
      if (lockReleaseResult.success) {
        console.log('[confirmDutySelection] 锁释放成功：', lockReleaseResult.releasedSlots)
      } else {
        console.error('[confirmDutySelection] 锁释放失败：', lockReleaseResult.message)
        // 锁释放失败不影响主流程，但需要记录日志
      }
    }

    // 4. 注释掉立即添加EW的逻辑 - EW应该在值班任务结束时添加，而不是确认时添加
    // console.log('[confirmDutySelection] 开始添加值班EW')
    // const ewResult = await addDutyEW(openid, slotsToConfirm.length)
    // 
    // if (ewResult.success) {
    //   console.log('[confirmDutySelection] 值班EW添加成功:', ewResult)
    // } else {
    //   console.error('[confirmDutySelection] 值班EW添加失败:', ewResult.message)
    //   // EW添加失败不影响主流程，但需要记录日志
    // }
    console.log('[confirmDutySelection] 值班确认完成，EW将在任务结束时自动计算')



    // 返回确认的时间段详情
    const confirmedSlotsDetails = slotsToConfirm.map(slot => ({
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
        confirmedSlots: confirmedSlotsDetails,
        totalConfirmed: slotsToConfirm.length,
        weekNumber: slotsToConfirm[0]?.weekNumber,
        year: slotsToConfirm[0]?.year,
        userName: userName
      },
      message: `成功确认${slotsToConfirm.length}个值班时间段`
    }

  } catch (err) {
    console.error('[confirmDutySelection] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '确认值班选择失败'
    }
  }
} 