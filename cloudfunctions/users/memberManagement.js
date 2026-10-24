// 仅管理已在组成员；账号注册及首次身份认证仍由用户自行完成。
const { createHash } = require('crypto')
const { validateNickname } = require('./sensitiveWordFilter')
const ROLES = ['member', 'leader', 'admin']
const DEPARTMENTS = ['运营管理部', '电子技术部', '机电维修部']
const ACTIONS = ['getManagedMembers', 'getManagedMemberDetail', 'updateManagedMember', 'changeMemberRole', 'removeTeamMember']
const PROFILE_FIELDS = ['nickName', 'studentId', 'qqId', 'department', 'isEmergencyContact']
function fail(message, code = 400, data = null) { throw Object.assign(new Error(message), { code, data }) }
async function one(db, name, query) {
  const { data } = await db.collection(name).where(query).limit(2).get()
  if (data.length > 1) fail('存在重复身份记录，请先核对数据', 409)
  return data[0]
}
async function caller(db, openid) {
  if (!openid) fail('请先登录', 401)
  const user = await one(db, 'users', { openid })
  if (!user || !['leader', 'admin'].includes(user.role) || user.membershipStatus === 'removed') fail('只有组长及管理员可以管理组员', 403)
  return user
}
function permissions(actor, target) {
  const editable = actor.openid !== target.openid && target.role !== 'admin' &&
    (actor.role === 'admin' || target.role === 'member')
  return { canEdit: editable, canRemove: editable, canChangeRole: editable && actor.role === 'admin' }
}
function present(user, pro = {}, actor) {
  const result = { userId: user._id, openid: user.openid, role: user.role,
    nickName: String(user.nickName || ''), studentId: String(user.studentId || ''), qqId: String(user.qqId || ''),
    avatarUrl: user.avatarUrl || '', cloudAvatarUrl: user.cloudAvatarUrl || '', cloudAvatarFileID: user.cloudAvatarFileID || '',
    department: pro.department || user.department || '', isEmergencyContact: pro.isEmergencyContact === true,
    version: user.version || 0, updateTime: user.updateTime || null, joinedAt: user.joinedAt || null,
    permissions: permissions(actor, user) }
  return result
}
async function all(db, name, condition) {
  const rows = []
  let cursor = ''
  while (true) {
    const query = cursor ? db.command.and([condition, { _id: db.command.gt(cursor) }]) : condition
    const { data } = await db.collection(name).where(query).orderBy('_id', 'asc').limit(100).get()
    rows.push(...data)
    if (data.length < 100) return rows
    cursor = data[data.length - 1]._id
  }
}
async function target(db, userId) {
  if (typeof userId !== 'string' || !userId || userId.length > 128) fail('无效的用户标识')
  const user = await one(db, 'users', { _id: userId })
  if (!user || !ROLES.includes(user.role) || user.membershipStatus === 'removed') fail('该用户已不在组内，请刷新列表', 404)
  return user
}
function profile(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('资料格式错误')
  const update = {}
  for (const key of Object.keys(fields)) {
    if (!PROFILE_FIELDS.includes(key)) fail('包含不允许修改的字段')
    const value = fields[key]
    if (key === 'isEmergencyContact') {
      if (typeof value !== 'boolean') fail('应急联系人设置无效')
      update[key] = value
      continue
    }
    if (typeof value !== 'string') fail('资料字段必须为文本')
    update[key] = value.trim()
    if (key === 'nickName') {
      const check = validateNickname(update[key])
      if (!check.valid) fail(check.message)
    }
    if (key === 'studentId' && !/^[a-zA-Z0-9]{1,32}$/.test(update[key])) fail('学号须为1至32位字母或数字')
    if (key === 'qqId' && !/^[0-9]{5,11}$/.test(update[key])) fail('QQ号须为5至11位数字')
    if (key === 'department' && !DEPARTMENTS.includes(update[key])) fail('请选择有效部门')
  }
  if (!Object.keys(update).length) fail('没有需要保存的变更')
  return update
}
// 按真实集合字段检查；历史快照与工作量均不修改。
async function blockers(db, openid) {
  const _ = db.command
  const maintenance = await all(db, 'maintenance_tasks', _.and([
    { taskStatus: _.in(['pending', 'inProgress']) },
    _.or([{ assigneeId: openid }, { additionalAssignees: _.elemMatch({ assigneeId: openid }) }])
  ]))
  const duty = await all(db, 'duty_slots', _.or([{ assignedUser: openid }, { dutyHolderId: openid }]))
  const volunteer = await all(db, 'voluntary_activities', _.and([
    { activityStatus: _.in(['pending', 'inPreparation', 'inProgress']) },
    _.or([{ creatorId: openid }, { participantsIDList: openid }])
  ]))
  const now = Date.now()
  const pendingDuty = duty.filter(slot => {
    const end = new Date(`${slot.date}T${slot.endTime}:00+08:00`).getTime()
    // 无法解析日期的占用记录也需人工确认，不能悄悄跳过。
    return !Number.isFinite(end) || end > now
  })
  return [...maintenance.map(row => ({ type: 'maintenance', id: row._id, title: row.title || row.maintenanceTaskId || '未完成维修任务' })),
    ...pendingDuty.map(row => ({ type: 'duty', id: row._id, title: `${row.date || ''} ${row.startTime || ''}-${row.endTime || ''}` })),
    ...volunteer.map(row => ({ type: 'volunteer', id: row._id, title: row.title || '未结束志愿活动' }))]
}
async function handle(db, action, params, openid) {
  try {
    const actor = await caller(db, openid)
    if (action === 'getManagedMembers') {
      const { keyword = '', department = '', role = '', page = 1, pageSize = 20 } = params
      if (typeof keyword !== 'string' || keyword.length > 40 || (department && !DEPARTMENTS.includes(department)) ||
          (role && !ROLES.includes(role)) || !Number.isInteger(page) || page < 1 ||
          !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) fail('查询条件无效')
      // ponytail: 小型团队按完整分页读取后筛选，规模达到数千人时改为数据库搜索与联表投影。
      const users = await all(db, 'users', { role: db.command.in(role ? [role] : ROLES) })
      const projections = await all(db, 'proUsers', {})
      const byOpenid = new Map(projections.map(row => [row.openid, row]))
      const search = keyword.trim().toLowerCase()
      const rows = users.filter(user => user.membershipStatus !== 'removed')
        .map(user => present(user, byOpenid.get(user.openid), actor))
        .filter(user => (!department || user.department === department) &&
          (!search || user.nickName.toLowerCase().includes(search) || user.studentId.toLowerCase() === search))
      const offset = (page - 1) * pageSize
      // 列表不下发QQ等详情资料。
      const items = rows.slice(offset, offset + pageSize).map(({ qqId, ...row }) => row)
      return { success: true, code: 200, data: { items, total: rows.length, page, pageSize, hasMore: offset + pageSize < rows.length } }
    }
    if (action === 'getManagedMemberDetail') {
      const user = await target(db, params.userId)
      const pro = await one(db, 'proUsers', { openid: user.openid })
      return { success: true, code: 200, data: present(user, pro, actor) }
    }
    const { userId, version, _requestId } = params
    if (!Number.isInteger(version) || version < 0 || typeof _requestId !== 'string' || !_requestId || _requestId.length > 128) fail('缺少有效版本号或请求标识')
    const logId = 'member_' + createHash('sha256').update(openid + ':' + _requestId).digest('hex')
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, userId, version, fields: params.fields, role: params.role, reason: params.reason })).digest('hex')
    return await db.runTransaction(async tx => {
      tx.command = db.command
      const currentActor = await caller(tx, openid)
      const previous = await one(tx, 'member_management_logs', { _id: logId })
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('请求标识已被其他操作使用', 409)
        return { success: true, code: 200, message: '操作已完成', data: previous.result }
      }
      const user = await target(tx, userId)
      if (!permissions(currentActor, user).canEdit) fail('不能修改自己、管理员或同级组长', 403)
      if ((user.version || 0) !== version) fail('资料已被更新，请刷新后重新编辑', 409)
      const pro = await one(tx, 'proUsers', { openid: user.openid })
      if (!pro) fail('成员资料不完整，请让该成员重新登录后再操作', 409)
      let changes
      if (action === 'updateManagedMember') {
        changes = profile(params.fields)
        const before = present(user, pro, currentActor)
        if ('isEmergencyContact' in changes && changes.isEmergencyContact && !(changes.qqId || user.qqId)) fail('应急联系人需要QQ号')
        if ('department' in changes && changes.department !== before.department &&
            Date.now() - (pro.lastDepartmentChangeTime || 0) < 3600000) fail('部门切换冷却中，请一小时后再操作', 409)
      } else if (action === 'changeMemberRole') {
        if (currentActor.role !== 'admin' || !['member', 'leader'].includes(params.role)) fail('只有管理员可以任免组长', 403)
        if (user.role === params.role) fail('角色未发生变化')
        changes = { role: params.role, roleManaged: true }
      } else if (action === 'removeTeamMember') {
        if (typeof params.reason !== 'string' || !params.reason.trim() || params.reason.length > 200) fail('请填写不超过200字的移出原因')
        const related = await blockers(tx, user.openid)
        if (related.length) fail('请先处理以下待交接事项，再移出成员', 409, { blockers: related })
        changes = { role: 'user', membershipStatus: 'removed', roleManaged: true,
          removedAt: db.serverDate(), removedBy: openid, removeReason: params.reason.trim() }
      } else fail('未知的管理操作')
      const before = present(user, pro, currentActor)
      const now = db.serverDate()
      const userUpdate = { ...changes, version: version + 1, updateTime: now }
      delete userUpdate.isEmergencyContact
      await tx.collection('users').doc(user._id).update({ data: userUpdate })
      if (action === 'removeTeamMember') {
        await tx.collection('proUsers').doc(pro._id).remove()
      } else {
        const proUpdate = { ...changes, updateTime: now }
        delete proUpdate.roleManaged
        if (changes.department && changes.department !== before.department) proUpdate.lastDepartmentChangeTime = Date.now()
        await tx.collection('proUsers').doc(pro._id).update({ data: proUpdate })
      }
      // 汇总中的姓名是当前资料，仅同步姓名，绝不重算或覆盖任何工作量。
      if (changes.nickName) {
        const summary = await one(tx, 'ewaSummary', { ewaUserId: user.openid })
        if (summary) await tx.collection('ewaSummary').doc(summary._id).update({ data: { ewaUserName: changes.nickName, updateTime: now } })
      }
      const result = { userId, version: version + 1, removed: action === 'removeTeamMember' }
      const auditBefore = {}, auditAfter = {}
      for (const key of Object.keys(changes)) {
        if (!['removedAt', 'removedBy', 'roleManaged'].includes(key)) {
          auditBefore[key] = before[key] === undefined ? null : before[key]
          auditAfter[key] = changes[key]
        }
      }
      // 日志兼作受影响字段备份，事务失败时身份、资料和日志一起回滚。
      await tx.collection('member_management_logs').add({ data: { _id: logId, action, actorId: openid,
        targetId: user.openid, targetUserId: userId, before: auditBefore, after: auditAfter,
        memberBackup: action === 'removeTeamMember' ? pro : null,
        reason: params.reason || '', createTime: now, fingerprint, result } })
      return { success: true, code: 200, message: action === 'removeTeamMember' ? '已移出维修组' : '保存成功', data: result }
    })
  } catch (error) {
    if (!error.code || typeof error.code !== 'number') console.error('组员管理操作失败', error.message)
    return { success: false, code: typeof error.code === 'number' ? error.code : 500,
      message: typeof error.code === 'number' ? error.message : '操作失败，请重试或联系管理员', data: error.data || null }
  }
}
module.exports = { ACTIONS, handle, permissions, profile, blockers }
