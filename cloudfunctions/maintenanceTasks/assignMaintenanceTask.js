// 认领维修任务
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 认领维修任务
 * @param {Object} params - 参数对象
 * @param {string} params.maintenanceTaskId - 维修任务ID
 * @param {string} params.assigneeId - 认领人openid（可选，默认为当前用户）
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回认领结果
 */
exports.assignMaintenanceTask = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.maintenanceTaskId) {
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    // 认领人ID，如果没有传入则使用当前用户ID
    const assigneeId = params.assigneeId || OPENID
    
    // 检查认领人权限（从 proUsers 集合获取，更高效）
    const userResult = await db.collection('proUsers').where({
      openid: assigneeId
    }).get()
    
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '未找到认领人信息或认领人不是维修组成员'
      }
    }
    
    const user = userResult.data[0]
    // proUsers 集合中的用户都是维修组成员，无需额外验证角色
    
    // 当前时间
    const now = new Date()
    
    // 格式化时间为东八区时间字符串
    const formatDateTimeCN = (date) => {
      // 云函数中new Date()返回UTC时间，需要转换为东八区时间字符串
      const cnTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
      
      const year = cnTime.getUTCFullYear();
      const month = String(cnTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(cnTime.getUTCDate()).padStart(2, '0');
      const hours = String(cnTime.getUTCHours()).padStart(2, '0');
      const minutes = String(cnTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(cnTime.getUTCSeconds()).padStart(2, '0');
      
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    
    const formattedNow = formatDateTimeCN(now)
    
    // 构建认领人信息
    const assigneeInfo = {
      assigneeId: user.openid,
      assigneeName: user.nickName,
      assigneeStudentId: user.studentId || '', // 添加受理人学号
      assigneeQqId: user.qqId || '', // 添加受理人QQ号
      assigneeTime: formattedNow,
      taskStatus: 'inProgress', // 更新状态为处理中
      updateTime: now
    }
    
    // 使用原子性更新操作：只有当任务状态为pending时才能更新
    const updateResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId,
      taskStatus: 'pending' // 原子性检查：只更新状态为pending的任务
    }).update({
      data: assigneeInfo
    })
    
    // 检查更新是否成功：如果更新的记录数为0，说明任务已被认领或不存在
    if (updateResult.stats.updated === 0) {
      // 再次查询任务以确定具体错误原因
      const taskCheckResult = await db.collection('maintenance_tasks').where({
        maintenanceTaskId: params.maintenanceTaskId
      }).get()
      
      if (taskCheckResult.data.length === 0) {
        return {
          code: 404,
          data: null,
          message: '未找到对应的维修任务'
        }
      }
      
      const currentTask = taskCheckResult.data[0]
      // 检查任务是否已经被当前用户认领
      if (currentTask.taskStatus !== 'pending' && currentTask.assigneeId === user.openid) {
        return {
          code: 200,
          data: {
            maintenanceTaskId: params.maintenanceTaskId,
            alreadyClaimed: true
          },
          message: '您已经认领了此维修任务'
        }
      }
      
      return {
        code: 400,
        data: null,
        message: '该维修任务已被其他用户认领，请选择其他任务'
      }
    }
    
    // 获取更新后的任务信息用于后续处理
    const taskResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).get()
    
    if (taskResult.data.length === 0) {
      return {
        code: 500,
        data: null,
        message: '任务认领成功，但获取任务详情失败'
      }
    }
    
    const task = taskResult.data[0]
    
    // 更新申请人待办事项
    await db.collection('maintenance_toDo_list').where({
      taskId: params.maintenanceTaskId,
      toDoListUserId: task.applicantId
    }).update({
      data: {
        taskStatus: 'inProgress',
        assigneeId: user.openid,
        assigneeName: user.nickName,
        assigneeStudentId: user.studentId || '', // 添加受理人学号
        assigneeQqId: user.qqId || '', // 添加受理人QQ号
        assigneeTime: formattedNow,
        updateTime: now
      }
    })
    
    // 添加到认领人待办事项
    await db.collection('maintenance_toDo_list').add({
      data: {
        toDoListUserId: user.openid,
        taskId: params.maintenanceTaskId,
        taskStatus: 'inProgress',
        title: `维修任务：${task.level1} > ${task.level2} > ${task.level3}`,
        otherDescription: task.otherDescription,
        // 特殊字段信息
        specialFields: task.specialFields || {
          laptopModel: '',
          laptopSystem: '',
          softwareInfo: '',
          systemVersion: '',
          deviceModel: ''
        },
        appointmentTime: task.appointmentTime,
        completeTime: '',
        applicantId: task.applicantId,
        applicantName: task.applicantName,
        applicantStudentId: task.applicantStudentId || '', // 添加申请人学号
        applicantQqId: task.applicantQqId || '', // 添加申请人QQ号
        applicantTime: task.applicantTime,
        assigneeId: user.openid,
        assigneeName: user.nickName,
        assigneeStudentId: user.studentId || '', // 添加受理人学号
        assigneeQqId: user.qqId || '', // 添加受理人QQ号
        assigneeTime: formattedNow,
        createTime: now,
        updateTime: now
      }
    })
    
    // 发送消息通知
    try {
      // 发送消息给申请人
      await cloud.callFunction({
        name: 'messages',
        data: {
          action: 'createMessage',
          params: {
            messageUserId: task.applicantId,
            title: '维修任务已被认领',
            content: `您的维修任务"${task.level1} > ${task.level2} > ${task.level3}"已被${user.nickName}认领，请通过QQ联系: ${user.qqId}`,
            messagetype: 'maintenance'
          }
        }
      });
      
      // 发送消息给认领人
      await cloud.callFunction({
        name: 'messages',
        data: {
          action: 'createMessage',
          params: {
            messageUserId: user.openid,
            title: '已认领维修任务',
            content: `您已成功认领维修任务"${task.level1} > ${task.level2} > ${task.level3}"，申请人: ${task.applicantName}，请通过QQ联系: ${task.applicantQqId}`,
            messagetype: 'maintenance'
          }
        }
      });
    } catch (messageErr) {
      console.error('发送消息失败', messageErr);
      // 消息发送失败不影响主流程
    }
    
    // 发送订阅消息通知
    try {
      await cloud.callFunction({
        name: 'subscriptionMessage',
        data: {
          action: 'sendTaskClaimedNotification',
          params: {
            applicantOpenid: task.applicantId,
            taskId: params.maintenanceTaskId,
            taskCategory: task.level3,
            assigneeName: user.nickName,
      
            maintenanceTaskId: params.maintenanceTaskId
          }
        }
      });
      
      console.log('任务认领订阅消息发送成功');
    } catch (subscriptionErr) {
      console.error('发送任务认领订阅消息失败:', subscriptionErr);
      // 订阅消息发送失败不影响主流程
    }
    

    
    return {
      code: 200,
      data: {
        maintenanceTaskId: params.maintenanceTaskId
      },
      message: '认领维修任务成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '认领维修任务失败'
    }
  }
} 
