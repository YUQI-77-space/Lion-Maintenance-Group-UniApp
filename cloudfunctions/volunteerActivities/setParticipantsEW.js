// 设置志愿活动参与者的EW值
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 批量设置参与者EW
 * @param {Object} event
 * @param {string} event.activityId - 活动ID
 * @param {Array<{openid: string, ew: number}>} event.assignments - 参与者EW分配
 * @param {Object} wxContext
 * @returns {Object}
 */
exports.main = async (event, wxContext) => {
  try {
    const { activityId, assignments } = event
    const { OPENID } = wxContext

    if (!activityId || !Array.isArray(assignments)) {
      return { code: 400, message: '缺少参数或参数格式错误' }
    }

    // 权限校验：仅组长
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (!userRes.data || userRes.data.length === 0 || userRes.data[0].role !== 'leader') {
      return { code: 403, message: '无权操作' }
    }

    // 读取活动
    const actRes = await db.collection('voluntary_activities').where({ activityId }).get()
    if (!actRes.data || actRes.data.length === 0) {
      return { code: 404, message: '活动不存在' }
    }

    const activity = actRes.data[0]

    // 仅允许在已结束活动上设置
    if (activity.activityStatus !== 'ended') {
      return { code: 400, message: '仅支持在已结束的活动上设置EW' }
    }

    // 构建新的映射和增量
    const existingMap = activity.participantEWMap || {}
    const newMap = { ...existingMap }

    // 校验 assignments 中的openid必须在参与者名单内
    const validOpenids = new Set(activity.participantsIDList || [])
    for (const item of assignments) {
      if (!item || typeof item.openid !== 'string') {
        return { code: 400, message: 'assignments 数据格式错误' }
      }
      if (!validOpenids.has(item.openid)) {
        return { code: 400, message: `存在非参与者的openid: ${item.openid}` }
      }
      let val = Number(item.ew)
      if (!isFinite(val) || val < 0) val = 0
      if (val > 50) val = 50
      newMap[item.openid] = val
    }

    // 计算差值并批量更新 ewaSummary
    const updates = []
    for (const openid of Object.keys(newMap)) {
      const prev = Number(existingMap[openid] || 0)
      const next = Number(newMap[openid] || 0)
      const diff = next - prev
      if (diff === 0) continue

      updates.push({ openid, diff, next })
    }

    // 事务更新活动文档 participantEWMap
    await db.collection('voluntary_activities').doc(activity._id).update({
      data: {
        participantEWMap: newMap,
        ewSetAt: db.serverDate(),
        updateTime: db.serverDate()
      }
    })

    // 针对有变动的用户，更新 ewaSummary，并发送消息
    for (const u of updates) {
      const summaryRes = await db.collection('ewaSummary').where({ ewaUserId: u.openid }).get()
      if (summaryRes.data && summaryRes.data.length > 0) {
        const currentSummary = summaryRes.data[0];
        const newVolunteerEW = (currentSummary.volunteerEW || 0) + u.diff;
        // 计算新的总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
        const newTotalEW = Math.round(((currentSummary.maintenanceEW || 0) * 0.5 + newVolunteerEW * 0.4 + (currentSummary.dutyEW || 0) * 0.1) * 100) / 100;
        
        await db.collection('ewaSummary').doc(summaryRes.data[0]._id).update({
          data: {
            volunteerEW: newVolunteerEW,
            totalEW: newTotalEW,
            updateTime: db.serverDate()
          }
        })
      } else {
        // 创建新记录（其余维度后续可由updateSummary校正）
        const userInfoRes = await db.collection('users').where({ openid: u.openid }).get()
        const user = (userInfoRes.data && userInfoRes.data[0]) || {}
        // 计算总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
        const newTotalEW = Math.round((0 * 0.5 + u.next * 0.4 + 0 * 0.1) * 100) / 100;
        
        await db.collection('ewaSummary').add({
          data: {
            ewaUserId: u.openid,
            ewaUserName: user.nickName || '',


            maintenanceEW: 0,
            volunteerEW: u.next, // 仅此时刻的总志愿EW（其余活动会在updateSummary后对齐）
            dutyEW: 0,
            totalEW: newTotalEW,
            manualMaintenanceEW: 0,
            manualVolunteerEW: 0,
            manualDutyEW: 0,
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
      }

      // 发送通知消息
      await db.collection('messages').add({
        data: {
          userId: u.openid,
          title: '志愿活动EW设置通知',
          content: `活动"${activity.title}"的EW已设置为 ${newMap[u.openid]}。`,
          type: 'activity_ew_set',
          relatedId: activity.activityId,
          isRead: false,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
    }

    // 触发一次全量汇总对齐，确保跨活动一致
    try {
      await cloud.callFunction({
        name: 'equivalentWorkloadAssessment',
        data: { action: 'updateSummary', params: {} }
      })
    } catch (e) {
      // 不阻塞主流程
      console.error('[setParticipantsEW] 触发updateSummary失败:', e)
    }

    return { code: 200, message: '参与者EW已更新' }
  } catch (error) {
    console.error('[setParticipantsEW] 失败:', error)
    return { code: 500, message: error.message || '设置参与者EW失败' }
  }
} 