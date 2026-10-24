const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 仅创建日志集合，不补写旧用户资料；客户端必须禁止直接读写此集合。
exports.initMemberManagement = async (openid, dryRun = true) => {
  const result = await db.collection('users').where({ openid }).limit(1).get()
  if (!result.data.length || !['leader', 'admin'].includes(result.data[0].role) || result.data[0].membershipStatus === 'removed') {
    return { success: false, code: 403, message: '只有组长及管理员可以初始化组员管理' }
  }
  if (typeof dryRun !== 'boolean') return { success: false, code: 400, message: 'dryRun 必须为布尔值' }
  const data = { dryRun, collection: 'member_management_logs', userRecordsChanged: 0 }
  if (dryRun) return { success: true, code: 200, message: '将创建组员管理日志集合，不修改已有用户', data }
  try {
    await db.createCollection('member_management_logs')
  } catch (error) {
    // 已存在时仍需验证读取可用，其他错误不得被忽略。
    if (error.errCode !== -502005) throw error
  }
  await db.collection('member_management_logs').limit(1).get()
  return { success: true, code: 200, message: '日志集合已就绪，请核实集合权限为仅管理端可访问', data }
}
