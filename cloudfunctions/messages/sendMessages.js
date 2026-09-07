// 发送批量消息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 发送批量消息
 * @param {Object} params - 参数对象
 * @param {string} params.type - 消息接收者类型('all', 'role', 'users', 'activity')
 * @param {string} [params.role] - 当type为'role'时，指定角色('user', 'member', 'leader')
 * @param {Array<string>} [params.userIds] - 当type为'users'时，指定用户ID列表
 * @param {string} [params.activityId] - 当type为'activity'时，指定活动ID
 * @param {string} params.title - 消息标题
 * @param {string} params.content - 消息内容
 * @param {string} params.messagetype - 消息类型('maintenance', 'duty', 'volunteer', 'system')
 * @param {string} OPENID - 操作用户ID
 * @returns {Object} 操作结果
 */
exports.sendMessages = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.type || !params.title || !params.content || !params.messagetype) {
      return {
        code: 400,
        data: null,
        message: '缺少必要参数'
      }
    }

    // 检查消息类型是否有效
    const validTypes = ['maintenance', 'duty', 'volunteer', 'system']
    if (!validTypes.includes(params.messagetype)) {
      return {
        code: 400,
        data: null,
        message: '无效的消息类型'
      }
    }

    // 检查用户权限（只有组长可以发送批量消息）
    // 查询用户信息（从 users 集合）
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()

    if (userResult.data.length === 0) {
      return {
        code: 404,
        message: '用户信息不存在'
      }
    }

    const user = userResult.data[0]
    
    if (!user || user.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有组长可以发送批量消息'
      }
    }

    // 获取接收者列表（使用 openid 作为 messageUserId）
    let receiverIds = []
    
    switch (params.type) {
      case 'all': {
        // 发送给所有用户（users + proUsers 的去重合集）
        const [allUsers, allProUsers] = await Promise.all([
          db.collection('users').field({ openid: true }).get(),
          db.collection('proUsers').field({ openid: true }).get()
        ])
        const set = new Set()
        allUsers.data.forEach(u => u.openid && set.add(u.openid))
        allProUsers.data.forEach(u => u.openid && set.add(u.openid))
        receiverIds = Array.from(set)
        break
      }
      
      case 'role': {
        // 发送给指定角色的用户
        if (!params.role) {
          return {
            code: 400,
            data: null,
            message: '缺少角色参数'
          }
        }
        if (params.role === 'member' || params.role === 'leader') {
          const roleUsers = await db.collection('proUsers').where({ role: params.role }).field({ openid: true }).get()
          receiverIds = roleUsers.data.map(u => u.openid)
        } else if (params.role === 'user') {
          const roleUsers = await db.collection('users').where({ role: 'user' }).field({ openid: true }).get()
          receiverIds = roleUsers.data.map(u => u.openid)
        } else {
          return { code: 400, data: null, message: '无效的角色参数' }
        }
        break
      }
      
      case 'users': {
        // 发送给指定用户（直接传入 openid 列表）
        if (!params.userIds || !Array.isArray(params.userIds) || params.userIds.length === 0) {
          return {
            code: 400,
            data: null,
            message: '缺少有效的用户ID列表'
          }
        }
        receiverIds = params.userIds
        break
      }
      
      case 'activity': {
        // 发送给活动参与者
        if (!params.activityId) {
          return {
            code: 400,
            data: null,
            message: '缺少活动ID'
          }
        }
        const activityResult = await db.collection('voluntary_activities').where({
          activityId: params.activityId
        }).get()
        if (!activityResult.data || activityResult.data.length === 0) {
          return {
            code: 404,
            data: null,
            message: '活动不存在'
          }
        }
        const activity = activityResult.data[0]
        if (!activity.participantsIDList || activity.participantsIDList.length === 0) {
          return {
            code: 400,
            data: null,
            message: '该活动没有参与者'
          }
        }
        receiverIds = activity.participantsIDList
        break
      }
      
      default:
        return {
          code: 400,
          data: null,
          message: '无效的消息接收者类型'
        }
    }
    
    // 如果没有接收者，返回错误
    if (receiverIds.length === 0) {
      return {
        code: 400,
        data: null,
        message: '没有符合条件的消息接收者'
      }
    }
    
    // 当前时间
    const now = new Date()
    
    // 批量发送消息
    let successCount = 0
    let failCount = 0
    
    // 使用 Promise.all 并行处理所有消息发送
    await Promise.all(receiverIds.map(async (receiverId) => {
      try {
        // 查询是否已有该用户的消息记录
        const messageResult = await db.collection('messages').where({
          messageUserId: receiverId
        }).get()
        
        if (messageResult.data.length === 0) {
          // 创建新的消息记录
          await db.collection('messages').add({
            data: {
              messageUserId: receiverId,
              messageNumber: 1,
              titleList: [params.title],
              contentList: [params.content],
              messagetypeList: [params.messagetype],
              isReadList: [false],
              sendTimeList: [now],
              createTime: now,
              updateTime: now
            }
          })
        } else {
          // 获取现有消息记录
          const existingMessage = messageResult.data[0]
          let {
            titleList = [],
            contentList = [],
            messagetypeList = [],
            isReadList = [],
            sendTimeList = [],
            messageNumber = 0
          } = existingMessage
          
          // 添加新消息
          titleList.push(params.title)
          contentList.push(params.content)
          messagetypeList.push(params.messagetype)
          isReadList.push(false)
          sendTimeList.push(now)
          messageNumber += 1
          
          // 如果超过10条消息，移除最早的消息
          if (messageNumber > 10) {
            titleList = titleList.slice(-10)
            contentList = contentList.slice(-10)
            messagetypeList = messagetypeList.slice(-10)
            isReadList = isReadList.slice(-10)
            sendTimeList = sendTimeList.slice(-10)
            messageNumber = 10
          }
          
          // 更新消息记录
          await db.collection('messages').where({
            messageUserId: receiverId
          }).update({
            data: {
              titleList,
              contentList,
              messagetypeList,
              isReadList,
              sendTimeList,
              messageNumber,
              updateTime: now
            }
          })
        }
        successCount++
      } catch (err) {
        console.error('发送消息失败:', receiverId, err)
        failCount++
      }
    }))
    
    return {
      code: 200,
      data: {
        successCount,
        failCount,
        total: receiverIds.length
      },
      message: '批量消息发送完成'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '发送批量消息失败'
    }
  }
} 