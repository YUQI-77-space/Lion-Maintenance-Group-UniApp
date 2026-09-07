// 初始化志愿活动集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化志愿活动集合
 * @returns {Object} 返回初始化结果
 */
exports.initializeVolunteerActivityCollection = async () => {
  try {
    // 判断志愿活动集合是否存在
    try {
      await db.createCollection('voluntary_activities')
    } catch (err) {
      // 集合已存在，不需处理
    }
    
    // 判断志愿活动待办集合是否存在
    try {
      await db.createCollection('volunteer_toDo_list')
    } catch (err) {
      // 集合已存在，不需处理
    }

    // 创建索引
    await db.collection('voluntary_activities').createIndex({
      name: 'activityId_index',
      unique: true,
      key: {
        activityId: 1
      }
    })

    await db.collection('voluntary_activities').createIndex({
      name: 'activityStatus_index',
      key: {
        activityStatus: 1
      }
    })

    await db.collection('voluntary_activities').createIndex({
      name: 'creatorId_index',
      key: {
        creatorId: 1
      }
    })

    await db.collection('volunteer_toDo_list').createIndex({
      name: 'toDoListUserId_index',
      key: {
        toDoListUserId: 1
      }
    })

    await db.collection('volunteer_toDo_list').createIndex({
      name: 'taskId_index',
      key: {
        taskId: 1
      }
    })

    return {
      code: 200,
      data: null,
      message: '初始化志愿活动集合成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '初始化志愿活动集合失败'
    }
  }
} 