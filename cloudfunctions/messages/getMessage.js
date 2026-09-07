// 获取用户消息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取用户消息
 * @param {Object} params - 参数对象
 * @param {string} params.messageUserId - 消息接收用户ID
 * @param {string} OPENID - 操作用户ID
 * @returns {Object} 查询结果
 */
exports.getMessage = async (params, OPENID) => {
  try {
    // 优先使用传入的用户ID，其次使用当前登录用户ID
    const userId = params.messageUserId || OPENID
    
    if (!userId) {
      return {
        code: 400,
        data: null,
        message: '缺少用户ID'
      }
    }
    
    // 查询用户的消息记录
    const messageResult = await db.collection('messages').where({
      messageUserId: userId
    }).get()
    
    // 如果没有消息记录，返回空数组
    if (messageResult.data.length === 0) {
      return {
        code: 200,
        data: {
          messageNumber: 0,
          messages: []
        },
        message: '未找到消息'
      }
    }
    
    // 获取消息数据
    const messageData = messageResult.data[0]
    const { 
      messageNumber = 0, 
      titleList = [], 
      contentList = [], 
      messagetypeList = [], 
      isReadList = [],
      sendTimeList = []
    } = messageData
    
    // 组装消息列表
    const messages = []
    for (let i = 0; i < messageNumber; i++) {
      messages.push({
        index: i,
        title: titleList[i] || '',
        content: contentList[i] || '',
        messagetype: messagetypeList[i] || 'system',
        isRead: isReadList[i] || false,
        sendTime: sendTimeList[i] || null
      })
    }
    
    return {
      code: 200,
      data: {
        messageNumber,
        messages
      },
      message: '获取消息成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '获取消息失败'
    }
  }
} 