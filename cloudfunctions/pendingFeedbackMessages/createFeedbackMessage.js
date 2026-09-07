const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 创建待反馈消息
 * @param {Object} params - 参数对象
 * @param {string} params.recipientId - 接收者openid
 * @param {string} params.type - 消息类型 ('maintenance_assignment' | 'volunteer_invitation')
 * @param {string} params.relatedId - 关联的任务或活动ID
 * @param {Object} params.content - 消息内容
 * @param {string} params.content.title - 消息标题
 * @param {string} params.content.details - 消息详情
 * @param {string} OPENID - 创建者openid
 * @returns {Object} 返回创建结果
 */
exports.createFeedbackMessage = async (params, OPENID) => {
  try {
    
    
    // 检查必需参数
    if (!params.recipientId) {
      return {
        code: 400,
        data: null,
        message: '缺少接收者ID'
      }
    }
    
    if (!params.type) {
      return {
        code: 400,
        data: null,
        message: '缺少消息类型'
      }
    }
    
    if (!params.relatedId) {
      return {
        code: 400,
        data: null,
        message: '缺少关联ID'
      }
    }
    
    if (!params.content || !params.content.title || !params.content.details) {
      return {
        code: 400,
        data: null,
        message: '缺少消息内容'
      }
    }
    
    // 验证消息类型
    const validTypes = ['maintenance_assignment', 'volunteer_invitation']
    if (!validTypes.includes(params.type)) {
      return {
        code: 400,
        data: null,
        message: '无效的消息类型'
      }
    }
    
    // 创建消息数据
    const messageData = {
      recipientId: params.recipientId,
      creatorId: OPENID,
      type: params.type,
      relatedId: params.relatedId,
      content: {
        title: params.content.title,
        details: params.content.details
      },
      isRead: false,
      createdAt: db.serverDate()
    }
    
    // 插入数据库
    const result = await db.collection('pending_feedback_messages').add({
      data: messageData
    })
    
    
    
    return {
      code: 200,
      data: {
        messageId: result._id
      },
      message: '待反馈消息创建成功'
    }
  } catch (error) {
    console.error('创建待反馈消息失败:', error);
    return {
      code: 500,
      data: null,
      message: '创建待反馈消息失败: ' + error.message
    }
  }
}
