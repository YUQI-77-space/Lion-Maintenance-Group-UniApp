// 批量创建站内消息
// 复用 createMessage 的单条创建逻辑，供 maintenanceTasks 等云函数一次性批量通知多人
const { createMessage } = require('./createMessage')

/**
 * 批量创建消息
 * @param {Object} params - 参数对象
 * @param {Array} params.messages - 消息列表，每项包含 messageUserId/title/content/messageType
 * @param {string} OPENID - 操作用户ID
 * @returns {Object} 批量创建结果
 */
exports.createMessages = async (params, OPENID) => {
  const messages = (params && Array.isArray(params.messages)) ? params.messages : []

  if (!messages.length) {
    return {
      code: 400,
      data: null,
      message: '缺少批量消息列表'
    }
  }

  let successCount = 0
  let failCount = 0

  await Promise.all(messages.map(async (item) => {
    if (!item || !item.messageUserId || !item.title || !item.content) {
      failCount += 1
      return {
        code: 400,
        data: null,
        message: '单条消息参数不完整'
      }
    }

    try {
      const res = await createMessage({
        messageUserId: item.messageUserId,
        title: item.title,
        content: item.content,
        messageType: item.messageType || item.messagetype || 'system'
      }, OPENID)

      if (res && res.code === 200) {
        successCount += 1
      } else {
        failCount += 1
      }
      return res
    } catch (err) {
      console.error('批量创建消息失败（单条）:', item.messageUserId, err)
      failCount += 1
      return {
        code: 500,
        data: null,
        message: err.message || '单条消息创建失败'
      }
    }
  }))

  return {
    code: 200,
    data: {
      successCount,
      failCount,
      total: messages.length
    },
    message: '批量消息创建完成'
  }
}
