/**
 * 志愿活动状态更新管理器
 * 负责状态自动更新、业务逻辑触发和数据库同步
 */

const cloud = require('wx-server-sdk');
const timeUtils = require('./timeUtils');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 状态变化业务逻辑处理器
 */
class StatusChangeHandler {
  
  /**
   * 处理状态变化触发的业务逻辑
   * @param {Object} activity 活动对象
   * @param {string} oldStatus 旧状态
   * @param {string} newStatus 新状态
   */
  static async handleStatusChange(activity, oldStatus, newStatus) {
    console.log(`[状态变化处理] 活动 ${activity.activityId} 状态从 ${oldStatus} 变更为 ${newStatus}`);
    
    try {
      // 筹备中 -> 进行中
      if (oldStatus === 'inPreparation' && newStatus === 'inProgress') {
        await this.handleActivityStart(activity);
      }
      
      // 进行中 -> 已结束 或 筹备中 -> 已结束
      if ((oldStatus === 'inProgress' || oldStatus === 'inPreparation') && newStatus === 'ended') {
        await this.handleActivityEnd(activity);
      }
      
    } catch (error) {
      console.error(`[状态变化处理失败] 活动 ${activity.activityId}:`, error);
    }
  }
  
  /**
   * 处理活动开始
   * @param {Object} activity 活动对象
   */
  static async handleActivityStart(activity) {
    console.log(`[活动开始处理] 活动 ${activity.activityId} 开始`);
    
    try {
      // 向所有报名参与者发送活动开始通知
      if (activity.participantsIDList && activity.participantsIDList.length > 0) {
        await this.sendActivityStartNotification(activity);
      }
      
      // 创建活动开始的待办事项
      await this.createActivityStartTodos(activity);
      
    } catch (error) {
      console.error(`[活动开始处理失败]:`, error);
    }
  }
  
  /**
   * 处理活动结束
   * @param {Object} activity 活动对象
   */
  static async handleActivityEnd(activity) {
    console.log(`[活动结束处理] 活动 ${activity.activityId} 结束`);
    
    try {
      // 不再自动分配统一EW，改为由组长在结束后设置个人EW
      
      // 向参与者发送活动结束通知
      if (activity.participantsIDList && activity.participantsIDList.length > 0) {
        await this.sendActivityEndNotification(activity);
      }
      
      // 更新用户EW汇总
      await this.updateUserEWSummary(activity);
      
    } catch (error) {
      console.error(`[活动结束处理失败]:`, error);
    }
  }
  
  /**
   * 发送活动开始通知
   * @param {Object} activity 活动对象
   */
  static async sendActivityStartNotification(activity) {
    const promises = activity.participantsIDList.map(async (participantId, index) => {
      const participantName = activity.participantsNameList[index] || '参与者';
      
      // 站内消息
      await db.collection('messages').add({
        data: {
          userId: participantId,
          title: '志愿活动开始提醒',
          content: `您报名的志愿活动"${activity.title}"现在开始了！地点：${activity.location}`,
          type: 'activity_start',
          relatedId: activity.activityId,
          isRead: false,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });

    });
    
    await Promise.all(promises);
    console.log(`[活动开始通知] 已向 ${activity.participantsIDList.length} 名参与者发送通知`);
  }
  
  /**
   * 发送活动结束通知
   * @param {Object} activity 活动对象
   */
  static async sendActivityEndNotification(activity) {
          const promises = activity.participantsIDList.map(async (participantId, index) => {
        const participantName = activity.participantsNameList[index] || '参与者';
        
        return db.collection('messages').add({
          data: {
            userId: participantId,
            title: '志愿活动结束通知',
            content: `志愿活动"${activity.title}"已结束，感谢您的参与！组长将稍后设置本次活动的EW。`,
            type: 'activity_end',
            relatedId: activity.activityId,
            isRead: false,
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        });
      });
    
    await Promise.all(promises);
    console.log(`[活动结束通知] 已向 ${activity.participantsIDList.length} 名参与者发送通知`);
  }
  
  /**
   * 创建活动开始相关的待办事项
   * @param {Object} activity 活动对象
   */
  static async createActivityStartTodos(activity) {
    console.log(`[活动开始处理] 检查创建者待办是否已存在: ${activity.activityId}`)

    try {
      // 先检查是否已存在该创建者针对同一活动的待办（避免重复）
      const existingTodoResult = await db.collection('volunteer_toDo_list')
        .where({
          toDoListUserId: activity.creatorId,
          taskId: activity.activityId
        })
        .get();

      if (existingTodoResult.data && existingTodoResult.data.length > 0) {
        // 已存在：只更新状态与基础信息（保持原有标题，不新增第二张卡片）
        const existingTodo = existingTodoResult.data[0];
        await db.collection('volunteer_toDo_list')
          .doc(existingTodo._id)
          .update({
            data: {
              activityStatus: 'inProgress',
              startTime: activity.startTime,
              endTime: activity.endTime,
              location: activity.location || '未指定',
              duration: activity.duration || 0,
              volunteerHours: activity.volunteerHours || 0,
              updateTime: db.serverDate()
            }
          });

        console.log(`[活动开始待办] 已存在创建者待办，执行更新而非新增`);
        return;
      }

      // 不存在：为活动创建者创建管理待办
      await db.collection('volunteer_toDo_list').add({
        data: {
          toDoListUserId: activity.creatorId,
          taskId: activity.activityId,
          activityStatus: 'inProgress',
          title: `管理进行中的志愿活动：${activity.title}`,
          description: `志愿活动"${activity.title}"已开始，请注意管理和监督`,
          startTime: activity.startTime,
          endTime: activity.endTime,
          location: activity.location || '未指定',
          duration: activity.duration || 0,
          volunteerHours: activity.volunteerHours || 0,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });

      console.log(`[活动开始待办] 已为创建者创建管理待办事项`);
    } catch (error) {
      console.error(`[活动开始处理-创建/更新创建者待办失败]:`, error);
    }
  }
  
  /**
   * 分配EW值给参与者
   * @param {Object} activity 活动对象
   */
  static async distributeEWToParticipants(activity) {
    if (!activity.participantsIDList || activity.participantsIDList.length === 0) {
      console.log(`[EW分配] 活动 ${activity.activityId} 无参与者，跳过EW分配`);
      return;
    }
    
    const ewPerParticipant = activity.ew || 0;
    if (ewPerParticipant <= 0) {
      console.log(`[EW分配] 活动 ${activity.activityId} EW值为0，跳过分配`);
      return;
    }
    
    console.log(`[EW分配] 开始为 ${activity.participantsIDList.length} 名参与者分配EW值: ${ewPerParticipant}`);
    
    // 为每个参与者分配EW值
    const updatePromises = activity.participantsIDList.map(async (participantId) => {
      // 更新用户的EW汇总
      const userEWResult = await db.collection('ewaSummary')
        .where({ ewaUserId: participantId })
        .get();
      
      if (userEWResult.data.length > 0) {
        // 更新现有记录
        const currentEW = userEWResult.data[0];
        await db.collection('ewaSummary')
          .doc(currentEW._id)
          .update({
            data: {
              volunteerEW: _.inc(ewPerParticipant),
              totalEW: _.inc(ewPerParticipant),
              updateTime: db.serverDate()
            }
          });
      } else {
        // 创建新记录
        const userResult = await db.collection('users')
          .where({ openid: participantId })
          .get();
        
        if (userResult.data.length > 0) {
          const user = userResult.data[0];
          await db.collection('ewaSummary').add({
            data: {
              ewaUserId: participantId,
              ewaUserName: user.nickName || '',


              maintenanceEW: 0,
              dutyEW: 0,
              volunteerEW: ewPerParticipant,
              totalEW: ewPerParticipant,
              createTime: db.serverDate(),
              updateTime: db.serverDate()
            }
          });
        }
      }
    });
    
    await Promise.all(updatePromises);
    console.log(`[EW分配] 完成EW值分配，每人获得 ${ewPerParticipant} EW`);
  }
  
  /**
   * 更新用户EW汇总
   * @param {Object} activity 活动对象
   */
  static async updateUserEWSummary(activity) {
    try {
      // 调用等效工作量评估云函数来更新汇总
      await cloud.callFunction({
        name: 'equivalentWorkloadAssessment',
        data: {
          action: 'updateSummary'
        }
      });
      
      console.log(`[EW汇总更新] 已触发EW汇总更新`);
    } catch (error) {
      console.error(`[EW汇总更新失败]:`, error);
    }
  }
}

/**
 * 状态更新管理器
 */
class StatusUpdateManager {
  
  /**
   * 更新单个活动的状态
   * @param {string} activityId 活动ID
   * @returns {Object} 更新结果
   */
  static async updateSingleActivityStatus(activityId) {
    try {
      const result = await db.collection('voluntary_activities')
        .where({ activityId: activityId })
        .get();
      
      if (result.data.length === 0) {
        return { code: 404, message: '活动不存在' };
      }
      
      const activity = result.data[0];
      const statusCheck = timeUtils.checkStatusNeedsUpdate(activity);
      
      if (statusCheck.needsUpdate) {
        // 更新数据库中的状态
        await db.collection('voluntary_activities')
          .doc(activity._id)
          .update({
            data: {
              activityStatus: statusCheck.newStatus,
              updateTime: db.serverDate(),
              lastStatusUpdate: timeUtils.formatChinaTime(timeUtils.getChinaTime())
            }
          });
        
        // 同步更新volunteer_toDo_list集合中对应记录的状态
        try {
          const todoUpdateResult = await db.collection('volunteer_toDo_list')
            .where({ taskId: activityId })
            .update({
              data: {
                activityStatus: statusCheck.newStatus,
                updateTime: db.serverDate()
              }
            });
          
          console.log(`[单个状态更新] 同步更新待办事项状态成功，更新了 ${todoUpdateResult.stats.updated} 条记录`);
        } catch (todoError) {
          console.error(`[单个状态更新] 同步更新待办事项状态失败:`, todoError);
          // 不影响主流程，继续执行
        }
        
        // 触发状态变化业务逻辑
        await StatusChangeHandler.handleStatusChange(
          activity, 
          statusCheck.oldStatus, 
          statusCheck.newStatus
        );
        
        console.log(`[单个状态更新] 活动 ${activityId} 状态已更新: ${statusCheck.oldStatus} -> ${statusCheck.newStatus}`);
        
        return {
          code: 200,
          message: '状态更新成功',
          data: {
            activityId: activityId,
            oldStatus: statusCheck.oldStatus,
            newStatus: statusCheck.newStatus
          }
        };
      } else {
        return {
          code: 200,
          message: '状态无需更新',
          data: {
            activityId: activityId,
            currentStatus: activity.activityStatus
          }
        };
      }
      
    } catch (error) {
      console.error(`[单个状态更新失败] 活动 ${activityId}:`, error);
      return { code: 500, message: '状态更新失败: ' + error.message };
    }
  }
  
  /**
   * 批量更新所有活动的状态
   * @returns {Object} 批量更新结果
   */
  static async batchUpdateAllActivitiesStatus() {
    try {
      console.log('[批量状态更新] 开始执行...');
      
      // 获取所有非"已结束"状态的活动（包括待发布状态）
      const result = await db.collection('voluntary_activities')
        .where({
          activityStatus: _.neq('ended')
        })
        .get();
      
      // 同时获取所有待发布状态的活动（可能被上面的查询遗漏）
      const pendingResult = await db.collection('voluntary_activities')
        .where({
          activityStatus: 'pending'
        })
        .get();
      
      // 合并结果，去重
      const allActivities = [];
      const activityMap = new Map();
      
      result.data.forEach(activity => {
        activityMap.set(activity.activityId, activity);
      });
      
      pendingResult.data.forEach(activity => {
        if (!activityMap.has(activity.activityId)) {
          activityMap.set(activity.activityId, activity);
        }
      });
      
      const activitiesToCheck = Array.from(activityMap.values());
      
      if (activitiesToCheck.length === 0) {
        console.log('[批量状态更新] 没有需要更新的活动');
        return { 
          code: 200, 
          message: '没有需要更新的活动',
          data: { updatedCount: 0 }
        };
      }
      
      console.log(`[批量状态更新] 找到 ${activitiesToCheck.length} 个待检查活动`);
      
      const updateResults = [];
      let updatedCount = 0;
      
      // 逐个检查和更新活动状态
      for (const activity of activitiesToCheck) {
        const statusCheck = timeUtils.checkStatusNeedsUpdate(activity);
        
        if (statusCheck.needsUpdate) {
          try {
            // 准备更新数据
            const updateData = {
              activityStatus: statusCheck.newStatus,
              updateTime: db.serverDate(),
              lastStatusUpdate: timeUtils.formatChinaTime(timeUtils.getChinaTime())
            };
            
            // 如果是自动发布，清除定时发布相关字段
            if (statusCheck.isAutoPublish) {
              updateData.scheduledPublish = false;
              updateData.publishTime = null;
              console.log(`[批量状态更新] 活动 ${activity.activityId} 自动发布，状态从 pending 变更为 ${statusCheck.newStatus}`);
            }
            
            // 更新数据库状态
            await db.collection('voluntary_activities')
              .doc(activity._id)
              .update({
                data: updateData
              });
            
            // 同步更新volunteer_toDo_list集合中对应记录的状态
            try {
              const todoUpdateResult = await db.collection('volunteer_toDo_list')
                .where({ taskId: activity.activityId })
                .update({
                  data: {
                    activityStatus: statusCheck.newStatus,
                    updateTime: db.serverDate()
                  }
                });
              
              console.log(`[批量状态更新] 活动 ${activity.activityId} 同步更新待办事项状态成功，更新了 ${todoUpdateResult.stats.updated} 条记录`);
            } catch (todoError) {
              console.error(`[批量状态更新] 活动 ${activity.activityId} 同步更新待办事项状态失败:`, todoError);
              // 不影响主流程，继续执行
            }
            
            // 触发状态变化业务逻辑
            await StatusChangeHandler.handleStatusChange(
              activity, 
              statusCheck.oldStatus, 
              statusCheck.newStatus
            );
            
            updateResults.push({
              activityId: activity.activityId,
              title: activity.title,
              oldStatus: statusCheck.oldStatus,
              newStatus: statusCheck.newStatus,
              success: true
            });
            
            updatedCount++;
            
            console.log(`[批量状态更新] 活动 ${activity.activityId} 更新成功: ${statusCheck.oldStatus} -> ${statusCheck.newStatus}`);
            
          } catch (error) {
            console.error(`[批量状态更新] 活动 ${activity.activityId} 更新失败:`, error);
            updateResults.push({
              activityId: activity.activityId,
              title: activity.title,
              oldStatus: statusCheck.oldStatus,
              newStatus: statusCheck.newStatus,
              success: false,
              error: error.message
            });
          }
        }
      }
      
      console.log(`[批量状态更新] 完成，共更新 ${updatedCount} 个活动`);
      
      return {
        code: 200,
        message: `批量状态更新完成，共更新 ${updatedCount} 个活动`,
        data: {
          totalChecked: activitiesToCheck.length,
          updatedCount: updatedCount,
          updateResults: updateResults
        }
      };
      
    } catch (error) {
      console.error('[批量状态更新失败]:', error);
      return { 
        code: 500, 
        message: '批量状态更新失败: ' + error.message 
      };
    }
  }
  
  /**
   * 获取活动列表时实时更新状态
   * @param {Array} activities 活动列表
   * @returns {Array} 状态更新后的活动列表
   */
  static async updateActivitiesStatusInList(activities) {
    if (!activities || activities.length === 0) {
      return activities;
    }
    
    const updatedActivities = [];
    const dbUpdates = [];
    
    for (const activity of activities) {
      // 🔥 关键修复：对于pending状态的活动，需要特殊处理
      // 如果活动是pending状态且发布时间未到，不应该更新状态
      if (activity.activityStatus === 'pending') {
        if (activity.scheduledPublish && activity.publishTime) {
          const now = timeUtils.getChinaTime();
          const publish = timeUtils.parseChinaTime(activity.publishTime);
          // 如果发布时间未到，保持pending状态，不进行任何更新
          if (now.getTime() < publish.getTime()) {
            updatedActivities.push(activity);
            continue;
          }
          // 如果发布时间已到，继续执行状态检查（会自动发布）
        } else {
          // 如果没有发布时间信息，说明是异常情况，需要更新状态
          // 继续执行下面的状态检查逻辑
        }
      }
      
      const statusCheck = timeUtils.checkStatusNeedsUpdate(activity);
      
      if (statusCheck.needsUpdate) {
        // 准备数据库更新
        dbUpdates.push({
          _id: activity._id,
          oldStatus: statusCheck.oldStatus,
          newStatus: statusCheck.newStatus,
          activity: activity,
          isAutoPublish: statusCheck.isAutoPublish || false // 标记是否为自动发布
        });
        
        // 更新活动对象的状态
        updatedActivities.push({
          ...activity,
          activityStatus: statusCheck.newStatus,
          lastStatusUpdate: timeUtils.formatChinaTime(timeUtils.getChinaTime())
        });
      } else {
        updatedActivities.push(activity);
      }
    }
    
    // 批量更新数据库（异步执行，不影响列表返回）
    if (dbUpdates.length > 0) {
      this.performAsyncDatabaseUpdates(dbUpdates).catch(error => {
        console.error('[异步状态更新失败]:', error);
      });
    }
    
    return updatedActivities;
  }
  
  /**
   * 异步执行数据库状态更新
   * @param {Array} updates 待更新的数据
   */
  static async performAsyncDatabaseUpdates(updates) {
    console.log(`[异步状态更新] 开始更新 ${updates.length} 个活动状态`);
    
    const updatePromises = updates.map(async (update) => {
      try {
        // 准备更新数据
        const updateData = {
          activityStatus: update.newStatus,
          updateTime: db.serverDate(),
          lastStatusUpdate: timeUtils.formatChinaTime(timeUtils.getChinaTime())
        };
        
        // 如果是自动发布，清除定时发布相关字段
        if (update.isAutoPublish) {
          updateData.scheduledPublish = false;
          updateData.publishTime = null;
          console.log(`[异步状态更新] 活动 ${update.activity.activityId} 自动发布，清除定时发布字段`);
        }
        
        // 更新数据库状态
        await db.collection('voluntary_activities')
          .doc(update._id)
          .update({
            data: updateData
          });
        
        // 同步更新volunteer_toDo_list集合中对应记录的状态
        try {
          const todoUpdateResult = await db.collection('volunteer_toDo_list')
            .where({ taskId: update.activity.activityId })
            .update({
              data: {
                activityStatus: update.newStatus,
                updateTime: db.serverDate()
              }
            });
          
          console.log(`[异步状态更新] 活动 ${update.activity.activityId} 同步更新待办事项状态成功，更新了 ${todoUpdateResult.stats.updated} 条记录`);
        } catch (todoError) {
          console.error(`[异步状态更新] 活动 ${update.activity.activityId} 同步更新待办事项状态失败:`, todoError);
          // 不影响主流程，继续执行
        }
        
        // 触发状态变化业务逻辑
        await StatusChangeHandler.handleStatusChange(
          update.activity, 
          update.oldStatus, 
          update.newStatus
        );
        
        console.log(`[异步状态更新] 活动 ${update.activity.activityId} 更新成功: ${update.oldStatus} -> ${update.newStatus}`);
        
      } catch (error) {
        console.error(`[异步状态更新] 活动 ${update.activity.activityId} 更新失败:`, error);
      }
    });
    
    await Promise.all(updatePromises);
    console.log(`[异步状态更新] 完成`);
  }
}

module.exports = {
  StatusUpdateManager,
  StatusChangeHandler
}; 