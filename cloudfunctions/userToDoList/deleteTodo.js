// 删除待办事项
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 删除待办事项
 * @param {Object} params - 参数对象
 * @param {string} params.type - 待办事项类型 (maintenance-维修任务, volunteer-志愿活动, duty-值班任务)
 * @param {string} params.id - 待办事项ID
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回删除结果
 */
exports.deleteTodo = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.type || !params.id) {
      return {
        code: 400,
        data: null,
        message: '缺少必要参数'
      }
    }
    
    // 根据类型删除不同的待办事项
    let result = null
    
    switch (params.type) {
      case 'maintenance':
        // 删除维修任务待办
        result = await db.collection('maintenance_toDo_list').where({
          toDoListUserId: OPENID,
          taskId: params.id
        }).remove()
        break
        
      case 'volunteer':
        // 删除志愿活动待办
        result = await db.collection('volunteer_toDo_list').where({
          toDoListUserId: OPENID,
          taskId: params.id
        }).remove()
        break
        

        
      default:
        return {
          code: 400,
          data: null,
          message: '不支持的待办事项类型'
        }
    }
    
    // 检查删除结果
    if (result.stats.removed === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到对应的待办事项或无权限删除'
      }
    }
    
    return {
      code: 200,
      data: {
        removed: result.stats.removed
      },
      message: '删除待办事项成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '删除待办事项失败'
    }
  }
} 