// 维修任务EW管理模块
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 为用户扣除维修任务EW
 * @param {string} openid - 用户openid
 * @param {number} ewAmount - 要扣除的EW值
 * @returns {Object} 操作结果
 */
exports.removeMaintenanceEW = async (openid, ewAmount) => {
  try {
    console.log(`[maintenanceEWManager] 为用户 ${openid} 扣除维修任务EW: ${ewAmount}`)
    
    if (ewAmount <= 0) {
      console.log(`[maintenanceEWManager] EW值为0，无需扣除`)
      return {
        success: true,
        ewRemoved: 0,
        message: 'EW值为0，无需扣除'
      }
    }
    
    // 查询用户的EWA汇总记录
    const summaryResult = await db.collection('ewaSummary').where({
      ewaUserId: openid
    }).get()
    
    if (summaryResult.data.length === 0) {
      console.log(`[maintenanceEWManager] 用户 ${openid} 没有EWA记录，无需扣除`)
      return {
        success: true,
        ewRemoved: 0,
        message: '用户没有EWA记录，无需扣除'
      }
    }
    
    const currentSummary = summaryResult.data[0]
    const currentMaintenanceEW = currentSummary.maintenanceEW || 0
    const newMaintenanceEW = Math.max(0, currentMaintenanceEW - ewAmount) // 确保不会变成负数
    const actualRemoved = currentMaintenanceEW - newMaintenanceEW
    
    const newTotalEW = (currentSummary.volunteerEW || 0) + (currentSummary.dutyEW || 0) + newMaintenanceEW
    
    await db.collection('ewaSummary').where({
      ewaUserId: openid
    }).update({
      data: {
        maintenanceEW: newMaintenanceEW,
        totalEW: newTotalEW,
        updateTime: new Date()
      }
    })
    
    console.log(`[maintenanceEWManager] 扣除维修任务EW：用户 ${openid}，扣除EW: ${actualRemoved}，剩余维修EW: ${newMaintenanceEW}`)
    
    return {
      success: true,
      ewRemoved: actualRemoved,
      message: `成功扣除${actualRemoved}点维修任务EW`
    }
    
  } catch (err) {
    console.error('[maintenanceEWManager] 扣除维修任务EW失败：', err)
    return {
      success: false,
      message: err.message || '扣除维修任务EW失败'
    }
  }
}

/**
 * 批量扣除维修任务EW（用于删除任务）
 * @param {Array} assigneeIds - 受理人ID数组
 * @param {number} ewAmount - 要扣除的EW值
 * @returns {Object} 操作结果
 */
exports.batchRemoveMaintenanceEW = async (assigneeIds, ewAmount) => {
  try {
    console.log(`[maintenanceEWManager] 批量扣除维修任务EW，受理人数量: ${assigneeIds.length}，EW值: ${ewAmount}`)
    
    if (!assigneeIds || assigneeIds.length === 0) {
      return {
        success: true,
        totalUsers: 0,
        successCount: 0,
        failedCount: 0,
        message: '没有需要处理的用户'
      }
    }
    
    const results = []
    
    // 为每个受理人扣除对应的EW
    for (const assigneeId of assigneeIds) {
      const result = await exports.removeMaintenanceEW(assigneeId, ewAmount)
      results.push({
        userId: assigneeId,
        ewAmount,
        result
      })
    }
    
    const successCount = results.filter(r => r.result.success).length
    const failedCount = results.length - successCount
    
    console.log(`[maintenanceEWManager] 批量扣除完成：成功 ${successCount}，失败 ${failedCount}`)
    
    return {
      success: failedCount === 0,
      totalUsers: results.length,
      successCount,
      failedCount,
      details: results,
      message: `批量处理完成：${successCount} 个用户成功，${failedCount} 个用户失败`
    }
    
  } catch (err) {
    console.error('[maintenanceEWManager] 批量扣除维修任务EW失败：', err)
    return {
      success: false,
      message: err.message || '批量扣除维修任务EW失败'
    }
  }
} 