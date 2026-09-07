// 清除所有值班时间段
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { batchRemoveDutyEW } = require('./dutyEWManager')

/**
 * 带重试机制的单条记录删除
 * @param {String} recordId 记录ID
 * @param {Number} maxRetries 最大重试次数
 * @returns {Object} 删除结果
 */
async function deleteRecordWithRetry(recordId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const deleteResult = await db.collection('duty_slots').doc(recordId).remove()
      
      if (deleteResult.stats && deleteResult.stats.removed > 0) {
        return { success: true, recordId: recordId }
      } else {
        throw new Error(`删除失败：记录可能不存在`)
      }
    } catch (err) {
      console.error(`[deleteRecordWithRetry] 记录 ${recordId} 第 ${attempt} 次删除尝试失败：`, err.message)
      
      if (attempt === maxRetries) {
        return { success: false, recordId: recordId, error: err.message }
      }
      
      // 重试前短暂等待
      await new Promise(resolve => setTimeout(resolve, 100 * attempt))
    }
  }
}

/**
 * 清空所有值班待办事项
 * @returns {Object} 清除结果
 */
async function clearAllTodoItems() {
  try {
    console.log(`[clearAllDutySlots] 开始清空所有值班待办事项`)

    // 第一步：统计总记录数
    const countResult = await db.collection('duty_toDo_list').count()
    const totalTodoRecords = countResult.total

    console.log(`[clearAllDutySlots] 发现 ${totalTodoRecords} 条待办事项需要删除`)

    if (totalTodoRecords === 0) {
      return {
        totalCount: 0,
        deletedCount: 0,
        failedCount: 0
      }
    }

    // 第二步：分批删除所有待办事项
    let deletedTodoCount = 0
    let failedTodoCount = 0
    const batchSize = 100

    while (true) {
      // 获取一批待办事项记录
      const batchResult = await db.collection('duty_toDo_list')
        .limit(batchSize)
        .field({ _id: true, dutySlotId: true })
        .get()

      const todosToDelete = batchResult.data

      if (todosToDelete.length === 0) {
        console.log('[clearAllDutySlots] 没有更多待办事项需要删除')
        break
      }

      console.log(`[clearAllDutySlots] 准备删除 ${todosToDelete.length} 条待办事项`)

      // 并行删除待办事项
      const deletePromises = todosToDelete.map(async (todo) => {
        try {
          await db.collection('duty_toDo_list').doc(todo._id).remove()
          return { success: true, todoId: todo._id, slotId: todo.dutySlotId }
        } catch (err) {
          console.error(`[clearAllDutySlots] 删除待办事项 ${todo._id} 失败：`, err)
          return { success: false, todoId: todo._id, slotId: todo.dutySlotId, error: err.message }
        }
      })

      const deleteResults = await Promise.all(deletePromises)
      
      const successDeletes = deleteResults.filter(r => r.success)
      const failedDeletes = deleteResults.filter(r => !r.success)
      
      deletedTodoCount += successDeletes.length
      failedTodoCount += failedDeletes.length
      
      console.log(`[clearAllDutySlots] 本批次待办事项删除完成：成功 ${successDeletes.length}，失败 ${failedDeletes.length}`)
      
      if (failedDeletes.length > 0) {
        console.log('[clearAllDutySlots] 删除失败的待办事项：', failedDeletes.map(r => r.slotId))
      }

      // 如果本批次没有成功删除任何记录，则退出循环避免无限循环
      if (successDeletes.length === 0) {
        console.error('[clearAllDutySlots] 连续批次待办事项删除失败，停止删除')
        break
      }
    }

    console.log(`[clearAllDutySlots] 待办事项清除完成：总计 ${totalTodoRecords}，成功删除 ${deletedTodoCount}，失败 ${failedTodoCount}`)

    return {
      totalCount: totalTodoRecords,
      deletedCount: deletedTodoCount,
      failedCount: failedTodoCount
    }

  } catch (err) {
    console.error('[clearAllDutySlots] 清除待办事项错误：', err)
    throw err
  }
}

/**
 * 清除duty_slots集合的所有记录
 * 优化版：先统计再高效批量删除
 * @param {Object} event 事件参数
 * @param {Boolean} event.forceDelete 是否强制删除（跳过权限检查）
 * @param {Number} event.batchSize 批次大小（可选，默认100）
 * @param {Number} event.maxRetries 最大重试次数（可选，默认2）
 * @param {String} openid 用户openid
 * @returns {Object} 返回删除结果
 */
exports.clearAllDutySlots = async (event, openid) => {
  try {
    console.log('[clearAllDutySlots] 开始清除所有值班时间段和待办事项（优化版）')
    console.log('[clearAllDutySlots] 参数：', { 
      forceDelete: event.forceDelete, 
      batchSize: event.batchSize,
      maxRetries: event.maxRetries 
    })

    // TODO: 权限检查（确保只有组长可以执行删除）
    if (!event.forceDelete) {
      // const userResult = await checkLeaderPermission(openid)
      console.log('[clearAllDutySlots] 权限检查通过（临时跳过）')
    }

    // 优化配置参数 - 更大批次，更快删除
    const batchSize = event.batchSize || 100  // 增大批次删除更多记录
    const maxRetries = event.maxRetries || 2  // 减少重试次数，加快速度
    const startTime = Date.now()

    // 第一步：获取总记录数
    console.log('[clearAllDutySlots] 第一步：统计总记录数')
    const countResult = await db.collection('duty_slots').count()
    const totalRecords = countResult.total

    console.log(`[clearAllDutySlots] 发现 ${totalRecords} 条记录需要删除`)

    if (totalRecords === 0) {
      // 即使duty_slots为空，也要尝试清空duty_toDo_list
      console.log('[clearAllDutySlots] duty_slots集合为空，但仍需清空待办事项')
      
      const todoResult = await clearAllTodoItems()
      
      return {
        code: 200,
        data: {
          totalRecords: 0,
          deletedRecords: 0,
          batchCount: 0,
          duration: Date.now() - startTime,
          status: 'completed',
          todoCleanupResult: todoResult
        },
        message: `duty_slots集合已经是空的，但已清空 ${todoResult.deletedCount} 条待办事项`
      }
    }

    // 第一点五步：获取所有已分配的值班记录，用于扣除EW
    console.log('[clearAllDutySlots] 获取已分配的值班记录，准备扣除EW')
    const assignedSlotsResult = await db.collection('duty_slots')
      .where({
        dutyHolderName: db.command.neq('')
      })
      .where({
        dutyHolderName: db.command.exists(true)
      })
      .field({
        dutySlotId: true,
        assignedUser: true,
        dutyHolderId: true,
        dutyHolderName: true
      })
      .get()

    const assignedSlots = assignedSlotsResult.data
    console.log(`[clearAllDutySlots] 找到 ${assignedSlots.length} 个已分配的值班时间段`)

    // 批量扣除值班EW
    let ewResult = null
    if (assignedSlots.length > 0) {
      console.log('[clearAllDutySlots] 开始批量扣除值班EW')
      ewResult = await batchRemoveDutyEW(assignedSlots)
      
      if (ewResult.success) {
        console.log('[clearAllDutySlots] 值班EW批量扣除成功:', ewResult)
      } else {
        console.error('[clearAllDutySlots] 值班EW批量扣除失败:', ewResult.message)
        // EW扣除失败不影响主流程，但需要记录日志
      }
    }

    // 第二步：并行清空duty_slots和duty_toDo_list
    console.log('[clearAllDutySlots] 第二步：开始并行清空duty_slots和duty_toDo_list')
    
    const [dutySlotsDeleteResult, todoCleanupResult] = await Promise.all([
      // 清空duty_slots集合
      (async () => {
        let deletedRecords = 0
        let batchCount = 0
        let failedBatches = []
        const estimatedBatches = Math.ceil(totalRecords / batchSize)

        console.log(`[clearAllDutySlots] 预计需要 ${estimatedBatches} 个批次完成删除`)

        // 持续删除直到没有记录
        while (true) {
          batchCount++
          console.log(`[clearAllDutySlots] 执行第 ${batchCount} 批次删除`)

          try {
            // 获取一批记录的ID
            const batchResult = await db.collection('duty_slots')
              .limit(batchSize)
              .field({ _id: true })
              .get()

            const recordsToDelete = batchResult.data

            if (recordsToDelete.length === 0) {
              console.log('[clearAllDutySlots] 没有更多记录需要删除，退出循环')
              break
            }

            console.log(`[clearAllDutySlots] 第 ${batchCount} 批次：准备删除 ${recordsToDelete.length} 条记录`)

            // 高效并发删除 - 直接删除，不使用重试机制
            const deletePromises = recordsToDelete.map(record => 
              db.collection('duty_slots').doc(record._id).remove()
                .then(() => ({ success: true, recordId: record._id }))
                .catch(err => ({ success: false, recordId: record._id, error: err.message }))
            )

            const deleteResults = await Promise.all(deletePromises)

            // 统计本批次删除结果
            let batchSuccessCount = 0
            let batchFailCount = 0

            deleteResults.forEach((result) => {
              if (result.success) {
                batchSuccessCount++
              } else {
                batchFailCount++
                console.log(`[clearAllDutySlots] 记录 ${result.recordId} 删除失败：${result.error}`)
              }
            })

            deletedRecords += batchSuccessCount

            console.log(`[clearAllDutySlots] 第 ${batchCount} 批次完成：成功 ${batchSuccessCount}，失败 ${batchFailCount}`)

            if (batchFailCount > 0) {
              failedBatches.push({
                batch: batchCount,
                failed: batchFailCount,
                records: recordsToDelete.length
              })
            }

            // 防止无限循环：如果连续多个批次都没有成功删除任何记录，则退出
            if (batchSuccessCount === 0 && batchCount > estimatedBatches + 5) {
              console.error('[clearAllDutySlots] 连续多个批次删除失败，停止删除')
              break
            }

            // 批次间短暂停顿，避免过度占用资源
            if (batchCount % 10 === 0) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }

          } catch (err) {
            console.error(`[clearAllDutySlots] 第 ${batchCount} 批次执行异常：`, err)
            failedBatches.push({
              batch: batchCount,
              error: err.message,
              records: 'unknown'
            })
          }
        }

        return {
          deletedRecords,
          batchCount,
          failedBatches,
          totalRecords
        }
      })(),
      // 清空duty_toDo_list集合
      clearAllTodoItems()
    ])

    // 第三步：验证删除结果
    console.log('[clearAllDutySlots] 第三步：验证删除结果')
    const finalCountResult = await db.collection('duty_slots').count()
    const remainingRecords = finalCountResult.total

    const duration = Date.now() - startTime
    const deletionRate = totalRecords > 0 ? (dutySlotsDeleteResult.deletedRecords / totalRecords * 100).toFixed(2) : 0

    console.log(`[clearAllDutySlots] 删除完成统计：`)
    console.log(`- 原始记录数：${totalRecords}`)
    console.log(`- 删除记录数：${dutySlotsDeleteResult.deletedRecords}`)
    console.log(`- 剩余记录数：${remainingRecords}`)
    console.log(`- 执行批次数：${dutySlotsDeleteResult.batchCount}`)
    console.log(`- 删除成功率：${deletionRate}%`)
    console.log(`- 待办事项删除：${todoCleanupResult.deletedCount}/${todoCleanupResult.totalCount}`)
    console.log(`- 执行时长：${duration}ms`)
    console.log(`- 失败批次：${dutySlotsDeleteResult.failedBatches.length}`)

    // 第四步：返回结果
    const isCompleteSuccess = (remainingRecords === 0 && todoCleanupResult.failedCount === 0)
    const status = isCompleteSuccess ? 'completed' : 'partial'

    return {
      code: isCompleteSuccess ? 200 : 206, // 206表示部分成功
      data: {
        totalRecords: totalRecords,
        deletedRecords: dutySlotsDeleteResult.deletedRecords,
        remainingRecords: remainingRecords,
        batchCount: dutySlotsDeleteResult.batchCount,
        deletionRate: deletionRate,
        duration: duration,
        status: status,
        failedBatches: dutySlotsDeleteResult.failedBatches.length > 0 ? dutySlotsDeleteResult.failedBatches : undefined,
        todoCleanupResult: todoCleanupResult,
        ewRemovalResult: ewResult
      },
      message: isCompleteSuccess 
        ? `成功清除所有 ${dutySlotsDeleteResult.deletedRecords} 条值班时间段记录和 ${todoCleanupResult.deletedCount} 条待办事项` 
        : `部分删除成功：删除了 ${dutySlotsDeleteResult.deletedRecords}/${totalRecords} 条值班记录，剩余 ${remainingRecords} 条；删除了 ${todoCleanupResult.deletedCount}/${todoCleanupResult.totalCount} 条待办事项`
    }

  } catch (err) {
    console.error('[clearAllDutySlots] 删除过程发生错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '清除值班时间段失败'
    }
  }
} 