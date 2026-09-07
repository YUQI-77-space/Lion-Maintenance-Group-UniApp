// 切换志愿活动招募状态
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 切换志愿活动招募状态
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @param {boolean} event.recruitmentOpen - 目标招募状态
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 切换结果
 */
exports.main = async (event, wxContext) => {
  try {
    const { activityId, recruitmentOpen } = event
    const { OPENID } = wxContext
    
    
    
    if (!activityId) {
      return {
        code: 400,
        message: '缺少活动ID'
      }
    }
    
    if (typeof recruitmentOpen !== 'boolean') {
      return {
        code: 400,
        message: '招募状态参数错误'
      }
    }
    
    // 验证用户权限（只有组长可以切换招募状态）
    const userResult = await db.collection('users')
      .where({
        openid: OPENID
      })
      .get()
    
    if (userResult.data.length === 0 || userResult.data[0].role !== 'leader') {
      return {
        code: 403,
        message: '权限不足，只有组长可以切换招募状态'
      }
    }
    
    // 开启事务以处理并发问题
    const transaction = await db.startTransaction()
    
    try {
      // 查询活动信息
      const activityResult = await transaction.collection('voluntary_activities')
        .where({
          activityId: activityId
        })
        .get()
      
      if (!activityResult.data || activityResult.data.length === 0) {
        await transaction.rollback()
        return {
          code: 404,
          message: '活动不存在'
        }
      }
      
      const activity = activityResult.data[0]
      
      // 检查活动状态 - 只有未结束的活动才能切换招募状态
      if (activity.activityStatus === 'ended') {
        await transaction.rollback()
        return {
          code: 400,
          message: '已结束的活动无法切换招募状态'
        }
      }
      
      // 检查当前招募状态，避免重复操作
      const currentStatus = activity.recruitmentOpen !== false // 默认为true
      if (currentStatus === recruitmentOpen) {
        await transaction.rollback()
        return {
          code: 200,
          data: {
            activityId: activityId,
            recruitmentOpen: recruitmentOpen
          },
          message: `招募状态已经是${recruitmentOpen ? '开启' : '关闭'}状态`
        }
      }
      
      // 更新招募状态
      await transaction.collection('voluntary_activities')
        .doc(activity._id)
        .update({
          data: {
            recruitmentOpen: recruitmentOpen,
            updateTime: db.serverDate()
          }
        })
      
      // 提交事务
      await transaction.commit()
      
      
      
      return {
        code: 200,
        data: {
          activityId: activityId,
          recruitmentOpen: recruitmentOpen,
          title: activity.title
        },
        message: `成功${recruitmentOpen ? '开启' : '关闭'}招募`
      }
      
    } catch (err) {
      // 回滚事务
      console.error('事务处理失败，执行回滚:', err)
      await transaction.rollback()
      throw err
    }
    
  } catch (error) {
    console.error('切换招募状态失败:', error)
    return {
      code: 500,
      message: '切换招募状态失败: ' + error.message
    }
  }
} 