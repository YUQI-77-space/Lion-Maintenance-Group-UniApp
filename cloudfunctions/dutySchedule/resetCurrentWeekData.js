// 重置当前周值班数据
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { batchRemoveDutyEW } = require('./dutyEWManager')

/**
 * 批量重置值班记录（完全清除所有相关数据）
 * @param {Array} records 需要重置的记录数组
 * @returns {Object} 重置结果
 */
async function batchResetRecords(records) {
  console.log(`[resetCurrentWeekData] 开始重置${records.length}条记录`)

  try {
    // 并行重置所有记录
    const resetPromises = records.map(async (record) => {
      try {
        // 构建重置数据 - 清除所有用户选择相关字段
        const resetData = {
          assignedUser: null,      // 清除预选用户
          dutyHolderId: null,      // 清除值班人ID（兼容字段）
          dutyHolderName: null,    // 清除值班人姓名
          updateTime: new Date()
        }

        await db.collection('duty_slots').doc(record._id).update({
          data: resetData
        })

        return { success: true, recordId: record._id, slotId: record.dutySlotId }
      } catch (err) {
        console.log(`[resetCurrentWeekData] 记录 ${record._id} 重置失败：${err.message}`)
        return { success: false, recordId: record._id, slotId: record.dutySlotId, error: err.message }
      }
    })

    const results = await Promise.all(resetPromises)
    
    // 统计结果
    const successResults = results.filter(r => r.success)
    const failedResults = results.filter(r => !r.success)
    
    console.log(`[resetCurrentWeekData] 重置完成：成功 ${successResults.length}，失败 ${failedResults.length}`)
    
    if (failedResults.length > 0) {
      console.log('[resetCurrentWeekData] 失败的记录：', failedResults.map(r => r.slotId))
    }

    return {
      totalCount: records.length,
      successCount: successResults.length,
      failedCount: failedResults.length,
      failedRecords: failedResults
    }
    
  } catch (globalErr) {
    console.error('[resetCurrentWeekData] 批量重置全局错误：', globalErr)
    throw globalErr
  }
}

/**
 * 清除相关的待办事项
 * @param {number} weekNumber 周数
 * @param {number} year 年份
 * @returns {Object} 清除结果
 */
async function clearTodoItems(weekNumber, year) {
  try {
    console.log(`[resetCurrentWeekData] 开始清除第${weekNumber}周的待办事项`)

    // 查询该周的所有值班待办事项
    const todoResult = await db.collection('duty_toDo_list')
      .where({
        weekNumber: weekNumber
      })
      .get()

    console.log(`[resetCurrentWeekData] 找到${todoResult.data.length}条待办事项`)

    if (todoResult.data.length === 0) {
      return {
        totalCount: 0,
        deletedCount: 0,
        failedCount: 0
      }
    }

    // 并行删除所有待办事项
    const deletePromises = todoResult.data.map(async (todo) => {
      try {
        await db.collection('duty_toDo_list').doc(todo._id).remove()
        return { success: true, todoId: todo._id, slotId: todo.dutySlotId }
      } catch (err) {
        console.error(`[resetCurrentWeekData] 删除待办事项 ${todo._id} 失败：`, err)
        return { success: false, todoId: todo._id, slotId: todo.dutySlotId, error: err.message }
      }
    })

    const deleteResults = await Promise.all(deletePromises)
    
    const successDeletes = deleteResults.filter(r => r.success)
    const failedDeletes = deleteResults.filter(r => !r.success)
    
    console.log(`[resetCurrentWeekData] 待办事项清除完成：成功 ${successDeletes.length}，失败 ${failedDeletes.length}`)
    
    if (failedDeletes.length > 0) {
      console.log('[resetCurrentWeekData] 删除失败的待办事项：', failedDeletes.map(r => r.slotId))
    }

    return {
      totalCount: todoResult.data.length,
      deletedCount: successDeletes.length,
      failedCount: failedDeletes.length,
      failedItems: failedDeletes
    }

  } catch (err) {
    console.error('[resetCurrentWeekData] 清除待办事项错误：', err)
    throw err
  }
}

/**
 * 重置当前周的值班数据（完全清除所有相关数据）
 * @param {Object} event 事件参数
 * @param {String} openid 用户openid
 * @returns {Object} 返回重置结果
 */
exports.resetCurrentWeekData = async (event, openid) => {
  const startTime = Date.now()
  
  try {
    console.log('[resetCurrentWeekData] 开始重置当前周数据（完全重置模式）')

    // 检查用户权限
    const userResult = await db.collection('users').where({
      openid: openid
    }).get()

    if (userResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '用户信息不存在'
      }
    }

    const user = userResult.data[0]

    // 验证用户权限 - 只有组长可以重置数据
    if (!user.role || user.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长才能重置值班数据'
      }
    }

    // 第一步：获取当前配置
    const configResult = await db.collection('duty_config').doc('global').get()
    if (!configResult.data) {
      return {
        code: 404,
        data: null,
        message: '值班配置不存在，请先初始化系统'
      }
    }

    const config = configResult.data
    const currentWeek = config.currentWeek
    const currentYear = config.currentYear || new Date().getFullYear()

    if (!currentWeek) {
      return {
        code: 400,
        data: null,
        message: '当前周次未设置，请先设置当前周'
      }
    }

    console.log('[resetCurrentWeekData] 当前周配置：', { currentWeek, currentYear })

    // 第二步：获取当前周的所有值班记录
    const queryResult = await db.collection('duty_slots')
      .where({
        weekNumber: currentWeek,
        year: currentYear
      })
      .get()

    const records = queryResult.data
    console.log(`[resetCurrentWeekData] 找到第${currentWeek}周的 ${records.length} 条记录`)

    if (records.length === 0) {
      return {
        code: 404,
        data: {
          weekNumber: currentWeek,
          year: currentYear,
          resetCount: 0
        },
        message: `第${currentWeek}周暂无数据记录`
      }
    }

    // 统计重置前的状态
    const assignedSlots = records.filter(record => 
      (record.assignedUser && record.assignedUser.trim() !== '') ||
      (record.dutyHolderId && record.dutyHolderId.trim() !== '')
    ).length
    const confirmedSlots = records.filter(record => 
      record.dutyHolderName && record.dutyHolderName.trim() !== ''
    ).length
    const totalSlots = records.length

    console.log(`[resetCurrentWeekData] 重置前状态：总计${totalSlots}个时间段，已分配${assignedSlots}个，已确认${confirmedSlots}个`)

    // 第三步：获取所有已分配的值班记录，准备扣除EW
    console.log('[resetCurrentWeekData] 获取已分配的值班记录，准备扣除EW')
    const assignedRecords = records.filter(record => 
      (record.dutyHolderId && record.dutyHolderId.trim() !== '') ||
      (record.dutyHolderName && record.dutyHolderName.trim() !== '') ||
      (record.assignedUser && record.assignedUser.trim() !== '')
    )
    
    console.log(`[resetCurrentWeekData] 找到 ${assignedRecords.length} 个已分配的值班时间段`)

    // 第四步：批量扣除值班EW（如果有已分配的记录）
    let ewResult = null
    if (assignedRecords.length > 0) {
      console.log('[resetCurrentWeekData] 开始批量扣除值班EW')
      ewResult = await batchRemoveDutyEW(assignedRecords)
      
      if (ewResult.success) {
        console.log('[resetCurrentWeekData] 值班EW批量扣除成功:', ewResult)
      } else {
        console.error('[resetCurrentWeekData] 值班EW批量扣除失败:', ewResult.message)
        // EW扣除失败不影响主流程，但需要记录日志
      }
    } else {
      console.log('[resetCurrentWeekData] 没有已分配的值班记录，跳过EW扣除')
    }

    // 第五步：并行执行重置操作
    const [resetResult, todoResult] = await Promise.all([
      batchResetRecords(records),
      clearTodoItems(currentWeek, currentYear)
    ])
    
    console.log('[resetCurrentWeekData] 值班记录重置结果：', resetResult)
    console.log('[resetCurrentWeekData] 待办事项清除结果：', todoResult)
    if (ewResult) {
      console.log('[resetCurrentWeekData] 值班EW扣除结果：', ewResult)
    }
    
    const totalTime = Date.now() - startTime
    console.log(`[resetCurrentWeekData] 重置完成，总用时 ${totalTime}ms`)

    // 处理部分失败的情况
    const hasFailures = resetResult.failedCount > 0 || todoResult.failedCount > 0 || (ewResult && !ewResult.success)
    
    if (hasFailures) {
      return {
        code: 206,
        data: {
          weekNumber: currentWeek,
          year: currentYear,
          totalSlots,
          assignedSlotsBefore: assignedSlots,
          confirmedSlotsBefore: confirmedSlots,
          dutySlotResetResult: resetResult,
          todoCleanupResult: todoResult,
          ewRemovalResult: ewResult,
          executionTime: totalTime
        },
        message: `第${currentWeek}周数据重置部分成功。值班记录：成功${resetResult.successCount}条，失败${resetResult.failedCount}条；待办事项：成功删除${todoResult.deletedCount}条，失败${todoResult.failedCount}条${ewResult ? `；值班EW：成功扣除${ewResult.successCount || 0}个用户，失败${ewResult.failedCount || 0}个用户` : ''}`
      }
    }

    return {
      code: 200,
      data: {
        weekNumber: currentWeek,
        year: currentYear,
        totalSlots,
        assignedSlotsBefore: assignedSlots,
        confirmedSlotsBefore: confirmedSlots,
        dutySlotResetResult: resetResult,
        todoCleanupResult: todoResult,
        ewRemovalResult: ewResult,
        executionTime: totalTime
      },
      message: `成功重置第${currentWeek}周的所有数据！已清除${resetResult.successCount}条值班记录、${todoResult.deletedCount}条待办事项${ewResult ? `、${ewResult.successCount || 0}个用户的值班EW` : ''}`
    }

  } catch (err) {
    console.error('[resetCurrentWeekData] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '重置当前周数据失败'
    }
  }
} 