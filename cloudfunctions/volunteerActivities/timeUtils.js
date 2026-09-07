/**
 * 时间处理工具 - 统一时区处理和状态计算
 * 确保所有时间操作都基于东八区（GMT+8）
 */

/**
 * 获取东八区当前时间
 * @returns {Date} 东八区当前时间
 */
function getChinaTime() {
  const now = new Date();
  // 云函数中的Date对象是UTC时间，需要转换为东八区时间
  // 确保最终结果为 Number 类型
  return new Date(Number(now.getTime()) + 8 * 60 * 60 * 1000);
}

/**
 * 将时间字符串转换为东八区Date对象
 * @param {string} timeString 时间字符串
 * @returns {Date} 东八区时间对象
 */
function parseChinaTime(timeString) {
  // 检查并处理包含 BigInt 的高精度时间字符串
  const regex = /(\.\d{3})\d+Z$/;
  const match = timeString.match(regex);
  if (match) {
    // 将微秒或更高精度部分强制转换为毫秒（Number类型）
    const milliseconds = Math.round(Number(`0${match[1]}`) * 1000);
    const simplifiedString = timeString.replace(regex, `.${String(milliseconds).padStart(3, '0')}Z`);
    return new Date(simplifiedString);
  }

  const date = new Date(timeString);
  // 如果传入的时间没有时区信息，默认当作东八区时间处理
  if (!timeString.includes('GMT') && !timeString.includes('+') && !timeString.includes('Z')) {
    // 假设传入的是东八区时间，需要转换为UTC再处理
    const utcTime = date.getTime() - (8 * 3600000);
    return new Date(utcTime + (8 * 3600000));
  }
  return date;
}

/**
 * 格式化东八区时间为字符串
 * @param {Date} date 时间对象
 * @returns {string} 格式化的时间字符串
 */
function formatChinaTime(date) {
  // 如果传入的date已经是东八区时间，直接格式化
  // 如果是UTC时间，需要转换
  const chinaDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return chinaDate.toISOString().replace('Z', '+08:00');
}

/**
 * 根据开始时间和结束时间计算活动状态
 * @param {string|Date} startTime 开始时间
 * @param {string|Date} endTime 结束时间
 * @returns {string} 活动状态：'inPreparation' | 'inProgress' | 'ended'
 */
function calculateActivityStatus(startTime, endTime) {
  try {
    const now = getChinaTime();
    const start = typeof startTime === 'string' ? parseChinaTime(startTime) : startTime;
    const end = typeof endTime === 'string' ? parseChinaTime(endTime) : endTime;
    
    const currentTimestamp = Number(now.getTime());
    const startTimestamp = Number(start.getTime());
    const endTimestamp = Number(end.getTime());
    
    
    
    if (currentTimestamp < startTimestamp) {
      return 'inPreparation'; // 筹备中
    } else if (currentTimestamp >= startTimestamp && currentTimestamp <= endTimestamp) {
      return 'inProgress'; // 进行中
    } else {
      return 'ended'; // 已结束
    }
  } catch (error) {
    console.error('[时间状态计算错误]', error);
    return 'inPreparation'; // 默认返回筹备中
  }
}

/**
 * 批量计算多个活动的状态
 * @param {Array} activities 活动列表
 * @returns {Array} 更新状态后的活动列表
 */
function batchCalculateActivityStatus(activities) {
  return activities.map(activity => {
    const newStatus = calculateActivityStatus(activity.startTime, activity.endTime);
    return {
      ...activity,
      activityStatus: newStatus,
      statusCalculatedAt: formatChinaTime(getChinaTime())
    };
  });
}

/**
 * 检查活动状态是否需要更新
 * @param {Object} activity 活动对象
 * @returns {Object} 包含是否需要更新和新状态的对象
 */
function checkStatusNeedsUpdate(activity) {
  const currentStatus = activity.activityStatus;
  
  // 如果是待发布状态，检查是否需要自动发布
  if (currentStatus === 'pending') {
    if (activity.scheduledPublish && activity.publishTime) {
      const now = getChinaTime();
      const publish = parseChinaTime(activity.publishTime);
      
      // 如果发布时间已到，需要自动发布
      if (now.getTime() >= publish.getTime()) {
        // 发布时间已到，计算正常状态
        const calculatedStatus = calculateActivityStatus(activity.startTime, activity.endTime);
        return {
          needsUpdate: true,
          oldStatus: currentStatus,
          newStatus: calculatedStatus,
          activity: activity,
          isAutoPublish: true // 标记为自动发布
        };
      } else {
        // 发布时间未到，保持待发布状态
        return {
          needsUpdate: false,
          oldStatus: currentStatus,
          newStatus: currentStatus,
          activity: activity
        };
      }
    } else {
      // 如果没有发布时间信息，直接计算正常状态（异常情况处理）
      const calculatedStatus = calculateActivityStatus(activity.startTime, activity.endTime);
      return {
        needsUpdate: true,
        oldStatus: currentStatus,
        newStatus: calculatedStatus,
        activity: activity
      };
    }
  }
  
  // 非待发布状态，使用正常状态判断
  const calculatedStatus = calculateActivityStatus(activity.startTime, activity.endTime);
  
  return {
    needsUpdate: currentStatus !== calculatedStatus,
    oldStatus: currentStatus,
    newStatus: calculatedStatus,
    activity: activity
  };
}

module.exports = {
  getChinaTime,
  parseChinaTime,
  formatChinaTime,
  calculateActivityStatus,
  batchCalculateActivityStatus,
  checkStatusNeedsUpdate
}; 