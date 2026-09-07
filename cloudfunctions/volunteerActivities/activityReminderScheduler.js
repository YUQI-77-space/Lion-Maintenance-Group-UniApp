// cloudfunctions/volunteerActivities/activityReminderScheduler.js
// 志愿活动提醒定时任务处理器

const cloud = require('wx-server-sdk');
const timeUtils = require('./timeUtils');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 检查并发送即将开始的志愿活动提醒（开始前1小时）
 * @param {Object} event - 定时触发器事件
 * @returns {Object} 处理结果
 */
exports.main = async (event, context) => {
  
  
  try {
    // 使用统一的时间处理工具
    const chinaTime = timeUtils.getChinaTime();
    const chinaTimeMs = Number(chinaTime.getTime());
    const oneHourLater = new Date(chinaTimeMs + 55 * 60 * 1000);  // 55分钟后
    const oneHourLaterMax = new Date(chinaTimeMs + 65 * 60 * 1000);  // 65分钟后
    
    // 将时间转换为数据库存储的格式（字符串）
    const oneHourLaterStr = timeUtils.formatChinaTime(oneHourLater).replace('+08:00', '');
    const oneHourLaterMaxStr = timeUtils.formatChinaTime(oneHourLaterMax).replace('+08:00', '');
    
    // 查询即将开始的志愿活动
    const activitiesResult = await db.collection('voluntary_activities')
      .where({
        activityStatus: 'inPreparation',
        startTime: _.and(
          _.gte(oneHourLaterStr),
          _.lte(oneHourLaterMaxStr)
        )
      })
      .get();
    
    const activities = activitiesResult.data;
    
    
    if (activities.length === 0) {
      return {
        success: true,
        message: '没有需要发送提醒的志愿活动',
        data: {
          checkedCount: 0,
          remindersSent: 0
        }
      };
    }
    
    let totalRemindersSent = 0;
    let successfulActivities = 0;
    const results = [];
    
    // 为每个活动发送提醒
    for (const activity of activities) {
      try {
        
        
        // 查询该活动已成功发送过提醒的接收人，按参与者维度去重
        const sentLogsRes = await db.collection('message_send_logs')
          .where({
            type: 'ACTIVITY_REMINDER',
            activityId: activity.activityId,
            success: true
          })
          .get();
        
        // 检查活动是否有参与者
        if (!activity.participantsIDList || activity.participantsIDList.length === 0) {
          
          results.push({
            activityId: activity.activityId,
            title: activity.title,
            success: true,
            message: '没有参与者',
            remindersSent: 0
          });
          continue;
        }
        
        // 构建参与者列表
        const participants = activity.participantsIDList.map((openid, index) => ({
          openid: openid,
          name: activity.participantsNameList && activity.participantsNameList[index] 
                ? activity.participantsNameList[index] 
                : '志愿者'
        }));

        // 过滤出尚未收到过成功提醒的参与者
        const sentRecipients = new Set(
          (sentLogsRes.data || [])
            .map(log => log.recipient)
            .filter(Boolean)
        );
        const recipientsToSend = participants.filter(p => !sentRecipients.has(p.openid));

        if (recipientsToSend.length === 0) {
          
          results.push({
            activityId: activity.activityId,
            title: activity.title,
            success: true,
            message: '全部参与者均已收到提醒',
            remindersSent: 0
          });
          continue;
        }
        
        // 调用订阅消息云函数发送提醒
        const reminderResult = await cloud.callFunction({
          name: 'subscriptionMessage',
          data: {
            action: 'sendActivityReminderNotification',
            params: {
              participants: recipientsToSend,
              activityId: activity.activityId,
              activityName: activity.title,
              startTime: activity.startTime,
              location: activity.location || '待定',
              description: activity.description || '请准时参加活动，感谢您的参与！',
              miniprogramState: 'formal',
              templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo'
            }
          }
        });
        
        if (reminderResult.result && reminderResult.result.success) {
          const sentCount = reminderResult.result.data.successCount || 0;
          totalRemindersSent += sentCount;
          successfulActivities++;
          
          
          
          // 记录成功发送的日志
          await db.collection('message_send_logs').add({
            data: {
              type: 'ACTIVITY_REMINDER',
              templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
              activityId: activity.activityId,
              success: true,
              successCount: sentCount,
              totalParticipants: recipientsToSend.length,
              timestamp: db.serverDate(),
              schedulerExecution: true
            }
          });
          
          results.push({
            activityId: activity.activityId,
            title: activity.title,
            success: true,
            message: `成功发送给${sentCount}个参与者`,
            remindersSent: sentCount
          });
        } else {
          console.error(`活动 ${activity.activityId} 提醒发送失败:`, reminderResult.result);
          results.push({
            activityId: activity.activityId,
            title: activity.title,
            success: false,
            message: reminderResult.result ? reminderResult.result.message : '发送失败',
            remindersSent: 0
          });
          // 记录失败日志
          await db.collection('message_send_logs').add({
            data: {
              type: 'ACTIVITY_REMINDER',
              templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
              activityId: activity.activityId,
              error: reminderResult.result ? reminderResult.result.message : '发送失败',
              success: false,
              timestamp: db.serverDate()
            }
          });
        }
        
      } catch (error) {
        console.error(`处理活动 ${activity.activityId} 时出错:`, error);
        results.push({
          activityId: activity.activityId,
          title: activity.title,
          success: false,
          message: error.message,
          remindersSent: 0
        });
        // 记录异常日志
        await db.collection('message_send_logs').add({
          data: {
            type: 'ACTIVITY_REMINDER',
            templateId: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
            activityId: activity.activityId,
            error: error.message,
            success: false,
            timestamp: db.serverDate()
          }
        });
      }
    }
    
    
    
    return {
      success: true,
      message: `处理完成: 检查了${activities.length}个活动，成功处理${successfulActivities}个，发送了${totalRemindersSent}条提醒`,
      data: {
        checkedCount: activities.length,
        successfulActivities: successfulActivities,
        totalRemindersSent: totalRemindersSent,
        results: results
      }
    };
    
  } catch (error) {
    console.error('志愿活动提醒定时任务执行失败:', error);
    return {
      success: false,
      message: '定时任务执行失败: ' + error.message,
      error: error
    };
  }
};
