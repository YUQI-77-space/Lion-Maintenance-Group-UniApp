// 志愿活动管理云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const createVolunteerActivity = require('./createVolunteerActivity')
const updateVolunteerActivity = require('./updateVolunteerActivity')
const deleteVolunteerActivity = require('./deleteVolunteerActivity')
const getVolunteerActivitiesList = require('./getVolunteerActivitiesList')
const getVolunteerActivityDetail = require('./getVolunteerActivityDetail')
const registerForVolunteerActivity = require('./registerForVolunteerActivity')
const cancelRegistration = require('./cancelRegistration')
const getParticipantsInfo = require('./getParticipantsInfo')
const exportParticipants = require('./exportParticipants')
const submitFeedback = require('./submitFeedback')
const toggleRecruitmentStatus = require('./toggleRecruitmentStatus')
const { getMembersList, batchImportVolunteers } = require('./batchImportVolunteers')
const { StatusUpdateManager } = require('./statusUpdateManager')
const activityReminderScheduler = require('./activityReminderScheduler')
const scheduleInvitedVolunteerReminder = require('./scheduleInvitedVolunteerReminder')

// 定时触发器入口
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  if (context && context.TriggerName === 'statusUpdateTrigger') {
    return await schedulerMain(event, context);
  }
  
  let processedEvent = { ...event }
  if (event.params) {
    processedEvent = { ...processedEvent, ...event.params }
  }
  switch (event.action) {
    case 'createVolunteerActivity':
    case 'createvolunteerActivitie':
      return await createVolunteerActivity.main(processedEvent, wxContext)
    case 'updateVolunteerActivity':
    case 'updatevolunteerActivitie':
      return await updateVolunteerActivity.main(processedEvent, wxContext)
    case 'deleteVolunteerActivity':
    case 'deletevolunteerActivitie':
      return await deleteVolunteerActivity.main(processedEvent, wxContext)
    case 'getVolunteerActivitiesList':
    case 'getvolunteerActivitiesList':
      return await getVolunteerActivitiesList.main(processedEvent, wxContext)
    case 'getVolunteerActivityDetail':
    case 'getvolunteerActivitieDetail':
      return await getVolunteerActivityDetail.main(processedEvent, wxContext)
    case 'registerForVolunteerActivity':
    case 'registerForvolunteerActivitie':
      return await registerForVolunteerActivity.main(processedEvent, wxContext)
    case 'cancelRegistration':
      return await cancelRegistration.main(processedEvent, wxContext)
    case 'getParticipantsInfo':
      return await getParticipantsInfo.main(processedEvent, wxContext)
    case 'exportParticipants':
      return await exportParticipants.main(processedEvent, wxContext)
    case 'setParticipantsEW':
      return await (require('./setParticipantsEW')).main(processedEvent, wxContext)

    case 'submitFeedback':
      return await submitFeedback(processedEvent, context)
    case 'getUserVolunteerActivities':
      return await getUserVolunteerActivities(processedEvent, wxContext)
    case 'updateActivityStatus':
      return await StatusUpdateManager.updateSingleActivityStatus(processedEvent.activityId)
    case 'batchUpdateAllStatus':
      return await StatusUpdateManager.batchUpdateAllActivitiesStatus()
    case 'schedulerMain':
      return await schedulerMain(processedEvent, context)
    case 'manualTrigger':
      return await manualTrigger(processedEvent, context)
    case 'getExecutionHistory':
      return await getExecutionHistory(processedEvent, context)
    case 'toggleRecruitmentStatus':
      return await toggleRecruitmentStatus.main(processedEvent, wxContext)
    case 'getMembersList':
      return await getMembersList(processedEvent, wxContext)
    case 'batchImportVolunteers':
      return await batchImportVolunteers(processedEvent, wxContext)
    case 'scheduleInvitedVolunteerReminder':
      return await scheduleInvitedVolunteerReminder.main(processedEvent, wxContext)
    default:
      console.error('未找到对应的功能接口:', event.action)
      return {
        code: 404,
        message: '未找到对应的功能接口'
      }
  }
} 

// 获取用户志愿活动记录
async function getUserVolunteerActivities(event, context) {
  try {
    const { params = {} } = event;
    const { OPENID } = cloud.getWXContext();
    
    if (!params.userId) {
      return {
        code: 400,
        data: null,
        message: '缺少用户ID参数'
      };
    }
    if (OPENID !== params.userId) {
      const userResult = await db.collection('users').where({
        openid: OPENID
      }).get();
      
      if (userResult.data.length === 0 || userResult.data[0].role !== 'leader') {
        return {
          code: 403,
          data: null,
          message: '无权查看该用户的志愿活动记录'
        };
      }
    }
    
    const activitiesResult = await db.collection('voluntary_activities')
      .where({
        participantsIDList: params.userId,
        activityStatus: 'ended'
      })
      .orderBy('startTime', 'desc')
      .get();
    
    return {
      code: 200,
      data: activitiesResult.data,
      message: '获取用户志愿活动记录成功'
    };
  } catch (err) {
    console.error('[getUserVolunteerActivities] 获取用户志愿活动记录失败', err);
    return {
      code: 500,
      data: null,
      message: err.message || '获取用户志愿活动记录失败'
    };
  }
}

// 定时任务主入口
async function schedulerMain(event, context) {
  console.log('🕐 [定时任务] 开始执行定时任务', {
    timestamp: new Date().toISOString(),
    timezone: 'GMT+8'
  });
  
  const results = {
    statusUpdate: null,
    activityReminder: null
  };
  
  try {
    // 1. 执行状态更新任务
    console.log('🔄 [定时任务] 执行志愿活动状态更新...');
    try {
      const statusResult = await StatusUpdateManager.batchUpdateAllActivitiesStatus();
      results.statusUpdate = statusResult;
      
      console.log('📊 [状态更新] 批量更新结果:', {
        success: statusResult.code === 200,
        resultCode: statusResult.code,
        message: statusResult.message,
        updatedCount: statusResult.data ? statusResult.data.updatedCount : 0,
        totalChecked: statusResult.data ? statusResult.data.totalChecked : 0
      });
    } catch (statusError) {
      console.error('❌ [状态更新] 执行失败:', statusError);
      results.statusUpdate = {
        code: 500,
        message: '状态更新失败: ' + statusError.message
      };
    }
    
    // 2. 执行活动提醒任务
    console.log('🔔 [定时任务] 执行志愿活动提醒检查...');
    try {
      const reminderResult = await activityReminderScheduler.main(event, context);
      results.activityReminder = reminderResult;
      
      console.log('📱 [活动提醒] 提醒任务结果:', {
        success: reminderResult.success,
        message: reminderResult.message,
        checkedCount: reminderResult.data ? reminderResult.data.checkedCount : 0,
        remindersSent: reminderResult.data ? reminderResult.data.totalRemindersSent : 0
      });
    } catch (reminderError) {
      console.error('❌ [活动提醒] 执行失败:', reminderError);
      results.activityReminder = {
        success: false,
        message: '活动提醒失败: ' + reminderError.message
      };
    }
    
    // 3. 汇总结果并记录日志
    const overallSuccess = (results.statusUpdate && results.statusUpdate.code === 200) || 
                          (results.activityReminder && results.activityReminder.success);
    
    const summaryMessage = [
      '定时任务执行完成:',
      results.statusUpdate ? `状态更新${results.statusUpdate.code === 200 ? '成功' : '失败'}` : '状态更新跳过',
      results.activityReminder ? `活动提醒${results.activityReminder.success ? '成功' : '失败'}` : '活动提醒跳过'
    ].join(' | ');
    
    // 记录执行日志
    await logSchedulerExecution({
      status: overallSuccess ? 'success' : 'partial_failure',
      result: results,
      executionTime: new Date().toISOString(),
      summary: summaryMessage
    });
    
    return {
      code: overallSuccess ? 200 : 500,
      message: summaryMessage,
      data: {
        statusUpdate: results.statusUpdate,
        activityReminder: results.activityReminder
      }
    };
    
  } catch (error) {
    console.error('💥 [定时任务] 执行异常:', {
      error: {
        message: error.message,
        stack: error.stack
      },
      timestamp: new Date().toISOString()
    });
    
    // 记录错误日志
    await logSchedulerExecution({
      status: 'error',
      error: error.message,
      stack: error.stack,
      executionTime: new Date().toISOString()
    });
    
    return {
      code: 500,
      message: '定时任务执行异常: ' + error.message,
      data: results
    };
  }
}

// 手动触发状态更新
async function manualTrigger(event, context) {
  console.log('🔧 [手动触发] 手动执行状态更新', {
    timestamp: new Date().toISOString(),
    triggerBy: event.triggerBy || 'unknown'
  });
  
  // 调用定时任务主函数
  return await schedulerMain(event, context);
}

// 获取定时任务执行历史
async function getExecutionHistory(event, context) {
  try {
    const db = cloud.database();
    const { limit = 10 } = event;
    
    const result = await db.collection('scheduler_logs')
      .where({
        taskType: 'volunteer_status_update'
      })
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get();
    
    return {
      code: 200,
      data: result.data,
      message: '获取执行历史成功'
    };
    
  } catch (error) {
    console.error('[获取执行历史失败]:', error);
    return {
      code: 500,
      message: '获取执行历史失败: ' + error.message
    };
  }
}

// 记录执行日志
async function logSchedulerExecution(logData) {
  try {
    const db = cloud.database();
    
    await db.collection('scheduler_logs').add({
      data: {
        taskType: 'volunteer_status_update',
        status: logData.status,
        result: logData.result || null,
        error: logData.error || null,
        stack: logData.stack || null,
        executionTime: logData.executionTime,
        createTime: db.serverDate()
      }
    });
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    await db.collection('scheduler_logs')
      .where({
        createTime: db.command.lt(thirtyDaysAgo)
      })
      .remove();
    
  } catch (error) {
    console.error('[日志记录失败]:', error);
  }
}

 