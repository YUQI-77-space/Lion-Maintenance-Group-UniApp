// 删除消息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 删除消息
 * @param {Object} params - 参数对象
 * @param {string} params.messageUserId - 消息接收用户ID
 * @param {number} params.messageIndex - 消息索引
 * @param {boolean} params.deleteAllMessages - 是否删除所有消息
 * @param {string} OPENID - 操作用户ID
 * @returns {Object} 操作结果
 */
exports.removalMessages = async (params, OPENID) => {
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
    
    // 如果没有消息记录，返回错误
    if (messageResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到消息'
      }
    }
    
    // 获取消息数据
    const messageData = messageResult.data[0]
    let {
      messageNumber = 0,
      titleList = [],
      contentList = [],
      messagetypeList = [],
      isReadList = []
    } = messageData
    
    // 当前时间
    const now = new Date()
    
    if (params.deleteAllMessages) {
      // 清空所有消息
      await db.collection('messages').where({
        messageUserId: userId
      }).update({
        data: {
          messageNumber: 0,
          titleList: [],
          contentList: [],
          messagetypeList: [],
          isReadList: [],
          updateTime: now
        }
      })
    } else if (params.messageIndex !== undefined && params.messageIndex >= 0 && params.messageIndex < messageNumber) {
      // 删除指定索引的消息
      titleList.splice(params.messageIndex, 1)
      contentList.splice(params.messageIndex, 1)
      messagetypeList.splice(params.messageIndex, 1)
      isReadList.splice(params.messageIndex, 1)
      messageNumber -= 1
      
      // 更新消息记录
      await db.collection('messages').where({
        messageUserId: userId
      }).update({
        data: {
          messageNumber,
          titleList,
          contentList,
          messagetypeList,
          isReadList,
          updateTime: now
        }
      })
    } else {
      return {
        code: 400,
        data: null,
        message: '无效的消息索引'
      }
    }
    
    return {
      code: 200,
      data: null,
      message: params.deleteAllMessages ? '所有消息已删除' : '消息已删除'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '删除消息失败'
    }
  }
} 