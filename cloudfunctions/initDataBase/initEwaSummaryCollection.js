// 初始化等效工作量评估集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化等效工作量评估集合
 * @returns {Object} 返回初始化结果
 */
exports.initEwaSummaryCollection = async () => {
  try {
    // 判断集合是否存在
    try {
      await db.createCollection('ewaSummary')
    } catch (err) {
      // 集合已存在，不需处理
    }

    // 创建索引
    await db.collection('ewaSummary').createIndex({
      name: 'ewaUserId_index',
      unique: true,
      key: {
        ewaUserId: 1
      }
    })

    await db.collection('ewaSummary').createIndex({
      name: 'totalEW_index',
      key: {
        totalEW: -1  // 降序索引，用于排行榜
      }
    })

    return {
      code: 200,
      data: null,
      message: '初始化等效工作量评估集合成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '初始化等效工作量评估集合失败'
    }
  }
} 