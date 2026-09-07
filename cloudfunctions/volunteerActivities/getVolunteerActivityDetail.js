// 获取志愿活动详情
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const { StatusUpdateManager } = require('./statusUpdateManager')

/**
 * 获取志愿活动详情
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 活动详情对象
 */
exports.main = async (event, wxContext) => {
  try {
    const { activityId } = event
    
    // 参数校验
    if (!activityId) {
      return {
        code: 400,
        message: '缺少活动ID参数'
      }
    }

    // 🔥 关键修复：在获取活动详情前，先更新活动状态
    console.log('[getVolunteerActivityDetail] 开始更新活动状态...')
    try {
      const updateResult = await StatusUpdateManager.updateSingleActivityStatus(activityId)
      console.log('[getVolunteerActivityDetail] 活动状态更新结果:', updateResult)
    } catch (updateError) {
      console.log('[getVolunteerActivityDetail] 状态更新出错，但继续获取详情:', updateError.message)
    }
    
    // 查询活动详情
    const activityResult = await db.collection('voluntary_activities')
      .where({
        activityId: activityId
      })
      .get()
    
    // 检查活动是否存在
    if (activityResult.data.length === 0) {
      return {
        code: 404,
        message: '未找到该活动'
      }
    }
    
    const activity = activityResult.data[0]
    
    // 检查当前用户是否已报名
    const openid = wxContext.OPENID
    const isRegistered = activity.participantsIDList && activity.participantsIDList.includes(openid)
    
    // 返回结果
    return {
      code: 200,
      data: {
        activity,
        isRegistered
      },
      message: '获取志愿活动详情成功'
    }
  } catch (error) {
    console.error('获取志愿活动详情失败', error)
    return {
      code: 500,
      message: '获取志愿活动详情失败: ' + error.message
    }
  }
} 