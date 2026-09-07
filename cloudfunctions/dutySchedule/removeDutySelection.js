// 取消值班选择
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { removeDutyEW } = require('./dutyEWManager')
const { lockManager } = require('./lockManager')

/**
 * 取消值班选择（只能取消预选状态的时间段，已确认的时间段不能取消）
 * @param {Object} event 事件参数
 * @param {Array} event.selectedSlots 要取消的时间段ID数组
 * @param {String} openid 用户openid
 * @returns {Object} 返回取消结果
 */
exports.removeDutySelection = async (event, openid) => {
  try {
    console.log('[removeDutySelection] 开始取消值班选择')
    console.log('[removeDutySelection] 参数：', { selectedSlots: event.selectedSlots, openid })

    // 参数验证
    if (!event.selectedSlots || !Array.isArray(event.selectedSlots) || event.selectedSlots.length === 0) {
      return {
        code: 400,
        data: null,
        message: '请提供要取消的时间段数组'
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

    // 验证用户权限
    if (!user.role || (user.role !== 'member' && user.role !== 'leader')) {
      return {
        code: 403,
        data: null,
        message: '只有维修组成员才能取消值班选择'
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
        message: '当前周编辑权限已关闭，无法取消值班选择'
      }
    }

    // 查找要取消的时间段，使用复合查询确保兼容性
    const slotsResult = await db.collection('duty_slots')
      .where({
        dutySlotId: db.command.in(event.selectedSlots)
      })
      .where(db.command.or([
        { assignedUser: openid },
        { dutyHolderId: openid }
      ]))
      .get()

    console.log('[removeDutySelection] 查询到的时间段：', slotsResult.data.length)

    if (slotsResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '没有找到属于您的选择时间段'
      }
    }

    if (slotsResult.data.length !== event.selectedSlots.length) {
      return {
        code: 404,
        data: null,
        message: '部分时间段不存在或不属于您'
      }
    }

    // 检查是否有已确认的时间段（已确认的时间段不能被普通用户取消）
    const confirmedSlots = slotsResult.data.filter(slot => slot.dutyHolderName && slot.dutyHolderName !== '')
    
    if (confirmedSlots.length > 0) {
      console.log('[removeDutySelection] 发现已确认的时间段：', confirmedSlots.map(s => s.dutySlotId))
      
      // 只有组长可以取消已确认的时间段
      if (user.role !== 'leader') {
        return {
          code: 403,
          data: null,
          message: '已确认的值班时间段不能自行取消，如有特殊情况请联系组长处理'
        }
      }
    }

    // 只处理预选状态的时间段（dutyHolderName为空的）
    const preSelectedSlots = slotsResult.data.filter(slot => !slot.dutyHolderName || slot.dutyHolderName === '')
    
    if (preSelectedSlots.length === 0) {
      return {
        code: 400,
        data: null,
        message: '没有可取消的预选时间段'
      }
    }

    console.log('[removeDutySelection] 可取消的预选时间段：', preSelectedSlots.length)

    // 开始取消流程 - 改为单个操作避免batch API问题
    const cancelledSlots = []
    const slotIdsToRelease = []
    
    for (const slot of preSelectedSlots) {
      try {
        // 1. 清除duty_slots表中的分配信息
        const updateData = {
          assignedUser: null,
          dutyHolderId: null,  // 兼容字段，同时清除
          dutyHolderName: null,
          updateTime: new Date()
        }
        
        await db.collection('duty_slots').doc(slot.dutySlotId).update({
          data: updateData
        })
        
        console.log('[removeDutySelection] 清除时间段成功：', slot.dutySlotId)
        
        cancelledSlots.push({
          dutySlotId: slot.dutySlotId,
          date: slot.date,
          dayOfWeek: slot.dayOfWeek,
          timeSlot: slot.timeSlot,
          startTime: slot.startTime,
          endTime: slot.endTime,
          weekNumber: slot.weekNumber,
          year: slot.year,
          wasConfirmed: false // 只处理预选状态，所以都是false
        })
        
        // 收集需要释放锁的时间段ID
        slotIdsToRelease.push(slot.dutySlotId)
        
      } catch (updateErr) {
        console.error('[removeDutySelection] 清除时间段失败：', slot.dutySlotId, updateErr)
        throw new Error(`清除时间段 ${slot.dutySlotId} 失败: ${updateErr.message}`)
      }
    }

    // 2. 释放对应时间段的锁
    if (slotIdsToRelease.length > 0) {
      console.log('[removeDutySelection] 开始释放时间段锁：', slotIdsToRelease)
      const lockReleaseResult = await lockManager.releaseLocks(slotIdsToRelease, openid)
      
      if (lockReleaseResult.success) {
        console.log('[removeDutySelection] 锁释放成功：', lockReleaseResult.releasedSlots)
      } else {
        console.error('[removeDutySelection] 锁释放失败：', lockReleaseResult.message)
        // 锁释放失败不影响主流程，但需要记录日志
      }
    }

    // 2. 从用户的等效工作量中扣除值班EW（只处理已确认的时间段）
    const confirmedCancelledSlots = cancelledSlots.filter(slot => slot.wasConfirmed)
    if (confirmedCancelledSlots.length > 0) {
      console.log('[removeDutySelection] 开始扣除值班EW，已确认时间段数量:', confirmedCancelledSlots.length)
      const ewResult = await removeDutyEW(openid, confirmedCancelledSlots.length)
      
      if (ewResult.success) {
        console.log('[removeDutySelection] 值班EW扣除成功:', ewResult)
      } else {
        console.error('[removeDutySelection] 值班EW扣除失败:', ewResult.message)
        // EW扣除失败不影响主流程，但需要记录日志
      }
    }

    // 3. 删除相关的待办事项（如果存在）
    const todoResult = await db.collection('duty_toDo_list')
      .where({
        toDoListUserId: openid,
        dutySlotId: db.command.in(preSelectedSlots.map(slot => slot.dutySlotId))
      })
      .get()

    if (todoResult.data.length > 0) {
      for (const todo of todoResult.data) {
        try {
          await db.collection('duty_toDo_list').doc(todo._id).remove()
          console.log('[removeDutySelection] 删除待办事项成功：', todo.dutySlotId)
        } catch (removeErr) {
          console.error('[removeDutySelection] 删除待办事项失败：', todo.dutySlotId, removeErr)
          // 待办事项删除失败不影响主流程
        }
      }
      console.log('[removeDutySelection] 已删除相关待办事项数量：', todoResult.data.length)
    }

    console.log('[removeDutySelection] 取消完成，slotIds:', preSelectedSlots.map(slot => slot.dutySlotId))

    return {
      code: 200,
      data: {
        cancelledSlots: cancelledSlots,
        totalCancelled: cancelledSlots.length,
        confirmedCancelled: 0, // 现在不允许取消已确认的
        preSelectedCancelled: cancelledSlots.length,
        weekNumber: cancelledSlots[0]?.weekNumber,
        year: cancelledSlots[0]?.year
      },
      message: `成功取消${cancelledSlots.length}个预选时间段`
    }

  } catch (err) {
    console.error('[removeDutySelection] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '取消值班选择失败'
    }
  }
} 