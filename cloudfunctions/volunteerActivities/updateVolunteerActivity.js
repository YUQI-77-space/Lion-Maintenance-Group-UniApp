const cloud = require('wx-server-sdk');
const { StatusUpdateManager } = require('./statusUpdateManager');
const timeUtils = require('./timeUtils');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { activityId, ...updateData } = event;
  const { OPENID } = cloud.getWXContext();

  if (!activityId) {
    return { code: 400, message: '缺少活动ID' };
  }

  try {
    const userResult = await db.collection('users').where({ openid: OPENID }).get();
    if (!userResult.data || userResult.data.length === 0 || userResult.data[0].role !== 'leader') {
      return { code: 403, message: '无权操作' };
    }
    
    const activity = await db.collection('voluntary_activities').where({ activityId }).get();
    if (!activity.data || activity.data.length === 0) {
        return { code: 404, message: '活动不存在' };
    }

    const currentActivity = activity.data[0];
    
    // 🔥 验证：如果更新志愿者人数，新人数不能小于当前已报名人数
    if (updateData.hasOwnProperty('volunteerCount')) {
      const newVolunteerCount = parseInt(updateData.volunteerCount);
      const currentNumberOfVolunteers = currentActivity.numberOfVolunteers || 0;
      
      if (isNaN(newVolunteerCount) || newVolunteerCount < 1) {
        return { code: 400, message: '志愿者人数必须大于0' };
      }
      
      if (newVolunteerCount < currentNumberOfVolunteers) {
        return { 
          code: 400, 
          message: `当前已有 ${currentNumberOfVolunteers} 人报名，志愿者人数不能设置为少于已报名人数` 
        };
      }
    }

    delete updateData.action;
    
    // 如果更新了定时发布相关字段，需要重新计算活动状态
    let finalUpdateData = { ...updateData };
    
    // 如果更新了定时发布设置或发布时间，需要重新判断状态
    if (updateData.hasOwnProperty('scheduledPublish') || updateData.hasOwnProperty('publishTime') || 
        updateData.hasOwnProperty('startTime') || updateData.hasOwnProperty('endTime')) {
      
      const scheduledPublish = updateData.scheduledPublish !== undefined ? updateData.scheduledPublish : currentActivity.scheduledPublish;
      const publishTime = updateData.publishTime !== undefined ? updateData.publishTime : currentActivity.publishTime;
      const startTime = updateData.startTime || currentActivity.startTime;
      const endTime = updateData.endTime || currentActivity.endTime;
      
      // 判断活动状态
      let newActivityStatus;
      if (scheduledPublish && publishTime) {
        const now = timeUtils.getChinaTime();
        const publish = timeUtils.parseChinaTime(publishTime);
        if (now.getTime() < publish.getTime()) {
          // 发布时间未到，状态为待发布
          newActivityStatus = 'pending';
        } else {
          // 发布时间已到，使用正常状态判断
          newActivityStatus = timeUtils.calculateActivityStatus(startTime, endTime);
        }
      } else {
        // 未开启定时发布，使用正常状态判断
        newActivityStatus = timeUtils.calculateActivityStatus(startTime, endTime);
      }
      
      finalUpdateData.activityStatus = newActivityStatus;
      
      // 如果关闭了定时发布或发布时间已过，清除定时发布相关字段
      if (!scheduledPublish || (publishTime && timeUtils.getChinaTime().getTime() >= timeUtils.parseChinaTime(publishTime).getTime())) {
        finalUpdateData.scheduledPublish = false;
        finalUpdateData.publishTime = null;
      }
    }

    await db.collection('voluntary_activities').doc(activity.data[0]._id).update({
      data: {
        ...finalUpdateData,
        updateTime: db.serverDate()
      }
    });

    // 如果更新数据包含影响状态的字段（时间相关），同步更新待办事项
    if (updateData.startTime || updateData.endTime || updateData.activityStatus) {
      try {
        const syncData = {};
        if (updateData.startTime) syncData.startTime = updateData.startTime;
        if (updateData.endTime) syncData.endTime = updateData.endTime;
        if (updateData.activityStatus) syncData.activityStatus = updateData.activityStatus;
        if (updateData.title) syncData.title = updateData.title;
        if (updateData.description) syncData.description = updateData.description;
        if (updateData.location) syncData.location = updateData.location;
        if (updateData.duration) syncData.duration = updateData.duration;
        if (updateData.volunteerHours) syncData.volunteerHours = updateData.volunteerHours;
        
        syncData.updateTime = new Date();
        
        const todoUpdateResult = await db.collection('volunteer_toDo_list')
          .where({ taskId: activityId })
          .update({
            data: syncData
          });
        
        console.log(`[updateVolunteerActivity] 同步更新待办事项成功，更新了 ${todoUpdateResult.stats.updated} 条记录`);
      } catch (todoError) {
        console.error('[updateVolunteerActivity] 同步更新待办事项失败:', todoError);
        // 不影响主流程，继续执行
      }

      // 触发一次状态重算，确保时间修改后状态与业务联动立即生效
      try {
        await StatusUpdateManager.updateSingleActivityStatus(activityId);
      } catch (statusErr) {
        console.error('[updateVolunteerActivity] 触发状态更新失败：', statusErr);
      }
    }

    return { code: 200, message: '更新成功' };
  } catch (error) {
    return { code: 500, message: error.message };
  }
}; 