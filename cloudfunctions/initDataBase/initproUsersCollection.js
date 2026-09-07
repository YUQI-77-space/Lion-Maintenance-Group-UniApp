// 初始化专业用户（维修组成员）集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化 proUsers 集合（用于集中存储 role 为 member/leader 的用户）
 * @returns {Object} 返回初始化结果
 */
exports.initProUsersCollection = async () => {
  try {
    // 判断集合是否存在
    try {
      await db.createCollection('proUsers')
    } catch (err) {
      // 集合已存在，不需处理
    }

    // 索引与 users 集合保持一致，便于统一查询
    await db.collection('proUsers').createIndex({
      name: 'openid_index',
      unique: true,
      key: {
        openid: 1
      }
    })

    await db.collection('proUsers').createIndex({
      name: 'role_index',
      key: {
        role: 1
      }
    })



    await db.collection('proUsers').createIndex({
      name: 'qqId_index',
      key: {
        qqId: 1
      }
    })

    // 常用检索字段
    await db.collection('proUsers').createIndex({
      name: 'nickName_index',
      key: {
        nickName: 1
      }
    })



    return {
      code: 200,
      data: null,
      message: '初始化 proUsers 集合成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '初始化 proUsers 集合失败'
    }
  }
} 