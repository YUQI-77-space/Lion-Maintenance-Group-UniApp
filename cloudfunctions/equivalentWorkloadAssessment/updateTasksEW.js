// 更新任务的等效工作量值
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 更新维修任务的等效工作量值
 * @param {Object} params - 参数对象
 * @param {string} params.maintenanceTaskId - 维修任务ID
 * @param {number} params.ew - 等效工作量值
 * @param {string} OPENID - 用户openid
 * @returns {Object} 更新结果
 */
exports.updateTasksEW = async (params, OPENID) => {
  try {
    console.log('updateTasksEW函数开始执行，参数:', params, '用户OPENID:', OPENID);
    
    // 检查参数
    if (!params.maintenanceTaskId || typeof params.ew !== 'number') {
      console.log('参数检查失败:', { maintenanceTaskId: params.maintenanceTaskId, ew: params.ew });
      return {
        code: 400,
        data: null,
        message: '缺少必要参数或参数类型错误'
      }
    }
    
    // 检查EW值范围
    if (params.ew < 0.5 || params.ew > 10) {
      console.log('EW值范围检查失败:', params.ew);
      return {
        code: 400,
        data: null,
        message: 'EW值必须在0.5-10之间'
      }
    }
    
    // 检查用户权限（只有组长可以设置EW值）
    console.log('开始检查用户权限');
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    console.log('用户查询结果:', userResult);
    
    if (userResult.data.length === 0) {
      console.log('未找到用户信息:', OPENID);
      return {
        code: 403,
        data: null,
        message: '未找到用户信息'
      }
    }
    
    const user = userResult.data[0]
    console.log('用户角色:', user.role);
    
    if (user.role !== 'leader') {
      console.log('用户权限不足:', user.role);
      return {
        code: 403,
        data: null,
        message: '只有组长可以设置EW值'
      }
    }
    
    // 查询维修任务
    console.log('开始查询维修任务:', params.maintenanceTaskId);
    const taskResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).get()
    
    console.log('任务查询结果:', taskResult);
    
    if (taskResult.data.length === 0) {
      console.log('未找到对应的维修任务:', params.maintenanceTaskId);
      return {
        code: 404,
        data: null,
        message: '未找到对应的维修任务'
      }
    }
    
    const task = taskResult.data[0]
    console.log('找到任务:', task.maintenanceTaskId, '当前EW值:', task.ew, '新EW值:', params.ew);
    
    // 更新任务的EW值
    console.log('开始更新任务EW值');
    const updateResult = await db.collection('maintenance_tasks').where({
      maintenanceTaskId: params.maintenanceTaskId
    }).update({
      data: {
        ew: params.ew,
        updateTime: new Date()
      }
    })
    
    console.log('任务EW值更新结果:', updateResult);
    
    // 收集所有受理人ID，包括主受理人和协助受理人
    const allAssigneeIds = [];
    if (task.assigneeId) {
      allAssigneeIds.push(task.assigneeId);
    }
    if (task.additionalAssignees && task.additionalAssignees.length > 0) {
      task.additionalAssignees.forEach(assignee => {
        if (assignee.assigneeId) {
          allAssigneeIds.push(assignee.assigneeId);
        }
      });
    }

    console.log('所有受理人ID列表:', allAssigneeIds);

    // 为所有受理人更新EW汇总
    if (allAssigneeIds.length > 0) {
      console.log('任务有受理人:', allAssigneeIds, '开始更新所有受理人EW汇总');
      
             // 计算原来的任务EW值（如果之前已设置）
       const oldEW = task.ew || 0;
       // EW值是每个受理人的标准值，不需要平均分配
       const ewPerAssignee = params.ew;
       const oldEwPerAssignee = oldEW;
       const ewDiffPerAssignee = ewPerAssignee - oldEwPerAssignee;
       
       console.log('EW值分配计算:', { 
         ewPerAssignee: params.ew, 
         assigneeCount: allAssigneeIds.length,
         totalEWToBeDistributed: params.ew * allAssigneeIds.length,
         oldEwPerAssignee,
         ewDiffPerAssignee 
       });

      // 为每个受理人更新EW汇总
      for (const assigneeId of allAssigneeIds) {
        console.log('开始更新受理人EW汇总:', assigneeId);
        
        // 查询受理人的EWA汇总
        const ewaSummaryResult = await db.collection('ewaSummary').where({
          ewaUserId: assigneeId
        }).get();
        
        if (ewaSummaryResult.data.length > 0) {
          const ewaSummary = ewaSummaryResult.data[0];
          
          // 更新维修EW值和总EW值
          const newMaintenanceEW = ewaSummary.maintenanceEW + ewDiffPerAssignee;
          // 计算新的总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
          const newTotalEW = Math.round((newMaintenanceEW * 0.5 + (ewaSummary.volunteerEW || 0) * 0.4 + (ewaSummary.dutyEW || 0) * 0.1) * 100) / 100;
          
          const updateEwaResult = await db.collection('ewaSummary').where({
            ewaUserId: assigneeId
          }).update({
            data: {
              maintenanceEW: newMaintenanceEW,
              totalEW: newTotalEW,
              updateTime: new Date()
            }
          });
          
          console.log('受理人EWA汇总更新结果:', assigneeId, updateEwaResult);
        } else {
          console.log('受理人没有EWA汇总记录，创建新记录:', assigneeId);
          // 如果受理人没有EWA汇总记录，则创建一个
          const userInfo = await db.collection('users').where({
            openid: assigneeId
          }).get();
          
          if (userInfo.data.length > 0) {
            const userDetail = userInfo.data[0];
            
            // 计算总EW（使用加权公式：维修EW*0.5 + 志愿EW*0.4 + 值班EW*0.1）
            const newTotalEW = Math.round((ewPerAssignee * 0.5 + 0 * 0.4 + 0 * 0.1) * 100) / 100;
            
            const addEwaResult = await db.collection('ewaSummary').add({
              data: {
                ewaUserId: assigneeId,
                ewaUserName: userDetail.nickName || '',


                maintenanceEW: ewPerAssignee,
                volunteerEW: 0,
                dutyEW: 0,
                totalEW: newTotalEW,
                createTime: new Date(),
                updateTime: new Date()
              }
            });
            
            console.log('创建受理人EWA汇总记录结果:', assigneeId, addEwaResult);
          }
        }
      }
    }
    
    console.log('updateTasksEW函数执行完成');
    return {
      code: 200,
      data: {
        maintenanceTaskId: params.maintenanceTaskId,
        ew: params.ew
      },
      message: '更新维修任务EW值成功'
    }
    
  } catch (err) {
    console.error('updateTasksEW函数执行错误:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '更新维修任务EW值失败'
    }
  }
} 