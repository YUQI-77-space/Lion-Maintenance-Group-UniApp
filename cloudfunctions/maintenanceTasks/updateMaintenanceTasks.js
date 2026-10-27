// 通用更新入口目前仅供管理详情设置 EW；状态和受理关系由专用 action 维护。
const cloud = require('wx-server-sdk')
const { withActiveMembers } = require('./memberStatus')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.updateMaintenanceTasks = async (params = {}, OPENID) => {
  try {
    if (!OPENID) return { code: 401, data: null, message: '请先登录' }
    const fields = params && params.updateData
    if (typeof params.maintenanceTaskId !== 'string' || !params.maintenanceTaskId.trim() ||
        !fields || typeof fields !== 'object' || Array.isArray(fields) ||
        Object.keys(fields).length !== 1 || !Object.prototype.hasOwnProperty.call(fields, 'ew')) {
      return { code: 400, data: null, message: '仅支持设置EW，任务状态和受理人请使用对应操作' }
    }
    if (typeof fields.ew !== 'number' || !Number.isFinite(fields.ew) || fields.ew < 0 || fields.ew > 300) {
      return { code: 400, data: null, message: 'EW须为0至300之间的有效数值' }
    }
    const users = await db.collection('users').where({ openid: OPENID }).limit(2).get()
    if (users.data.length !== 1) return { code: 403, data: null, message: '用户身份异常' }
    const tasks = await db.collection('maintenance_tasks').where({ maintenanceTaskId: params.maintenanceTaskId }).limit(2).get()
    if (tasks.data.length !== 1) return { code: 404, data: null, message: '未找到唯一的维修任务' }
    await withActiveMembers(db, [OPENID], async tx => {
      const { data: actor } = await tx.collection('users').doc(users.data[0]._id).get()
      if (!['leader', 'admin'].includes(actor.role)) {
        throw Object.assign(new Error('只有在职组长或管理员可以设置EW'), { code: 403 })
      }
      const ref = tx.collection('maintenance_tasks').doc(tasks.data[0]._id)
      const { data: task } = await ref.get()
      if (!task || task.maintenanceTaskId !== params.maintenanceTaskId) {
        throw Object.assign(new Error('任务已变化，请刷新后重试'), { code: 409 })
      }
      await ref.update({ data: { ew: fields.ew, updateTime: db.serverDate() } })
    })
    return { code: 200, data: { maintenanceTaskId: params.maintenanceTaskId }, message: '更新维修任务成功' }
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 500, data: null, message: error.message || '更新维修任务失败' }
  }
}
