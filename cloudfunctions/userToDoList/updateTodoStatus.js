// 更新待办事项状态
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 更新待办事项状态
 * @param {Object} params - 参数对象
 * @param {string} params.type - 待办事项类型 (maintenance-维修任务, volunteer-志愿活动, duty-值班任务)
 * @param {string} params.id - 待办事项ID
 * @param {string} params.status - 新状态 (维修任务: pending/inProgress/completed, 志愿活动: inPreparation/inProgress/ended, 值班任务: pending/inProgress/ended)
 * @param {Object} params.updateData - 其他需要更新的数据
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回更新结果
 */
exports.updateTodoStatus = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.type || !params.id || !params.status) {
      return {
        code: 400,
        data: null,
        message: '缺少必要参数'
      }
    }
    
    // 当前时间
    const now = new Date()
    
    // 构建更新数据
    const updateData = {
      ...(params.updateData || {}),
      updateTime: now
    }
    
    // 根据类型更新不同的集合
    let result = null
    
    switch (params.type) {
      case 'maintenance':
        // 更新维修任务待办状态
        updateData.taskStatus = params.status
        
        result = await db.collection('maintenance_toDo_list').where({
          toDoListUserId: OPENID,
          taskId: params.id
        }).update({
          data: updateData
        })
        break
        
      case 'volunteer':
        // 更新志愿活动待办状态
        updateData.activityStatus = params.status
        
        result = await db.collection('volunteer_toDo_list').where({
          toDoListUserId: OPENID,
          taskId: params.id
        }).update({
          data: updateData
        })
        break
        
      case 'duty':
        // 更新值班任务待办状态
        updateData.status = params.status
        
        result = await db.collection('duty_toDo_list').where({
          toDoListUserId: OPENID,
          dutySlotId: params.id
        }).update({
          data: updateData
        })
        break
        
      default:
        return {
          code: 400,
          data: null,
          message: '不支持的待办事项类型'
        }
    }
    
    // 检查更新结果
    if (result.stats.updated === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到对应的待办事项或无权限更新'
      }
    }
    
    return {
      code: 200,
      data: {
        updated: result.stats.updated
      },
      message: '更新待办事项状态成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '更新待办事项状态失败'
    }
  }
} 