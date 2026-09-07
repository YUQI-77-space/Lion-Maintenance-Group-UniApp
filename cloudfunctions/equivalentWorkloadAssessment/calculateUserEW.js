// 计算用户等效工作量
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 计算用户等效工作量（实时从各集合计算，确保数据准确性）
 * @param {Object} params - 参数对象
 * @param {string} params.userId - 用户ID
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回用户的等效工作量数据
 */
exports.calculateUserEW = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.userId) {
      return {
        code: 400,
        data: null,
        message: '缺少用户ID参数'
      }
    }
    
    // 检查用户权限
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
    
    // 只有组长或者用户本人可以计算EW
    if (user.role !== 'leader' && OPENID !== params.userId) {
      return {
        code: 403,
        data: null,
        message: '无权计算此用户的等效工作量'
      }
    }
    
    // 查询目标用户信息
    const targetUserResult = await db.collection('users').where({
      openid: params.userId
    }).get()
    
    if (targetUserResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到目标用户信息'
      }
    }
    
    const targetUser = targetUserResult.data[0]
    
    // 计算维修任务EW
    const maintenanceTasks = await db.collection('maintenance_tasks').where(
      db.command.and([
        { taskStatus: 'completed' },
        db.command.or([
          { assigneeId: params.userId },
          { additionalAssignees: db.command.elemMatch({ assigneeId: params.userId }) }
        ])
      ])
    ).get()
    
    const maintenanceEW = maintenanceTasks.data.reduce((total, task) => {
      return total + (task.ew || 0)
    }, 0)

    
    // 计算志愿活动EW
    const volunteerActivities = await db.collection('voluntary_activities').where({
      participantsIDList: params.userId,
      activityStatus: 'ended'
    }).get()
    
    let volunteerEW = 0
    for (const activity of volunteerActivities.data) {
      const v = Number((activity.participantEWMap || {})[params.userId] || 0)
      if (isFinite(v)) volunteerEW += v
    }
    
    // 获取值班EW（只计算已结束的值班任务，确保数据准确性）
    const dutySlots = await db.collection('duty_slots').where({
      dutyHolderId: params.userId,
      dutyStatus: 'ended' // 只计算已结束的值班任务
    }).get()
    
    const dutySlotsCount = dutySlots.data.length
    const dutyEW = dutySlotsCount * 2 // 每个已结束的值班时间段对应2分EW
    
    console.log(`[calculateUserEW] 用户 ${params.userId} 已结束值班任务：${dutySlotsCount}个，计算值班EW：${dutyEW}分`)
    
    // 计算总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
    const totalEW = Math.round((maintenanceEW * 0.5 + volunteerEW * 0.4 + dutyEW * 0.1) * 100) / 100
    
    // 整理返回数据
    const ewData = {
      userId: params.userId,
      userName: targetUser.nickName || '',


      maintenanceEW,
      volunteerEW,
      dutyEW,
      totalEW,
      maintenanceTasksCount: maintenanceTasks.data.length,
      volunteerActivitiesCount: volunteerActivities.data.length,
      dutySlotsCount: dutySlotsCount
    }
    
    return {
      code: 200,
      data: ewData,
      message: '计算用户等效工作量成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '计算用户等效工作量失败'
    }
  }
} 