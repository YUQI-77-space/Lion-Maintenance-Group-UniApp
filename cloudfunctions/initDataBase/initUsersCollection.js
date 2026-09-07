// 初始化用户集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化用户集合
 * @returns {Object} 返回初始化结果
 */
exports.initUsersCollection = async () => {
  try {
    // 判断集合是否存在
    try {
      await db.createCollection('users')
    } catch (err) {
      // 集合已存在，不需处理
    }

    // 创建索引
    await db.collection('users').createIndex({
      name: 'openid_index',
      unique: true,
      key: {
        openid: 1
      }
    })

    await db.collection('users').createIndex({
      name: 'role_index',
      key: {
        role: 1
      }
    })



    // 新增QQ号索引
    await db.collection('users').createIndex({
      name: 'qqId_index',
      key: {
        qqId: 1
      }
    })

    return {
      code: 200,
      data: null,
      message: '初始化用户集合成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '初始化用户集合失败'
    }
  }
} 