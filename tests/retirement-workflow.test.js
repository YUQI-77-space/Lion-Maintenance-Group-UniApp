// 退休跨业务契约：只模拟云端边界，不连接生产或改真实成员。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const status = require('../cloudfunctions/users/memberStatus')

function database() {
  const state = {
    users: [{ _id: 'u0', openid: 'leader', role: 'leader', nickName: '在职组长' },
      { _id: 'u1', openid: 'active', role: 'member', nickName: '在职成员' },
      { _id: 'u2', openid: 'retired', role: 'leader', nickName: '退休成员', employmentStatus: 'retired' }],
    proUsers: [], ewaSummary: [], maintenance_tasks: [], duty_slots: [], voluntary_activities: [], duty_toDo_list: []
  }
  state.proUsers = state.users.map(u => ({ ...u, _id: 'p' + u._id, studentId: u._id }))
  state.ewaSummary = state.users.map((u, i) => ({ _id: 'e' + i, ewaUserId: u.openid, totalEW: [3, 50, 100][i], ewaUserName: u.nickName, manualDutyEW: 7 }))
  const op = (name, value) => ({ op: name, value })
  function matches(row, condition) {
    if (condition.op === 'or') return condition.value.some(c => matches(row, c))
    if (condition.op === 'and') return condition.value.every(c => matches(row, c))
    return Object.entries(condition).every(([key, value]) => {
      const actual = row[key]
      if (value instanceof RegExp) return value.test(String(actual || ''))
      if (value && value.op === 'in') return value.value.includes(actual)
      if (value && value.op === 'gt') return actual > value.value
      if (value && value.op === 'neq') return actual !== value.value
      return actual === value
    })
  }
  const db = {
    command: { in: v => op('in', v), gt: v => op('gt', v), neq: v => op('neq', v), or: v => op('or', v), and: v => op('and', v) },
    RegExp: ({ regexp, options }) => new RegExp(regexp, options),
    collection(name) {
      const query = (where = {}, cap = 100, skip = 0, order) => {
        const rows = () => {
          let data = (state[name] || []).filter(row => matches(row, where))
          if (order) data = data.slice().sort((a, b) => (a[order.key] > b[order.key] ? 1 : a[order.key] < b[order.key] ? -1 : 0) * (order.direction === 'desc' ? -1 : 1))
          return data
        }
        return {
          where: next => query(next, cap, skip, order), field() { return this },
          limit: limit => query(where, limit, skip, order), skip: offset => query(where, cap, offset, order),
          orderBy: (key, direction) => query(where, cap, skip, { key, direction }),
          get: async () => ({ data: structuredClone(rows().slice(skip, skip + cap)) }),
          count: async () => ({ total: rows().length }),
          update: async () => { throw new Error('测试不允许意外写入') }
        }
      }
      return query()
    }
  }
  return { db, state }
}

function load(unit, file, db, { openid = 'leader', stubBusiness = false, sheets = [] } = {}) {
  const filename = path.resolve('cloudfunctions', unit, file), context = { exports: {}, console: { log() {}, error() {}, warn() {} }, Buffer, setTimeout, clearTimeout }
  context.module = { exports: context.exports }
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: openid }),
    listFiles: async () => ({ fileList: [] }), uploadFile: async () => ({ fileID: 'local-test' }),
    getTempFileURL: async () => ({ fileList: [{ tempFileURL: 'https://example.test/local-test' }] }) }
  context.require = name => {
    if (name === 'wx-server-sdk') return cloud
    if (name === './memberStatus') return status
    if (name === 'node-xlsx') return { build: data => { sheets.push(...data); return Buffer.from('local-test') } }
    if (stubBusiness) return new Proxy({}, { get: () => async () => ({ code: 200, data: { history: true } }) })
    return require(path.resolve(path.dirname(filename), name))
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  return context.module.exports
}

test('独立部署单元的状态实现一致，历史任务标记退休且不改数据库快照', async () => {
  const source = fs.readFileSync('cloudfunctions/users/memberStatus.js', 'utf8')
  for (const unit of ['login', 'maintenanceTasks', 'volunteerActivities', 'dutySchedule', 'equivalentWorkloadAssessment', 'userToDoList']) {
    assert.equal(fs.readFileSync(`cloudfunctions/${unit}/memberStatus.js`, 'utf8'), source)
  }
  const { db, state } = database(), before = structuredClone(state)
  const task = { assigneeId: 'retired', assigneeName: '历史姓名', ew: 9, taskStatus: 'completed', additionalAssignees: [{ assigneeId: 'active', assigneeName: '历史协助人' }] }
  const result = (await status.markTasks(db, [task]))[0]
  assert.equal(result.assigneeEmploymentStatus, 'retired')
  assert.equal(result.assigneeName, '历史姓名')
  assert.equal(result.ew, 9)
  assert.equal(result.additionalAssignees[0].employmentStatus, 'active')
  assert.equal(task.assigneeEmploymentStatus, undefined)
  assert.deepEqual(state, before)
})

test('退休身份跨维修、志愿、值班、待办、EWA拒绝写入，历史读取仍可用', async () => {
  const { db } = database()
  assert.equal((await load('equivalentWorkloadAssessment', 'index.js', db, { openid: '', stubBusiness: true }).main({ action: 'getRanking' }, {})).code, 401)
  assert.equal((await load('equivalentWorkloadAssessment', 'getRanking.js', db).getRanking({}, '')).code, 401)
  for (const [unit, write, read] of [
    ['maintenanceTasks', 'assignMaintenanceTask', 'getMaintenanceTaskDetail'],
    ['volunteerActivities', 'registerForVolunteerActivity', 'getVolunteerActivityDetail'],
    ['dutySchedule', 'selectDutySlots', 'getDutySlots'],
    ['userToDoList', 'updateTodoStatus', 'getTodoDetail'],
    ['equivalentWorkloadAssessment', 'updateUserEW', null]
  ]) {
    const handler = load(unit, 'index.js', db, { openid: 'retired', stubBusiness: true }).main
    assert.equal((await handler({ action: write, params: {} }, {})).code, 403, unit)
    if (read) assert.equal((await handler({ action: read, params: {} }, {})).code, 200, unit)
    else assert.equal((await handler({ action: 'getRanking', params: {} }, {})).code, 403)
  }
})

test('在职组长不能把退休人员导入活动或分配任务，退休人员不能直接报名', async () => {
  const { db, state } = database(), before = structuredClone(state)
  state.voluntary_activities.push({ activityId: 'v', activityStatus: 'inPreparation', volunteerCount: 10, numberOfVolunteers: 0, participantsIDList: [], recruitmentOpen: true })
  const imported = await load('volunteerActivities', 'batchImportVolunteers.js', db).batchImportVolunteers({ activityId: 'v', selectedMembers: ['retired'] }, { OPENID: 'leader' })
  assert.notEqual(imported.code, 200)
  const assigned = await load('maintenanceTasks', 'assignMaintenanceTask.js', db).assignMaintenanceTask({ maintenanceTaskId: 'task', assigneeId: 'retired' }, 'leader')
  assert.equal(assigned.code, 403)
  const joined = await load('volunteerActivities', 'registerForVolunteerActivity.js', db).main({ activityId: 'v' }, { OPENID: 'retired' })
  assert.notEqual(joined.code, 200)
  assert.deepEqual(state.users, before.users)
  assert.deepEqual(state.ewaSummary, before.ewaSummary)
  assert.equal(state.voluntary_activities[0].participantsIDList.length, 0)
})

test('排行榜总数、搜索和本人排名仅含在职成员，退休汇总与手动字段仍保留', async () => {
  const { db, state } = database(), before = structuredClone(state.ewaSummary)
  const rank = load('equivalentWorkloadAssessment', 'getRanking.js', db).getRanking
  const result = await rank({ page: 1, pageSize: 20, includeUserRanking: true }, 'leader')
  assert.equal(result.code, 200)
  assert.equal(result.data.total, 2)
  assert.equal(result.data.list.some(row => row.ewaUserId === 'retired'), false)
  assert.equal(result.data.userRanking.rank, 2)
  const searched = await rank({ search: '退休' }, 'leader')
  assert.equal(searched.data.total, 0)
  assert.equal((await rank({}, 'retired')).code, 403)
  assert.deepEqual(state.ewaSummary, before)
})

test('实际导出生成的四张表均排除退休成员，但不删除其历史工作量', async () => {
  const { db, state } = database(), sheets = [], before = structuredClone(state.ewaSummary)
  const result = await load('equivalentWorkloadAssessment', 'exportAdvancedExcel.js', db, { sheets }).exportAdvancedExcel({}, 'leader')
  assert.equal(result.code, 200)
  assert.equal(sheets.length, 4)
  assert.equal(JSON.stringify(sheets).includes('退休成员'), false)
  assert.equal(JSON.stringify(sheets).includes('在职成员'), true)
  assert.deepEqual(state.ewaSummary, before)
})

test('EWA 页面退休后不发请求，退休期间返回的旧请求不会重新展示名单', async () => {
  let definition, retired = false, calls = 0, resolve
  const app = { globalData: { role: 'leader', openid: 'self' } }
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/team/ewa/manage/index.js', 'utf8'), {
    Page: value => { definition = value }, getApp: () => app, setTimeout() {},
    wx: { getStorageSync() {}, showToast() {}, navigateBack() {} }, console,
    require: name => name.endsWith('memberStatus') ? { isRetired: () => retired } : name.endsWith('apiAdapter') ? {
      call: () => { calls++; return new Promise(done => { resolve = done }) }
    } : {}
  })
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch) } }
  page.checkUserPermission()
  const pending = page.fetchUsers()
  retired = true
  page.checkUserPermission()
  resolve({ success: true, data: { list: [{ ewaUserId: 'retired' }], total: 1 } })
  await pending
  assert.equal(page.data.hasPermission, false)
  assert.equal(page.data.users.length, 0)
  await page.fetchUsers()
  assert.equal(calls, 1)
})

test('重新填写登录资料后采用服务端在职状态，首个页面不会误认为退休组长可管理', async () => {
  let definition
  const stored = {}, app = { globalData: { userInfo: { openid: 'self', nickName: '历史姓名' } }, updateUserRole(role) { this.globalData.role = role } }
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/login/index.js', 'utf8'), {
    Page: value => { definition = value }, getApp: () => app, console,
    wx: { setStorageSync: (key, value) => { stored[key] = value }, showToast() {} },
    require: name => name.endsWith('apiAdapter') ? { call: async () => ({ success: true, data: { role: 'leader', employmentStatus: 'retired' } }) }
      : name.endsWith('loading') ? { hide() {} } : name.endsWith('router') ? { switchTab() {}, ROUTES: { HOME: '/' } }
      : name.endsWith('iconManager') ? { get() {}, getDefault: () => ({}) } : {}
  })
  await definition.getUserRole.call({ data: { userInfo: {} } })
  assert.equal(app.globalData.role, 'leader')
  assert.equal(app.globalData.userInfo.employmentStatus, 'retired')
  assert.equal(stored.userInfo.nickName, '历史姓名')
})
