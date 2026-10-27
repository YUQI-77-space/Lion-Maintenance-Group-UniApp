// node --test cloudfunctions/initDataBase/initMemberManagement.test.js（不连接云端）
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function harness({ exists = false, users = [{ role: 'leader' }], readError, createError, race = false } = {}) {
  let creates = 0
  const db = {
    collection(name) {
      const query = {
        where() { return query }, limit() { return query },
        async get() {
          if (name === 'users') return { data: users }
          if (readError) throw readError
          if (!exists) throw Object.assign(new Error('日志集合不存在'), { errCode: -502005 })
          return { data: [] }
        }
      }
      return query
    },
    async createCollection(name) {
      assert.equal(name, 'member_management_logs')
      creates++
      if (race) exists = true
      if (createError) throw createError
      exists = true
    }
  }
  const context = { exports: {}, require: () => ({ init() {}, database: () => db }) }
  vm.runInNewContext(fs.readFileSync(require.resolve('./initMemberManagement'), 'utf8'), context)
  return { run: context.exports.initMemberManagement, creates: () => creates }
}

test('默认演练不建集合；实际初始化只创建一次，可重复执行', async () => {
  const h = harness()
  assert.equal((await h.run('leader')).data.dryRun, true)
  assert.equal(h.creates(), 0)
  assert.equal((await h.run('leader', false)).success, true)
  assert.equal((await h.run('leader', false)).success, true)
  assert.equal(h.creates(), 1)
})

test('未登录、非管理者、退组、重复身份和非法参数均不创建集合', async () => {
  const h = harness()
  assert.equal((await h.run('', false)).code, 401)
  assert.equal((await h.run('leader', 'false')).code, 400)
  assert.equal(h.creates(), 0)
  for (const users of [[], [{ role: 'member' }], [{ role: 'leader', employmentStatus: 'retired' }], [{ role: 'leader', membershipStatus: 'removed' }], [{ role: 'leader' }, { role: 'leader' }]]) {
    const denied = harness({ users })
    assert.equal((await denied.run('actor', false)).code, 403)
    assert.equal(denied.creates(), 0)
  }
})

test('退休调用者不能经其他初始化 action 写入', async () => {
  let writes = 0
  const db = {
    collection() { const q = { where: () => q, limit: () => q, get: async () => ({ data: [{ role: 'leader', employmentStatus: 'retired' }] }) }; return q },
    createCollection() { writes++; throw new Error('不应写入') }
  }
  const exports = {}
  const sdk = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'retired' }) }
  vm.runInNewContext(fs.readFileSync(require.resolve('./index'), 'utf8'), { exports, require: () => sdk, console: { log() {}, error() {} } })
  const result = await exports.main({ action: 'initEwaSummaryCollection' }, {})
  assert.equal(result.code, 403)
  assert.equal(writes, 0)
})

test('无关读取错误和真实创建错误必须上抛，不伪报就绪', async () => {
  const denied = new Error('读取权限不足'), broken = new Error('创建失败')
  const h = harness({ readError: denied })
  await assert.rejects(h.run('leader', false), error => error === denied)
  assert.equal(h.creates(), 0)
  await assert.rejects(harness({ createError: broken }).run('leader', false), error => error === broken)
})

test('并发初始化仅在集合实际可读时成功', async () => {
  const h = harness({ race: true, createError: new Error('其他初始化已建好集合') })
  assert.equal((await h.run('leader', false)).success, true)
  assert.equal(h.creates(), 1)
})
