// 删除维修任务（管理员专用）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { batchRemoveMaintenanceEW } = require('./maintenanceEWManager')

/**
 * 删除维修任务（管理员专用，彻底删除）
 * @param {Object} params - 参数对象
 * @param {string} params.maintenanceTaskId - 维修任务ID
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回删除结果
 */
exports.deleteMaintenanceTask = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.maintenanceTaskId) {
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    // 查询任务详情
    const taskResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).get()
    
    // 检查任务是否存在
    if (taskResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到对应的维修任务'
      }
    }
    
    const task = taskResult.data[0]
    
    // 检查用户权限（只有组长可以删除任务）
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '未找到用户信息'
      }
    }
    
    const user = userResult.data[0]
    const userRole = user.role
    
    if (userRole !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长可以删除任务'
      }
    }
    
    // 删除维修任务
    await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).remove()
    
    // 删除申请人的待办事项
    await db.collection('maintenance_toDo_list').where({
      taskId: params.maintenanceTaskId,
      toDoListUserId: task.applicantId
    }).remove()
    
    // 统一删除所有受理人（主受理人+协助受理人）的待办，并发送消息通知
    const notifyAssigneeIds = new Set()
    if (task.assigneeId) notifyAssigneeIds.add(task.assigneeId)
    if (Array.isArray(task.additionalAssignees) && task.additionalAssignees.length > 0) {
      task.additionalAssignees.forEach(a => {
        if (a && a.assigneeId) notifyAssigneeIds.add(a.assigneeId)
      })
    }

    if (notifyAssigneeIds.size > 0) {
      for (const assigneeId of notifyAssigneeIds) {
        await db.collection('maintenance_toDo_list').where({
          taskId: params.maintenanceTaskId,
          toDoListUserId: assigneeId
        }).remove()

        // 使用 cloud.callFunction 发送消息，保持与其它模块一致
        try {
          await cloud.callFunction({
            name: 'messages',
            data: {
              action: 'createMessage',
              params: {
                messageUserId: assigneeId,
                title: '维修任务已删除',
                content: `您认领的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被管理员删除`,
                messagetype: 'maintenance'
              }
            }
          })
        } catch (e) {
          console.error('通知受理人消息发送失败', e)
        }
      }
    }
    
    // 通知申请人任务已删除
    try {
      await cloud.callFunction({
        name: 'messages',
        data: {
          action: 'createMessage',
          params: {
            messageUserId: task.applicantId,
            title: '维修任务已删除',
            content: `您申请的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被管理员删除`,
            messagetype: 'maintenance'
          }
        }
      })
    } catch (e) {
      console.error('通知申请人消息发送失败', e)
    }
    
    // 扣除所有受理人的维修任务EW（如果任务已完成并且有EW值）
    if (task.taskStatus === 'completed' && task.ew && task.ew > 0 && notifyAssigneeIds.size > 0) {
      console.log('开始扣除受理人维修任务EW，任务EW值:', task.ew, '受理人数量:', notifyAssigneeIds.size)
      const ewResult = await batchRemoveMaintenanceEW(Array.from(notifyAssigneeIds), task.ew)
      
      if (ewResult.success) {
        console.log('维修任务EW批量扣除成功:', ewResult)
      } else {
        console.error('维修任务EW批量扣除失败:', ewResult.message)
        // EW扣除失败不影响主流程，但需要记录日志
      }
    } else {
      console.log('任务未完成或无EW值，跳过EW扣除。任务状态:', task.taskStatus, 'EW值:', task.ew)
    }
    
    return {
      code: 200,
      data: {
        maintenanceTaskId: params.maintenanceTaskId
      },
      message: '删除维修任务成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '删除维修任务失败'
    }
  }
} 