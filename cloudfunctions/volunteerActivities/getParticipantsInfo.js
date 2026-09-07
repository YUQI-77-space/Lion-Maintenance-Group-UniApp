// 获取志愿活动参与者信息
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

/**
 * 获取志愿活动参与者信息
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 参与者信息列表
 */
exports.main = async (event, wxContext) => {
  try {
    const { activityId } = event
    const openid = wxContext.OPENID
    
    // 参数校验
    if (!activityId) {
      return {
        code: 400,
        message: '缺少活动ID参数'
      }
    }
    
    // 验证用户权限（只有组长可以查看详细参与者信息）
    const userResult = await db.collection('users')
      .where({
        openid: openid
      })
      .get()
    
    if (userResult.data.length === 0 || userResult.data[0].role !== 'leader') {
      return {
        code: 403,
        message: '权限不足，只有组长可以查看详细参与者信息'
      }
    }
    
    // 获取活动信息
    const activityResult = await db.collection('voluntary_activities')
      .where({
        activityId: activityId
      })
      .get()
    
    if (activityResult.data.length === 0) {
      return {
        code: 404,
        message: '未找到该活动'
      }
    }
    
    const activity = activityResult.data[0]
    
    // 如果没有参与者，直接返回空列表
    if (!activity.participantsIDList || activity.participantsIDList.length === 0) {
      return {
        code: 200,
        data: {
          participants: [],
          total: 0
        },
        message: '获取参与者信息成功'
      }
    }
    
    // 获取参与者详细信息
    const participantsResult = await db.collection('users')
      .where({
        openid: _.in(activity.participantsIDList)
      })
      .field({
        openid: true,
        nickName: true,
        avatarUrl: true,
        cloudAvatarUrl: true,
        cloudAvatarFileID: true,
        studentId: true,
        role: true
      })
      .get()
    
    // 整合参与者信息
    const participants = participantsResult.data.map(user => {
      // 找到用户在参与者列表中的索引
      const index = activity.participantsIDList.indexOf(user.openid)
      
      return {
        openid: user.openid,
        nickName: user.nickName,
        avatarUrl: user.avatarUrl,
        cloudAvatarUrl: user.cloudAvatarUrl,
        cloudAvatarFileID: user.cloudAvatarFileID,
        studentId: user.studentId,
        role: user.role
      }
    })
    
    return {
      code: 200,
      data: {
        participants,
        total: participants.length,
        activity: {
          activityId: activity.activityId,
          title: activity.title,
          startTime: activity.startTime,
          endTime: activity.endTime,
          location: activity.location,
          activityStatus: activity.activityStatus,
          volunteerHours: activity.volunteerHours,
          ew: activity.ew
        }
      },
      message: '获取参与者信息成功'
    }
  } catch (error) {
    console.error('获取志愿活动参与者信息失败', error)
    return {
      code: 500,
      message: '获取志愿活动参与者信息失败: ' + error.message
    }
  }
} 