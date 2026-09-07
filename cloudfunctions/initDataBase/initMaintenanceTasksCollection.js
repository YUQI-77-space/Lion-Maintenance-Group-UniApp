// 初始化维修任务集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化维修任务集合
 * @returns {Object} 返回初始化结果
 */
exports.initMaintenanceTasksCollection = async () => {
  try {
    // 初始化维修任务集合
    try {
      await db.createCollection('maintenance_tasks')
    } catch (err) {
      // 集合已存在，不需处理
    }
    
    // 初始化维修任务待办集合
    try {
      await db.createCollection('maintenance_toDo_list')
    } catch (err) {
      // 集合已存在，不需处理
    }
    
    // 初始化等效工作量汇总集合
    try {
      await db.createCollection('ewaSummary')
    } catch (err) {
      // 集合已存在，不需处理
    }

    // 创建索引
    // 维修任务索引
    await db.collection('maintenance_tasks').createIndex({
      name: 'maintenanceTaskId_index',
      unique: true,
      key: {
        maintenanceTaskId: 1
      }
    })

    await db.collection('maintenance_tasks').createIndex({
      name: 'taskStatus_index',
      key: {
        taskStatus: 1
      }
    })

    await db.collection('maintenance_tasks').createIndex({
      name: 'applicantId_index',
      key: {
        applicantId: 1
      }
    })

    await db.collection('maintenance_tasks').createIndex({
      name: 'assigneeId_index',
      key: {
        assigneeId: 1
      }
    })

    // 维修任务待办索引
    await db.collection('maintenance_toDo_list').createIndex({
      name: 'toDoListUserId_index',
      key: {
        toDoListUserId: 1
      }
    })

    await db.collection('maintenance_toDo_list').createIndex({
      name: 'taskId_index',
      key: {
        taskId: 1
      }
    })

    // 等效工作量汇总索引
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
        totalEW: -1
      }
    })

    return {
      code: 200,
      data: null,
      message: '初始化维修任务相关集合成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '初始化维修任务相关集合失败'
    }
  }
} 