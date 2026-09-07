// 获取维修任务详情
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取维修任务详情
 * @param {Object} params - 参数对象
 * @param {string} params.maintenanceTaskId - 维修任务ID
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回任务详情
 */
exports.getMaintenanceTaskDetail = async (params, OPENID) => {
  try {
    console.log('getMaintenanceTaskDetail 接收到的参数:', params, '用户OPENID:', OPENID);
    
    // 检查参数
    if (!params.maintenanceTaskId) {
      console.log('缺少任务ID参数');
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    // 查询任务详情
    console.log('正在查询维修任务详情, maintenanceTaskId:', params.maintenanceTaskId);
    const taskResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).get()
    
    console.log('维修任务查询结果:', taskResult);
    
    // 检查任务是否存在
    if (taskResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到对应的维修任务'
      }
    }
    
    // 获取用户角色
    console.log('正在查询用户角色');
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    console.log('用户查询结果:', userResult);
    
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '未找到用户信息，无法获取任务详情'
      }
    }
    
    const user = userResult.data[0]
    const userRole = user.role
    const task = taskResult.data[0]
    
    console.log('用户角色:', userRole, '任务申请人:', task.applicantId, '任务受理人:', task.assigneeId);
    
    // 检查用户是否为协助受理人
    let isAdditionalAssignee = false;
    if (task.additionalAssignees && task.additionalAssignees.length > 0) {
      isAdditionalAssignee = task.additionalAssignees.some(assignee => assignee.assigneeId === OPENID);
    }
    
    // 检查访问权限 - 包含协助受理人权限
    if (userRole !== 'leader' && 
        userRole !== 'member' && 
        task.applicantId !== OPENID && 
        task.assigneeId !== OPENID &&
        !isAdditionalAssignee) {  // 添加协助受理人权限检查
      console.log('用户无权查看此任务详情');
      return {
        code: 403,
        data: null,
        message: '您无权查看此任务详情'
      }
    }
    
    console.log('成功获取维修任务详情');
    return {
      code: 200,
      data: (() => {
        const { isUrgent, ...taskWithoutUrgency } = task
        return taskWithoutUrgency
      })(),
      message: '获取维修任务详情成功'
    }
    
  } catch (err) {
    console.error('获取维修任务详情出错:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '获取维修任务详情失败'
    }
  }
} 
