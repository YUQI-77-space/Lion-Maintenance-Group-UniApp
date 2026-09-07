// 获取用户待办事项列表
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 计算值班任务状态
 * @param {string} date - 值班日期 (YYYY-MM-DD)
 * @param {string} startTime - 开始时间 (HH:MM)
 * @param {string} endTime - 结束时间 (HH:MM)
 * @returns {string} 任务状态：'pending' | 'inProgress' | 'ended'
 */
function calculateDutyStatus(date, startTime, endTime) {
  try {
    // 使用东八区当前时间进行比较
    const now = getChinaTime()
    
    // 直接构建带时区信息的完整时间字符串，避免使用setHours导致的时区问题
    // 格式: YYYY-MM-DDTHH:MM:SS+08:00
    const dutyStartTime = new Date(`${date}T${startTime}:00+08:00`)
    const dutyEndTime = new Date(`${date}T${endTime}:00+08:00`)
    
    // 计算状态
    if (now < dutyStartTime) {
      return 'pending'    // 待值班
    } else if (now >= dutyStartTime && now <= dutyEndTime) {
      return 'inProgress' // 进行中
    } else {
      return 'ended'      // 已结束
    }
  } catch (error) {
    console.error('[calculateDutyStatus] 计算状态失败：', error)
    return 'pending' // 默认返回待值班
  }
}

/**
 * 获取东八区当前时间
 * @returns {Date} 东八区当前时间
 */
function getChinaTime() {
  const now = new Date();
  // 云函数中的Date对象是UTC时间，需要转换为东八区时间
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

/**
 * 将时间字符串转换为东八区Date对象
 * @param {string} timeString 时间字符串
 * @returns {Date} 东八区时间对象
 */
function parseChinaTime(timeString) {
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
 * 计算志愿活动状态 - 使用与voluntary_activities相同的时区处理逻辑
 * @param {string|Date} startTime - 活动开始时间
 * @param {string|Date} endTime - 活动结束时间
 * @returns {string} 活动状态：'inPreparation' | 'inProgress' | 'ended'
 */
function calculateVolunteerActivityStatus(startTime, endTime) {
  try {
    const now = getChinaTime();
    const start = typeof startTime === 'string' ? parseChinaTime(startTime) : startTime;
    const end = typeof endTime === 'string' ? parseChinaTime(endTime) : endTime;
    
    // 检查时间有效性
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      console.error('[calculateVolunteerActivityStatus] 无效的时间参数:', { startTime, endTime });
      return 'inPreparation'; // 默认返回筹备中
    }
    
    
    
    const currentTimestamp = Number(now.getTime());
    const startTimestamp = Number(start.getTime());
    const endTimestamp = Number(end.getTime());
    
    // 计算状态
    if (currentTimestamp < startTimestamp) {
      return 'inPreparation'; // 筹备中
    } else if (currentTimestamp >= startTimestamp && currentTimestamp <= endTimestamp) {
      return 'inProgress';    // 进行中
    } else {
      return 'ended';         // 已结束
    }
  } catch (error) {
    console.error('[calculateVolunteerActivityStatus] 计算状态失败：', error);
    return 'inPreparation'; // 默认返回筹备中
  }
}

/**
 * 获取待办事项列表
 * @param {Object} params - 参数对象
 * @param {string} params.type - 待办事项类型 (maintenance-维修任务, volunteer-志愿活动, duty-值班任务)
 * @param {string} params.userId - 用户ID（可选，默认使用OPENID）
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回待办事项列表
 */
exports.getTodoList = async (params, OPENID) => {
  try {
    const userId = params.userId || OPENID;
    

    if (!params.type) {
      return { code: 400, message: '缺少待办事项类型' };
    }

    let todoList = [];
    let responseMessage = '';

    switch (params.type) {
      case 'maintenance':
        responseMessage = '获取维修任务待办列表成功';
        
        const maintenanceResult = await db.collection('maintenance_toDo_list')
          .where({ toDoListUserId: userId })
          .orderBy('updateTime', 'desc')
          .get();

        let tasks = maintenanceResult.data;

        if (tasks.length > 0) {
          const taskIds = tasks.map(task => task.taskId);
          

          const mainTasksResult = await db.collection('maintenance_tasks')
            .where({ maintenanceTaskId: db.command.in(taskIds) })
            .field({
              maintenanceTaskId: true,
              level1: true,
              level2: true,
              level3: true,
              // 关键：主受理人字段
              assigneeId: true,
              assigneeName: true,

              assigneeQqId: true,
              assigneeTime: true
            })
            .get();
          
          

          if (mainTasksResult.data.length > 0) {
            const mainTasksMap = new Map();
            mainTasksResult.data.forEach(task => {
              mainTasksMap.set(task.maintenanceTaskId, task);
            });
            
            tasks = tasks.map(todo => {
              const mainTask = mainTasksMap.get(todo.taskId);
              if (!mainTask) {
                console.warn(`[getTodoList] - 警告：未找到taskId为 ${todo.taskId} 的主任务详情`);
              }
              return {
                ...todo,
                level1: mainTask ? mainTask.level1 : '未知',
                level2: mainTask ? mainTask.level2 : '未知',
                level3: mainTask ? mainTask.level3 : '未知',
                // 用主任务的主受理人覆盖，防止协助受理人在列表里被当作主受理人显示
                assigneeId: mainTask && mainTask.assigneeId ? mainTask.assigneeId : todo.assigneeId,
                assigneeName: mainTask && mainTask.assigneeName ? mainTask.assigneeName : todo.assigneeName,

                assigneeQqId: mainTask && mainTask.assigneeQqId ? mainTask.assigneeQqId : todo.assigneeQqId,
                assigneeTime: mainTask && mainTask.assigneeTime ? mainTask.assigneeTime : todo.assigneeTime
              };
            });
          } else {
            console.warn('[getTodoList] - 警告：无法从主任务表获取详情，将使用默认值');
            tasks = tasks.map(todo => ({
              ...todo,
              level1: '获取失败',
              level2: '获取失败',
              level3: '获取失败'
            }));
          }
        }

        todoList = tasks.map(({ isUrgent, ...task }) => task);
        break;

      case 'volunteer':
        responseMessage = '获取志愿活动待办列表成功';
        const volunteerListResult = await db.collection('volunteer_toDo_list')
          .where({ toDoListUserId: userId })
          .orderBy('updateTime', 'desc')
          .get();

        let volunteerTodos = volunteerListResult.data || [];

        if (volunteerTodos.length > 0) {
          const taskIds = volunteerTodos
            .map(item => item.taskId)
            .filter(Boolean);

          if (taskIds.length > 0) {
            const activitiesResult = await db.collection('voluntary_activities')
              .where({
                activityId: _.in(taskIds)
              })
              .field({
                activityId: true,
                activityStatus: true,
                title: true,
                description: true,
                startTime: true,
                endTime: true,
                location: true,
                duration: true,
                volunteerHours: true
              })
              .get();

            const activityMap = new Map();
            (activitiesResult.data || []).forEach(activity => {
              activityMap.set(activity.activityId, activity);
            });

            const orphanTodoRemovals = [];
            volunteerTodos = volunteerTodos.filter(todo => {
              const activity = activityMap.get(todo.taskId);
              if (!activity) {
                // 关联活动已不存在，清理孤立待办并从结果中剔除
                orphanTodoRemovals.push(
                  db.collection('volunteer_toDo_list')
                    .doc(todo._id)
                    .remove()
                );
                return false;
              }

              todo.activityStatus = activity.activityStatus ||
                calculateVolunteerActivityStatus(activity.startTime, activity.endTime);
              todo.title = todo.title || activity.title;
              todo.description = activity.description || todo.description || '';
              todo.startTime = activity.startTime || todo.startTime;
              todo.endTime = activity.endTime || todo.endTime;
              todo.location = activity.location || todo.location || '';
              todo.duration = activity.duration || todo.duration || 0;
              todo.volunteerHours = activity.volunteerHours ||
                todo.volunteerHours || activity.duration || 0;
              return true;
            });

            if (orphanTodoRemovals.length > 0) {
              await Promise.allSettled(orphanTodoRemovals);
            }
          }
        }

        todoList = volunteerTodos.map(item => ({
          ...item,
          activityStatus: item.activityStatus ||
            calculateVolunteerActivityStatus(item.startTime, item.endTime)
        }));
        break;

      case 'duty':
        responseMessage = '获取值班任务待办列表成功';
        const dutyListResult = await db.collection('duty_toDo_list')
          .where({ toDoListUserId: userId })
          .orderBy('date', 'desc')
          .get();
        {
          const updates = []
          todoList = (dutyListResult.data || []).map(item => {
            const computedStatus = calculateDutyStatus(item.date, item.startTime, item.endTime)
            // 若库中status与计算状态不一致，则回写同步
            if (item.status !== computedStatus) {
              updates.push(
                db.collection('duty_toDo_list')
                  .where({
                    toDoListUserId: userId,
                    dutySlotId: item.dutySlotId
                  })
                  .update({
                    data: {
                      status: computedStatus,
                      updateTime: new Date()
                    }
                  })
              )
            }
            return {
              ...item,
              dutyStatus: computedStatus,
              dutyStatusText: computedStatus === 'pending' ? '待值班' : (computedStatus === 'inProgress' ? '进行中' : '已结束')
            }
          })
          if (updates.length > 0) {
            try {
              await Promise.allSettled(updates)
            } catch (syncErr) {
              console.error('[getTodoList] - 同步更新 duty_toDo_list 状态失败：', syncErr)
            }
          }
        }
        break;

      default:
        return { code: 400, message: '不支持的待办事项类型' };
    }

    

    return {
      code: 200,
      data: todoList,
      message: responseMessage
    }

  } catch (err) {
    console.error('[getTodoList] - 获取待办列表出错:', err)
    return {
      code: 500,
      message: err.message || '数据库查询失败'
    }
  }
} 
