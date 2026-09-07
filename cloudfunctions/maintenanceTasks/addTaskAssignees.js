// 添加任务受理人
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 添加任务受理人
 * @param {Object} params - 参数对象
 * @param {string} params.taskId - 任务ID
 * @param {Array} params.selectedMembers - 选中的成员openid数组
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回操作结果
 */
exports.addTaskAssignees = async (params, OPENID) => {
  try {
    
    
    // 检查参数
    if (!params.taskId) {
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    if (!params.selectedMembers || !Array.isArray(params.selectedMembers) || params.selectedMembers.length === 0) {
      return {
        code: 400,
        data: null,
        message: '请选择要添加的受理人'
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
    
    // 只有组长可以添加受理人
    if (currentUser.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长可以添加受理人'
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
    
    // 获取当前所有受理人ID
    const currentAssignees = [task.assigneeId];
    if (task.additionalAssignees && task.additionalAssignees.length > 0) {
      task.additionalAssignees.forEach(assignee => {
        if (assignee.assigneeId) {
          currentAssignees.push(assignee.assigneeId);
        }
      });
    }
    // 过滤掉null/undefined值
    const validCurrentAssignees = currentAssignees.filter(Boolean);
    
    
    
    // 过滤掉已经是受理人的成员
    const newAssignees = params.selectedMembers.filter(memberId => !validCurrentAssignees.includes(memberId))
    
    if (newAssignees.length === 0) {
      return {
        code: 400,
        data: null,
        message: '选中的成员都已经是受理人了'
      }
    }
    
    // 限制：如果申请人是维修组成员，禁止将申请人添加为协助受理人
    // 说明：成员列表来自 proUsers（仅 member/leader），若申请人不是维修组成员，本身不会出现在成员列表中
    if (task.applicantId && newAssignees.includes(task.applicantId)) {
      return {
        code: 400,
        data: null,
        message: '不能将申请人添加为协助受理人'
      }
    }
    
    // 获取新受理人的详细信息（从 proUsers 集合，更高效）
    const newAssigneesInfo = await db.collection('proUsers').where({
      openid: db.command.in(newAssignees)
    }).get()
    
    if (newAssigneesInfo.data.length !== newAssignees.length) {
      return {
        code: 400,
        data: null,
        message: '部分选中的成员信息不存在'
      }
    }
    
    // proUsers 集合中的用户都是维修组成员，无需额外验证角色
    
    // 准备更新的额外受理人数据
    const existingAdditionalAssignees = task.additionalAssignees || []
    const newAdditionalAssignees = [...existingAdditionalAssignees]
    
    // 为每个新受理人创建详细信息
    const currentTime = new Date()
    for (const memberInfo of newAssigneesInfo.data) {
      const assigneeData = {
        assigneeId: memberInfo.openid,
        assigneeName: memberInfo.nickName,
        assigneeStudentId: memberInfo.studentId || '', // 添加协助受理人学号
        assigneeQqId: memberInfo.qqId,
        assigneeTime: currentTime
      }
      newAdditionalAssignees.push(assigneeData)
    }
    
    // 更新任务数据
    await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.taskId
    }).update({
      data: {
        additionalAssignees: newAdditionalAssignees,
        updateTime: currentTime
      }
    })
    
    // 为新受理人创建待办事项
    const todoPromises = newAssignees.map(async (assigneeId) => {
      const assigneeInfo = newAssigneesInfo.data.find(info => info.openid === assigneeId)
      
      return db.collection('maintenance_toDo_list').add({
        data: {
          toDoListUserId: assigneeId,
          taskId: params.taskId,
          taskStatus: 'inProgress',
          title: `维修任务：${task.level1} > ${task.level2} > ${task.level3}`,
          otherDescription: task.otherDescription || '',
          // 特殊字段信息
          specialFields: task.specialFields || {
            laptopModel: '',
            laptopSystem: '',
            softwareInfo: '',
            systemVersion: '',
            deviceModel: ''
          },
          location: task.location || '',
          applicantId: task.applicantId,
          applicantName: task.applicantName,
          applicantStudentId: task.applicantStudentId || '', // 添加申请人学号
          applicantQqId: task.applicantQqId || '',
          assigneeId: assigneeInfo.openid,
          assigneeName: assigneeInfo.nickName,
          assigneeStudentId: assigneeInfo.studentId || '', // 添加协助受理人学号
          assigneeQqId: assigneeInfo.qqId,
          createTime: currentTime,
          updateTime: currentTime
        }
      })
    })
    
    await Promise.all(todoPromises)

    // 为新受理人创建待反馈消息
    const feedbackMessagePromises = newAssignees.map(async (assigneeId) => {
      const assigneeInfo = newAssigneesInfo.data.find(info => info.openid === assigneeId)
      
      try {
        // 调用待反馈消息云函数创建消息
        const messageResult = await cloud.callFunction({
          name: 'pendingFeedbackMessages',
          data: {
            action: 'createFeedbackMessage',
            params: {
              recipientId: assigneeId,
              type: 'maintenance_assignment',
              relatedId: params.taskId,
              content: {
                title: '您被指派为维修任务协助受理人',
                details: `您已被指派为维修任务的协助受理人：\n\n【任务分类】\n${task.level1} > ${task.level2} > ${task.level3}\n\n【任务地点】\n${task.location || '待确定'}\n\n【问题描述】\n${task.otherDescription || '详见任务详情'}\n\n请及时查看任务详情并准时参与处理。\n请点击确认收到此消息。`
              }
            }
          }
        })
        
        
      } catch (error) {
        console.error(`为受理人 ${assigneeInfo.nickName} 创建待反馈消息失败:`, error);
        // 不影响主流程，仅记录错误
      }
    })
    
    await Promise.all(feedbackMessagePromises)
    
    return {
      code: 200,
      data: {
        added: newAssignees.length
      },
      message: '添加受理人成功'
    }
  } catch (err) {
    console.error('添加受理人失败:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '添加受理人失败'
    }
  }
} 