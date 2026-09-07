// cloudfunctions/volunteerActivities/scheduleInvitedVolunteerReminder.js
// 处理被动邀请的志愿者订阅提醒调度

const cloud = require('wx-server-sdk');
const timeUtils = require('./timeUtils');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 为被动邀请的志愿者处理订阅提醒调度
 * @param {Object} event - 云函数调用事件
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 处理结果
 */
exports.main = async (event, wxContext) => {
  
  
  try {
    // 验证必要参数
    if (!event.activityId) {
      return {
        success: false,
        message: '缺少活动ID参数'
      };
    }
    
    if (!wxContext.OPENID) {
      return {
        success: false,
        message: '无法获取用户身份信息'
      };
    }
    
    // 获取志愿活动信息
    const activityResult = await db.collection('voluntary_activities')
      .where({
        activityId: event.activityId
      })
      .get();
    
    if (activityResult.data.length === 0) {
      return {
        success: false,
        message: '未找到指定的志愿活动'
      };
    }
    
    const activity = activityResult.data[0];
    
    // 验证用户是否为该活动的参与者
    if (!activity.participantsIDList || !activity.participantsIDList.includes(wxContext.OPENID)) {
      return {
        success: false,
        message: '您不是该志愿活动的参与者'
      };
    }
    
    // 检查活动状态
    if (activity.activityStatus === 'ended') {
      return {
        success: false,
        message: '活动已结束，无需设置提醒'
      };
    }
    
    // 使用统一时间工具计算时间
    const currentTime = timeUtils.getChinaTime();
    const activityStartTime = timeUtils.parseChinaTime(activity.startTime);
    
    
    
    // 计算距离活动开始的时间差（毫秒）
    // 强制转换为Number类型以避免BigInt序列化问题
    const activityTime = Number(activityStartTime.getTime());
    const currentTimeNum = Number(currentTime.getTime());
    const timeDifference = activityTime - currentTimeNum;
    const oneHourInMs = 60 * 60 * 1000; // 1小时的毫秒数
    
    // 确保 timeDifference 是 Number 类型，防止BigInt序列化错误
    const timeDifferenceNum = Number(timeDifference);
    
    // 验证数值有效性
    if (!Number.isFinite(timeDifferenceNum) || !Number.isFinite(activityTime) || !Number.isFinite(currentTimeNum)) {
      console.error('时间计算产生无效数值:', {
        activityTime,
        currentTimeNum,
        timeDifferenceNum
      });
      return {
        success: false,
        message: '时间计算错误，请稍后重试'
      };
    }

    
    
    // 检查活动是否已经开始或即将开始
    if (timeDifferenceNum <= 0) {
      return {
        success: false,
        message: '活动已经开始，无需设置提醒'
      };
    }
    
    // 根据时间差决定处理策略
    if (timeDifferenceNum > oneHourInMs) {
      // 场景一：距离活动开始超过1小时
      // 用户已完成授权，现有的定时任务 activityReminderScheduler 会在活动开始前1小时为所有参与者发送提醒
      // 此时我们只需要记录这次授权即可，不需要额外操作
      
      
      
      // 可选：记录此次授权确认的日志
      await db.collection('message_send_logs').add({
        data: {
          type: 'INVITED_VOLUNTEER_AUTH',
          templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
          activityId: activity.activityId,
          openid: wxContext.OPENID,
          success: true,
          message: '被邀请志愿者完成订阅授权，将由定时任务发送提醒',
          authTime: db.serverDate(),
          scheduledBy: 'scheduler_task',
          timeDifferenceHours: Number(parseFloat((timeDifferenceNum / oneHourInMs).toFixed(2)))
        }
      });
      
      return {
        success: true,
        message: '授权成功！我们将在活动开始前1小时为您发送提醒',
        data: {
          scheduledBy: 'scheduler_task',
          timeDifferenceHours: Number(parseFloat((timeDifferenceNum / oneHourInMs).toFixed(2))),
          reminderTime: '活动开始前1小时'
        }
      };
      
    } else {
      // 场景二：距离活动开始不足1小时
      // 现有定时任务可能已经执行完毕，需要立即发送提醒
      
      console.log('距离活动开始不足1小时，立即发送提醒');
      
      // 检查是否已经发送过提醒（防重复）
      const existingLogResult = await db.collection('message_send_logs')
        .where({
          type: 'ACTIVITY_REMINDER',
          activityId: activity.activityId
        })
        .get();
      
      const hasSchedulerSent = existingLogResult.data.some(log => log.schedulerExecution === true);
      
      if (hasSchedulerSent) {
        // 定时任务已经发送过，检查当前用户是否在发送列表中
        // 如果用户是新加入的，可能定时任务执行时还没有加入，需要补发
      }
      
      // 构建参与者信息
      const userIndex = activity.participantsIDList.indexOf(wxContext.OPENID);
      const userName = activity.participantsNameList && activity.participantsNameList[userIndex] 
        ? activity.participantsNameList[userIndex] 
        : '志愿者';
      
      const participant = {
        openid: wxContext.OPENID,
        name: userName
      };
      
      // 调用订阅消息云函数立即发送提醒
      const reminderResult = await cloud.callFunction({
        name: 'subscriptionMessage',
        data: {
          action: 'sendActivityReminderNotification',
          params: {
            participants: [participant], // 只为当前用户发送
            activityId: activity.activityId,
            activityName: activity.title,
            startTime: activity.startTime,
            location: activity.location || '待定',
            description: activity.description || '请准时参加活动，感谢您的参与！',
            // 立即提醒在联调环境下默认走开发版，避免测试期收不到
            miniprogramState: event.miniprogramState || 'developer',
            templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo'
          }
        }
      });
      
      let resultMessage = '';
      let sendSuccess = false;
      
      if (reminderResult.result && reminderResult.result.success) {
        const sentCount = reminderResult.result.data.successCount || 0;
        sendSuccess = sentCount > 0;
        resultMessage = sendSuccess 
          ? '立即发送活动提醒成功！' 
          : '提醒发送失败，可能是由于订阅消息配额限制';
        
        
      } else {
        resultMessage = '提醒发送失败: ' + (reminderResult.result?.message || '未知错误');
        console.error('立即发送提醒失败:', reminderResult.result);
      }
      
      // 记录发送日志
      await db.collection('message_send_logs').add({
        data: {
          type: 'INVITED_VOLUNTEER_IMMEDIATE_REMINDER',
          templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
          activityId: activity.activityId,
          openid: wxContext.OPENID,
          success: sendSuccess,
          message: resultMessage,
          authTime: db.serverDate(),
          sendTime: db.serverDate(),
          scheduledBy: 'immediate_send',
          timeDifferenceMinutes: Number(parseFloat((timeDifferenceNum / (1000 * 60)).toFixed(1)))
        }
      });
      
      return {
        success: true,
        message: resultMessage,
        data: {
          scheduledBy: 'immediate_send',
          timeDifferenceMinutes: Number(parseFloat((timeDifferenceNum / (1000 * 60)).toFixed(1))),
          reminderSent: sendSuccess
        }
      };
    }
    
  } catch (error) {
    console.error('处理被动邀请志愿者提醒调度失败:', error);
    
    // 记录错误日志
    try {
      await db.collection('message_send_logs').add({
        data: {
          type: 'INVITED_VOLUNTEER_AUTH_ERROR',
          activityId: event.activityId || '',
          openid: wxContext.OPENID || '',
          success: false,
          error: error.message,
          errorStack: error.stack,
          timestamp: db.serverDate()
        }
      });
    } catch (logError) {
      console.error('记录错误日志失败:', logError);
    }
    
    return {
      success: false,
      message: '处理提醒调度时发生错误: ' + error.message
    };
  }
};
