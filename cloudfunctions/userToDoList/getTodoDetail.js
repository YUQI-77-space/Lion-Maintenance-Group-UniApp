// 获取待办事项详情
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取待办事项详情
 * @param {Object} params - 参数对象
 * @param {string} params.type - 待办事项类型 (maintenance-维修任务, volunteer-志愿活动, duty-值班任务)
 * @param {string} params.id - 待办事项ID
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回待办事项详情
 */
exports.getTodoDetail = async (params, OPENID) => {
  try {
    const userId = OPENID;
    console.log(`[getTodoDetail] - 开始获取待办详情, 类型: ${params.type}, ID: ${params.id}, 用户ID: ${userId}`);

    if (!params.type || !params.id) {
      return { code: 400, message: '缺少必要参数' };
    }

    let todoDetail = null;

    switch (params.type) {
      case 'maintenance':
        const maintenanceResult = await db.collection('maintenance_toDo_list')
          .where({
            toDoListUserId: userId,
            taskId: params.id
          })
          .get();

        if (maintenanceResult.data.length === 0) {
          return { code: 404, message: '未找到对应的维修任务待办' };
        }
        
        let todo = maintenanceResult.data[0];
        console.log(`[getTodoDetail] - 找到待办记录，taskId: ${todo.taskId}，开始聚合主任务信息`);

        const mainTaskResult = await db.collection('maintenance_tasks')
          .where({ maintenanceTaskId: todo.taskId })
          .field({
            level1: true,
            level2: true,
            level3: true,
            additionalAssignees: true,
            otherDescription: true,
            comments: true,
            cost: true,
            ew: true,
            // 关键：主受理人字段
            assigneeId: true,
            assigneeName: true,
            assigneeStudentId: true, // 添加受理人学号字段
            assigneeQqId: true,
            assigneeTime: true,
            // 申请人信息字段
            applicantId: true,
            applicantName: true,
            applicantStudentId: true, // 添加申请人学号字段
            applicantQqId: true,
            isManagementCreated: true
          })
          .get();

        if (mainTaskResult.data.length > 0) {
          const mainTask = mainTaskResult.data[0];
          // 使用主任务中的主受理人信息覆盖todo中的assignee*字段，避免协助受理人误显为主受理人
          todoDetail = {
            ...todo,
            level1: mainTask.level1,
            level2: mainTask.level2,
            level3: mainTask.level3,
            additionalAssignees: mainTask.additionalAssignees || [],
            otherDescription: mainTask.otherDescription,
            comments: mainTask.comments,
            cost: mainTask.cost,
            ew: mainTask.ew,
            // 申请人信息
            applicantId: mainTask.applicantId || todo.applicantId,
            applicantName: mainTask.applicantName || todo.applicantName,
            applicantStudentId: mainTask.applicantStudentId || todo.applicantStudentId,
            applicantQqId: mainTask.applicantQqId || todo.applicantQqId,
            // 主受理人信息
            assigneeId: mainTask.assigneeId || todo.assigneeId,
            assigneeName: mainTask.assigneeName || todo.assigneeName,
            assigneeStudentId: mainTask.assigneeStudentId || todo.assigneeStudentId,
            assigneeQqId: mainTask.assigneeQqId || todo.assigneeQqId,
            assigneeTime: mainTask.assigneeTime || todo.assigneeTime
          };
          console.log('[getTodoDetail] - 成功聚合主任务详细信息，包含次要受理人数据:', mainTask.additionalAssignees?.length || 0);
        } else {
          console.warn(`[getTodoDetail] - 警告：未找到taskId为 ${todo.taskId} 的主任务详情，将使用默认值`);
          todoDetail = {
            ...todo,
            level1: '获取失败',
            level2: '获取失败',
            level3: '获取失败',
            additionalAssignees: []
          };
        }
        // 仅在确认调用者拥有该待办后读取相关人员头像，不返回其他用户资料。
        const participantIds = [...new Set([
          todoDetail.applicantId,
          todoDetail.assigneeId,
          ...(todoDetail.additionalAssignees || []).map(person => person.assigneeId)
        ].filter(id => typeof id === 'string' && id))];
        const avatarProfiles = {};
        try {
          for (let offset = 0; offset < participantIds.length; offset += 100) {
            const profiles = await db.collection('users')
              .where({ openid: db.command.in(participantIds.slice(offset, offset + 100)) })
              .field({ _id: false, openid: true, avatarUrl: true, cloudAvatarFileID: true })
              .limit(100)
              .get();
            profiles.data.forEach(profile => {
              avatarProfiles[profile.openid] = {
                avatarUrl: profile.avatarUrl || '',
                cloudAvatarFileID: profile.cloudAvatarFileID || ''
              };
            });
          }
        } catch (error) {
          console.warn('[getTodoDetail] - 头像资料读取失败，详情使用默认头像');
        }
        todoDetail.applicantAvatar = avatarProfiles[todoDetail.applicantId] || {};
        todoDetail.assigneeAvatar = avatarProfiles[todoDetail.assigneeId] || {};
        todoDetail.additionalAssignees = (todoDetail.additionalAssignees || []).map(person => ({
          ...person,
          avatarProfile: avatarProfiles[person.assigneeId] || {}
        }));
        break;
        
      case 'volunteer':
        const volunteerResult = await db.collection('volunteer_toDo_list')
          .where({
            toDoListUserId: userId,
            taskId: params.id
          })
          .get();
        
        if (volunteerResult.data.length === 0) {
          return { code: 404, message: '未找到对应的志愿活动待办' };
        }
        todoDetail = volunteerResult.data[0];
        break;
        
      case 'duty':
        const dutyResult = await db.collection('duty_toDo_list')
          .where({
            toDoListUserId: userId,
            dutySlotId: params.taskId || params.id
          })
          .get();
        
        if (dutyResult.data.length === 0) {
          return { code: 404, message: '未找到对应的值班任务待办' };
        }
        todoDetail = dutyResult.data[0];
        console.log('[getTodoDetail] - 成功获取值班任务详情:', JSON.stringify(todoDetail));
        break;
        
      default:
        return { code: 400, message: '不支持的待办事项类型' };
    }
    
    console.log('[getTodoDetail] - 成功返回待办详情');
    
    if (params.type === 'maintenance') {
      const { isUrgent, ...todoWithoutUrgency } = todoDetail;
      todoDetail = todoWithoutUrgency;
    }

    return {
      code: 200,
      data: todoDetail,
      message: '获取待办事项详情成功'
    };
    
  } catch (err) {
    console.error(`[getTodoDetail] - 获取待办详情出错, 类型: ${params.type}, ID: ${params.id}`, err);
    return {
      code: 500,
      message: err.message || '数据库查询失败'
    };
  }
} 
