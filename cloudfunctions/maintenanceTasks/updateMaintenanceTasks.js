// 更新维修任务
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 更新维修任务
 * @param {Object} params - 参数对象
 * @param {string} params.maintenanceTaskId - 维修任务ID
 * @param {Object} params.updateData - 要更新的数据
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回更新结果
 */
exports.updateMaintenanceTasks = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.maintenanceTaskId || !params.updateData) {
      return {
        code: 400,
        data: null,
        message: '缺少必要参数'
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
    
    // 检查用户权限（只有申请人、认领人和组长可以更新任务）
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
    
    if (userRole !== 'leader' && 
        task.applicantId !== OPENID && 
        task.assigneeId !== OPENID) {
      return {
        code: 403,
        data: null,
        message: '您无权更新此任务'
      }
    }
    
    // 当前时间
    const now = new Date()
    
    // 构建更新数据
    const updateData = {
      ...params.updateData,
      updateTime: now
    }

    // “是否紧急”已废弃，不允许旧客户端或手工请求重新写入该字段。
    delete updateData.isUrgent

    // 禁止普通用户更新敏感字段
    if (userRole !== 'leader') {
      delete updateData.ew
    }
    
    // 更新维修任务
    await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).update({
      data: updateData
    })
    
    // 如果有状态更新，同步更新待办事项
    if (updateData.taskStatus) {
      // 更新申请人待办事项
      if (task.applicantId) {
        await db.collection('maintenance_toDo_list').where({
          taskId: params.maintenanceTaskId,
          toDoListUserId: task.applicantId
        }).update({
          data: {
            taskStatus: updateData.taskStatus,
            updateTime: now
          }
        })
      }
      
      // 更新认领人待办事项
      if (task.assigneeId) {
        await db.collection('maintenance_toDo_list').where({
          taskId: params.maintenanceTaskId,
          toDoListUserId: task.assigneeId
        }).update({
          data: {
            taskStatus: updateData.taskStatus,
            updateTime: now
          }
        })
      }
      
      // 新增：更新所有协助受理人的待办事项
      if (Array.isArray(task.additionalAssignees) && task.additionalAssignees.length > 0) {
        const helperIds = task.additionalAssignees
          .map(a => a && a.assigneeId)
          .filter(Boolean)
      
        for (const helperId of helperIds) {
          await db.collection('maintenance_toDo_list').where({
            taskId: params.maintenanceTaskId,
            toDoListUserId: helperId
          }).update({
            data: {
              taskStatus: updateData.taskStatus,
              updateTime: now
            }
          })
        }
      }
    }
    
    return {
      code: 200,
      data: {
        maintenanceTaskId: params.maintenanceTaskId
      },
      message: '更新维修任务成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '更新维修任务失败'
    }
  }
} 
