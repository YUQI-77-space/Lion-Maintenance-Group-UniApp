// 标记消息为已读
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 标记消息为已读
 * @param {Object} params - 参数对象
 * @param {string} params.messageUserId - 消息接收用户ID
 * @param {number} params.messageIndex - 消息索引
 * @param {boolean} params.markAllAsRead - 是否标记所有消息为已读
 * @param {string} OPENID - 操作用户ID
 * @returns {Object} 操作结果
 */
exports.markTheMessageAsRead = async (params, OPENID) => {
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
    let { isReadList = [] } = messageData
    
    // 更新已读状态
    if (params.markAllAsRead) {
      // 标记所有消息为已读
      isReadList = isReadList.map(() => true)
    } else if (params.messageIndex !== undefined && isReadList[params.messageIndex] !== undefined) {
      // 标记指定索引的消息为已读
      isReadList[params.messageIndex] = true
    } else {
      return {
        code: 400,
        data: null,
        message: '无效的消息索引'
      }
    }
    
    // 当前时间
    const now = new Date()
    
    // 更新消息记录
    await db.collection('messages').where({
      messageUserId: userId
    }).update({
      data: {
        isReadList,
        updateTime: now
      }
    })
    
    return {
      code: 200,
      data: null,
      message: '标记消息为已读成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '标记消息为已读失败'
    }
  }
} 