// node --test cloudfunctions/users/ewaMembership.test.js（不连接云端）
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { ensureEwaSummary } = require('./ensureEwaSummary')
const { repairProUserEwa } = require('./repairProUserEwa')

function harness(count = 0, uniqueEwaUserId = true) {
  const members = Array.from({ length: count }, (_, i) => ({
    _id: String(i).padStart(4, '0'), openid: `member-${i}`, nickName: `成员${i}`, role: 'member'
  }))
  const state = { users: [{ _id: 'leader', openid: 'leader', role: 'leader' }, ...structuredClone(members)],
    proUsers: members, ewaSummary: [] }
  let failWrite = false
  const matches = (row, condition) => Object.entries(condition).every(([key, value]) => {
    if (value && value.op === 'gt') return row[key] > value.value
    if (value && value.op === 'in') return value.value.includes(row[key])
    return row[key] === value
  })
  const db = {
    async runTransaction(run) {
      const snapshot = structuredClone(state)
      try { return await run(db) } catch (error) {
        for (const key of Object.keys(state)) delete state[key]
        Object.assign(state, snapshot)
        throw error
      }
    },
    serverDate: () => new Date('2026-10-23T00:00:00Z'),
    command: { gt: value => ({ op: 'gt', value }), in: value => ({ op: 'in', value }),
      and: () => ({}), or: () => ({}), elemMatch: () => ({}) },
    collection(name) {
      state[name] ||= []
      let condition = {}, cap = 100, sort = ''
      const q = {
        where(value) { condition = value; return q }, limit(value) { cap = value; return q },
        orderBy(value) { sort = value; return q },
        async get() {
          let rows = state[name].filter(row => matches(row, condition))
          if (sort) rows = rows.slice().sort((a, b) => String(a[sort]).localeCompare(String(b[sort])))
          return { data: structuredClone(rows.slice(0, cap)) }
        },
        async add({ data }) {
          if (name === 'ewaSummary' && failWrite) throw new Error('注入写入失败')
          if (state[name].some(r => (data._id && r._id === data._id) ||
              (uniqueEwaUserId && name === 'ewaSummary' && r.ewaUserId === data.ewaUserId))) throw new Error('唯一键冲突')
          state[name].push(structuredClone({ ...data, _id: data._id || `auto-${state[name].length}` }))
          return { _id: data._id }
        },
        async update({ data }) { state[name].filter(r => matches(r, condition)).forEach(r => Object.assign(r, data)) },
        doc(id) {
          return {
            get: async () => ({ data: structuredClone(state[name].find(r => r._id === id)) }),
            update: async ({ data }) => Object.assign(state[name].find(r => r._id === id), data)
          }
        }
      }
      return q
    }
  }
  function load(relative) {
    const filename = path.resolve(__dirname, relative)
    const exports = {}
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      exports, console: { log() {}, error() {} },
      require(name) {
        if (name === 'wx-server-sdk') return { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'member-0' }) }
        return require(path.resolve(path.dirname(filename), name))
      }
    }, { filename })
    return exports
  }
  return { db, state, load, failWrites: value => { failWrite = value } }
}

test('两个独立部署单元使用相同补建实现', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, 'ensureEwaSummary.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../login/ensureEwaSummary.js'), 'utf8'))
})

test('只建缺失记录，并发/重试保留旧值和手动调整', async () => {
  const h = harness(1), member = h.state.proUsers[0]
  const results = await Promise.all(Array.from({ length: 8 }, () => ensureEwaSummary(h.db, member)))
  assert.equal(results.filter(r => r === 'created').length, 1)
  assert.equal(h.state.ewaSummary.length, 1)
  Object.assign(h.state.ewaSummary[0], { _id: 'legacy-random-id', maintenanceEW: 22, totalEW: 11, manualMaintenanceEW: 7 })
  const before = structuredClone(h.state.ewaSummary)
  assert.equal(await ensureEwaSummary(h.db, member), 'existing')
  assert.deepEqual(h.state.ewaSummary, before)
  await assert.rejects(ensureEwaSummary(h.db, { openid: 'x', role: 'user' }))
})

test('写入失败上抛，恢复后可安全重试', async () => {
  const h = harness(1)
  h.failWrites(true)
  await assert.rejects(ensureEwaSummary(h.db, h.state.proUsers[0]), /注入写入失败/)
  h.failWrites(false)
  assert.equal(await ensureEwaSummary(h.db, h.state.proUsers[0]), 'created')
})

test('缺少历史唯一索引时，并发补建仍由固定 _id 去重', async () => {
  const h = harness(1, false)
  const results = await Promise.all(Array.from({ length: 8 }, () => ensureEwaSummary(h.db, h.state.proUsers[0])))
  assert.equal(results.filter(r => r === 'created').length, 1)
  assert.equal(h.state.ewaSummary.length, 1)
})

test('login 会话同步与 users 资料同步均补建；失败不返回成功', async () => {
  for (const relative of ['../login/index.js', 'index.js']) {
    const h = harness(1), handler = h.load(relative).main
    const event = relative.startsWith('../login') ? { action: 'verifySession' } :
      { action: 'saveUserInfo', params: { userInfo: { nickName: '成员' } } }
    h.failWrites(true)
    const failed = await handler(event, {})
    assert.equal(failed.valid === true || failed.success === true, false)
    h.failWrites(false)
    const result = await handler(event, {})
    assert.equal(result.valid === true || result.success === true, true)
    assert.equal(h.state.ewaSummary.length, 1)
    await handler(event, {})
    assert.equal(h.state.ewaSummary.length, 1)
  }
})

test('历史审查默认只读；遍历超过100人，补齐后再跑无新增', async () => {
  const h = harness(123)
  h.state.ewaSummary.push({ _id: 'old', ewaUserId: 'member-0', totalEW: 89, manualDutyEW: 6 })
  const before = structuredClone(h.state.ewaSummary)
  async function all(dryRun) {
    let cursor = '', scanned = 0, missing = 0, created = 0
    while (true) {
      const params = dryRun === undefined ? { cursor } : { cursor, dryRun }
      const result = await repairProUserEwa(h.db, params, 'leader')
      assert.equal(result.success, true)
      scanned += result.data.scanned; missing += result.data.missing; created += result.data.created
      if (!result.data.hasMore) break
      assert.notEqual(cursor, result.data.nextCursor)
      cursor = result.data.nextCursor
    }
    return { scanned, missing, created }
  }
  assert.deepEqual(await all(), { scanned: 123, missing: 122, created: 0 })
  assert.deepEqual(h.state.ewaSummary, before)
  assert.deepEqual(await all(false), { scanned: 123, missing: 0, created: 122 })
  assert.deepEqual(h.state.ewaSummary[0], before[0])
  assert.deepEqual(await all(false), { scanned: 123, missing: 0, created: 0 })
})

test('普通用户会话不会创建 EWA，组长会话会创建', async () => {
  for (const role of ['user', 'leader']) {
    const h = harness(1)
    h.state.users.find(u => u.openid === 'member-0').role = role
    // 普通用户原本不应存在于 proUsers。
    if (role === 'user') h.state.proUsers = []
    const result = await h.load('../login/index.js').main({ action: 'verifySession' }, {})
    assert.equal(result.valid, true)
    assert.equal(h.state.ewaSummary.length, role === 'leader' ? 1 : 0)
  }
})

test('历史补齐校验真实调用者、参数、孤立记录与已退组身份，并报告部分失败', async () => {
  const h = harness(4)
  assert.equal((await repairProUserEwa(h.db, { dryRun: false, openid: 'leader' }, 'member-0')).success, false)
  assert.equal((await repairProUserEwa(h.db, { dryRun: 'false' }, 'leader')).success, false)
  h.state.proUsers[1].openid = ''
  h.state.users.find(u => u.openid === 'member-2').role = 'user'
  h.state.users = h.state.users.filter(u => u.openid !== 'member-3')
  h.failWrites(true)
  const result = await repairProUserEwa(h.db, { dryRun: false }, 'leader')
  assert.equal(result.success, false)
  assert.equal(result.data.skipped.length, 3)
  assert.equal(result.data.failed.length, 1)
  assert.equal(h.state.ewaSummary.length, 0)
})

test('全员重算成员查询不再截断为100人', async () => {
  const h = harness(123)
  const result = await h.load('../equivalentWorkloadAssessment/updateSummary.js').updateSummary({}, 'leader')
  assert.equal(result.code, 200)
  assert.equal(h.state.ewaSummary.length, 123)
})

test('实际 wx-server-sdk 2.6.3 支持固定 ID 新增与服务端时间序列化', async () => {
  const cloud = require('wx-server-sdk')
  cloud.init({ env: 'local-test-no-network' })
  const db = cloud.database()
  const Db = db._db.constructor, originalRequest = Db.reqClass
  const calls = []
  Db.reqClass = class {
    async send(api, params) {
      calls.push({ api, params })
      if (api === 'database.getDocument') return { data: { list: [] } }
      if (api === 'database.insertDocument') return { data: { insertedIds: ['test-id'] } }
      throw new Error(`测试禁止外部请求：${api}`)
    }
  }
  try {
    assert.equal(await ensureEwaSummary(db, { openid: 'member', role: 'member', nickName: '组员' }), 'created')
    const write = calls.find(c => c.api === 'database.insertDocument')
    const data = JSON.parse(write.params.data[0])
    assert.match(data._id, /^ewa_[a-f0-9]{64}$/)
    assert.equal(data.ewaUserId, 'member')
    assert.equal(data.totalEW.$numberInt, '0')
    assert.ok(data.createTime && data.updateTime)
    assert.equal(calls.filter(c => c.api === 'database.insertDocument').length, 1)
  } finally {
    Db.reqClass = originalRequest
  }
})
