// 报名参加志愿活动
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 报名参加志愿活动
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 报名结果
 */
exports.main = async (event, wxContext) => {
  try {
    const { activityId } = event
    const { OPENID } = wxContext
    
    
    
    if (!activityId) {
      console.error('缺少活动ID')
      return {
        code: 400,
        message: '缺少活动ID'
      }
    }
    
    // 获取活动信息
    
    const activityResult = await db.collection('voluntary_activities').where({
      activityId: activityId
    }).get()
    
    if (!activityResult.data || activityResult.data.length === 0) {
      console.error('活动不存在:', activityId)
      return {
        code: 404,
        message: '活动不存在'
      }
    }
    
    const activity = activityResult.data[0]
    
    
    // 检查活动状态
    if (activity.activityStatus === 'ended') {
      console.error('活动已结束，无法报名')
      return {
        code: 400,
        message: '活动已结束，无法报名'
      }
    }
    
    // 检查招募状态
    if (activity.recruitmentOpen === false) {
      console.error('活动已关闭招募，无法报名')
      return {
        code: 400,
        message: '该活动已关闭招募，无法报名'
      }
    }
    
    // 检查是否已报名
    if (activity.participantsIDList && activity.participantsIDList.includes(OPENID)) {
      console.error('用户已报名该活动')
      return {
        code: 400,
        message: '您已报名该活动'
      }
    }
    
    // 检查名额是否已满
    if (activity.numberOfVolunteers >= activity.volunteerCount) {
      console.error('活动名额已满')
      return {
        code: 400,
        message: '活动名额已满'
      }
    }
    
    // 获取用户信息
    
    let userInfo = null
    
    // 先尝试使用where查询
    const userByWhereResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    if (userByWhereResult.data && userByWhereResult.data.length > 0) {
      userInfo = userByWhereResult.data[0]
    } else {
      // 如果where查询失败，尝试使用doc查询
      try {
        // 查询用户信息，获取名字、学号和手机号
        // 将doc(OPENID)查询改为where查询
        const userByDocResult = await db.collection('users').where({
          openid: OPENID
        }).get()

        if (userByDocResult.data.length === 0) {
          return {
            code: 404,
            message: '用户信息不存在'
          }
        }

        const user = userByDocResult.data[0]
        userInfo = user
      } catch (err) {
        console.error('通过doc获取用户信息失败:', err)
      }
    }
    
    if (!userInfo) {
      console.error('未找到用户信息')
      return {
        code: 400,
        message: '未找到用户信息，请先完善个人资料'
      }
    }
    
    
    
    // 开启事务
    const transaction = await db.startTransaction()
    
    try {
      // 准备更新数据
      const updateData = {
        numberOfVolunteers: _.inc(1),
        updateTime: db.serverDate()
      }
      
      // 初始化参与者列表（如果不存在）
      if (!activity.participantsIDList) {
        updateData.participantsIDList = [OPENID]
      } else {
        updateData.participantsIDList = _.push(OPENID)
      }
      
      // 添加参与者姓名
      const participantName = userInfo.nickName
      if (!activity.participantsNameList) {
        updateData.participantsNameList = [participantName]
      } else {
        updateData.participantsNameList = _.push(participantName)
      }
      

      

      
      // 如果用户曾经取消过报名，从canceledUsers数组中移除
      if (activity.canceledUsers && activity.canceledUsers.includes(OPENID)) {
        // 找到用户在canceledUsers中的索引
        const canceledIndex = activity.canceledUsers.indexOf(OPENID)
        if (canceledIndex !== -1) {
          updateData[`canceledUsers.${canceledIndex}`] = _.remove()
        }
      }
      
      // 更新活动信息
      
      await transaction.collection('voluntary_activities').doc(activity._id).update({
        data: updateData
      })
      
      // 添加到用户待办事项
      
      let todoResult = null
      try {
        // 先检查是否已经存在该用户针对同一活动的待办（例如之前作为创建者被创建了管理待办）
        const existingTodoRes = await transaction.collection('volunteer_toDo_list')
          .where({ toDoListUserId: OPENID, taskId: activityId })
          .get()

        if (existingTodoRes.data && existingTodoRes.data.length > 0) {
          // 已存在：更新为标准参与者待办信息，避免重复卡片
          const existingTodo = existingTodoRes.data[0]
          await transaction.collection('volunteer_toDo_list')
            .doc(existingTodo._id)
            .update({
              data: {
                // 使用活动当前信息进行同步
                activityStatus: activity.activityStatus,
                title: activity.title, // 标准化标题，移除可能的“管理进行中的志愿活动：”前缀
                description: activity.description || '',
                startTime: activity.startTime,
                endTime: activity.endTime,
                location: activity.location || '',
                duration: activity.duration,
                volunteerHours: activity.volunteerHours || activity.duration,
                updateTime: db.serverDate()
              }
            })
          
          todoResult = { _id: existingTodo._id }
        } else {
          // 不存在则新增
          todoResult = await transaction.collection('volunteer_toDo_list').add({
            data: {
              toDoListUserId: OPENID,
              taskId: activityId,
              activityStatus: activity.activityStatus,
              title: activity.title,
              description: activity.description || '',
              startTime: activity.startTime,
              endTime: activity.endTime,
              location: activity.location || '',
              duration: activity.duration,
              volunteerHours: activity.volunteerHours || activity.duration,
              createTime: db.serverDate(),
              updateTime: db.serverDate()
            }
          })
          
        }
      } catch (err) {
        console.error('添加待办事项失败，但不影响报名流程:', err)
        // 添加待办事项失败不影响整体流程，继续执行
      }
      
      // 提交事务
      
      await transaction.commit()
      
      // 发送消息通知
      
      try {
        await cloud.callFunction({
          name: 'messages',
          data: {
            action: 'createMessage',
            params: {
              messageUserId: OPENID,
              title: '报名成功',
              content: `您已成功报名参加"${activity.title}"活动，请按时参加。`,
              messageType: 'volunteer'
            }
          }
        })
      } catch (err) {
        console.error('发送消息通知失败，但不影响报名流程:', err)
        // 消息发送失败不影响整体流程，继续执行
      }
      
      // 注意：订阅消息授权将在前端处理，发送记录会保存到 message_send_logs 集合
      
      // 检查是否需要立即发送提醒（活动开始时间距离当前时间不足1小时）
      // 🔥 使用统一的时间处理工具
      const timeUtils = require('./timeUtils');
      const chinaTime = timeUtils.getChinaTime();
      const activityStartTime = timeUtils.parseChinaTime(activity.startTime);
      const activityTimeMs = Number(activityStartTime.getTime());
      const chinaTimeMs = Number(chinaTime.getTime());
      const timeDiffInMinutes = Number(Math.round((activityTimeMs - chinaTimeMs) / (1000 * 60)));
      
      
      
      let immediateReminderSent = false
      // 如果活动在1小时内开始，向新报名的用户发送立即提醒
      if (timeDiffInMinutes <= 60 && timeDiffInMinutes > 0) {
        
        
        // 检查该用户是否已经收到过该活动的提醒
        try {
          const existingLogsResult = await db.collection('message_send_logs')
            .where({
              type: 'ACTIVITY_REMINDER',
              activityId: activity.activityId,
              recipient: OPENID
            })
            .get();
          
          if (existingLogsResult.data && existingLogsResult.data.length > 0) {
            immediateReminderSent = false
          } else {
            // 发送立即提醒
            const subscriptionResult = await cloud.callFunction({
            name: 'subscriptionMessage',
            data: {
              action: 'sendActivityReminderNotification',
              params: {
                participants: [{
                  openid: OPENID,
                  name: userInfo.nickName || '志愿者'
                }],
                activityId: activity.activityId,
                activityName: activity.title,
                startTime: activity.startTime,
                location: activity.location,
                description: activity.description,
                // 使用正式版，避免非开发者/体验者收不到
                miniprogramState: 'formal',
                isImmediateReminder: true, // 标记为立即提醒
                templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo'
              }
            }
          })
          
            
            immediateReminderSent = true
            // 记录日志
            await db.collection('message_send_logs').add({
              data: {
                type: 'ACTIVITY_REMINDER',
                templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
                recipient: OPENID,
                activityId: activity.activityId,
                sendResult: subscriptionResult,
                success: true,
                timestamp: db.serverDate()
              }
            });
          }
        } catch (error) {
          console.error('[报名] 立即提醒发送失败:', error)
          // 不影响报名，只记录错误
          await db.collection('message_send_logs').add({
            data: {
              type: 'ACTIVITY_REMINDER',
              templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
              recipient: OPENID,
              activityId: activity.activityId,
              error: error.message,
              success: false,
              timestamp: db.serverDate()
            }
          });
        }
      }
      
      
      return {
        code: 200,
        data: {
          activityId: activityId,
          todoId: todoResult ? todoResult._id : null,
          immediateReminderSent: immediateReminderSent
        },
        message: '报名成功'
      }
    } catch (err) {
      // 回滚事务
      console.error('事务处理失败，执行回滚:', err)
      await transaction.rollback()
      throw err
    }
  } catch (error) {
    console.error('报名失败:', error)
    return {
      code: 500,
      message: '报名失败: ' + error.message
    }
  }
} 