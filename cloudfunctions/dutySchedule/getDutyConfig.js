// 获取值班配置
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取值班配置
 * @param {Object} event 事件参数
 * @param {String} openid 用户openid
 * @returns {Object} 返回配置数据
 */
exports.getDutyConfig = async (event, openid) => {
  try {
    console.log('[getDutyConfig] 开始获取值班配置')

    // 获取配置数据
    const configResult = await db.collection('duty_config').doc('global').get()

    if (!configResult.data) {
      console.log('[getDutyConfig] 配置不存在')
      return {
        code: 404,
        data: null,
        message: '值班配置不存在，请先初始化系统'
      }
    }

    console.log('[getDutyConfig] 配置获取成功：', configResult.data)

    return {
      code: 200,
      data: configResult.data,
      message: '获取值班配置成功'
    }

  } catch (err) {
    console.error('[getDutyConfig] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '获取值班配置失败'
    }
  }
} 