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
    
    // 管理身份只以 users 为准。
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length !== 1) {
      return {
        code: 403,
        data: null,
        message: '未找到用户信息或您不是维修组成员'
      }
    }
    
    const currentUser = userResult.data[0]
    
    // 只有组长可以删除受理人
    if (!['leader', 'admin'].includes(currentUser.role)) {
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
    await require('./memberStatus').withActiveMembers(db, [OPENID], async tx => {
      const { data: actor } = await tx.collection('users').doc(currentUser._id).get()
      if (!['leader', 'admin'].includes(actor.role)) {
        throw Object.assign(new Error('身份已变化，无权删除受理人'), { code: 403 })
      }
      const ref = tx.collection('maintenance_tasks').doc(task._id)
      const { data: current } = await ref.get()
      if (!current || current.assigneeId !== task.assigneeId ||
          JSON.stringify(current.additionalAssignees || []) !== JSON.stringify(currentAdditionalAssignees)) {
        throw Object.assign(new Error('任务已变化，请刷新后重试'), { code: 409 })
      }
      await ref.update({ data: { additionalAssignees: remainingAssignees, updateTime: db.serverDate() } })
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
      code: typeof err.code === 'number' ? err.code : 500,
      data: null,
      message: err.message || '删除受理人失败'
    }
  }
} 
