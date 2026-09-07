// 更新指定用户的等效工作量
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 更新指定用户的等效工作量
 * @param {Object} params - 参数对象
 * @param {string} params.userId - 用户ID
 * @param {number} params.maintenanceEW - 维修任务等效工作量
 * @param {number} params.dutyEW - 值班等效工作量
 * @param {number} params.volunteerEW - 志愿活动等效工作量
 * @param {string} OPENID - 操作用户openid
 * @returns {Object} 返回更新结果
 */
exports.updateUserEW = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.userId) {
      return {
        code: 400,
        data: null,
        message: '缺少用户ID参数'
      }
    }
    
    // 检查操作用户权限（只有组长可以更新用户EW）
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
    
    if (user.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长才能更新用户工作量'
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
    
    // 处理输入的工作量值（这些数值被视为“期望的最终显示值”）
    let maintenanceDesired = parseFloat(params.maintenanceEW) || 0
    let volunteerDesired = parseFloat(params.volunteerEW) || 0
    let dutyDesired = parseFloat(params.dutyEW) || 0
    
    // 后端校验与上限：单项<=300，总<=900
    maintenanceDesired = Math.min(300, Math.max(0, maintenanceDesired))
    volunteerDesired = Math.min(300, Math.max(0, volunteerDesired))
    dutyDesired = Math.min(300, Math.max(0, dutyDesired))
    if ((maintenanceDesired + volunteerDesired + dutyDesired) > 900) {
      const scale = 900 / (maintenanceDesired + volunteerDesired + dutyDesired)
      maintenanceDesired = Math.floor(maintenanceDesired * scale)
      volunteerDesired = Math.floor(volunteerDesired * scale)
      dutyDesired = Math.floor(dutyDesired * scale)
    }
    
    // 读取当前系统自动计算值（不含手调）：从相关集合实时计算
    // 维修EW
    const maintenanceTasks = await db.collection('maintenance_tasks').where(
      db.command.and([
        { taskStatus: 'completed' },
        db.command.or([
          { assigneeId: params.userId },
          { additionalAssignees: db.command.elemMatch({ assigneeId: params.userId }) }
        ])
      ])
    ).get()
    const maintenanceAuto = maintenanceTasks.data.reduce((sum, t) => sum + (t.ew || 0), 0)
    
    // 志愿EW
    const volunteerActivities = await db.collection('voluntary_activities').where({
      participantsIDList: params.userId,
      activityStatus: 'ended'
    }).get()
    const volunteerAuto = volunteerActivities.data.reduce((sum, a) => {
      const v = Number((a.participantEWMap || {})[params.userId] || 0)
      return sum + (isFinite(v) ? v : 0)
    }, 0)
    
    // 值班EW（只计算已结束）
    const dutySlots = await db.collection('duty_slots').where({
      dutyHolderId: params.userId,
      dutyStatus: 'ended'
    }).get()
    const dutyAuto = (dutySlots.data.length || 0) * 2
    
    // 计算需要记录在manual字段中的差值（手动调整 = 期望值 - 自动值）
    const manualMaintenanceEW = maintenanceDesired - maintenanceAuto
    const manualVolunteerEW = volunteerDesired - volunteerAuto
    const manualDutyEW = dutyDesired - dutyAuto
    
    // 最终显示值 = 自动 + 手调
    const maintenanceFinal = maintenanceAuto + manualMaintenanceEW
    const volunteerFinal = volunteerAuto + manualVolunteerEW
    const dutyFinal = dutyAuto + manualDutyEW
    // 计算总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
    const totalFinal = Math.round((maintenanceFinal * 0.5 + volunteerFinal * 0.4 + dutyFinal * 0.1) * 100) / 100
    
    // 检查是否已有汇总记录
    const summaryResult = await db.collection('ewaSummary').where({
      ewaUserId: params.userId
    }).get()
    
    if (summaryResult.data.length > 0) {
      // 更新现有记录：写入manual字段，并同步最终数值
      await db.collection('ewaSummary').where({
        ewaUserId: params.userId
      }).update({
        data: {
          manualMaintenanceEW,
          manualVolunteerEW,
          manualDutyEW,
          maintenanceEW: maintenanceFinal,
          volunteerEW: volunteerFinal,
          dutyEW: dutyFinal,
          totalEW: totalFinal,
          updateTime: new Date()
        }
      })
    } else {
      // 创建新记录：包含manual字段
      await db.collection('ewaSummary').add({
        data: {
          ewaUserId: params.userId,
          ewaUserName: targetUser.nickName || '',


          manualMaintenanceEW,
          manualVolunteerEW,
          manualDutyEW,
          maintenanceEW: maintenanceFinal,
          volunteerEW: volunteerFinal,
          dutyEW: dutyFinal,
          totalEW: totalFinal,
          createTime: new Date(),
          updateTime: new Date()
        }
      })
    }
    
    // 记录操作日志
    console.log(`[updateUserEW] 组长${user.nickName}(${OPENID})手动调整用户${targetUser.nickName}(${params.userId})，最终值：` +
      `maintenance=${maintenanceFinal}, volunteer=${volunteerFinal}, duty=${dutyFinal}, total=${totalFinal}`)
    
    return {
      code: 200,
      data: {
        userId: params.userId,
        maintenanceEW: maintenanceFinal,
        dutyEW: dutyFinal,
        volunteerEW: volunteerFinal,
        totalEW: totalFinal
      },
      message: '更新用户工作量成功'
    }
  } catch (err) {
    console.error('[updateUserEW] 更新用户工作量失败', err)
    return {
      code: 500,
      data: null,
      message: err.message || '更新用户工作量失败'
    }
  }
} 