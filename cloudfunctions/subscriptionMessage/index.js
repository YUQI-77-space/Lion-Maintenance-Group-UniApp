// cloudfunctions/subscriptionMessage/index.js
// 微信订阅消息推送云函数

const cloud = require('wx-server-sdk');

// 初始化云开发环境（与调用方保持一致的环境，避免跨环境导致的发送失败）
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 获取数据库实例
const db = cloud.database();

/**
 * 通过openid获取用户信息
 * @param {string} openid - 用户openid
 * @returns {Promise<Object|null>} 用户信息或null
 */
async function getUserByOpenid(openid) {
  try {
    const userResult = await db.collection('users').where({
      openid: openid
    }).get();
    
    if (userResult.data.length > 0) {
      return userResult.data[0];
    }
    
    // 如果在users集合中找不到，尝试在proUsers集合中查找
    const proUserResult = await db.collection('proUsers').where({
      openid: openid
    }).get();
    
    if (proUserResult.data.length > 0) {
      return proUserResult.data[0];
    }
    
    return null;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
}

// 订阅消息模板ID常量
const TEMPLATES = {
  TASK_CLAIMED: '5r55o8dpEttQ8H-u38ThmVuhFlr-n97x1ey67_QT4ok',    // 模板1：任务被认领
  TASK_COMPLETED: '5r55o8dpEttQ8H-u38ThmQf4Q2LzLOvS28nVHf3o-9w',   // 模板2：任务完成
  TASK_CANCELLED: '9hekOFjhrV1wQI1RH6JdgSTZAs5oNtOcY1nqjT3TM3s',    // 模板3：任务取消
  ACTIVITY_REMINDER: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',    // 模板4：志愿活动开始提醒
  DUTY_REMINDER: 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8'     // 模板5：值班安排提醒
};

// 小程序页面路径常量
const PAGES = {
  TASK_DETAIL: 'pages/user/todo/maintenance-detail/index',
  TASK_LIST: 'pages/team/maintenance/list/index',
  USER_TODO: 'pages/user/todo/index',
  VOLUNTEER_DETAIL: 'pages/team/volunteer/detail/index',
  DUTY_ROSTER: 'pages/team/duty/roster/index'
};

// 统一东八区时间处理（与前端 `miniprogram/utils/time.js` 行为保持一致）
function toChinaDateTime(dateStr, timeStr) {
  try {
    const safeTime = (timeStr || '00:00').length === 5 ? `${timeStr}:00` : timeStr || '00:00:00';
    const iso = `${dateStr}T${safeTime}+08:00`;
    return new Date(iso);
  } catch (_) {
    return new Date(`${dateStr}T00:00:00+08:00`);
  }
}

function formatChinaToMinute(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}年${MM}月${dd}日 ${hh}:${mm}`;
}

// 直接用原始字符串拼出中文时间，避免平台时区差异导致的 8 小时偏移
function formatChinaFromStrings(dateStr, timeStr) {
  if (!dateStr) return '';
  const [y, m = '01', d = '01'] = String(dateStr).split('-');
  const [hh = '00', mm = '00'] = String(timeStr || '00:00').split(':');
  const pad = (s) => (String(s).length === 1 ? '0' + s : String(s));
  return `${y}年${pad(m)}月${pad(d)}日 ${pad(hh)}:${pad(mm)}`;
}

// 清洗用于微信订阅消息 nameX 字段的人名：
// - 仅保留中英文及常见间隔点
// - 去除数字和其它符号
// - 长度限制为 10（微信 name 类型字段规范）
// - 若结果为空，提供兜底占位
function sanitizeNameForWechat(rawName) {
  try {
    if (!rawName || typeof rawName !== 'string') return '维修志愿者';
    const cleaned = rawName
      .replace(/[^a-zA-Z\u4e00-\u9fa5·•\s]/g, '')
      .replace(/\s+/g, '')
      .trim();
    const safe = cleaned || '维修志愿者';
    return safe.substring(0, 10);
  } catch (_) {
    return '维修志愿者';
  }
}

/**
 * 云函数入口函数
 */
exports.main = async (event, context) => {
  const { action, params } = event;
  
  
  try {
    switch (action) {
      case 'sendTaskClaimedNotification':
        return await sendTaskClaimedNotification(params);
      case 'sendTaskCompletedNotification':
        return await sendTaskCompletedNotification(params);
      case 'sendTaskCancelledNotification':
        return await sendTaskCancelledNotification(params);
      case 'sendActivityReminderNotification':
        return await sendActivityReminderNotification(params);
      case 'sendDutyReminderNotification':
        return await sendDutyReminderNotification(params);
      case 'getMessageStats':
        return await getMessageStats(params);

      default:
        return {
          success: false,
          message: '未知操作: ' + action,
          code: 'UNKNOWN_ACTION'
        };
    }
  } catch (error) {
    console.error('云函数执行失败:', error);
    return {
      success: false,
      message: '云函数执行失败: ' + error.message,
      error: error,
      code: 'FUNCTION_ERROR'
    };
  }
};

/**
 * 发送任务认领通知给申请人
 * @param {Object} params - 参数对象
 * @returns {Promise<Object>} 发送结果
 */
async function sendTaskClaimedNotification(params) {
  const {
    applicantOpenid,
    taskId,
    taskCategory,
    assigneeName,

    maintenanceTaskId
  } = params;
  
  // 参数验证
  if (!applicantOpenid || !taskId || !taskCategory || !assigneeName) {
    return {
      success: false,
      message: '参数不完整',
      code: 'INVALID_PARAMS'
    };
  }
  
  try {
    // 构建消息数据 - 根据实际微信模板参数结构
    const safeAssigneeName = sanitizeNameForWechat(assigneeName);
    const messageData = {
      number6: { value: taskId.toString().substring(0, 20) },                  // 报修单号
      date1: { value: formatChinaFromStrings(new Date().toISOString().split('T')[0], new Date().toTimeString().split(' ')[0]) },  // 报修时间
      thing5: { value: taskCategory.substring(0, 20) },                       // 报修内容
      name9: { value: safeAssigneeName },                        // 维修人名称（需符合微信 name 字段规范）
      thing23: { value: '您的维修任务已被认领！'.substring(0, 20) }  // 温馨提示
    };
    
    
    
    // 发送订阅消息
    const sendResult = await cloud.openapi.subscribeMessage.send({
      touser: applicantOpenid,
      template_id: TEMPLATES.TASK_CLAIMED,
      data: messageData,
      page: `${PAGES.TASK_DETAIL}?taskId=${maintenanceTaskId || taskId}`,
      miniprogram_state: 'formal'  // 正式版
    });
    
    // 记录发送日志
    await logMessageSend({
      type: 'TASK_CLAIMED',
      templateId: TEMPLATES.TASK_CLAIMED,
      recipient: applicantOpenid,
      taskId: taskId,
      messageData: messageData,
      sendResult: sendResult,
      success: true
    });
    
    return {
      success: true,
      message: '任务认领通知发送成功',
      data: {
        templateId: TEMPLATES.TASK_CLAIMED,
        recipient: applicantOpenid,
        taskId: taskId
      }
    };
    
  } catch (error) {
    console.error('发送任务认领通知失败:', error);
    
    // 记录失败日志
    await logMessageSend({
      type: 'TASK_CLAIMED',
      templateId: TEMPLATES.TASK_CLAIMED,
      recipient: applicantOpenid,
      taskId: taskId,
      error: error.message,
      success: false
    });
    
    return {
      success: false,
      message: '通知发送失败: ' + error.message,
      error: error,
      code: 'SEND_FAILED'
    };
  }
}

/**
 * 发送任务完成通知给主受理人
 * @param {Object} params - 参数对象
 * @returns {Promise<Object>} 发送结果
 */
async function sendTaskCompletedNotification(params) {
  const {
    assigneeOpenid,
    taskId,
    taskCategory,
    applicantName,
    maintenanceTaskId
  } = params;
  
  // 参数验证 - 移除对电话号码的依赖
  if (!assigneeOpenid || !taskId || !taskCategory || !applicantName) {
    return {
      success: false,
      message: '参数不完整',
      code: 'INVALID_PARAMS'
    };
  }
  
  try {
    // 构建消息数据 - 根据实际微信模板参数结构，移除电话号码字段
    const safeApplicantName = sanitizeNameForWechat(applicantName);
    const messageData = {
      number6: { value: taskId.toString().substring(0, 20) },                  // 报修单号
      date1: { value: formatChinaFromStrings(new Date().toISOString().split('T')[0], new Date().toTimeString().split(' ')[0]) },  // 报修时间
      thing5: { value: taskCategory.substring(0, 20) },                       // 报修内容
      name2: { value: safeApplicantName },                       // 报修人（符合微信 name 字段规范）
      thing23: { value: '您受理的该维修任务已完成，维修组感谢您的每一次无私奉献！祝您有一个充实的大学时光，让维修组伴您成长，成就更好的自我！'.substring(0, 20) }  // 温馨提示
    };
    
    // 发送订阅消息
    const sendResult = await cloud.openapi.subscribeMessage.send({
      touser: assigneeOpenid,
      template_id: TEMPLATES.TASK_COMPLETED,
      data: messageData,
      page: `${PAGES.TASK_DETAIL}?taskId=${maintenanceTaskId || taskId}`,
      miniprogram_state: 'formal'
    });
    
    // 记录发送日志
    await logMessageSend({
      type: 'TASK_COMPLETED',
      templateId: TEMPLATES.TASK_COMPLETED,
      recipient: assigneeOpenid,
      taskId: taskId,
      messageData: messageData,
      sendResult: sendResult,
      success: true
    });
    
    return {
      success: true,
      message: '任务完成通知发送成功',
      data: {
        templateId: TEMPLATES.TASK_COMPLETED,
        recipient: assigneeOpenid,
        taskId: taskId
      }
    };
    
  } catch (error) {
    console.error('发送任务完成通知失败:', error);
    
    // 记录失败日志
    await logMessageSend({
      type: 'TASK_COMPLETED',
      templateId: TEMPLATES.TASK_COMPLETED,
      recipient: assigneeOpenid,
      taskId: taskId,
      error: error.message,
      success: false
    });
    
    return {
      success: false,
      message: '通知发送失败: ' + error.message,
      error: error,
      code: 'SEND_FAILED'
    };
  }
}

/**
 * 发送任务取消通知给相关人员
 * @param {Object} params - 参数对象
 * @returns {Promise<Object>} 发送结果
 */
async function sendTaskCancelledNotification(params) {
  const {
    recipients,
    taskId,
    taskCategory,
    applicantName,
    maintenanceTaskId,
    cancelReason = '其他安排'
  } = params;
  
  // 参数验证 - 移除对电话号码的依赖
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return {
      success: false,
      message: '接收人列表不能为空',
      code: 'INVALID_RECIPIENTS'
    };
  }
  
  if (!taskId || !taskCategory || !applicantName) {
    return {
      success: false,
      message: '参数不完整',
      code: 'INVALID_PARAMS'
    };
  }
  
  const results = [];
  let successCount = 0;
  let failureCount = 0;
  
  // 构建消息数据 - 根据实际微信模板参数结构，移除电话号码字段
  const messageData = {
    thing1: { value: taskCategory.substring(0, 20) },                       // 报修类型
    thing3: { value: applicantName.substring(0, 20) },                       // 报修人
    time4: { value: formatChinaFromStrings(new Date().toISOString().split('T')[0], new Date().toTimeString().split(' ')[0]) },  // 报修时间
    time5: { value: formatChinaFromStrings(new Date().toISOString().split('T')[0], new Date().toTimeString().split(' ')[0]) }   // 取消时间
  };
  
  // 逐个发送给所有接收人
  for (const recipient of recipients) {
    if (!recipient.openid) {
      results.push({
        openid: 'unknown',
        role: recipient.role || 'unknown',
        success: false,
        error: '缺少openid'
      });
      failureCount++;
      continue;
    }
    
    try {
      const sendResult = await cloud.openapi.subscribeMessage.send({
        touser: recipient.openid,
        template_id: TEMPLATES.TASK_CANCELLED,
        data: messageData,
        page: `${PAGES.TASK_DETAIL}?taskId=${maintenanceTaskId || taskId}`,
        miniprogram_state: 'formal'
      });
      
      // 记录成功发送日志
      await logMessageSend({
        type: 'TASK_CANCELLED',
        templateId: TEMPLATES.TASK_CANCELLED,
        recipient: recipient.openid,
        recipientRole: recipient.role,
        taskId: taskId,
        messageData: messageData,
        sendResult: sendResult,
        success: true
      });
      
      results.push({
        openid: recipient.openid,
        role: recipient.role || 'unknown',
        success: true,
        sendResult: sendResult
      });
      successCount++;
      
    } catch (error) {
      console.error(`发送取消通知给${recipient.openid}失败:`, error);
      
      // 记录失败日志
      await logMessageSend({
        type: 'TASK_CANCELLED',
        templateId: TEMPLATES.TASK_CANCELLED,
        recipient: recipient.openid,
        recipientRole: recipient.role,
        taskId: taskId,
        error: error.message,
        success: false
      });
      
      results.push({
        openid: recipient.openid,
        role: recipient.role || 'unknown',
        success: false,
        error: error.message
      });
      failureCount++;
    }
  }
  
  return {
    success: successCount > 0,
    message: `任务取消通知发送完成: 成功${successCount}个, 失败${failureCount}个`,
    data: {
      templateId: TEMPLATES.TASK_CANCELLED,
      taskId: taskId,
      totalRecipients: recipients.length,
      successCount: successCount,
      failureCount: failureCount,
      results: results
    }
  };
}

/**
 * 发送志愿活动开始提醒通知
 * @param {Object} params - 参数对象
 * @returns {Promise<Object>} 发送结果
 */
async function sendActivityReminderNotification(params) {
  const {
    participants,
    activityId,
    activityName,
    startTime,
    location,
    description,
    miniprogramState = 'formal'
  } = params;
  
  // 参数验证
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return {
      success: false,
      message: '参与者列表不能为空',
      code: 'INVALID_PARTICIPANTS'
    };
  }
  
  if (!activityId || !activityName || !startTime || !location) {
    return {
      success: false,
      message: '参数不完整',
      code: 'INVALID_PARAMS'
    };
  }
  
  const results = [];
  let successCount = 0;
  let failureCount = 0;
  
  // 🔥 使用统一的时区处理工具
  
  
  // 解析活动开始时间（确保时区正确）
  let activityStartTime;
  try {
    if (typeof startTime === 'string') {
      // 如果是字符串，检查是否包含时区信息
      if (startTime.includes('T') && (startTime.includes('Z') || startTime.includes('+') || startTime.includes('-'))) {
        // ISO格式，直接解析
        activityStartTime = new Date(startTime);
      } else {
        // 假设是本地时间字符串，按照东八区处理
        activityStartTime = new Date(startTime);
        // 检查解析结果是否有效
        if (isNaN(activityStartTime.getTime())) {
          console.error('时间解析失败:', startTime);
          activityStartTime = new Date();
        }
      }
    } else {
      activityStartTime = new Date(startTime);
    }
  } catch (error) {
    console.error('时间解析异常:', error);
    activityStartTime = new Date();
  }

  // 格式化时间 - 微信订阅消息要求格式："2019年10月1日 15:01"
  const formattedTime = `${activityStartTime.getFullYear()}年${String(activityStartTime.getMonth() + 1).padStart(2, '0')}月${String(activityStartTime.getDate()).padStart(2, '0')}日 ${String(activityStartTime.getHours()).padStart(2, '0')}:${String(activityStartTime.getMinutes()).padStart(2, '0')}`;
  
  // 计算剩余时间 - 修复时区问题
  const now = new Date();
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 转换为东八区时间
  const timeDiffInMinutes = Number(Math.round((activityStartTime.getTime() - chinaTime.getTime()) / (1000 * 60)));
  
  
  
  let remainingTimeText = '';
  if (timeDiffInMinutes <= 0) {
    remainingTimeText = '活动已开始';
  } else if (timeDiffInMinutes < 60) {
    remainingTimeText = `还剩${timeDiffInMinutes}分钟`;
  } else {
    const hours = Math.floor(timeDiffInMinutes / 60);
    const minutes = timeDiffInMinutes % 60;
    if (minutes === 0) {
      remainingTimeText = `还剩${hours}小时`;
    } else {
      remainingTimeText = `还剩${hours}小时${minutes}分钟`;
    }
  }
  
  // 构建消息数据 - 根据志愿活动提醒模板参数结构
  const messageData = {
    character_string6: { value: activityId.toString().substring(0, 20) },     // 活动编号
    thing9: { value: activityName.substring(0, 20) },                          // 活动名称
    time2: { value: formattedTime },                                           // 活动时间
    thing4: { value: location.substring(0, 20) },                             // 活动地点
    thing5: { value: (description || '志愿活动提醒').substring(0, 20) }  // 备注：活动详情
  };
  
  
  
  // 逐个发送给所有参与者
  for (const participant of participants) {
    if (!participant.openid) {
      results.push({
        openid: 'unknown',
        name: participant.name || 'unknown',
        success: false,
        error: '缺少openid'
      });
      failureCount++;
      continue;
    }
    
    try {
      
      
      const sendResult = await cloud.openapi.subscribeMessage.send({
        touser: participant.openid,
        template_id: TEMPLATES.ACTIVITY_REMINDER,
        data: messageData,
        page: `${PAGES.VOLUNTEER_DETAIL}?id=${activityId}`,
        miniprogram_state: miniprogramState
      });
      
      
      
      // 记录成功发送日志
      await logMessageSend({
        type: 'ACTIVITY_REMINDER',
        templateId: TEMPLATES.ACTIVITY_REMINDER,
        recipient: participant.openid,
        recipientName: participant.name,
        activityId: activityId,
        messageData: messageData,
        sendResult: sendResult,
        success: true
      });
      
      results.push({
        openid: participant.openid,
        name: participant.name || 'unknown',
        success: true,
        sendResult: sendResult
      });
      successCount++;
      
    } catch (error) {
      console.error(`发送活动提醒给${participant.name} (${participant.openid.substring(0, 8)}***)失败:`, {
        error: error.message,
        errCode: error.errCode,
        errMsg: error.errMsg
      });
      
      // 记录失败日志
      await logMessageSend({
        type: 'ACTIVITY_REMINDER',
        templateId: TEMPLATES.ACTIVITY_REMINDER,
        recipient: participant.openid,
        recipientName: participant.name,
        activityId: activityId,
        error: error.message,
        success: false
      });
      
      results.push({
        openid: participant.openid,
        name: participant.name || 'unknown',
        success: false,
        error: error.message
      });
      failureCount++;
    }
  }
  
  const finalResult = {
    success: successCount > 0,
    message: `志愿活动提醒发送完成: 成功${successCount}个, 失败${failureCount}个`,
    data: {
      templateId: TEMPLATES.ACTIVITY_REMINDER,
      activityId: activityId,
      totalParticipants: participants.length,
      successCount: successCount,
      failureCount: failureCount,
      results: results
    }
  };
  
  
  
  return finalResult;
}

/**
 * 记录消息发送日志
 * @param {Object} logData - 日志数据
 */
async function logMessageSend(logData) {
  try {
    const logRecord = {
      ...logData,
      timestamp: new Date(),
      cloudFunctionRequestId: String(cloud.getWXContext().REQUESTID || '')
    };
    
    await db.collection('message_send_logs').add({
      data: logRecord
    });
    
  } catch (error) {
    console.error('记录消息发送日志失败:', error);
    
    // 如果是集合不存在错误，尝试创建集合
    if (error.errCode === -502005) {
      try {
        
        await db.createCollection('message_send_logs');
        
        
        // 重新尝试添加日志
        const logRecord = {
          ...logData,
          timestamp: new Date(),
          cloudFunctionRequestId: cloud.getWXContext().REQUESTID
        };
        
        await db.collection('message_send_logs').add({
          data: logRecord
        });
        
      } catch (createErr) {
        console.error('创建集合或重新记录日志失败:', createErr);
      }
    }
    // 日志记录失败不影响主要功能
  }
}

/**
 * 获取消息发送统计
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} 统计结果
 */
async function getMessageStats(params = {}) {
  try {
    const { startDate, endDate, type } = params;
    
    // 构建查询条件
    let query = db.collection('message_send_logs');
    
    if (startDate || endDate) {
      let dateFilter = {};
      if (startDate) {
        dateFilter.gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.lte = new Date(endDate);
      }
      query = query.where({
        timestamp: dateFilter
      });
    }
    
    if (type) {
      query = query.where({
        type: type
      });
    }
    
    // 获取日志数据
    const { data: logs } = await query.orderBy('timestamp', 'desc').limit(1000).get();
    
    // 统计分析
    const stats = {
      totalMessages: logs.length,
      successCount: logs.filter(log => log.success).length,
      failureCount: logs.filter(log => !log.success).length,
      byType: {},
      byDate: {},
      recentErrors: []
    };
    
    // 按类型统计
    logs.forEach(log => {
      if (!stats.byType[log.type]) {
        stats.byType[log.type] = { total: 0, success: 0, failure: 0 };
      }
      stats.byType[log.type].total++;
      if (log.success) {
        stats.byType[log.type].success++;
      } else {
        stats.byType[log.type].failure++;
      }
    });
    
    // 按日期统计
    logs.forEach(log => {
      const date = log.timestamp.toISOString().split('T')[0];
      if (!stats.byDate[date]) {
        stats.byDate[date] = { total: 0, success: 0, failure: 0 };
      }
      stats.byDate[date].total++;
      if (log.success) {
        stats.byDate[date].success++;
      } else {
        stats.byDate[date].failure++;
      }
    });
    
    // 最近的错误
    stats.recentErrors = logs
      .filter(log => !log.success)
      .slice(0, 10)
      .map(log => ({
        timestamp: log.timestamp,
        type: log.type,
        error: log.error,
        recipient: log.recipient,
        taskId: log.taskId
      }));
    
    // 成功率
    stats.successRate = stats.totalMessages > 0 
      ? (stats.successCount / stats.totalMessages * 100).toFixed(2)
      : 0;
    
    return {
      success: true,
      message: '获取消息统计成功',
      data: stats
    };
    
  } catch (error) {
    console.error('获取消息统计失败:', error);
    return {
      success: false,
      message: '获取统计失败: ' + error.message,
      error: error,
      code: 'STATS_ERROR'
    };
  }
}

/**
 * 发送值班提醒通知
 * @param {Object} params - 参数对象
 * @returns {Promise<Object>} 发送结果
 */
async function sendDutyReminderNotification(params) {
  const {
    dutySlots,           // 值班时间段数组
    miniprogramState = 'formal'  // 小程序版本状态，默认正式版
  } = params;

  

  // 参数验证
  if (!dutySlots || !Array.isArray(dutySlots) || dutySlots.length === 0) {
    return {
      success: false,
      message: '参数错误：缺少值班时间段列表',
      code: 'INVALID_PARAMS'
    };
  }

  let successCount = 0;
  let failureCount = 0;
  const results = [];

  

  // 逐个发送给每个值班人员
  for (const dutySlot of dutySlots) {
    if (!dutySlot.dutyHolderId || !dutySlot.dutyHolderName) {
      results.push({
        dutySlotId: dutySlot.dutySlotId,
        success: false,
        error: '值班时间段未分配值班人员'
      });
      failureCount++;
      continue;
    }

    try {
      

      // 改为用原始字符串拼接，彻底避免时区偏移
      const dutyDate = formatChinaFromStrings(dutySlot.date, dutySlot.startTime); // time1
      const workTime = formatChinaFromStrings(dutySlot.date, dutySlot.endTime);   // time12
      
      // 构建订阅消息数据
      const messageData = {
        // 值班日期
        time1: {
          value: dutyDate
        },
        // 工作时间
        time12: {
          value: workTime
        },
        // 值班地点
        thing9: {
          value: '格物楼5楼维修组活动室'.substring(0, 20)
        }
      };

      

      const sendResult = await cloud.openapi.subscribeMessage.send({
        touser: dutySlot.dutyHolderId,
        template_id: TEMPLATES.DUTY_REMINDER,
        data: messageData,
        page: PAGES.DUTY_ROSTER,
        miniprogram_state: miniprogramState
      });

      

      // 记录成功发送日志
      await logMessageSend({
        type: 'DUTY_REMINDER',
        templateId: TEMPLATES.DUTY_REMINDER,
        recipient: dutySlot.dutyHolderId,
        recipientName: dutySlot.dutyHolderName,
        dutySlotId: dutySlot.dutySlotId,
        dutyDate: dutySlot.date,
        dutyTime: workTime,
        messageData: messageData,
        sendResult: sendResult,
        success: true
      });

      results.push({
        dutySlotId: dutySlot.dutySlotId,
        dutyHolderId: dutySlot.dutyHolderId,
        dutyHolderName: dutySlot.dutyHolderName,
        success: true,
        sendResult: sendResult
      });
      successCount++;

    } catch (error) {
      console.error(`发送值班提醒给${dutySlot.dutyHolderName}失败:`, error);

      // 记录失败发送日志
      await logMessageSend({
        type: 'DUTY_REMINDER',
        templateId: TEMPLATES.DUTY_REMINDER,
        recipient: dutySlot.dutyHolderId,
        recipientName: dutySlot.dutyHolderName,
        dutySlotId: dutySlot.dutySlotId,
        dutyDate: dutySlot.date,
        dutyTime: `${dutySlot.startTime}-${dutySlot.endTime}`,
        error: error.message,
        success: false
      });

      results.push({
        dutySlotId: dutySlot.dutySlotId,
        dutyHolderId: dutySlot.dutyHolderId,
        dutyHolderName: dutySlot.dutyHolderName,
        success: false,
        error: error.message
      });
      failureCount++;
    }
  }

  

  return {
    success: true,
    message: `值班提醒发送完成: 成功${successCount}个，失败${failureCount}个`,
    data: {
      totalCount: dutySlots.length,
      successCount: successCount,
      failureCount: failureCount,
      results: results
    }
  };
}

/**
 * 格式化值班日期为用户友好的格式
 * @param {string} dateStr - 日期字符串 (YYYY-MM-DD)
 * @returns {string} 格式化后的日期字符串 (例如: 3月15日 周一)
 */
function formatDutyDate(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00+08:00'); // 确保使用东八区时间
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekDay = weekDays[date.getDay()];
    
    return `${month}月${day}日 ${weekDay}`;
  } catch (error) {
    console.error('格式化值班日期失败:', error);
    return dateStr; // 降级返回原始日期字符串
  }
}


