const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 仅创建日志集合，不补写旧用户资料；客户端必须禁止直接读写此集合。
exports.initMemberManagement = async (openid, dryRun = true) => {
  if (!openid) return { success: false, code: 401, message: '请先登录' }
  const result = await db.collection('users').where({ openid }).limit(2).get()
  if (result.data.length !== 1 || !['leader', 'admin'].includes(result.data[0].role) || (result.data[0].membershipStatus === 'removed' || result.data[0].employmentStatus === 'retired')) {
    return { success: false, code: 403, message: '只有组长及管理员可以初始化组员管理' }
  }
  if (typeof dryRun !== 'boolean') return { success: false, code: 400, message: 'dryRun 必须为布尔值' }
  const data = { dryRun, collection: 'member_management_logs', userRecordsChanged: 0 }
  if (dryRun) return { success: true, code: 200, message: '将创建组员管理日志集合，不修改已有用户', data }
  const logs = db.collection('member_management_logs')
  try {
    await logs.limit(1).get()
  } catch (error) {
    if (error.errCode !== -502005 && error.code !== 'DATABASE_COLLECTION_NOT_EXIST') throw error
    try {
      await db.createCollection('member_management_logs')
    } catch (createError) {
      // 并发初始化可能已经建好；只有实际读取成功才视为就绪。
      try { await logs.limit(1).get() } catch (_) { throw createError }
    }
    await logs.limit(1).get()
  }
  return { success: true, code: 200, message: '日志集合已就绪，请核实集合权限为仅管理端可访问', data }
}
