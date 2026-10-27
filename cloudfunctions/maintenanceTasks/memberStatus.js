// 各云函数独立部署，此文件保持一致；状态只补充到响应，不改历史业务快照。
const MEMBER_ROLES = ['member', 'leader', 'admin']
const statusOf = user => user && (user.employmentStatus === 'retired' || user.membershipStatus === 'removed') ? 'retired' : 'active'
const isActiveMember = user => !!user && MEMBER_ROLES.includes(user.role) && statusOf(user) === 'active'

async function readProfiles(db, ids) {
  const result = new Map()
  const unique = [...new Set(ids.filter(id => typeof id === 'string' && id))]
  for (let offset = 0; offset < unique.length; offset += 100) {
    const { data } = await db.collection('users').where({ openid: db.command.in(unique.slice(offset, offset + 100)) })
      .field({ openid: true, role: true, employmentStatus: true, membershipStatus: true }).limit(100).get()
    for (const user of data) result.set(user.openid, user)
  }
  return result
}

async function retirementBlock(db, openid) {
  if (!openid) return null // 内部定时结算沿用各入口的系统身份校验。
  const { data } = await db.collection('users').where({ openid }).limit(2).get()
  if (data.some(user => statusOf(user) === 'retired')) {
    return { success: false, code: 403, data: null, message: '您已退休，可查看历史记录；如需参与组内事务，请联系组长调整为在职' }
  }
  return null
}

async function activeMembers(db) {
  const rows = []
  let cursor = ''
  while (true) {
    const where = { role: db.command.in(MEMBER_ROLES) }
    if (cursor) where._id = db.command.gt(cursor)
    const { data } = await db.collection('proUsers').where(where).orderBy('_id', 'asc').limit(100).get()
    rows.push(...data)
    if (data.length < 100) break
    cursor = data[data.length - 1]._id
  }
  const profiles = await readProfiles(db, rows.map(row => row.openid))
  return rows.filter(row => isActiveMember(profiles.get(row.openid)))
    .map(row => ({ ...row, role: profiles.get(row.openid).role, employmentStatus: 'active' }))
}

async function markTasks(db, tasks) {
  const profiles = await readProfiles(db, tasks.flatMap(task => [task.applicantId, task.assigneeId,
    ...(task.additionalAssignees || []).map(person => person.assigneeId)]))
  return tasks.map(task => ({ ...task,
    applicantEmploymentStatus: statusOf(profiles.get(task.applicantId)),
    assigneeEmploymentStatus: statusOf(profiles.get(task.assigneeId)),
    additionalAssignees: (task.additionalAssignees || []).map(person => ({ ...person, employmentStatus: statusOf(profiles.get(person.assigneeId)) })) }))
}

// 与退休事务共写 users 文档，防止检查通过后又新增待完成事项。
async function lockActiveMembers(tx, db, ids) {
  for (const openid of [...new Set(ids)]) {
    const { data: candidates } = await db.collection('users').where({ openid }).limit(2).get()
    if (candidates.length !== 1) throw new Error('成员身份异常，请刷新后重试')
    const ref = tx.collection('users').doc(candidates[0]._id)
    const { data: user } = await ref.get()
    if (!user || user.openid !== openid || !isActiveMember(user)) throw new Error('成员状态已变化，仅在职组员可以参与，请刷新后重试')
    await ref.update({ data: { membershipWriteTime: db.serverDate() } })
  }
}

async function withActiveMembers(db, ids, write) {
  const tx = await db.startTransaction()
  try {
    await lockActiveMembers(tx, db, ids)
    const result = await write(tx)
    await tx.commit()
    return result
  } catch (error) {
    await tx.rollback().catch(() => {})
    throw error
  }
}

module.exports = { MEMBER_ROLES, statusOf, isActiveMember, readProfiles, retirementBlock, activeMembers, markTasks, lockActiveMembers, withActiveMembers }
