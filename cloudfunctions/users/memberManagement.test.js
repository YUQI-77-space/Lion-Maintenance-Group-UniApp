// node --test cloudfunctions/users/memberManagement.test.js（所有数据均为内存测试数据）
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { handle } = require('./memberManagement')
const { updateMemberDepartment } = require('./updateMemberDepartment')
const { syncMemberProjection } = require('./syncMemberProjection')
const clone = value => value === undefined ? undefined : structuredClone(value)

function harness(count = 1) {
  const members = Array.from({ length: count }, (_, i) => ({ _id: `u${String(i).padStart(4, '0')}`,
    openid: `member-${i}`, role: 'member', nickName: `成员${i}`, studentId: `202600${i}`, qqId: '123456', version: 0 }))
  const state = { users: [{ _id: 'leader', openid: 'leader', role: 'leader', nickName: '组长' },
    { _id: 'admin', openid: 'admin', role: 'admin', nickName: '管理员' },
    { _id: 'guest', openid: 'guest', role: 'user' }, ...members],
    proUsers: members.map(row => ({ ...row, _id: 'p' + row._id, department: '电子技术部', isEmergencyContact: false })),
    ewaSummary: [{ _id: 'ewa', ewaUserId: 'member-0', ewaUserName: '成员0', maintenanceEW: 50, totalEW: 25, manualDutyEW: 9 }],
    member_management_logs: [], maintenance_tasks: [], duty_slots: [], voluntary_activities: [] }
  const op = (name, value) => ({ op: name, value })
  const command = { in: value => op('in', value), gt: value => op('gt', value),
    and: value => op('and', value), or: value => op('or', value), elemMatch: value => op('elemMatch', value) }
  function matches(row, condition) {
    if (condition.op === 'and') return condition.value.every(c => matches(row, c))
    if (condition.op === 'or') return condition.value.some(c => matches(row, c))
    return Object.entries(condition).every(([key, value]) => {
      const actual = row[key]
      if (value && value.op === 'in') return value.value.includes(actual)
      if (value && value.op === 'gt') return actual > value.value
      if (value && value.op === 'elemMatch') return Array.isArray(actual) && actual.some(r => matches(r, value.value))
      return Array.isArray(actual) ? actual.includes(value) : actual === value
    })
  }
  let failLogs = false, actingOpenid = 'member-0'
  let queue = Promise.resolve()
  const db = { command, serverDate: () => new Date('2026-10-23T00:00:00Z'),
    // 串行执行并回滚模拟事务；并发测试验证第二次提交重读版本。
    runTransaction(run) {
      const task = queue.then(async () => {
        const before = clone(state)
        try { return await run(db) } catch (error) {
          for (const key of Object.keys(state)) delete state[key]
          Object.assign(state, before)
          throw error
        }
      })
      queue = task.catch(() => {})
      return task
    },
    collection(name) {
      if (!state[name]) throw new Error(`集合不存在：${name}`)
      const query = (condition = {}, cap = 100, order = '') => ({
        where: condition => query(condition, cap, order), limit: cap => query(condition, cap, order),
        orderBy: order => query(condition, cap, order),
        async get() {
          let rows = state[name].filter(r => matches(r, condition))
          if (order) rows = rows.slice().sort((a, b) => String(a[order]).localeCompare(String(b[order])))
          return { data: clone(rows.slice(0, cap)) }
        },
        doc(id) { return {
          get: async () => ({ data: clone(state[name].find(r => r._id === id)) }),
          update: async ({ data }) => {
            const row = state[name].find(r => r._id === id)
            if (!row) throw new Error('文档不存在')
            Object.assign(row, clone(data))
          },
          remove: async () => { state[name] = state[name].filter(r => r._id !== id) }
        } },
        async add({ data }) {
          if (name === 'member_management_logs' && failLogs) throw new Error('日志写入失败')
          if (data._id && state[name].some(r => r._id === data._id)) throw new Error('重复ID')
          state[name].push(clone({ ...data, _id: data._id || 'new-' + state[name].length }))
          return { _id: data._id }
        }
      })
      return query()
    }
  }
  function load(relative) {
    const filename = path.resolve(__dirname, relative), exports = {}
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      exports, console: { log() {}, error() {} }, require(name) {
        if (name === 'wx-server-sdk') return { init() {}, database: () => db, getWXContext: () => ({ OPENID: actingOpenid }) }
        return require(path.resolve(path.dirname(filename), name))
      }
    }, { filename })
    return exports.main
  }
  const write = (action, values = {}, actor = 'leader') => handle(db, action,
    { userId: 'u0000', version: 0, _requestId: 'request-1', ...values }, actor)
  return { db, state, write, load, actAs: openid => { actingOpenid = openid }, failLogs: () => { failLogs = true } }
}

test('所有管理接口拒绝普通用户、组员和伪造的操作者参数；不提供新增或恢复操作', async () => {
  const h = harness(), before = clone(h.state)
  for (const actor of ['guest', 'member-0', '']) for (const action of require('./memberManagement').ACTIONS) {
    const result = await h.write(action, { fields: { nickName: '新昵称' }, openid: 'admin' }, actor)
    assert.ok([401, 403].includes(result.code))
  }
  for (const action of ['addTeamMember', 'restoreTeamMember', 'createUser']) assert.equal((await h.write(action)).success, false)
  assert.deepEqual(h.state, before)
})

test('完整分页超过100人；仅显示当前成员，支持部门、角色、昵称和完整学号筛选', async () => {
  const h = harness(123)
  h.state.proUsers[0].department = '机电维修部'
  h.state.users.find(r => r.openid === 'member-1').membershipStatus = 'removed'
  const result = await handle(h.db, 'getManagedMembers', { page: 7, pageSize: 20 }, 'leader')
  assert.equal(result.data.total, 124)
  assert.equal(result.data.items.length, 4)
  assert.equal(result.data.hasMore, false)
  const filtered = await handle(h.db, 'getManagedMembers', { department: '机电维修部', role: 'member', keyword: '2026000' }, 'admin')
  assert.equal(filtered.data.items.length, 1)
  assert.equal('qqId' in filtered.data.items[0], false)
  assert.equal((await handle(h.db, 'getManagedMembers', { keyword: '202600' }, 'leader')).data.total, 0)
  assert.equal((await handle(h.db, 'getManagedMembers', { keyword: '成员12' }, 'leader')).data.total, 4)
})

test('组长不能编辑自己、其他组长和管理员；管理员可编辑组长但不能编辑管理员', async () => {
  const h = harness()
  for (const userId of ['leader', 'admin']) assert.equal((await h.write('updateManagedMember', { userId, fields: { nickName: '变更' } })).code, 403)
  assert.equal((await h.write('changeMemberRole', { role: 'leader' })).code, 403)
  assert.equal((await h.write('updateManagedMember', { userId: 'admin', fields: { nickName: '变更' } }, 'admin')).code, 403)
  assert.equal((await h.write('updateManagedMember', { userId: 'leader', fields: { nickName: '新组长' } }, 'admin')).code, 409)
  h.state.proUsers.push({ _id: 'pl', openid: 'leader', role: 'leader' })
  assert.equal((await h.write('updateManagedMember', { userId: 'leader', fields: { nickName: '新组长' } }, 'admin')).success, true)
})

test('字段白名单和输入校验；事务同时更新双集合与EWA姓名，保留工作量和历史快照', async () => {
  const h = harness()
  for (const fields of [{ role: 'admin' }, { nickName: '' }, { studentId: 'a b' }, { qqId: 'abc' },
    { department: '不存在' }, { isEmergencyContact: 'true' }, { openid: 'admin' }]) {
    assert.equal((await h.write('updateManagedMember', { fields })).code, 400)
  }
  h.state.maintenance_tasks.push({ _id: 'history', assigneeId: 'member-0', assigneeName: '旧快照', taskStatus: 'completed' })
  const summary = clone(h.state.ewaSummary[0])
  const result = await h.write('updateManagedMember', { fields: { nickName: '新昵称', isEmergencyContact: true } })
  assert.equal(result.success, true)
  assert.equal(h.state.users.find(r => r.openid === 'member-0').nickName, '新昵称')
  assert.equal(h.state.proUsers[0].nickName, '新昵称')
  assert.equal(h.state.proUsers[0].isEmergencyContact, true)
  assert.equal(h.state.ewaSummary[0].ewaUserName, '新昵称')
  assert.equal(h.state.ewaSummary[0].totalEW, summary.totalEW)
  assert.equal(h.state.ewaSummary[0].manualDutyEW, summary.manualDutyEW)
  assert.equal(h.state.maintenance_tasks[0].assigneeName, '旧快照')
  assert.equal(h.state.member_management_logs.length, 1)
})

test('重复请求只提交一次；同标识不同内容拒绝；并发编辑只有一个版本成功', async () => {
  const h = harness(), values = { fields: { nickName: '新昵称' } }
  const results = await Promise.all([h.write('updateManagedMember', values), h.write('updateManagedMember', values)])
  assert.ok(results.every(r => r.success))
  assert.equal(h.state.member_management_logs.length, 1)
  assert.equal((await h.write('updateManagedMember', { fields: { nickName: '其他昵称' } })).code, 409)
  const conflict = await h.write('updateManagedMember', { ...values, _requestId: 'other' })
  assert.equal(conflict.code, 409)
  assert.equal(h.state.users.find(r => r.openid === 'member-0').version, 1)
})

test('任意日志写入失败则双集合、EWA和版本一起回滚', async () => {
  const h = harness(), before = clone(h.state)
  h.failLogs()
  assert.equal((await h.write('updateManagedMember', { fields: { nickName: '变更' } })).success, false)
  assert.deepEqual(h.state, before)
  assert.equal((await h.write('removeTeamMember', { reason: '离组' })).success, false)
  assert.deepEqual(h.state, before)
})

test('未完成维修、附加受理、未来或异常值班、未结束志愿活动均阻止移出', async () => {
  const cases = [
    ['maintenance_tasks', { taskStatus: 'inProgress', assigneeId: 'member-0' }],
    ['maintenance_tasks', { taskStatus: 'inProgress', additionalAssignees: [{ assigneeId: 'member-0' }] }],
    ['duty_slots', { assignedUser: 'member-0', date: '2099-01-01', endTime: '17:30' }],
    ['duty_slots', { dutyHolderId: 'member-0', date: '异常日期' }],
    ['voluntary_activities', { activityStatus: 'inPreparation', participantsIDList: ['member-0'] }],
    ['voluntary_activities', { activityStatus: 'pending', creatorId: 'member-0' }]
  ]
  for (const [name, record] of cases) {
    const h = harness()
    h.state[name].push({ _id: 'pending', ...record })
    const before = clone(h.state)
    const result = await h.write('removeTeamMember', { reason: '离组' })
    assert.equal(result.code, 409)
    assert.equal(result.data.blockers.length, 1)
    assert.deepEqual(h.state, before)
  }
})

test('移出保留账号、历史和全部EWA，幂等重试；旧会话及权限码不能恢复', async () => {
  const h = harness()
  h.state.duty_slots.push({ _id: 'past', dutyHolderId: 'member-0', date: '2020-01-01', endTime: '17:30' })
  const summary = clone(h.state.ewaSummary)
  assert.equal((await h.write('removeTeamMember', { reason: '毕业离组' })).success, true)
  assert.equal((await h.write('removeTeamMember', { reason: '毕业离组' })).success, true)
  assert.equal(h.state.users.find(r => r.openid === 'member-0').role, 'user')
  assert.equal(h.state.proUsers.length, 0)
  assert.equal(h.state.duty_slots.length, 1)
  assert.deepEqual(h.state.ewaSummary, summary)
  assert.equal(h.state.member_management_logs[0].memberBackup.openid, 'member-0')
  // 从本地现有配置读取测试用权限码，禁止打印或复制到测试文件。
  const loginSource = fs.readFileSync(path.join(__dirname, '../login/index.js'), 'utf8')
  const authCode = loginSource.match(/'([^']+)': 'leader'/)[1]
  const login = h.load('../login/index.js')
  for (const action of ['userPermissionAuthentication', 'revalidatePermissions']) {
    assert.equal((await login({ action, params: { authCode, openid: 'leader' } }, {})).success, true)
    assert.equal(h.state.users.find(r => r.openid === 'member-0').role, 'user')
    assert.equal(h.state.proUsers.length, 0)
  }
  await syncMemberProjection(h.db, 'member-0')
  assert.equal(h.state.proUsers.length, 0)
  assert.equal((await h.write('getManagedMemberDetail')).code, 404)
})

test('管理者任命角色不被旧权限码覆盖，管理员身份同步不丢失', async () => {
  const h = harness()
  assert.equal((await h.write('changeMemberRole', { role: 'leader' }, 'admin')).success, true)
  const result = await h.load('../login/index.js')({ action: 'revalidatePermissions', params: { authCode: '' } }, {})
  assert.equal(result.data.newRole, 'leader')
  assert.equal(h.state.proUsers[0].role, 'leader')
  await syncMemberProjection(h.db, 'admin')
  assert.equal(h.state.proUsers.find(r => r.openid === 'admin').role, 'admin')
})

test('个人资料接口只修改本人和白名单字段，增量更新版本并保留管理身份', async () => {
  const h = harness(), handler = h.load('index.js')
  const result = await handler({ action: 'saveUserInfo', params: { userInfo: {
    openid: 'leader', role: 'admin', membershipStatus: 'active', roleManaged: false, version: 99, nickName: '本人新昵称'
  } } }, {})
  assert.equal(result.success, true)
  const user = h.state.users.find(r => r.openid === 'member-0')
  assert.equal(user.role, 'member')
  assert.equal(user.nickName, '本人新昵称')
  assert.equal(user.version, 1)
  assert.equal(h.state.users.find(r => r.openid === 'leader').nickName, '组长')
  const self = await handler({ action: 'getUserByOpenId', params: { openid: 'admin' } }, {})
  assert.equal(self.data.openid, 'member-0')
})

test('个人部门与管理部门同步且共用冷却，个人变更使旧管理版本失效', async () => {
  const h = harness()
  const result = await updateMemberDepartment(h.db, 'member-0', '机电维修部')
  assert.equal(result.success, true)
  assert.equal(h.state.users.find(r => r.openid === 'member-0').department, '机电维修部')
  assert.equal(h.state.proUsers[0].department, '机电维修部')
  assert.equal((await h.write('updateManagedMember', { fields: { department: '运营管理部' } })).code, 409)
  assert.equal((await h.write('updateManagedMember', { version: 1, fields: { department: '运营管理部' } })).code, 409)
  assert.equal((await updateMemberDepartment(h.db, 'member-0', '运营管理部')).code, 409)
  h.state.users.find(r => r.openid === 'member-0').membershipStatus = 'removed'
  assert.equal((await updateMemberDepartment(h.db, 'member-0', '运营管理部')).code, 403)
})

test('两部署单元同步实现相同，防止单独部署时身份逻辑漂移', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, 'syncMemberProjection.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../login/syncMemberProjection.js'), 'utf8'))
})

test('实际 wx-server-sdk 的管理事务携带同一事务ID，资料、姓名和日志一起提交', async () => {
  const cloud = require('wx-server-sdk')
  cloud.init({ env: 'local-test-no-network' })
  const db = cloud.database(), Db = db._db.constructor, OriginalRequest = Db.reqClass
  const calls = []
  Db.reqClass = class {
    async send(api, params) {
      calls.push({ api, params })
      if (api === 'database.startTransaction') return { transactionId: 'member-transaction' }
      if (api === 'database.commitTransaction' || api === 'database.abortTransaction') return {}
      if (api === 'database.getDocument') {
        const collection = params.collectionName, query = JSON.parse(params.query || '{}')
        let row
        if (collection === 'users') row = query.openid === 'leader' ?
          { _id: 'leader', openid: 'leader', role: 'leader' } :
          { _id: 'u0000', openid: 'member-0', role: 'member', version: 0, nickName: '成员', qqId: '123456' }
        if (collection === 'proUsers') row = { _id: 'pro', openid: 'member-0', role: 'member', nickName: '成员' }
        if (collection === 'ewaSummary') row = { _id: 'ewa', ewaUserId: 'member-0', totalEW: 50 }
        return { data: { list: row ? [JSON.stringify(row)] : [] } }
      }
      if (api === 'database.modifyDocument') return { data: { updated: 1 } }
      if (api === 'database.insertDocument') return { data: { insertedIds: ['log'] } }
      throw new Error('测试禁止网络请求：' + api)
    }
  }
  try {
    const result = await handle(db, 'updateManagedMember', {
      userId: 'u0000', version: 0, _requestId: 'sdk-test', fields: { nickName: '新昵称' }
    }, 'leader')
    assert.equal(result.success, true)
    const writes = calls.filter(c => ['database.modifyDocument', 'database.insertDocument'].includes(c.api))
    assert.equal(writes.length, 4)
    assert.ok(writes.every(c => c.params.transactionId === 'member-transaction'))
    assert.equal(calls.at(-1).api, 'database.commitTransaction')
    const summaryWrite = writes.find(c => c.params.collectionName === 'ewaSummary')
    assert.equal(summaryWrite.params.data.includes('totalEW'), false)
  } finally { Db.reqClass = OriginalRequest }
})
