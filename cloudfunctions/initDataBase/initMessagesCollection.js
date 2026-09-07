// 初始化消息集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化消息集合
 * @returns {Object} 返回初始化结果
 */
exports.initMessagesCollection = async () => {
  try {
    // 判断集合是否存在
    try {
      await db.createCollection('messages')
    } catch (err) {
      // 集合已存在，不需处理
    }

    // 创建索引
    await db.collection('messages').createIndex({
      name: 'messageUserId_index',
      unique: true,
      key: {
        messageUserId: 1
      }
    })

    return {
      code: 200,
      data: null,
      message: '初始化消息集合成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '初始化消息集合失败'
    }
  }
} 