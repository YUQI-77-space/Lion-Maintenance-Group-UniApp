const { ensureEwaSummary } = require('./ensureEwaSummary')

// login/users 为独立部署单元，此实现保持一致；始终重读身份，防止旧会话把已移出成员加回。
async function syncMemberProjection(db, openid) {
  const member = await db.runTransaction(async tx => {
    const users = await tx.collection('users').where({ openid }).limit(2).get()
    if (users.data.length !== 1) throw new Error('用户身份不存在或重复')
    const user = users.data[0]
    const projections = await tx.collection('proUsers').where({ openid }).limit(2).get()
    if (projections.data.length > 1) throw new Error('成员身份重复，请联系管理员')
    const pro = projections.data[0]
    if (!['member', 'leader', 'admin'].includes(user.role) || user.membershipStatus === 'removed') {
      if (pro) await tx.collection('proUsers').doc(pro._id).remove()
      return null
    }
    const data = { openid, role: user.role, nickName: user.nickName || '',
      avatarUrl: user.avatarUrl || '', cloudAvatarUrl: user.cloudAvatarUrl || null,
      cloudAvatarFileID: user.cloudAvatarFileID || null, studentId: user.studentId || '', qqId: user.qqId || '',
      department: user.department || (pro && pro.department) || null,
      isEmergencyContact: !!(pro && pro.isEmergencyContact), updateTime: db.serverDate() }
    if (pro) await tx.collection('proUsers').doc(pro._id).update({ data })
    else await tx.collection('proUsers').add({ data: { ...data, createTime: user.createTime || db.serverDate() } })
    return data
  })
  if (member) await ensureEwaSummary(db, member)
}
module.exports = { syncMemberProjection }
