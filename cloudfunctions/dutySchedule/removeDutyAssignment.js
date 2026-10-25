// 组长删除值班分配
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { batchRemoveDutyEW } = require('./dutyEWManager')

/**
 * 组长删除值班分配（可删除预选和已确认的值班分配）
 * @param {Object} event 事件参数
 * @param {Array} event.selectedSlots 要删除的时间段ID数组
 * @param {String} [event.requestId] 可选幂等键
 * @param {String} openid 操作人openid（必须是组长）
 * @returns {Object} 返回删除结果
 */
exports.removeDutyAssignment = async (event, openid) => {
  try {
    console.log('[removeDutyAssignment] 开始删除值班分配')
    console.log('[removeDutyAssignment] 参数：', { selectedSlots: event.selectedSlots, openid, requestId: event.requestId })

    // 参数验证
    if (!event.selectedSlots || !Array.isArray(event.selectedSlots) || event.selectedSlots.length === 0) {
      return {
        code: 400,
        data: null,
        message: '请提供要删除的时间段数组'
      }
    }

    // 幂等集合移除：不再做集合读取/写入，避免外部依赖

    // 获取操作人信息
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

    // 验证操作人权限 - 只有组长可以执行删除操作
    if (!user.role || user.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长才能删除值班分配'
      }
    }

    // 获取配置数据
    const configResult = await db.collection('duty_config').doc('global').get()
    if (!configResult.data) {
      return {
        code: 404,
        data: null,
        message: '值班配置不存在，请先初始化系统'
      }
    }

    const config = configResult.data

    // 查找要删除的时间段：兼容仅有 _id 而没有 dutySlotId 的旧数据
    const _ = db.command
    const slotsResult = await db.collection('duty_slots')
      .where(_.or([
        { dutySlotId: _.in(event.selectedSlots) },
        { _id: _.in(event.selectedSlots) }
      ]))
      .get()

    console.log('[removeDutyAssignment] 查询到的时间段：', slotsResult.data.length)

    if (slotsResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '没有找到指定的时间段'
      }
    }

    if (slotsResult.data.length !== event.selectedSlots.length) {
      return {
        code: 404,
        data: null,
        message: '部分时间段不存在'
      }
    }

    // 筛选出有分配的时间段（有assignedUser或dutyHolderId的）
    const assignedSlots = slotsResult.data.filter(slot => 
      slot.assignedUser || slot.dutyHolderId || 
      (slot.dutyHolderName && slot.dutyHolderName !== '')
    )

    if (assignedSlots.length === 0) {
      return {
        code: 400,
        data: null,
        message: '选中的时间段中没有已分配的值班'
      }
    }

    console.log('[removeDutyAssignment] 可删除的已分配时间段：', assignedSlots.length)

    // 统计预选和已确认的时间段
    const preSelectedSlots = assignedSlots.filter(slot => !slot.dutyHolderName || slot.dutyHolderName === '')
    const confirmedSlots = assignedSlots.filter(slot => slot.dutyHolderName && slot.dutyHolderName !== '')

    console.log('[removeDutyAssignment] 预选时间段：', preSelectedSlots.length, '已确认时间段：', confirmedSlots.length)

    // 开始删除流程
    const deletedSlots = []
    const affectedUsers = new Set() // 记录受影响的用户，用于删除待办事项

    for (const slot of assignedSlots) {
      try {
        // 记录受影响的用户
        if (slot.assignedUser) {
          affectedUsers.add(slot.assignedUser)
        }
        if (slot.dutyHolderId) {
          affectedUsers.add(slot.dutyHolderId)
        }

        // 1. 清除duty_slots表中的分配信息
        const updateData = {
          assignedUser: null,
          dutyHolderId: null,
          dutyHolderName: null,
          updateTime: new Date()
        }
        const docId = slot.dutySlotId || slot._id
        await db.collection('duty_slots').doc(docId).update({
          data: updateData
        })
        
        console.log('[removeDutyAssignment] 清除时间段成功：', docId)
        
        deletedSlots.push({
          dutySlotId: docId,
          date: slot.date,
          dayOfWeek: slot.dayOfWeek,
          timeSlot: slot.timeSlot,
          startTime: slot.startTime,
          endTime: slot.endTime,
          weekNumber: slot.weekNumber,
          year: slot.year,
          wasConfirmed: !!(slot.dutyHolderName && slot.dutyHolderName !== ''),
          dutyStatus: slot.dutyStatus,
          originalAssignedUser: slot.assignedUser || slot.dutyHolderId,
          originalAssignedName: slot.dutyHolderName || '预选状态'
        })
        
      } catch (updateErr) {
        console.error('[removeDutyAssignment] 清除时间段失败：', slot.dutySlotId || slot._id, updateErr)
        throw new Error(`清除时间段 ${slot.dutySlotId || slot._id} 失败: ${updateErr.message}`)
      }
    }

    // 2. 删除受影响用户的相关待办事项
    let deletedTodoCount = 0
    for (const userId of affectedUsers) {
      try {
        const idsToRemove = assignedSlots.map(slot => slot.dutySlotId || slot._id)
        const todoResult = await db.collection('duty_toDo_list')
          .where({
            toDoListUserId: userId,
            dutySlotId: _.in(idsToRemove)
          })
          .get()

        if (todoResult.data.length > 0) {
          for (const todo of todoResult.data) {
            try {
              await db.collection('duty_toDo_list').doc(todo._id).remove()
              deletedTodoCount++
              console.log('[removeDutyAssignment] 删除待办事项成功：', todo.dutySlotId, '用户：', userId)
            } catch (removeErr) {
              console.error('[removeDutyAssignment] 删除待办事项失败：', todo.dutySlotId, removeErr)
              // 待办事项删除失败不影响主流程
            }
          }
        }
      } catch (todoErr) {
        console.error('[removeDutyAssignment] 查询用户待办失败：', userId, todoErr)
        // 不影响主流程
      }
    }

    // 3. 从用户的等效工作量中扣除值班EW（只处理已确认的时间段）
    const confirmedDeletedSlots = deletedSlots.filter(slot => slot.wasConfirmed)
    if (confirmedDeletedSlots.length > 0) {
      console.log('[removeDutyAssignment] 开始扣除值班EW，已确认时间段数量:', confirmedDeletedSlots.length)
      const ewResult = await batchRemoveDutyEW(confirmedDeletedSlots)
      
      if (ewResult.success) {
        console.log('[removeDutyAssignment] 值班EW批量扣除成功:', ewResult)
      } else {
        console.error('[removeDutyAssignment] 值班EW批量扣除失败:', ewResult.message)
        // EW扣除失败不影响主流程，但需要记录日志
      }
    }

    console.log('[removeDutyAssignment] 删除完成，删除时间段数：', deletedSlots.length, '删除待办数：', deletedTodoCount)

    const resultPayload = {
      code: 200,
      data: {
        deletedSlots: deletedSlots,
        totalDeleted: deletedSlots.length,
        confirmedDeleted: confirmedSlots.length,
        preSelectedDeleted: preSelectedSlots.length,
        deletedTodoCount: deletedTodoCount,
        affectedUsersCount: affectedUsers.size,
        weekNumber: deletedSlots[0]?.weekNumber,
        year: deletedSlots[0]?.year
      },
      message: `成功删除${deletedSlots.length}个值班分配（包括${confirmedSlots.length}个已确认、${preSelectedSlots.length}个预选）`
    }

    return resultPayload

  } catch (err) {
    console.error('[removeDutyAssignment] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '删除值班分配失败'
    }
  }
}
