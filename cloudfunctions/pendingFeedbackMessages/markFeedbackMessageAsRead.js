const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 标记待反馈消息为已读
 * @param {Object} params - 参数对象
 * @param {string} params.messageId - 消息ID
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回操作结果
 */
exports.markFeedbackMessageAsRead = async (params, OPENID) => {
  try {
    
    // 检查参数
    if (!params.messageId) {
      return {
        code: 400,
        data: null,
        message: '缺少消息ID'
      }
    }
    
    // 先查询消息确保存在且属于当前用户
    const messageResult = await db.collection('pending_feedback_messages')
      .doc(params.messageId)
      .get()
    
    if (!messageResult.data) {
      return {
        code: 404,
        data: null,
        message: '消息不存在'
      }
    }
    
    const message = messageResult.data
    
    // 验证消息属于当前用户
    if (message.recipientId !== OPENID) {
      return {
        code: 403,
        data: null,
        message: '无权限操作此消息'
      }
    }
    
    // 如果消息已经是已读状态，直接返回成功
    if (message.isRead) {
      return {
        code: 200,
        data: null,
        message: '消息已标记为已读'
      }
    }
    
    // 更新消息状态为已读
    await db.collection('pending_feedback_messages')
      .doc(params.messageId)
      .update({
        data: {
          isRead: true,
          readAt: db.serverDate()
        }
      })
    
    
    
    return {
      code: 200,
      data: null,
      message: '消息已标记为已读'
    }
  } catch (error) {
    console.error('标记消息为已读失败:', error);
    return {
      code: 500,
      data: null,
      message: '标记消息为已读失败: ' + error.message
    }
  }
}
