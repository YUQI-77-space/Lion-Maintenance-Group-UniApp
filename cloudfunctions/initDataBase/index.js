// 初始化数据库集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 引入各个初始化模块
const { initEwaSummaryCollection } = require('./initEwaSummaryCollection')
const { initEmergencyContacts } = require('./initEmergencyContacts')

/**
 * 数据库初始化云函数主入口
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  
  try {
    const { action, params = {} } = event
    
    console.log('initDataBase云函数收到请求:', { action, params, OPENID });
    
    // 根据action调用对应的初始化方法
    switch (action) {
      case 'initServiceSummary':
      case 'initEwaSummaryCollection':
        console.log('调用initEwaSummaryCollection函数');
        return await initEwaSummaryCollection()

      case 'initEmergencyContacts':
        console.log('调用initEmergencyContacts函数');
        return await initEmergencyContacts(params.openids)
        
      case 'initMessageLogs':
      default:
        console.log('执行默认的消息日志集合初始化');
        return await initMessageLogsCollections()
    }
  } catch (error) {
    console.error('数据库初始化失败:', error)
    return {
      success: false,
      message: error.message || '数据库初始化失败',
      error: error
    }
  }
}

/**
 * 初始化消息日志相关集合
 */
async function initMessageLogsCollections() {
  try {
    
    
    // 创建 message_send_logs 集合
    try {
      await db.createCollection('message_send_logs')
      
    } catch (err) {
      if (err.errCode === -502005) {
        
      } else {
        console.error('创建 message_send_logs 集合失败:', err)
        throw err
      }
    }
    
    // 创建 pending_feedback_messages 集合
    try {
      await db.createCollection('pending_feedback_messages')
      
    } catch (err) {
      if (err.errCode === -502005) {
        
      } else {
        console.error('创建 pending_feedback_messages 集合失败:', err)
        throw err
      }
    }
    
    // 创建测试数据以验证集合
    const testLog = {
      type: 'INIT_TEST',
      templateId: 'test',
      toUser: 'test',
      status: 'success',
      timestamp: new Date(),
      details: {
        message: '数据库集合初始化测试',
        action: 'database_init'
      }
    }
    
    const result = await db.collection('message_send_logs').add({
      data: testLog
    })
    
    
    
    // 删除测试数据
    await db.collection('message_send_logs').doc(result._id).remove()
    
    
    return {
      code: 200,
      data: {
        collections: ['message_send_logs', 'pending_feedback_messages'],
        timestamp: new Date()
      },
      message: '消息日志集合初始化成功'
    }
    
  } catch (error) {
    console.error('消息日志集合初始化失败:', error)
    return {
      code: 500,
      data: null,
      message: error.message || '消息日志集合初始化失败'
    }
  }
}
