// 创建新消息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 创建新消息
 * @param {Object} params - 参数对象
 * @param {string} params.messageUserId - 消息接收用户ID
 * @param {string} params.title - 消息标题
 * @param {string} params.content - 消息内容
 * @param {string} params.messageType - 消息类型('maintenance', 'duty', 'volunteer', 'system')
 * @param {string} OPENID - 操作用户ID
 * @returns {Object} 操作结果
 */
exports.createMessage = async (params, OPENID) => {
  try {
    console.log('创建消息，接收参数:', params);
    
    // 检查参数
    if (!params.messageUserId || !params.title || !params.content) {
      console.error('缺少必要参数');
      return {
        code: 400,
        data: null,
        message: '缺少必要参数'
      }
    }
    
    // 处理messageType参数，兼容两种命名方式
    const messageType = params.messageType || params.messagetype || 'system';
    
    // 检查消息类型是否有效
    const validTypes = ['maintenance', 'duty', 'volunteer', 'system']
    if (!validTypes.includes(messageType)) {
      console.error('无效的消息类型:', messageType);
      return {
        code: 400,
        data: null,
        message: '无效的消息类型'
      }
    }

    // 当前时间
    const now = new Date()

    // 查询是否已有该用户的消息记录
    console.log('查询用户消息记录:', params.messageUserId);
    const messageResult = await db.collection('messages').where({
      messageUserId: params.messageUserId
    }).get()

    if (messageResult.data.length === 0) {
      // 创建新的消息记录
      console.log('创建新的消息记录');
      await db.collection('messages').add({
        data: {
          messageUserId: params.messageUserId,
          messageNumber: 1,
          titleList: [params.title],
          contentList: [params.content],
          messagetypeList: [messageType],
          isReadList: [false],
          sendTimeList: [now],
          createTime: now,
          updateTime: now
        }
      })
    } else {
      // 获取现有消息记录
      console.log('更新现有消息记录');
      const existingMessage = messageResult.data[0]
      let {
        titleList = [],
        contentList = [],
        messagetypeList = [],
        isReadList = [],
        sendTimeList = [],
        messageNumber = 0
      } = existingMessage

      // 添加新消息
      titleList.push(params.title)
      contentList.push(params.content)
      messagetypeList.push(messageType)
      isReadList.push(false)
      sendTimeList.push(now)
      messageNumber += 1

      // 如果超过10条消息，移除最早的消息
      if (messageNumber > 10) {
        titleList = titleList.slice(-10)
        contentList = contentList.slice(-10)
        messagetypeList = messagetypeList.slice(-10)
        isReadList = isReadList.slice(-10)
        sendTimeList = sendTimeList.slice(-10)
        messageNumber = 10
      }

      // 更新消息记录
      await db.collection('messages').where({
        messageUserId: params.messageUserId
      }).update({
        data: {
          titleList,
          contentList,
          messagetypeList,
          isReadList,
          sendTimeList,
          messageNumber,
          updateTime: now
        }
      })
    }
    
    console.log('消息创建成功');
    return {
      code: 200,
      data: {
        messageUserId: params.messageUserId,
        title: params.title
      },
      message: '消息创建成功'
    }
  } catch (err) {
    console.error('创建消息失败:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '创建消息失败'
    }
  }
} 