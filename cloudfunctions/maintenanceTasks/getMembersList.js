// 获取维修组成员列表（用于添加受理人）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取维修组成员列表
 * @param {Object} params - 参数对象
 * @param {string} params.taskId - 任务ID
 * @param {string} params.searchKeyword - 搜索关键词（可选）
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回成员列表
 */
exports.getMembersList = async (params, OPENID) => {
  try {
    
    
    // 检查参数
    if (!params.taskId) {
      return {
        code: 400,
        data: null,
        message: '缺少任务ID'
      }
    }
    
    // 获取当前用户角色（从 proUsers 集合，更高效）
    const userResult = await db.collection('proUsers').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '未找到用户信息或您不是维修组成员'
      }
    }
    
    const currentUser = userResult.data[0]
    
    // 只有组长可以添加受理人
    if (currentUser.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长可以添加受理人'
      }
    }
    
    // 获取任务信息，检查当前受理人情况
    const taskResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.taskId
    }).get()
    
    if (taskResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '任务不存在'
      }
    }
    
    const task = taskResult.data[0]
    
    // 获取当前所有受理人ID
    const currentAssignees = [task.assigneeId];
    if (task.additionalAssignees && task.additionalAssignees.length > 0) {
      task.additionalAssignees.forEach(assignee => {
        if (assignee.assigneeId) {
          currentAssignees.push(assignee.assigneeId);
        }
      });
    }
    // 过滤掉null/undefined值
    const validCurrentAssignees = currentAssignees.filter(Boolean);
    
    // 构建查询条件（针对 proUsers 集合）
    let query = {
      role: db.command.in(['member', 'leader'])
    }
    
    // 如果有搜索关键词，添加搜索条件
    if (params.searchKeyword && params.searchKeyword.trim()) {
      const keyword = params.searchKeyword.trim()
      query = db.command.and([
        query,
        db.command.or([
          { nickName: db.command.regex({ regexp: keyword, options: 'i' }) },
          { qqId: db.command.regex({ regexp: keyword, options: 'i' }) }
        ])
      ])
    }
    
    
    
    // 查询维修组成员（从 proUsers 集合）
    const membersResult = await db.collection('proUsers')
      .where(query)
      .orderBy('role', 'desc') // 组长优先
      .orderBy('nickName', 'asc')
      .get()
    
    
    
    // 处理成员数据（排除申请人自身）
    const members = membersResult.data
      .filter(member => member.openid !== task.applicantId)
      .map(member => {
      const displayName = member.nickName || '未知用户'
      const isCurrentAssignee = validCurrentAssignees.includes(member.openid)
      
      
      
      return {
        openid: member.openid,
        displayName: displayName,
        nickName: member.nickName,
        role: member.role,
        avatarUrl: member.avatarUrl,
        cloudAvatarUrl: member.cloudAvatarUrl,
        cloudAvatarFileID: member.cloudAvatarFileID,
        department: member.department || null, // 添加部门字段
        isCurrentAssignee: isCurrentAssignee // 标识是否已经是受理人
      }
    })
    
    
    
    return {
      code: 200,
      data: {
        members: members,
        currentAssigneesCount: validCurrentAssignees.length
      },
      message: '获取成员列表成功'
    }
    
  } catch (err) {
    console.error('获取成员列表出错:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '获取成员列表失败'
    }
  }
} 