// 更新消息列表
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 更新消息列表
 * @param {Object} params - 参数对象
 * @param {string} params.messageUserId - 消息接收用户ID
 * @param {Array<string>} params.titleList - 消息标题列表
 * @param {Array<string>} params.contentList - 消息内容列表
 * @param {Array<string>} params.messagetypeList - 消息类型列表
 * @param {Array<boolean>} params.isReadList - 消息已读状态列表
 * @param {string} OPENID - 操作用户ID
 * @returns {Object} 操作结果
 */
exports.updateMessageList = async (params, OPENID) => {
  try {
    // 检查参数
    if (!params.messageUserId) {
      return {
        code: 400,
        data: null,
        message: '缺少用户ID'
      }
    }
    
    // 检查权限，只有管理员或用户自己可以修改
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '用户不存在'
      }
    }
    
    const user = userResult.data[0]
    if (params.messageUserId !== OPENID && user.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '无权限执行此操作'
      }
    }
    
    // 获取现有消息记录
    const messageResult = await db.collection('messages').where({
      messageUserId: params.messageUserId
    }).get()
    
    // 当前时间
    const now = new Date()
    
    let messageNumber = 0
    
    if (params.titleList && Array.isArray(params.titleList)) {
      messageNumber = params.titleList.length
    }
    
    // 要更新的数据
    const updateData = {
      updateTime: now
    }
    
    if (params.titleList && Array.isArray(params.titleList)) {
      updateData.titleList = params.titleList
      updateData.messageNumber = params.titleList.length
    }
    
    if (params.contentList && Array.isArray(params.contentList)) {
      updateData.contentList = params.contentList
    }
    
    if (params.messagetypeList && Array.isArray(params.messagetypeList)) {
      updateData.messagetypeList = params.messagetypeList
    }
    
    if (params.isReadList && Array.isArray(params.isReadList)) {
      updateData.isReadList = params.isReadList
    }
    
    if (params.sendTimeList && Array.isArray(params.sendTimeList)) {
      updateData.sendTimeList = params.sendTimeList
    }
    
    if (messageResult.data.length === 0) {
      // 创建新记录
      await db.collection('messages').add({
        data: {
          messageUserId: params.messageUserId,
          messageNumber,
          titleList: params.titleList || [],
          contentList: params.contentList || [],
          messagetypeList: params.messagetypeList || [],
          isReadList: params.isReadList || [],
          sendTimeList: params.sendTimeList || [],
          createTime: now,
          updateTime: now
        }
      })
    } else {
      // 更新现有记录
      await db.collection('messages').where({
        messageUserId: params.messageUserId
      }).update({
        data: updateData
      })
    }
    
    return {
      code: 200,
      data: {
        messageUserId: params.messageUserId
      },
      message: '更新消息列表成功'
    }
    
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '更新消息列表失败'
    }
  }
} 