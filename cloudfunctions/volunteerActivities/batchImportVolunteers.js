// 批量导入志愿者
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 获取维修组成员列表（用于导入志愿者）
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @param {string} event.searchKeyword - 搜索关键词
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 成员列表
 */
async function getMembersList(event, wxContext) {
  try {
    const { activityId, searchKeyword = '' } = event
    const { OPENID } = wxContext
    
    
    
    if (!activityId) {
      return {
        code: 400,
        message: '缺少活动ID'
      }
    }
    
    // 获取当前活动信息
    const activityResult = await db.collection('voluntary_activities').where({
      activityId: activityId
    }).get()
    
    if (!activityResult.data || activityResult.data.length === 0) {
      return {
        code: 404,
        message: '活动不存在'
      }
    }
    
    const activity = activityResult.data[0]
    const existingParticipants = activity.participantsIDList || []
    
    // 构建查询条件（使用 proUsers 集合）
    let whereCondition = {
      role: _.in(['member', 'leader']),
      openid: _.neq(OPENID) // 排除自己
    }
    
    // 如果有搜索关键词，添加搜索条件
    if (searchKeyword.trim()) {
      whereCondition = _.and([
        whereCondition,
        _.or([
          { nickName: db.RegExp({ regexp: searchKeyword, options: 'i' }) },
          { studentId: db.RegExp({ regexp: searchKeyword, options: 'i' }) },
          { qqId: db.RegExp({ regexp: searchKeyword, options: 'i' }) }
        ])
      ])
    }
    
    // 查询维修组成员（从 proUsers）
    const usersResult = await db.collection('proUsers')
      .where(whereCondition)
      .field({
        openid: true,
        nickName: true,
        studentId: true,
        avatarUrl: true,
        cloudAvatarUrl: true,
        cloudAvatarFileID: true,
        role: true
      })
      .orderBy('nickName', 'asc')
      .limit(100)
      .get()
    
    // 标记已参与的成员
    const members = usersResult.data.map(user => ({
      ...user,
      isParticipant: existingParticipants.includes(user.openid),
      displayName: user.nickName || '未知'
    }))
    
    return {
      code: 200,
      data: {
        members,
        activityInfo: {
          title: activity.title,
          numberOfVolunteers: activity.numberOfVolunteers,
          volunteerCount: activity.volunteerCount,
          remainingSlots: activity.volunteerCount - activity.numberOfVolunteers
        }
      },
      message: '获取成员列表成功'
    }
  } catch (error) {
    console.error('获取维修组成员列表失败:', error)
    return {
      code: 500,
      message: '获取维修组成员列表失败: ' + error.message
    }
  }
}

/**
 * 批量导入志愿者
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @param {Array} event.selectedMembers - 选中的成员openid列表
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 导入结果
 */
async function batchImportVolunteers(event, wxContext) {
  try {
    const { activityId, selectedMembers = [] } = event
    const { OPENID } = wxContext
    
    
    
    if (!activityId) {
      return {
        code: 400,
        message: '缺少活动ID'
      }
    }
    
    if (!selectedMembers || selectedMembers.length === 0) {
      return {
        code: 400,
        message: '请选择要导入的成员'
      }
    }
    
    // 获取活动信息
    const activityResult = await db.collection('voluntary_activities').where({
      activityId: activityId
    }).get()
    
    if (!activityResult.data || activityResult.data.length === 0) {
      return {
        code: 404,
        message: '活动不存在'
      }
    }
    
    const activity = activityResult.data[0]
    
    // 检查活动状态
    if (activity.activityStatus === 'ended') {
      return {
        code: 400,
        message: '活动已结束，无法导入志愿者'
      }
    }
    
    // 检查操作者权限（组长可以绕过招募状态检查）
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    const isLeader = userResult.data.length > 0 && userResult.data[0].role === 'leader'
    
    // 检查招募状态（组长操作时跳过此检查）
    if (!isLeader && activity.recruitmentOpen === false) {
      return {
        code: 400,
        message: '活动已关闭招募，无法导入志愿者'
      }
    }
    
    // 如果是组长但招募已关闭，记录日志
    if (isLeader && activity.recruitmentOpen === false) {
      
    }
    
    const existingParticipants = activity.participantsIDList || []
    const currentCount = activity.numberOfVolunteers || 0
    const maxCount = activity.volunteerCount || 0
    
    // 过滤出未参与的成员
    const newMembers = selectedMembers.filter(openid => !existingParticipants.includes(openid))
    
    if (newMembers.length === 0) {
      return {
        code: 400,
        message: '所选成员均已参与该活动'
      }
    }
    
    // 检查人数限制
    if (currentCount + newMembers.length > maxCount) {
      return {
        code: 400,
        message: `名额不足，当前剩余 ${maxCount - currentCount} 个名额，选择了 ${newMembers.length} 人`
      }
    }
    
    // 获取新成员的详细信息（从 users 集合，users为主存）
    const membersResult = await db.collection('users')
      .where({
        openid: _.in(newMembers)
      })
      .get()
    
    if (membersResult.data.length !== newMembers.length) {
      return {
        code: 400,
        message: '部分成员信息不存在'
      }
    }
    
    // 开启事务
    const transaction = await db.startTransaction()
    
    try {
      const membersInfo = membersResult.data
      const memberNames = membersInfo.map(m => m.nickName || '未知')


      
      // 准备更新数据
      const updateData = {
        numberOfVolunteers: _.inc(newMembers.length),
        updateTime: db.serverDate()
      }
      
      // 更新参与者ID列表
      if (!activity.participantsIDList || activity.participantsIDList.length === 0) {
        updateData.participantsIDList = newMembers
      } else {
        updateData.participantsIDList = _.push(newMembers)
      }
      
      // 更新参与者姓名列表
      if (!activity.participantsNameList || activity.participantsNameList.length === 0) {
        updateData.participantsNameList = memberNames
      } else {
        updateData.participantsNameList = _.push(memberNames)
      }
      

      
      // 提交更新
      await transaction.collection('voluntary_activities').doc(activity._id).update({
        data: updateData
      })
      
      // 为每个导入的志愿者创建待办事项
      
      const todoPromises = membersInfo.map(async (memberInfo) => {
        try {
          // 检查是否已存在该志愿者的待办事项
          const existingTodoRes = await transaction.collection('volunteer_toDo_list')
            .where({ toDoListUserId: memberInfo.openid, taskId: activityId })
            .get()

          if (existingTodoRes.data && existingTodoRes.data.length > 0) {
            // 已存在：更新为标准参与者待办信息
            const existingTodo = existingTodoRes.data[0]
            await transaction.collection('volunteer_toDo_list')
              .doc(existingTodo._id)
              .update({
                data: {
                  activityStatus: activity.activityStatus,
                  title: activity.title,
                  description: activity.description || '',
                  startTime: activity.startTime,
                  endTime: activity.endTime,
                  location: activity.location || '',
                  duration: activity.duration,
                  volunteerHours: activity.volunteerHours || activity.duration,
                  updateTime: db.serverDate()
                }
              })
            
          } else {
            // 不存在则新增
            const todoResult = await transaction.collection('volunteer_toDo_list').add({
              data: {
                toDoListUserId: memberInfo.openid,
                taskId: activityId,
                activityStatus: activity.activityStatus,
                title: activity.title,
                description: activity.description || '',
                startTime: activity.startTime,
                endTime: activity.endTime,
                location: activity.location || '',
                duration: activity.duration,
                volunteerHours: activity.volunteerHours || activity.duration,
                createTime: db.serverDate(),
                updateTime: db.serverDate()
              }
            })
            
          }
        } catch (err) {
          console.error('为志愿者创建待办事项失败，但不影响导入流程:', memberInfo.openid, err)
          // 待办事项创建失败不影响整体导入流程，继续执行
        }
      })
      
      // 等待所有待办事项创建完成
      await Promise.all(todoPromises)
      
      
      // 提交事务
      await transaction.commit()

      // 为新导入的志愿者创建待反馈消息
      
      const feedbackMessagePromises = membersInfo.map(async (memberInfo) => {
        try {
          // 调用待反馈消息云函数创建消息
          const messageResult = await cloud.callFunction({
            name: 'pendingFeedbackMessages',
            data: {
              action: 'createFeedbackMessage',
              params: {
                recipientId: memberInfo.openid,
                type: 'volunteer_invitation',
                relatedId: activityId,
                              content: {
                title: '您被邀请参加志愿活动',
                details: `您已被邀请参加志愿活动：\n\n【活动名称】\n${activity.title}\n\n【活动时间】\n${activity.startTime} 至 ${activity.endTime}\n\n【活动地点】\n${activity.location || '待确定'}\n\n请及时查看活动详情并准时参加。\n请点击确认收到此消息。`
              }
              }
            }
          })
          
          
        } catch (error) {
          console.error(`为志愿者 ${memberInfo.nickName} 创建待反馈消息失败:`, error);
          // 不影响主流程，仅记录错误
        }
      })
      
      await Promise.all(feedbackMessagePromises)
      
      
      return {
        code: 200,
        data: {
          imported: newMembers.length
        },
        message: `成功导入${newMembers.length}名志愿者，已为其创建待办事项`
      }
    } catch (error) {
      console.error('批量导入志愿者事务失败:', error)
      await transaction.rollback()
      return {
        code: 500,
        message: '批量导入志愿者失败: ' + error.message
      }
    }
  } catch (error) {
    console.error('批量导入志愿者失败:', error)
    return {
      code: 500,
      message: '批量导入志愿者失败: ' + error.message
    }
  }
}

module.exports = {
  getMembersList,
  batchImportVolunteers
} 