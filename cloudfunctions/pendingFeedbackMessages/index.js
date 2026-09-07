const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 导入待反馈消息相关方法
const { getUnreadFeedbackMessages } = require('./getUnreadFeedbackMessages')
const { markFeedbackMessageAsRead } = require('./markFeedbackMessageAsRead')
const { createFeedbackMessage } = require('./createFeedbackMessage')

// 云函数入口函数
exports.main = async (event, context) => {
  // 获取用户OpenID
  const wxContext = cloud.getWXContext()
  const OPENID = wxContext.OPENID
  
  // 请求参数
  const { action, params } = event
  
  
  
  try {
    switch (action) {
      case 'getUnreadFeedbackMessages':
        return await getUnreadFeedbackMessages(params, OPENID)
      case 'markFeedbackMessageAsRead':
        return await markFeedbackMessageAsRead(params, OPENID)
      case 'createFeedbackMessage':
        return await createFeedbackMessage(params, OPENID)
      default:
        return {
          code: 404,
          data: null,
          message: `未找到名为 ${action} 的操作`
        }
    }
  } catch (err) {
    console.error('待反馈消息云函数执行错误:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '待反馈消息操作失败'
    }
  }
}
