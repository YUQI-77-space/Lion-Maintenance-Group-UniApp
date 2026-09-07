const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取用户未读的待反馈消息
 * @param {Object} params - 参数对象
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回未读消息列表
 */
exports.getUnreadFeedbackMessages = async (params, OPENID) => {
  try {
    
    // 查询用户的未读待反馈消息，按创建时间升序排列
    const result = await db.collection('pending_feedback_messages')
      .where({
        recipientId: OPENID,
        isRead: false
      })
      .orderBy('createdAt', 'asc')
      .get()
    
    
    
    return {
      code: 200,
      data: result.data,
      message: '获取未读待反馈消息成功'
    }
  } catch (error) {
    console.error('获取未读待反馈消息失败:', error);
    return {
      code: 500,
      data: null,
      message: '获取未读待反馈消息失败: ' + error.message
    }
  }
}
