// 值班锁清理与状态查询封装
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { lockManager } = require('./lockManager')

/**
 * 清理过期锁
 * @param {Object} event
 * @param {string} openid
 */
exports.cleanupExpiredLocks = async (event = {}, openid) => {
  try {
    const result = await lockManager.cleanupExpiredLocks()
    return {
      code: 200,
      data: result,
      message: '过期锁清理完成'
    }
  } catch (err) {
    console.error('[cleanupExpiredLocks] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '过期锁清理失败'
    }
  }
}

/**
 * 强制释放用户的所有锁
 * @param {Object} event
 * @param {string} event.userId 目标用户ID（可选，默认当前用户）
 * @param {string} openid
 */
exports.forceReleaseUserLocks = async (event = {}, openid) => {
  try {
    const targetUserId = event.userId || openid
    const result = await lockManager.forceReleaseUserLocks(targetUserId)
    return {
      code: 200,
      data: { userId: targetUserId, ...result },
      message: '已尝试释放目标用户的所有锁'
    }
  } catch (err) {
    console.error('[forceReleaseUserLocks] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '强制释放用户锁失败'
    }
  }
}

/**
 * 查询单个时间段的锁状态
 * @param {Object} event
 * @param {string} event.slotId 时间段ID（必填）
 * @param {string} openid
 */
exports.getLockStatus = async (event = {}, openid) => {
  try {
    const { slotId } = event
    if (!slotId) {
      return {
        code: 400,
        data: null,
        message: '缺少参数：slotId'
      }
    }
    const info = await lockManager.getSlotLockInfo(slotId)
    return {
      code: 200,
      data: info,
      message: '获取锁状态成功'
    }
  } catch (err) {
    console.error('[getLockStatus] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '获取锁状态失败'
    }
  }
} 