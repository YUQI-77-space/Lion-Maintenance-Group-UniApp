// 值班EW管理模块
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 默认每次值班的EW值
const DEFAULT_DUTY_EW_PER_SLOT = 2

/**
 * 为用户添加值班EW
 * @param {string} openid - 用户openid
 * @param {number} slotCount - 值班时间段数量 
 * @param {number} ewPerSlot - 每个时间段的EW值，默认为2
 * @returns {Object} 操作结果
 */
exports.addDutyEW = async (openid, slotCount = 1, ewPerSlot = DEFAULT_DUTY_EW_PER_SLOT) => {
  try {
    console.log(`[dutyEWManager] 为用户 ${openid} 添加值班EW，时间段数量: ${slotCount}，每段EW: ${ewPerSlot}`)
    
    const ewToAdd = slotCount * ewPerSlot
    
    // 获取用户信息
    const userResult = await db.collection('users').where({
      openid: openid
    }).get()
    
    if (userResult.data.length === 0) {
      return {
        success: false,
        message: '用户信息不存在'
      }
    }
    
    const user = userResult.data[0]
    
    // 查询用户的EWA汇总记录
    const summaryResult = await db.collection('ewaSummary').where({
      ewaUserId: openid
    }).get()
    
    if (summaryResult.data.length > 0) {
      // 更新现有记录
      const currentSummary = summaryResult.data[0]
      const newDutyEW = (currentSummary.dutyEW || 0) + ewToAdd
      const newTotalEW = (currentSummary.maintenanceEW || 0) + (currentSummary.volunteerEW || 0) + newDutyEW
      
      await db.collection('ewaSummary').where({
        ewaUserId: openid
      }).update({
        data: {
          dutyEW: newDutyEW,
          totalEW: newTotalEW,
          updateTime: new Date()
        }
      })
      
      console.log(`[dutyEWManager] 更新现有记录：用户 ${openid}，新增值班EW: ${ewToAdd}，总值班EW: ${newDutyEW}`)
    } else {
      // 创建新记录
      const newSummary = {
        ewaUserId: openid,
        ewaUserName: user.nickName || '',


        maintenanceEW: 0,
        volunteerEW: 0,
        dutyEW: ewToAdd,
        totalEW: ewToAdd,
        createTime: new Date(),
        updateTime: new Date()
      }
      
      await db.collection('ewaSummary').add({
        data: newSummary
      })
      
      console.log(`[dutyEWManager] 创建新记录：用户 ${openid}，值班EW: ${ewToAdd}`)
    }
    
    return {
      success: true,
      ewAdded: ewToAdd,
      slotCount: slotCount,
      message: `成功添加${ewToAdd}点值班EW`
    }
    
  } catch (err) {
    console.error('[dutyEWManager] 添加值班EW失败：', err)
    return {
      success: false,
      message: err.message || '添加值班EW失败'
    }
  }
}

/**
 * 为用户扣除值班EW
 * @param {string} openid - 用户openid
 * @param {number} slotCount - 值班时间段数量
 * @param {number} ewPerSlot - 每个时间段的EW值，默认为2
 * @returns {Object} 操作结果
 */
exports.removeDutyEW = async (openid, slotCount = 1, ewPerSlot = DEFAULT_DUTY_EW_PER_SLOT) => {
  try {
    console.log(`[dutyEWManager] 为用户 ${openid} 扣除值班EW，时间段数量: ${slotCount}，每段EW: ${ewPerSlot}`)
    
    const ewToRemove = slotCount * ewPerSlot
    
    // 查询用户的EWA汇总记录
    const summaryResult = await db.collection('ewaSummary').where({
      ewaUserId: openid
    }).get()
    
    if (summaryResult.data.length === 0) {
      console.log(`[dutyEWManager] 用户 ${openid} 没有EWA记录，无需扣除`)
      return {
        success: true,
        ewRemoved: 0,
        message: '用户没有EWA记录，无需扣除'
      }
    }
    
    const currentSummary = summaryResult.data[0]
    const currentDutyEW = currentSummary.dutyEW || 0
    const newDutyEW = Math.max(0, currentDutyEW - ewToRemove) // 确保不会变成负数
    const actualRemoved = currentDutyEW - newDutyEW
    
    const newTotalEW = (currentSummary.maintenanceEW || 0) + (currentSummary.volunteerEW || 0) + newDutyEW
    
    await db.collection('ewaSummary').where({
      ewaUserId: openid
    }).update({
      data: {
        dutyEW: newDutyEW,
        totalEW: newTotalEW,
        updateTime: new Date()
      }
    })
    
    console.log(`[dutyEWManager] 扣除值班EW：用户 ${openid}，扣除EW: ${actualRemoved}，剩余值班EW: ${newDutyEW}`)
    
    return {
      success: true,
      ewRemoved: actualRemoved,
      slotCount: slotCount,
      message: `成功扣除${actualRemoved}点值班EW`
    }
    
  } catch (err) {
    console.error('[dutyEWManager] 扣除值班EW失败：', err)
    return {
      success: false,
      message: err.message || '扣除值班EW失败'
    }
  }
}

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
