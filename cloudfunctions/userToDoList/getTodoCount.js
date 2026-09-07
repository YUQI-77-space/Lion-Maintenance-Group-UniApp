// 获取待办事项数量
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
  const now = new Date()
  const chinaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000))
  return chinaTime
}

/**
 * 获取待办事项数量
 * @param {Object} params - 参数对象
 * @param {string} params.type - 待办事项类型 (maintenance-维修任务, volunteer-志愿活动, duty-值班任务, all-所有)
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回待办事项数量
 */
exports.getTodoCount = async (params, OPENID) => {
  try {
    // 默认获取所有类型的待办事项数量
    const type = params.type || 'all'
    
    // 存储各类型的数量
    const counts = {
      maintenance: 0,
      volunteer: 0,
      duty: 0,
      total: 0
    }
    
    // 根据类型获取不同的待办事项数量
    if (type === 'all' || type === 'maintenance') {
      // 仅统计维修任务的待受理与进行中
      const maintenanceCount = await db.collection('maintenance_toDo_list')
        .where({
          toDoListUserId: OPENID,
          taskStatus: _.in(['pending', 'inProgress'])
        })
        .count()
      
      counts.maintenance = maintenanceCount.total
      counts.total += maintenanceCount.total
    }
    
    if (type === 'all' || type === 'volunteer') {
      const volunteerCount = await db.collection('volunteer_toDo_list')
        .where({
          toDoListUserId: OPENID,
          // 仅统计未结束：排除 ended
          activityStatus: _.neq('ended')
        })
        .count()
      
      counts.volunteer = volunteerCount.total
      counts.total += volunteerCount.total
    }
    
    // 修复：统计值班任务待办数量（仅未结束）
    if (type === 'all' || type === 'duty') {
      // 获取所有值班任务，然后计算状态
      const dutyTasks = await db.collection('duty_toDo_list')
        .where({
          toDoListUserId: OPENID
        })
        .get()
      
      // 计算每个任务的状态，只统计未结束的
      let activeDutyCount = 0
      dutyTasks.data.forEach(duty => {
        const dutyStatus = calculateDutyStatus(duty.date, duty.startTime, duty.endTime)
        // 只有待值班和进行中的任务才计入计数
        if (dutyStatus === 'pending' || dutyStatus === 'inProgress') {
          activeDutyCount++
        }
      })
      
      counts.duty = activeDutyCount
      counts.total += activeDutyCount
    }
    
    return {
      code: 200,
      data: counts,
      message: '获取待办事项数量成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '获取待办事项数量失败'
    }
  }
} 