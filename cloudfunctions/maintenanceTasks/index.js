// 维修任务管理云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

const { obtainApplicantInfo } = require('./obtainApplicantInfo')
const { obtainClaimantInfo } = require('./obtainClaimantInfo')
const { createMaintenanceTask } = require('./createMaintenanceTask')
const { getMaintenanceTasksList } = require('./getMaintenanceTasksList')
const { getMaintenanceTaskDetail } = require('./getMaintenanceTaskDetail')
const { assignMaintenanceTask } = require('./assignMaintenanceTask')
const { completeMaintenanceTask } = require('./completeMaintenanceTask')
const { cancelMaintenanceTask } = require('./cancelMaintenanceTask')
const { updateMaintenanceTasks } = require('./updateMaintenanceTasks')
const { getMembersList } = require('./getMembersList')
const { addTaskAssignees } = require('./addTaskAssignees')
const { removeTaskAssignees } = require('./removeTaskAssignees')
const { deleteMaintenanceTask } = require('./deleteMaintenanceTask')

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, params } = event
  
  let result = {
    code: 200,
    data: null,
    message: 'success'
  }
  
  try {
    switch (action) {
      case 'obtainApplicantInfo':
        result = await obtainApplicantInfo(params, OPENID)
        break
      case 'obtainClaimantInfo':
        result = await obtainClaimantInfo(params, OPENID)
        break
      case 'createMaintenanceTask':
        result = await createMaintenanceTask(params, OPENID)
        break
      case 'getMaintenanceTasksList':
        result = await getMaintenanceTasksList(params, OPENID)
        break
      case 'getMaintenanceTaskDetail':
        result = await getMaintenanceTaskDetail(params, OPENID)
        break
      case 'assignMaintenanceTask':
        result = await assignMaintenanceTask(params, OPENID)
        break
      case 'completeMaintenanceTask':
        result = await completeMaintenanceTask(params, OPENID)
        break
      case 'cancelMaintenanceTask':
        result = await cancelMaintenanceTask(params, OPENID)
        break
      case 'updateMaintenanceTasks':
        result = await updateMaintenanceTasks(params, OPENID)
        break
      case 'getMembersList':
        result = await getMembersList(params, OPENID)
        break
      case 'addTaskAssignees':
        result = await addTaskAssignees(params, OPENID)
        break
      case 'removeTaskAssignees':
        result = await removeTaskAssignees(params, OPENID)
        break

      case 'deleteMaintenanceTask':
        result = await deleteMaintenanceTask(params, OPENID)
        break
      default:
        result = {
          code: 404,
          data: null,
          message: '未找到对应的方法'
        }
    }
  } catch (err) {
    result = {
      code: 500,
      data: null,
      message: err.message || '服务器内部错误'
    }
  }
  
  return result
} 