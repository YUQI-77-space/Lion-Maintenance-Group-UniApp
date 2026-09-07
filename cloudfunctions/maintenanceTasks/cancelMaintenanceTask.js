// 取消维修任务
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 取消维修任务
 * @param {Object} params - 参数对象
 * @param {string} params.maintenanceTaskId - 维修任务ID
 * @param {string} params.cancelReason - 取消原因
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回取消结果
 */
exports.cancelMaintenanceTask = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.maintenanceTaskId) {
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    if (!params.cancelReason || params.cancelReason.trim() === '') {
      return {
        code: 400,
        data: null,
        message: '缺少取消原因'
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
    
    // 检查用户权限（只有申请人和组长可以取消任务）
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
    
    if (userRole !== 'leader' && task.applicantId !== OPENID) {
      return {
        code: 403,
        data: null,
        message: '您无权取消此任务'
      }
    }
    
    // 更新维修任务状态为已取消
    const now = new Date()
    await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).update({
      data: {
        taskStatus: 'cancelled',
        cancelReason: params.cancelReason.trim(),
        updateTime: now
      }
    })
    
    // 更新申请人的待办事项状态为已取消
    await db.collection('maintenance_toDo_list').where({
      taskId: params.maintenanceTaskId,
      toDoListUserId: task.applicantId
    }).update({
      data: {
        taskStatus: 'cancelled',
        updateTime: now
      }
    })
    
    // 统一通知并更新所有受理人（主受理人+协助受理人）的待办
    const notifyAssigneeIds = new Set()
    if (task.assigneeId) notifyAssigneeIds.add(task.assigneeId)
    if (Array.isArray(task.additionalAssignees) && task.additionalAssignees.length > 0) {
      task.additionalAssignees.forEach(a => {
        if (a && a.assigneeId) notifyAssigneeIds.add(a.assigneeId)
      })
    }

    // 获取操作人信息用于通知消息
    const operator = user.nickName || '管理员'
    const isApplicantOperation = task.applicantId === OPENID

    // 优化：并行处理待办列表更新和消息发送
    if (notifyAssigneeIds.size > 0) {
      const updatePromises = [];
      const messagePromises = [];
      
      for (const assigneeId of notifyAssigneeIds) {
        // 并行执行待办列表更新
        updatePromises.push(
          db.collection('maintenance_toDo_list').where({
            taskId: params.maintenanceTaskId,
            toDoListUserId: assigneeId
          }).update({
            data: {
              taskStatus: 'cancelled',
              updateTime: now
            }
          })
        );

        // 并行准备消息发送
        const notifyContent = isApplicantOperation 
          ? `您认领的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被申请人撤销，撤销原因：${params.cancelReason.trim()}`
          : `您认领的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被${operator}撤销，撤销原因：${params.cancelReason.trim()}`
        
        messagePromises.push(
          cloud.callFunction({
            name: 'messages',
            data: {
              action: 'createMessage',
              params: {
                messageUserId: assigneeId,
                title: '维修任务已撤销',
                content: notifyContent,
                messagetype: 'maintenance'
              }
            }
          }).catch(e => {
            console.error(`通知受理人${assigneeId}消息发送失败`, e);
          })
        );
      }
      
      // 并行执行所有待办列表更新
      try {
        await Promise.all(updatePromises);
      } catch (e) {
        console.error('更新待办列表失败', e);
      }
      
      // 异步发送消息（不阻塞主流程）
      Promise.all(messagePromises).catch(e => {
        console.error('批量发送受理人消息失败', e);
      });
    }
    
    // 异步发送所有通知消息（不阻塞主流程）
    const notificationPromises = [];
    
    // 通知申请人任务已撤销
    const applicantContent = isApplicantOperation
      ? `您的维修任务"${task.level1} > ${task.level2} > ${task.level3}"撤销成功，撤销原因：${params.cancelReason.trim()}`
      : `您申请的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被${operator}撤销，撤销原因：${params.cancelReason.trim()}`
    
    notificationPromises.push(
      cloud.callFunction({
        name: 'messages',
        data: {
          action: 'createMessage',
          params: {
            messageUserId: task.applicantId,
            title: '维修任务已撤销',
            content: applicantContent,
            messagetype: 'maintenance'
          }
        }
      }).catch(e => {
        console.error('通知申请人消息发送失败', e);
      })
    );

    // 异步获取组长列表并发送通知
    const leaderNotificationPromise = db.collection('proUsers').where({
      role: 'leader'
    }).get().then(leaderResult => {
      if (leaderResult.data.length > 0) {
        const leaderContent = isApplicantOperation
          ? `维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被申请人${task.applicantName}撤销，撤销原因：${params.cancelReason.trim()}`
          : `维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被${operator}撤销，撤销原因：${params.cancelReason.trim()}`
        
        const leaderPromises = leaderResult.data
          .filter(leader => leader.openid !== OPENID) // 避免重复通知
          .map(leader => 
            cloud.callFunction({
              name: 'messages',
              data: {
                action: 'createMessage',
                params: {
                  messageUserId: leader.openid,
                  title: '维修任务已撤销',
                  content: leaderContent,
                  messagetype: 'maintenance'
                }
              }
            }).catch(e => {
              console.error(`通知组长${leader.openid}消息发送失败`, e);
            })
          );
        
        return Promise.all(leaderPromises);
      }
    }).catch(e => {
      console.error('获取组长列表或发送通知失败', e);
    });
    
    notificationPromises.push(leaderNotificationPromise);
    
    // 异步发送订阅消息通知
    const subscriptionPromise = (async () => {
      try {
        console.log('开始发送任务取消订阅消息通知');
        
        // 构建接收人列表
        const recipients = [{
          openid: task.applicantId,
          role: 'applicant'
        }];
        
        // 只有当任务已被认领时才添加受理人
        if (task.assigneeId) {
          recipients.push({
            openid: task.assigneeId,
            role: 'assignee'
          });
          
          if (Array.isArray(task.additionalAssignees) && task.additionalAssignees.length > 0) {
            task.additionalAssignees.forEach(assignee => {
              if (assignee && assignee.assigneeId) {
                recipients.push({
                  openid: assignee.assigneeId,
                  role: 'additional_assignee'
                });
              }
            });
          }
        }
        
        await cloud.callFunction({
          name: 'subscriptionMessage',
          data: {
            action: 'sendTaskCancelledNotification',
            params: {
              recipients: recipients,
              taskId: params.maintenanceTaskId,
              taskCategory: task.level3,
              applicantName: task.applicantName,

              maintenanceTaskId: params.maintenanceTaskId,
              cancelReason: params.cancelReason.trim()
            }
          }
        });
        
        console.log('任务取消订阅消息发送成功');
      } catch (subscriptionErr) {
        console.error('发送任务取消订阅消息失败:', subscriptionErr);
      }
    })();
    
    notificationPromises.push(subscriptionPromise);
    
    // 等待所有通知完成，确保订阅消息可靠发送
    try {
      await Promise.all(notificationPromises);
    } catch (e) {
      console.error('批量发送通知消息失败', e);
      // 不中断主流程
    }
    
    return {
      code: 200,
      data: {
        maintenanceTaskId: params.maintenanceTaskId
      },
      message: '取消维修任务成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '取消维修任务失败'
    }
  }
} 