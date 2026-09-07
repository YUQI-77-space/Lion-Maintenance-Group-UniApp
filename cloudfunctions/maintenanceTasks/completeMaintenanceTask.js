// 完成维修任务
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 完成维修任务
 * @param {Object} params - 参数对象
 * @param {string} params.maintenanceTaskId - 维修任务ID
 * @param {string} params.completeTime - 完成时间
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回完成结果
 */
exports.completeMaintenanceTask = async (params, OPENID) => {
  try {
    console.log('completeMaintenanceTask 接收到的参数:', params, '用户OPENID:', OPENID);
    
    // 检查参数
    if (!params.maintenanceTaskId) {
      console.log('缺少任务ID');
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    // 查询任务详情
    console.log('查询任务详情:', params.maintenanceTaskId);
    const taskResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).get()
    
    // 检查任务是否存在
    if (taskResult.data.length === 0) {
      console.log('未找到对应的维修任务:', params.maintenanceTaskId);
      return {
        code: 404,
        data: null,
        message: '未找到对应的维修任务'
      }
    }
    
    const task = taskResult.data[0]
    console.log('找到任务:', task.maintenanceTaskId, '当前状态:', task.taskStatus);
    
    // 检查任务状态
    if (task.taskStatus !== 'inProgress') {
      console.log('任务状态不允许标记为完成, 当前状态:', task.taskStatus);
      return {
        code: 400,
        data: null,
        message: '该任务当前状态不允许标记为完成'
      }
    }
    
    // 检查用户是否有权限（只有申请人可以完成任务）
    console.log('检查用户权限:', OPENID);
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length === 0) {
      console.log('未找到用户信息:', OPENID);
      return {
        code: 403,
        data: null,
        message: '未找到用户信息'
      }
    }
    
    // 检查是否为申请人
    if (task.applicantId !== OPENID) {
      // 如果不是申请人，则返回错误
      console.log('用户不是申请人, 申请人ID:', task.applicantId, '用户ID:', OPENID);
      return {
        code: 403,
        data: null,
        message: '只有申请人可以确认任务完成'
      }
    }
    
    // 当前时间
    const now = new Date()
    const completeTime = params.completeTime || now.toISOString()
    
    try {
      // 更新任务状态为已完成
      console.log('更新维修任务状态为已完成');
      await db.collection('maintenance_tasks').where({
        maintenanceTaskId: params.maintenanceTaskId
      }).update({
        data: {
          taskStatus: 'completed',
          completeTime: completeTime,
          updateTime: now
        }
      })
      
      // 更新申请人待办事项
      console.log('更新申请人待办事项状态');
      await db.collection('maintenance_toDo_list').where({
        taskId: params.maintenanceTaskId,
        toDoListUserId: task.applicantId
      }).update({
        data: {
          taskStatus: 'completed',
          completeTime: completeTime,
          updateTime: now
        }
      })
      
      // 更新所有受理人的待办事项
      console.log('更新受理人待办事项状态');
      
      // 收集所有受理人ID
      const allAssigneeIds = [task.assigneeId];
      if (task.additionalAssignees && task.additionalAssignees.length > 0) {
        task.additionalAssignees.forEach(assignee => {
          if (assignee.assigneeId) {
            allAssigneeIds.push(assignee.assigneeId);
          }
        });
      }
      
             // 更新所有受理人的待办事项
       for (const assigneeId of allAssigneeIds) {
         await db.collection('maintenance_toDo_list').where({
           taskId: params.maintenanceTaskId,
           toDoListUserId: assigneeId
         }).update({
           data: {
             taskStatus: 'completed',
             completeTime: completeTime,
             updateTime: now
           }
         });
         console.log('已更新受理人', assigneeId, '的待办事项状态');
       }
    } catch (updateErr) {
      console.error('更新任务状态失败:', updateErr);
      return {
        code: 500,
        data: null,
        message: '更新任务状态失败: ' + updateErr.message
      }
    }
    
    // 发送消息通知
    try {
      console.log('开始发送消息通知');
      // 通知申请人任务已完成
      await cloud.callFunction({
        name: 'messages',
        data: {
          action: 'createMessage',
          params: {
            messageUserId: task.applicantId,
            title: '维修任务已完成',
            content: `您的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已完成`,
            messagetype: 'maintenance'
          }
        }
      });
      console.log('已发送消息给申请人:', task.applicantId);
      
      // 通知所有受理人任务已完成
      const allAssigneeIds = [task.assigneeId];
      if (task.additionalAssignees && task.additionalAssignees.length > 0) {
        task.additionalAssignees.forEach(assignee => {
          if (assignee.assigneeId) {
            allAssigneeIds.push(assignee.assigneeId);
          }
        });
      }
      
      for (const assigneeId of allAssigneeIds) {
        await cloud.callFunction({
          name: 'messages',
          data: {
            action: 'createMessage',
            params: {
              messageUserId: assigneeId,
              title: '维修任务已完成',
              content: `您受理的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已完成`,
              messagetype: 'maintenance'
            }
          }
        });
        console.log('已发送消息给受理人:', assigneeId);
      }
      
      // 查询并通知组长（从 proUsers 集合）
      const leaderResult = await db.collection('proUsers').where({
        role: 'leader'
      }).get();
      
      if (leaderResult.data.length > 0) {
        for (const leader of leaderResult.data) {
          await cloud.callFunction({
            name: 'messages',
            data: {
              action: 'createMessage',
              params: {
                messageUserId: leader.openid,
                title: '维修任务已完成',
                content: `维修任务"${task.level1} > ${task.level2} > ${task.level3}"已由${task.assigneeName}完成，请及时设置EW值。`,
                messagetype: 'maintenance'
              }
            }
          });
          console.log('已发送消息给组长:', leader.openid);
        }
      }
      console.log('所有消息发送完成');
    } catch (messageErr) {
      console.error('发送消息失败', messageErr);
      // 消息发送失败不影响主流程，但记录错误
    }
    
    // 发送订阅消息通知
    try {
      console.log('开始发送订阅消息通知');
      
      // 收集所有受理人ID
      const allAssigneeIds = [task.assigneeId];
      if (task.additionalAssignees && task.additionalAssignees.length > 0) {
        task.additionalAssignees.forEach(assignee => {
          if (assignee.assigneeId) {
            allAssigneeIds.push(assignee.assigneeId);
          }
        });
      }
      
      // 向所有受理人发送任务完成订阅消息
      for (const assigneeId of allAssigneeIds) {
        try {
          await cloud.callFunction({
            name: 'subscriptionMessage',
            data: {
              action: 'sendTaskCompletedNotification',
              params: {
                assigneeOpenid: assigneeId,
                taskId: params.maintenanceTaskId,
                taskCategory: task.level3,
                applicantName: task.applicantName,

                maintenanceTaskId: params.maintenanceTaskId
              }
            }
          });
          console.log('任务完成订阅消息发送成功给受理人:', assigneeId);
        } catch (subscriptionErr) {
          console.error('发送任务完成订阅消息失败给受理人', assigneeId, ':', subscriptionErr);
          // 单个用户发送失败不影响其他用户
        }
      }
      
      console.log('所有任务完成订阅消息发送完成');
    } catch (subscriptionErr) {
      console.error('发送任务完成订阅消息失败:', subscriptionErr);
      // 订阅消息发送失败不影响主流程
    }
    

    
    console.log('任务完成处理成功:', params.maintenanceTaskId);
    return {
      code: 200,
      data: {
        maintenanceTaskId: params.maintenanceTaskId,
        taskStatus: 'completed',
        completeTime: completeTime
      },
      message: '任务已标记为完成'
    }
    
  } catch (err) {
    console.error('完成维修任务失败:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '完成维修任务失败'
    }
  }
} 