// 添加待办事项
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 添加待办事项
 * @param {Object} params - 参数对象
 * @param {string} params.type - 待办事项类型 (maintenance-维修任务, volunteer-志愿活动, duty-值班任务)
 * @param {Object} params.todoData - 待办事项数据
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回添加结果
 */
exports.addTodo = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.type || !params.todoData) {
      return {
        code: 400,
        data: null,
        message: '缺少必要参数'
      }
    }
    
    // 当前时间
    const now = new Date()
    
    // 添加toDoListUserId字段
    const todoData = {
      ...params.todoData,
      toDoListUserId: OPENID,
      createTime: now,
      updateTime: now
    }
    
    // 根据类型添加到不同的集合
    let result = null
    
    switch (params.type) {
      case 'maintenance':
        // 添加维修任务待办
        result = await db.collection('maintenance_toDo_list').add({
          data: todoData
        })
        break
        
      case 'volunteer':
        // 添加志愿活动待办
        result = await db.collection('volunteer_toDo_list').add({
          data: todoData
        })
        break
        

        
      default:
        return {
          code: 400,
          data: null,
          message: '不支持的待办事项类型'
        }
    }
    
    return {
      code: 200,
      data: {
        id: result._id
      },
      message: '添加待办事项成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '添加待办事项失败'
    }
  }
} 