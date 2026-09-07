// 云函数 - deleteVolunteerActivity
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

async function removeCollectionByFilter(collectionName, filter) {
  const MAX_LIMIT = 100
  let removed = 0
  while (true) {
    const snapshot = await db.collection(collectionName)
      .where(filter)
      .field({ _id: true })
      .limit(MAX_LIMIT)
      .get()
    const docs = snapshot.data || []
    if (docs.length === 0) break
    await Promise.allSettled(
      docs.map(doc => db.collection(collectionName).doc(doc._id).remove())
    )
    removed += docs.length
    if (docs.length < MAX_LIMIT) break
  }
  return removed
}

async function rollbackParticipantEW(participantEWMap = {}) {
  const entries = Object.entries(participantEWMap)
    .filter(([, value]) => isFinite(Number(value)) && Number(value) > 0)

  if (entries.length === 0) {
    return 0
  }

  let adjustedUsers = 0

  for (const [openid, value] of entries) {
    const ewValue = Number(value)
    if (!openid || ewValue <= 0) continue

    const summaryRes = await db.collection('ewaSummary').where({ ewaUserId: openid }).get()
    if (!summaryRes.data || summaryRes.data.length === 0) continue
    const summaryDoc = summaryRes.data[0]
    const maintenanceEW = Number(summaryDoc.maintenanceEW || 0)
    const dutyEW = Number(summaryDoc.dutyEW || 0)
    const currentVolunteerEW = Number(summaryDoc.volunteerEW || 0)
    const updatedVolunteerEW = Math.max(0, currentVolunteerEW - ewValue)
    const updatedTotalEW = Math.round((maintenanceEW * 0.5 + updatedVolunteerEW * 0.4 + dutyEW * 0.1) * 100) / 100

    await db.collection('ewaSummary').doc(summaryDoc._id).update({
      data: {
        volunteerEW: updatedVolunteerEW,
        totalEW: updatedTotalEW,
        updateTime: db.serverDate()
      }
    })
    adjustedUsers++
  }

  return adjustedUsers
}

/**
 * 删除志愿活动（支持所有状态，包含数据级联清理）
 */
exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext()
    const { activityId } = event
    const openid = wxContext.OPENID
    
    console.log('删除活动请求:', { activityId, openid })
    
    if (!activityId) {
      return { code: 400, message: '缺少活动ID' }
    }
    
    const userResult = await db.collection('users').where({ openid }).get()
    if (!userResult.data || userResult.data.length === 0) {
      return { code: 404, message: '用户不存在' }
    }
    const user = userResult.data[0]
    if (user.role !== 'leader') {
      return { code: 403, message: '只有组长可以删除活动' }
    }
    
    const activityResult = await db.collection('voluntary_activities')
      .where({ activityId })
      .get()
    
    if (!activityResult.data || activityResult.data.length === 0) {
      return { code: 404, message: '活动不存在' }
    }
    
    const activity = activityResult.data[0]
    const participantEWMap = activity.participantEWMap || {}
    
    const ewAdjustedUsers = await rollbackParticipantEW(participantEWMap)
    
    const [todoRemoved, feedbackRemoved, messageLogsRemoved] = await Promise.all([
      removeCollectionByFilter('volunteer_toDo_list', { taskId: activityId }),
      removeCollectionByFilter('pending_feedback_messages', { relatedId: activityId }),
      removeCollectionByFilter('message_send_logs', { activityId })
    ])
    
    await db.collection('voluntary_activities').doc(activity._id).remove()
    
    try {
      await cloud.callFunction({
        name: 'equivalentWorkloadAssessment',
        data: { action: 'updateSummary', params: {} }
      })
    } catch (syncErr) {
      console.error('删除后触发EW汇总失败（不阻塞主流程）:', syncErr)
    }

    console.log('删除活动成功:', activityId, {
      ewAdjustedUsers,
      todoRemoved,
      feedbackRemoved,
      messageLogsRemoved
    })

    return {
      code: 200,
      message: '活动及相关数据已删除',
      data: {
        ewAdjustedUsers,
        todoRemoved,
        feedbackRemoved,
        messageLogsRemoved
      }
    }
  } catch (error) {
    console.error('删除活动错误:', error)
    return { code: 500, message: '删除失败: ' + error.message }
  }
} 