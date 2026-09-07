// 删除任务受理人
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 删除任务受理人
 * @param {Object} params - 参数对象
 * @param {string} params.taskId - 任务ID
 * @param {Array} params.assigneesToRemove - 要删除的受理人openid数组
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回操作结果
 */
exports.removeTaskAssignees = async (params, OPENID) => {
  try {
    console.log('removeTaskAssignees 接收到的参数:', params, '用户OPENID:', OPENID);
    
    // 检查参数
    if (!params.taskId) {
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    if (!params.assigneesToRemove || !Array.isArray(params.assigneesToRemove) || params.assigneesToRemove.length === 0) {
      return {
        code: 400,
        data: null,
        message: '请选择要删除的受理人'
      }
    }
    
    // 获取当前用户角色（从 proUsers 集合，更高效）
    const userResult = await db.collection('proUsers').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '未找到用户信息或您不是维修组成员'
      }
    }
    
    const currentUser = userResult.data[0]
    
    // 只有组长可以删除受理人
    if (currentUser.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长可以删除受理人'
      }
    }
    
    // 获取任务信息
    const taskResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.taskId
    }).get()
    
    if (taskResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '任务不存在'
      }
    }
    
    const task = taskResult.data[0]
    console.log('任务信息:', { id: task.maintenanceTaskId, status: task.taskStatus });
    
    // 检查是否试图删除主要受理人
    if (params.assigneesToRemove.includes(task.assigneeId)) {
      return {
        code: 400,
        data: null,
        message: '不能删除主要受理人，只能删除额外的受理人'
      }
    }
    
    // 获取当前的额外受理人列表
    const currentAdditionalAssignees = task.additionalAssignees || []
    console.log('当前额外受理人:', currentAdditionalAssignees);
    
    // 过滤出要保留的受理人（不在删除列表中的）
    const remainingAssignees = currentAdditionalAssignees.filter(assignee => 
      !params.assigneesToRemove.includes(assignee.assigneeId)
    )
    
    const removedCount = currentAdditionalAssignees.length - remainingAssignees.length
    
    if (removedCount === 0) {
      return {
        code: 400,
        data: null,
        message: '所选受理人不在任务的额外受理人列表中'
      }
    }
    
    // 更新任务数据
    await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.taskId
    }).update({
      data: {
        additionalAssignees: remainingAssignees,
        updateTime: new Date()
      }
    })
    
    // 删除被移除受理人的待办事项
    const deletePromises = params.assigneesToRemove.map(async (assigneeId) => {
      return db.collection('maintenance_toDo_list').where({
        toDoListUserId: assigneeId,
        taskId: params.taskId
      }).remove()
    })
    
    await Promise.all(deletePromises)
    
    console.log(`成功删除了 ${removedCount} 名受理人`);
    
    return {
      code: 200,
      data: {
        removed: removedCount
      },
      message: '删除受理人成功'
    }
  } catch (err) {
    console.error('删除受理人失败:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '删除受理人失败'
    }
  }
} 