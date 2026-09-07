// 等效工作量评估云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

const { getRanking } = require('./getRanking')
const { updateTasksEW } = require('./updateTasksEW')
const { updateSummary } = require('./updateSummary')
const { calculateUserEW } = require('./calculateUserEW')
const { exportExcel } = require('./exportExcel')
const { exportAdvancedExcel } = require('./exportAdvancedExcel')
const { updateUserEW } = require('./updateUserEW')

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  
  try {
    const { action, params = {} } = event
    
    switch (action) {
      case 'getRanking':
        return await getRanking(params, OPENID)
      case 'updateTasksEW':
        return await updateTasksEW(params, OPENID)
      case 'updateSummary':
        return await updateSummary(params, OPENID)
      case 'calculateUserEW':
        return await calculateUserEW(params, OPENID)
      case 'exportExcel':
        return await exportAdvancedExcel(params, OPENID)
      case 'updateUserEW':
        return await updateUserEW(params, OPENID)
      default:
        return {
          code: 400,
          data: null,
          message: '未知的操作'
        }
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '等效工作量评估操作失败'
    }
  }
} 