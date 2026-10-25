// 值班EW管理模块
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })

// 默认每次值班的EW值
const DEFAULT_DUTY_EW_PER_SLOT = 2
const { createHash } = require('crypto')

// 由状态事务调用：沿用历史文档ID和manual字段，只改值班展示值与加权总分。
exports.adjustDutyEW = async (transaction, summaryId, openid, delta, userName = '') => {
  if (!Number.isFinite(delta)) throw new Error('工作量增量无效')
  const ref = transaction.collection('ewaSummary').doc(summaryId)
  const { data: existing } = await ref.get()
  if (existing && existing.ewaUserId !== openid) throw new Error('工作量记录归属异常')
  const current = existing || { maintenanceEW: 0, volunteerEW: 0, dutyEW: 0 }
  const values = ['maintenanceEW', 'volunteerEW', 'dutyEW'].map(key => {
    const value = current[key] === undefined ? 0 : current[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 300) {
      throw new Error('历史工作量数值异常，请先核查，未自动覆盖')
    }
    return value
  })
  const dutyEW = Math.round(Math.max(0, Math.min(300, values[2] + delta)) * 100) / 100
  const totalEW = Math.round((values[0] * 0.5 + values[1] * 0.4 + dutyEW * 0.1) * 100) / 100
  const data = { dutyEW, totalEW, updateTime: db.serverDate() }
  if (existing) await ref.update({ data })
  else await ref.set({ data: { ewaUserId: openid, ewaUserName: userName,
    maintenanceEW: 0, volunteerEW: 0, ...data, createTime: db.serverDate() } })
  return dutyEW - values[2]
}

exports.findDutySummaryId = async openid => {
  const result = await db.collection('ewaSummary').where({ ewaUserId: openid }).limit(2).get()
  if (result.data.length > 1) throw new Error('工作量存在重复记录，请先核查')
  return result.data.length ? result.data[0]._id : 'ewa_' + createHash('sha256').update(openid).digest('hex')
}

async function changeDutyEW(openid, slotCount, ewPerSlot, remove) {
  let transaction
  try {
    if (typeof openid !== 'string' || !openid || !Number.isInteger(slotCount) || slotCount < 0 ||
        !Number.isFinite(ewPerSlot) || ewPerSlot < 0) throw new Error('工作量参数无效')
    const users = await db.collection('users').where({ openid }).limit(2).get()
    if (users.data.length !== 1) throw new Error('用户身份异常')
    const summaryId = await exports.findDutySummaryId(openid)
    transaction = await db.startTransaction()
    const delta = await exports.adjustDutyEW(transaction, summaryId, openid,
      slotCount * ewPerSlot * (remove ? -1 : 1), users.data[0].nickName || '')
    await transaction.commit()
    transaction = null
    return { success: true, [remove ? 'ewRemoved' : 'ewAdded']: Math.abs(delta), slotCount, message: '值班工作量已更新' }
  } catch (error) {
    if (transaction) await transaction.rollback().catch(() => {})
    return { success: false, message: error.message || '更新工作量失败' }
  }
}

// 状态结算使用同一事务中的adjustDutyEW；兼容内部已有增减接口。
exports.addDutyEW = (openid, slotCount = 1, ewPerSlot = DEFAULT_DUTY_EW_PER_SLOT) =>
  changeDutyEW(openid, slotCount, ewPerSlot, false)
exports.removeDutyEW = (openid, slotCount = 1, ewPerSlot = DEFAULT_DUTY_EW_PER_SLOT) =>
  changeDutyEW(openid, slotCount, ewPerSlot, true)
/**
 * 批量处理用户值班EW扣除（用于清除操作）
 * @param {Array} dutySlots - 包含用户信息的值班时间段数组
 * @param {number} ewPerSlot - 每个时间段的EW值，默认为2
 * @returns {Object} 操作结果
 */
exports.batchRemoveDutyEW = async (dutySlots, ewPerSlot = DEFAULT_DUTY_EW_PER_SLOT) => {
  try {
    console.log(`[dutyEWManager] 批量扣除值班EW，共 ${dutySlots.length} 个时间段`)
    
    // 按用户分组统计需要扣除的EW
    const userEWMap = {}
    
    dutySlots.forEach(slot => {
      // 确认不等于已入账；删除未来排班不能扣掉其他历史工作量。
      if (slot.dutyStatus !== 'ended') return
      const userId = slot.assignedUser || slot.dutyHolderId || slot.originalAssignedUser
      if (userId) {
        userEWMap[userId] = (userEWMap[userId] || 0) + 1
      }
    })
    
    const results = []
    
    // 为每个用户扣除对应的EW
    for (const [userId, slotCount] of Object.entries(userEWMap)) {
      const result = await exports.removeDutyEW(userId, slotCount, ewPerSlot)
      results.push({
        userId,
        slotCount,
        result
      })
    }
    
    const successCount = results.filter(r => r.result.success).length
    const failedCount = results.length - successCount
    
    console.log(`[dutyEWManager] 批量扣除完成：成功 ${successCount}，失败 ${failedCount}`)
    
    return {
      success: failedCount === 0,
      totalUsers: results.length,
      successCount,
      failedCount,
      details: results,
      message: `批量处理完成：${successCount} 个用户成功，${failedCount} 个用户失败`
    }
    
  } catch (err) {
    console.error('[dutyEWManager] 批量扣除值班EW失败：', err)
    return {
      success: false,
      message: err.message || '批量扣除值班EW失败'
    }
  }
}

/**
 * 获取用户当前的值班EW
 * @param {string} openid - 用户openid
 * @returns {Object} 查询结果
 */
exports.getUserDutyEW = async (openid) => {
  try {
    const summaryResult = await db.collection('ewaSummary').where({
      ewaUserId: openid
    }).get()
    
    if (summaryResult.data.length === 0) {
      return {
        success: true,
        dutyEW: 0,
        message: '用户没有EWA记录'
      }
    }
    
    const dutyEW = summaryResult.data[0].dutyEW || 0
    
    return {
      success: true,
      dutyEW: dutyEW,
      message: '查询成功'
    }
    
  } catch (err) {
    console.error('[dutyEWManager] 查询用户值班EW失败：', err)
    return {
      success: false,
      dutyEW: 0,
      message: err.message || '查询用户值班EW失败'
    }
  }
}
