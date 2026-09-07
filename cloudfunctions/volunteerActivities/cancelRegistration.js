// 取消报名
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 取消报名
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @param {boolean} event.fromTodo - 是否从待办事项取消（可选）
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 取消报名结果
 */
exports.main = async (event, wxContext) => {
  try {
    const { activityId, fromTodo = false } = event
    const { OPENID } = wxContext
    
    
    
    if (!activityId) {
      console.error('缺少活动ID')
      return {
        code: 400,
        message: '缺少活动ID'
      }
    }
    
    // 获取活动信息
    
    const activityResult = await db.collection('voluntary_activities').where({
      activityId: activityId
    }).get()
    
    if (!activityResult.data || activityResult.data.length === 0) {
      console.error('活动不存在:', activityId)
      return {
        code: 404,
        message: '活动不存在'
      }
    }
    
    const activity = activityResult.data[0]
    
    
    // 检查活动状态
    if (activity.activityStatus === 'ended') {
      console.error('活动已结束，无法取消报名')
      return {
        code: 400,
        message: '活动已结束，无法取消报名'
      }
    }
    
    // 检查是否已报名
    if (!activity.participantsIDList || !activity.participantsIDList.includes(OPENID)) {
      console.error('用户未报名该活动')
      return {
        code: 400,
        message: '您未报名该活动'
      }
    }
    
    // 检查是否在取消报名截止时间前（活动前一天17:00）
    const startTime = new Date(activity.startTime)
    const cancelDeadline = new Date(startTime)
    cancelDeadline.setDate(startTime.getDate() - 1)
    cancelDeadline.setHours(17, 0, 0, 0)
    
    const now = new Date()
    if (now >= cancelDeadline) {
      console.error('已超过取消报名截止时间')
      return {
        code: 400,
        message: `已超过取消报名截止时间（活动前一天17:00）`
      }
    }
    
    // 开启事务
    const transaction = await db.startTransaction()
    
    try {
      // 获取用户在参与者列表中的索引
      const participantIndex = activity.participantsIDList.indexOf(OPENID)
      
      // 准备更新数据
      const updateData = {
        numberOfVolunteers: _.inc(-1),
        updateTime: db.serverDate()
      }
      
      // 记录取消报名的用户（用于统计，但不限制重复取消）
      if (!activity.canceledUsers) {
        updateData.canceledUsers = [OPENID]
      } else if (!activity.canceledUsers.includes(OPENID)) {
        updateData.canceledUsers = _.push(OPENID)
      }
      // 如果用户已在canceledUsers中，不重复添加
      
      // 从参与者列表中移除
      if (activity.participantsIDList && activity.participantsIDList.length > participantIndex) {
        updateData[`participantsIDList.${participantIndex}`] = _.remove()
      }
      
      if (activity.participantsNameList && activity.participantsNameList.length > participantIndex) {
        updateData[`participantsNameList.${participantIndex}`] = _.remove()
      }
      
      // 更新活动信息
      
      await transaction.collection('voluntary_activities').doc(activity._id).update({
        data: updateData
      })
      
      // 删除待办事项
      
      await transaction.collection('volunteer_toDo_list').where({
        toDoListUserId: OPENID,
        taskId: activityId
      }).remove()
      
      // 提交事务
      
      await transaction.commit()
      
      // 发送消息通知
      
      try {
        await cloud.callFunction({
          name: 'messages',
          data: {
            action: 'createMessage',
            params: {
              messageUserId: OPENID,
              title: '取消报名成功',
              content: `您已成功取消"${activity.title}"活动的报名。如需再次报名，请在截止时间前重新报名。`,
              messageType: 'volunteer'
            }
          }
        })
      } catch (err) {
        console.error('发送消息通知失败，但不影响取消报名流程:', err)
        // 消息发送失败不影响整体流程，继续执行
      }
      
      
      return {
        code: 200,
        data: {
          activityId: activityId
        },
        message: '取消报名成功'
      }
    } catch (err) {
      // 回滚事务
      console.error('事务处理失败，执行回滚:', err)
      await transaction.rollback()
      throw err
    }
  } catch (error) {
    console.error('取消报名失败:', error)
    return {
      code: 500,
      message: '取消报名失败: ' + error.message
    }
  }
} 