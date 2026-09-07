// 值班时间段悲观锁管理器
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 悲观锁管理器
 * 用于管理值班时间段的并发访问控制
 */
class DutySlotLockManager {
  constructor() {
    this.LOCK_TIMEOUT = 5 * 60 * 1000 // 锁超时时间：5分钟
    this.CLEANUP_BATCH_SIZE = 50 // 清理操作的批次大小
  }

  /**
   * 尝试获取时间段锁
   * @param {Array} slotIds 时间段ID数组
   * @param {String} userId 用户ID
   * @returns {Object} 锁获取结果
   */
  async acquireLocks(slotIds, userId) {
    try {
      console.log('[LockManager] 开始获取锁：', { slotIds, userId })
      
      if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
        return {
          success: false,
          message: '时间段ID数组不能为空',
          lockedSlots: [],
          failedSlots: slotIds || []
        }
      }

      // 先清理过期锁
      await this.cleanupExpiredLocks()

      const currentTime = new Date()
      const expireTime = new Date(currentTime.getTime() + this.LOCK_TIMEOUT)
      
      const lockedSlots = []
      const failedSlots = []

      // 逐个尝试获取锁，确保原子性
      for (const slotId of slotIds) {
        try {
          // 使用条件更新确保原子性：只有在未锁定状态下才能获取锁
          const updateResult = await db.collection('duty_slots')
            .where({
              dutySlotId: slotId,
              lockStatus: db.command.neq('locked') // 只有非锁定状态才能获取锁
            })
            .update({
              data: {
                lockStatus: 'locked',
                lockUserId: userId,
                lockTime: currentTime,
                lockExpireTime: expireTime,
                updateTime: currentTime
              }
            })

          if (updateResult.stats.updated > 0) {
            lockedSlots.push(slotId)
            console.log('[LockManager] 成功获取锁：', slotId)
          } else {
            // 获取锁失败，检查具体原因
            const slotInfo = await this.getSlotLockInfo(slotId)
            failedSlots.push({
              slotId,
              reason: slotInfo.isLocked ? 
                `时间段已被用户 ${slotInfo.lockUserId} 锁定` : 
                '时间段不可用'
            })
            console.log('[LockManager] 获取锁失败：', slotId, slotInfo)
          }
        } catch (error) {
          console.error('[LockManager] 获取锁异常：', slotId, error)
          failedSlots.push({
            slotId,
            reason: `系统错误：${error.message}`
          })
        }
      }

      const success = failedSlots.length === 0
      
      console.log('[LockManager] 锁获取结果：', {
        success,
        lockedCount: lockedSlots.length,
        failedCount: failedSlots.length
      })

      return {
        success,
        message: success ? 
          `成功获取${lockedSlots.length}个时间段的锁` : 
          `获取锁失败，${failedSlots.length}个时间段无法锁定`,
        lockedSlots,
        failedSlots,
        lockExpireTime: expireTime
      }

    } catch (error) {
      console.error('[LockManager] 获取锁过程异常：', error)
      return {
        success: false,
        message: `获取锁失败：${error.message}`,
        lockedSlots: [],
        failedSlots: slotIds.map(id => ({ slotId: id, reason: error.message }))
      }
    }
  }

  /**
   * 释放时间段锁
   * @param {Array} slotIds 时间段ID数组
   * @param {String} userId 用户ID（可选，用于验证锁的所有权）
   * @returns {Object} 锁释放结果
   */
  async releaseLocks(slotIds, userId = null) {
    try {
      console.log('[LockManager] 开始释放锁：', { slotIds, userId })
      
      if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
        return {
          success: true,
          message: '没有需要释放的锁',
          releasedSlots: [],
          failedSlots: []
        }
      }

      const releasedSlots = []
      const failedSlots = []

      for (const slotId of slotIds) {
        try {
          // 构建释放条件
          const whereCondition = {
            dutySlotId: slotId,
            lockStatus: 'locked'
          }
          
          // 如果指定了用户ID，只释放该用户的锁
          if (userId) {
            whereCondition.lockUserId = userId
          }

          const updateResult = await db.collection('duty_slots')
            .where(whereCondition)
            .update({
              data: {
                lockStatus: 'unlocked',
                lockUserId: '',
                lockTime: null,
                lockExpireTime: null,
                updateTime: new Date()
              }
            })

          if (updateResult.stats.updated > 0) {
            releasedSlots.push(slotId)
            console.log('[LockManager] 成功释放锁：', slotId)
          } else {
            failedSlots.push({
              slotId,
              reason: userId ? '锁不属于当前用户或已被释放' : '锁不存在或已被释放'
            })
            console.log('[LockManager] 释放锁失败：', slotId)
          }
        } catch (error) {
          console.error('[LockManager] 释放锁异常：', slotId, error)
          failedSlots.push({
            slotId,
            reason: `系统错误：${error.message}`
          })
        }
      }

      const success = failedSlots.length === 0

      console.log('[LockManager] 锁释放结果：', {
        success,
        releasedCount: releasedSlots.length,
        failedCount: failedSlots.length
      })

      return {
        success,
        message: success ? 
          `成功释放${releasedSlots.length}个时间段的锁` : 
          `释放锁部分失败，${failedSlots.length}个时间段释放失败`,
        releasedSlots,
        failedSlots
      }

    } catch (error) {
      console.error('[LockManager] 释放锁过程异常：', error)
      return {
        success: false,
        message: `释放锁失败：${error.message}`,
        releasedSlots: [],
        failedSlots: slotIds.map(id => ({ slotId: id, reason: error.message }))
      }
    }
  }

  /**
   * 检查时间段锁状态
   * @param {String} slotId 时间段ID
   * @returns {Object} 锁状态信息
   */
  async getSlotLockInfo(slotId) {
    try {
      const result = await db.collection('duty_slots')
        .where({ dutySlotId: slotId })
        .field({
          dutySlotId: true,
          lockStatus: true,
          lockUserId: true,
          lockTime: true,
          lockExpireTime: true,
          isAvailable: true,
          dutyHolderId: true,
          dutyHolderName: true
        })
        .get()

      if (result.data.length === 0) {
        return {
          exists: false,
          isLocked: false,
          lockUserId: null,
          lockTime: null,
          lockExpireTime: null,
          isExpired: false
        }
      }

      const slot = result.data[0]
      const isLocked = slot.lockStatus === 'locked'
      const isExpired = isLocked && slot.lockExpireTime && new Date() > new Date(slot.lockExpireTime)

      return {
        exists: true,
        isLocked: isLocked && !isExpired, // 过期的锁视为未锁定
        lockUserId: slot.lockUserId,
        lockTime: slot.lockTime,
        lockExpireTime: slot.lockExpireTime,
        isExpired,
        isAvailable: slot.isAvailable,
        isAssigned: !!(slot.dutyHolderId || slot.dutyHolderName)
      }
    } catch (error) {
      console.error('[LockManager] 获取锁状态异常：', error)
      return {
        exists: false,
        isLocked: false,
        lockUserId: null,
        lockTime: null,
        lockExpireTime: null,
        isExpired: false,
        error: error.message
      }
    }
  }

  /**
   * 清理过期的锁
   * @returns {Object} 清理结果
   */
  async cleanupExpiredLocks() {
    try {
      console.log('[LockManager] 开始清理过期锁')
      
      const currentTime = new Date()
      
      // 查找所有过期的锁
      const expiredLocksResult = await db.collection('duty_slots')
        .where({
          lockStatus: 'locked',
          lockExpireTime: db.command.lt(currentTime)
        })
        .limit(this.CLEANUP_BATCH_SIZE)
        .get()

      if (expiredLocksResult.data.length === 0) {
        console.log('[LockManager] 没有过期锁需要清理')
        return {
          success: true,
          cleanedCount: 0,
          message: '没有过期锁需要清理'
        }
      }

      // 批量清理过期锁
      const cleanupPromises = expiredLocksResult.data.map(slot => {
        return db.collection('duty_slots')
          .doc(slot._id)
          .update({
            data: {
              lockStatus: 'unlocked',
              lockUserId: '',
              lockTime: null,
              lockExpireTime: null,
              updateTime: currentTime
            }
          })
      })

      await Promise.all(cleanupPromises)
      
      console.log('[LockManager] 过期锁清理完成：', expiredLocksResult.data.length)

      return {
        success: true,
        cleanedCount: expiredLocksResult.data.length,
        message: `成功清理${expiredLocksResult.data.length}个过期锁`
      }

    } catch (error) {
      console.error('[LockManager] 清理过期锁异常：', error)
      return {
        success: false,
        cleanedCount: 0,
        message: `清理过期锁失败：${error.message}`
      }
    }
  }

  /**
   * 强制释放用户的所有锁（用于异常情况处理）
   * @param {String} userId 用户ID
   * @returns {Object} 释放结果
   */
  async forceReleaseUserLocks(userId) {
    try {
      console.log('[LockManager] 强制释放用户锁：', userId)
      
      // 查找用户的所有锁
      const userLocksResult = await db.collection('duty_slots')
        .where({
          lockStatus: 'locked',
          lockUserId: userId
        })
        .get()

      if (userLocksResult.data.length === 0) {
        return {
          success: true,
          releasedCount: 0,
          message: '用户没有需要释放的锁'
        }
      }

      // 批量释放
      const releasePromises = userLocksResult.data.map(slot => {
        return db.collection('duty_slots')
          .doc(slot._id)
          .update({
            data: {
              lockStatus: 'unlocked',
              lockUserId: '',
              lockTime: null,
              lockExpireTime: null,
              updateTime: new Date()
            }
          })
      })

      await Promise.all(releasePromises)
      
      console.log('[LockManager] 强制释放用户锁完成：', userLocksResult.data.length)

      return {
        success: true,
        releasedCount: userLocksResult.data.length,
        message: `强制释放${userLocksResult.data.length}个锁`
      }

    } catch (error) {
      console.error('[LockManager] 强制释放用户锁异常：', error)
      return {
        success: false,
        releasedCount: 0,
        message: `强制释放失败：${error.message}`
      }
    }
  }
}

// 导出单例实例
const lockManager = new DutySlotLockManager()

module.exports = {
  lockManager,
  DutySlotLockManager
} 