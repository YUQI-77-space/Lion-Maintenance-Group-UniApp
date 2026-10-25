// 更新等效工作量汇总
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 计算值班任务状态
 * @param {string} date - 值班日期 (YYYY-MM-DD)
 * @param {string} startTime - 开始时间 (HH:MM)
 * @param {string} endTime - 结束时间 (HH:MM)
 * @returns {string} 任务状态：'pending' | 'inProgress' | 'ended'
 */
function calculateDutyStatus(date, startTime, endTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return null
  const start = Date.parse(`${date}T${startTime}:00+08:00`)
  const end = Date.parse(`${date}T${endTime}:00+08:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      new Date(start + 8 * 3600000).toISOString().slice(0, 10) !== date) return null
  const now = Date.now() // 起止时间已经带时区，当前绝对时间不能再加8小时。
  return now < start ? 'pending' : now <= end ? 'inProgress' : 'ended'
}

/**
 * 更新等效工作量汇总（重新计算所有EW数据确保一致性）
 * @param {Object} params - 参数对象
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回更新结果
 */
exports.updateSummary = async (params, OPENID) => {
  try {
    // 检查用户权限（只有组长可以更新汇总数据）
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
        message: '只有组长才能更新EW汇总数据'
      }
    }
    
    // 分页读取全部成员，避免 .get() 默认只返回 100 人。
    const memberResult = { data: [] }
    let cursor = ''
    while (true) {
      const condition = { role: db.command.in(['member', 'leader']) }
      if (cursor) condition._id = db.command.gt(cursor)
      const page = await db.collection('proUsers').where(condition)
        .orderBy('_id', 'asc').limit(100).get()
      memberResult.data.push(...page.data)
      if (page.data.length < 100) break
      cursor = page.data[page.data.length - 1]._id
    }
    
    // 更新每个成员的EW汇总
    const updatePromises = memberResult.data.map(async (member) => {
      // 计算维修任务EW
      const maintenanceTasks = await db.collection('maintenance_tasks').where(
        db.command.and([
          { taskStatus: 'completed' },
          db.command.or([
            { assigneeId: member.openid },
            { additionalAssignees: db.command.elemMatch({ assigneeId: member.openid }) }
          ])
        ])
      ).get()
      
      const maintenanceEW = maintenanceTasks.data.reduce((total, task) => {
        return total + (task.ew || 0)
      }, 0)
      
      // 计算志愿活动EW
      const volunteerActivities = await db.collection('voluntary_activities').where({
        participantsIDList: member.openid,
        activityStatus: 'ended'
      }).get()
      
      let volunteerEW = 0
      for (const activity of volunteerActivities.data) {
        const v = Number((activity.participantEWMap || {})[member.openid] || 0)
        if (isFinite(v)) volunteerEW += v
      }
      
      // 重新计算值班EW（只计算已结束的值班任务）
      const dutySlots = await db.collection('duty_slots').where({
        dutyHolderId: member.openid,
        dutyStatus: 'ended' // 只计算已结束的值班任务
      }).get()
      
      let actualDutyEW = dutySlots.data.length * 2 // 每个已结束的值班时间段对应2分EW
      
      console.log(`[updateSummary] 用户 ${member.nickName || member.openid} 已结束值班任务：${dutySlots.data.length}个，重新计算值班EW：${actualDutyEW}分`)
      
      // 在更新汇总数据前，先批量更新值班任务状态，确保状态是最新的
      if (dutySlots.data.length === 0) {
        // 如果没有找到已结束的任务，检查是否有需要更新状态的任务
        const allUserDutySlots = await db.collection('duty_slots').where({
          dutyHolderId: member.openid
        }).get()
        
        let statusUpdatedCount = 0
        for (const slot of allUserDutySlots.data) {
          if (slot.date && slot.startTime && slot.endTime) {
            const newStatus = calculateDutyStatus(slot.date, slot.startTime, slot.endTime)
            if (newStatus && newStatus !== (slot.dutyStatus || 'pending')) {
              await db.collection('duty_slots').doc(slot.dutySlotId).update({
                data: {
                  dutyStatus: newStatus,
                  updateTime: new Date()
                }
              })
              statusUpdatedCount++
            }
          }
        }
        
        if (statusUpdatedCount > 0) {
          console.log(`[updateSummary] 更新了${statusUpdatedCount}个值班任务状态，重新查询已结束任务`)
          // 重新查询已结束的任务
          const updatedDutySlots = await db.collection('duty_slots').where({
            dutyHolderId: member.openid,
            dutyStatus: 'ended'
          }).get()
          
          actualDutyEW = updatedDutySlots.data.length * 2
          console.log(`[updateSummary] 状态更新后，用户 ${member.nickName || member.openid} 已结束值班任务：${updatedDutySlots.data.length}个，值班EW：${actualDutyEW}分`)
        }
      }
      
      // 计算总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
      const totalEW = Math.round((maintenanceEW * 0.5 + volunteerEW * 0.4 + actualDutyEW * 0.1) * 100) / 100
      
      // 检查是否已有汇总记录
      const summaryResult = await db.collection('ewaSummary').where({
        ewaUserId: member.openid
      }).get()
      
      if (summaryResult.data.length > 0) {
        // 读取手动调整，默认0
        const existing = summaryResult.data[0]
        const manualMaintenanceEW = existing.manualMaintenanceEW || 0
        const manualVolunteerEW = existing.manualVolunteerEW || 0
        const manualDutyEW = existing.manualDutyEW || 0
        
        // 叠加手动调整，得到最终聚合值
        const maintenanceFinal = maintenanceEW + manualMaintenanceEW
        const volunteerFinal = volunteerEW + manualVolunteerEW
        const dutyFinal = actualDutyEW + manualDutyEW
        // 计算总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
        const totalFinal = Math.round((maintenanceFinal * 0.5 + volunteerFinal * 0.4 + dutyFinal * 0.1) * 100) / 100
        
        // 更新现有记录，使用重新计算+手动调整后的值
        return db.collection('ewaSummary').where({
          ewaUserId: member.openid
        }).update({
          data: {
            maintenanceEW: maintenanceFinal,
            volunteerEW: volunteerFinal,
            dutyEW: dutyFinal,
            totalEW: totalFinal,
            updateTime: new Date()
          }
        })
      } else {
        // 创建新的汇总记录
        return db.collection('ewaSummary').add({
          data: {
            ewaUserId: member.openid,
            ewaUserName: member.nickName || '',
            maintenanceEW,
            volunteerEW,
            dutyEW: actualDutyEW,
            totalEW,
            createTime: new Date(),
            updateTime: new Date()
          }
        })
      }
    })
    
    await Promise.all(updatePromises)
    
    return {
      code: 200,
      data: null,
      message: 'EW汇总更新完成'
    }
  } catch (err) {
    console.error('更新EW汇总失败:', err)
    return {
      code: 500,
      data: null,
      message: err.message || '更新EW汇总失败'
    }
  }
}
