// 本人资料写入采用白名单与事务，防止旧会话覆盖管理者刚修改的身份。
const FIELDS = ['nickName', 'studentId', 'qqId', 'avatarUrl', 'cloudAvatarUrl', 'cloudAvatarFileID', 'useDefaultAvatar']
function pickProfile(info) {
  const result = {}
  for (const key of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(info, key)) continue
    const value = info[key]
    if (key === 'useDefaultAvatar') {
      if (typeof value !== 'boolean') throw new Error('默认头像标记无效')
    } else if ((value === null && !['cloudAvatarUrl', 'cloudAvatarFileID'].includes(key)) ||
        (value !== null && (typeof value !== 'string' || value.length > 2048))) throw new Error('资料字段格式无效')
    result[key] = value
  }
  return result
}
async function updateSelf(db, id, info) {
  return db.runTransaction(async tx => {
    const { data: current } = await tx.collection('users').doc(id).get()
    const update = { ...pickProfile(info), version: (current.version || 0) + 1, updateTime: db.serverDate() }
    await tx.collection('users').doc(id).update({ data: update })
    return { ...current, ...update }
  })
}
module.exports = { pickProfile, updateSelf }
