const { createHash } = require('crypto')

// login/users 独立部署，此文件须在两个云函数中保持一致（回归测试校验）。
// 只补缺失记录，不覆盖自动计量、手动调整或历史时间。
async function ensureEwaSummary(db, member, dryRun = false) {
  if (!member || typeof member.openid !== 'string' || !member.openid.trim()) {
    throw new Error('成员缺少有效 openid')
  }
  if (!['member', 'leader', 'admin'].includes(member.role)) {
    throw new Error('仅维修组成员可以初始化 EWA')
  }
  const summaries = db.collection('ewaSummary')
  const find = () => summaries.where({ ewaUserId: member.openid }).limit(1).get()
  if ((await find()).data.length) return 'existing'
  if (dryRun) return 'missing'

  try {
    // 固定文档 ID 防止并发补建；同时兼容已有随机 ID 记录。
    // 保留初始化器定义的 ewaUserId 唯一索引，兼容其他业务写入入口。
    await summaries.add({ data: {
      _id: 'ewa_' + createHash('sha256').update(member.openid).digest('hex'),
      ewaUserId: member.openid,
      ewaUserName: member.nickName || '',
      maintenanceEW: 0,
      volunteerEW: 0,
      dutyEW: 0,
      totalEW: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    } })
    return 'created'
  } catch (err) {
    // 另一个请求可能已补建成功；实际写入故障必须继续上抛。
    if ((await find()).data.length) return 'existing'
    throw err
  }
}

module.exports = { ensureEwaSummary }
