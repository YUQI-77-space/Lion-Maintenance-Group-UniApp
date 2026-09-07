// 创建志愿活动
const cloud = require('wx-server-sdk')
const timeUtils = require('./timeUtils')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

/**
 * 创建志愿活动
 * @param {Object} event - 请求参数
 * @param {string} event.title - 活动标题
 * @param {string} event.description - 活动描述
 * @param {string} event.startTime - 活动开始时间
 * @param {string} event.endTime - 活动结束时间
 * @param {string} event.location - 活动地点
 * @param {number} event.duration - 活动时长(小时)
 * @param {number} event.volunteerHours - 志愿时长(小时)
 * @param {number} event.volunteerCount - 需要志愿者数量
 * @param {Object} wxContext - 微信上下文
 * @returns {Object} 创建结果
 */
exports.main = async (event, wxContext) => {
  try {
    const { 
      title, 
      description, 
      startTime, 
      endTime, 
      location, 
      duration, 
      volunteerHours, 
      volunteerCount,
      scheduledPublish,
      publishTime
    } = event
    
    const openid = wxContext.OPENID
    
    // 参数校验
    if (!title || !description || !startTime || !endTime || !location || !duration || !volunteerCount) {
      return {
        code: 400,
        message: '缺少必要参数'
      }
    }
    
    // 验证用户权限（只有组长可以创建活动）
    const userResult = await db.collection('users')
      .where({
        openid: openid
      })
      .get()
    
    if (userResult.data.length === 0 || userResult.data[0].role !== 'leader') {
      return {
        code: 403,
        message: '权限不足，只有组长可以创建活动'
      }
    }
    
    const creatorName = userResult.data[0].nickName
    
    // 生成活动ID（格式：年月序号，如20250701）
    const currentTime = new Date()
    const year = currentTime.getFullYear()
    const month = String(currentTime.getMonth() + 1).padStart(2, '0')
    
    // 查询当月活动数量，用于生成序号
    const monthPrefix = `${year}${month}`
    const countResult = await db.collection('voluntary_activities')
      .where({
        activityId: db.RegExp({
          regexp: `^${monthPrefix}.*`,
          options: 'i',
        })
      })
      .count()
    
    const sequence = String(countResult.total + 1).padStart(2, '0')
    const activityId = `${monthPrefix}${sequence}`
    
    // 判断活动状态：如果开启了定时发布且发布时间未到，状态为pending（待发布）
    let activityStatus;
    if (scheduledPublish && publishTime) {
      const now = timeUtils.getChinaTime();
      const publish = timeUtils.parseChinaTime(publishTime);
      if (now.getTime() < publish.getTime()) {
        // 发布时间未到，状态为待发布
        activityStatus = 'pending';
      } else {
        // 发布时间已到，使用正常状态判断
        activityStatus = timeUtils.calculateActivityStatus(startTime, endTime);
      }
    } else {
      // 未开启定时发布，使用正常状态判断
      activityStatus = timeUtils.calculateActivityStatus(startTime, endTime);
    }
    
    
    
    // 创建活动记录
    const activityData = {
      activityId,
      activityStatus,
      title,
      description,
      startTime,
      endTime,
      location,
      duration,
      volunteerHours: volunteerHours || duration, // 如果未提供志愿时长，默认等于活动时长
      volunteerCount,
      numberOfVolunteers: 0,
      recruitmentOpen: true, // 默认开启招募
      participantsIDList: [],
      participantsNameList: [],
      scheduledPublish: scheduledPublish || false, // 是否定时发布
      publishTime: publishTime || null, // 发布时间

      creatorId: openid,
      creatorName,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
    
    // 写入数据库
    const result = await db.collection('voluntary_activities').add({
      data: activityData
    })
    
    
    return {
      code: 200,
      data: {
        activityId,
        _id: result._id
      },
      message: '创建志愿活动成功'
    }
  } catch (error) {
    console.error('创建志愿活动失败', error)
    return {
      code: 500,
      message: '创建志愿活动失败: ' + error.message
    }
  }
} 