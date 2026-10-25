// node --test tests/backend-safety.test.js；只使用内存数据库，不连接云端。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function harness() {
  let now = '2026-10-26T02:30:00Z', version = 0, caller = 'member', failName = '', hook = null
  let state = {
    users: Object.fromEntries(['user', 'member', 'other', 'leader', 'admin'].map(id => [id, { _id: id, openid: id,
      role: id === 'other' ? 'member' : id, nickName: id, studentId: '示例学号', qqId: '示例QQ' }])),
    proUsers: Object.fromEntries(['member', 'other', 'leader', 'admin'].map(id => [id, { _id: id, openid: id, role: id === 'other' ? 'member' : id, nickName: id }])),
    duty_config: { global: { _id: 'global', currentWeek: 8, currentYear: 2026, startDate: '2026-09-07', isEditingEnabled: true } },
    duty_slots: Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['s' + i, { _id: 's' + i, dutySlotId: 's' + i,
      date: '2026-10-27', weekNumber: 8, year: 2026, dayOfWeek: 2, startTime: '10:00', endTime: '11:00', timeSlot: '上午',
      isAvailable: true, dutyHolderId: '', dutyHolderName: '' }])),
    duty_toDo_list: {}, ewaSummary: { legacy: { _id: 'legacy', ewaUserId: 'member', maintenanceEW: 100, volunteerEW: 50,
      dutyEW: 18, totalEW: 71.8, manualDutyEW: -2, retained: '保留字段' } },
    maintenance_tasks: {}, maintenance_toDo_list: {}
  }
  const clone = value => structuredClone(value)
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && value.op === 'gt') return row[key] > value.value
    if (value && value.op === 'neq') return row[key] !== value.value
    if (value && value.op === 'in') return value.value.includes(row[key])
    if (value instanceof RegExp || Object.prototype.toString.call(value) === '[object RegExp]') return value.test(row[key])
    return row[key] === value
  })
  let nextId = 0
  function collection(store, name, tx = false) {
    store[name] ||= {}
    const write = () => {
      if (name === failName) throw new Error('注入写入失败')
      if (!tx) version++
    }
    const ref = id => ({
      get: async () => ({ data: clone(store[name][id] || null) }),
      set: async ({ data }) => { write(); store[name][id] = { ...clone(data), _id: id }; return { stats: { updated: 1 } } },
      update: async ({ data }) => { write(); if (!store[name][id]) throw new Error('记录不存在'); Object.assign(store[name][id], clone(data)); return { stats: { updated: 1 } } },
      remove: async () => { write(); delete store[name][id] }
    })
    const base = { doc: id => { assert.equal(typeof id, 'string'); return ref(id) } }
    if (tx) return base // SDK事务没有where/get查询，测试不能掩盖此限制。
    let where = {}, cap = 100, sort = false
    const rows = () => Object.values(store[name]).filter(row => matches(row, where)).sort((a, b) => sort ? a._id.localeCompare(b._id) : 0)
    return Object.assign(base, {
      where(value) { where = { ...where, ...value }; return this }, limit(value) { cap = value; return this },
      orderBy() { sort = true; return this }, field() { return this },
      get: async () => ({ data: clone(rows().slice(0, cap)) }), count: async () => ({ total: rows().length }),
      add: async ({ data }) => { const id = data._id || 'new' + nextId++; write(); store[name][id] = { ...clone(data), _id: id }; return { _id: id } },
      update: async ({ data }) => { const selected = rows(); for (const row of selected) await ref(row._id).update({ data }); return { stats: { updated: selected.length } } }
    })
  }
  const db = {
    command: { gt: value => ({ op: 'gt', value }), neq: value => ({ op: 'neq', value }), in: value => ({ op: 'in', value }) },
    serverDate: () => new Date(now), collection: name => collection(state, name),
    startTransaction: async () => {
      const snapshot = clone(state), atVersion = version
      return { collection: name => collection(snapshot, name, true),
        commit: async () => {
          if (hook) { const action = hook; hook = null; action() }
          if (version !== atVersion) throw new Error('事务写冲突')
          state = snapshot; version++
        }, rollback: async () => {} }
    }
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return Date.parse(now) }
  }
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: caller }), callFunction: async () => ({}) }
  const cache = {}
  function load(relative) {
    const file = path.resolve('cloudfunctions', relative)
    if (cache[file]) return cache[file]
    const exported = {}, module = { exports: exported }; cache[file] = exported
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { exports: exported, module, Date: Clock,
      console: { log() {}, error() {}, warn() {} }, setTimeout, clearTimeout,
      require: name => name === 'wx-server-sdk' ? cloud : name.startsWith('.')
        ? load(path.relative(path.resolve('cloudfunctions'), path.resolve(path.dirname(file), name + '.js'))) : require(name)
    }, { filename: file })
    cache[file] = module.exports
    return module.exports
  }
  return { load, db, state: () => state, time: value => { now = value }, caller: value => { caller = value },
    fail: name => { failName = name }, beforeCommit: value => { hook = value },
    change: action => { action(state); version++ },
    confirm: (ids, user = 'member') => load('dutySchedule/confirmDutySelection.js').confirmDutySelection(ids === undefined ? {} : { selectedSlots: ids }, user),
    select: (ids, user = 'member') => load('dutySchedule/selectDutySlots.js').selectDutySlots({ selectedSlots: ids }, user),
    status: input => load('dutySchedule/dutyStatusManager.js').updateDutySlotStatus(input) }
}
const createParams = { level1: '示例分类', level2: '示例', level3: '示例', appointmentTime: '2026-10-27 10:00' }

test('报修绑定真实身份，普通用户不能代建或伪造管理标志；组长管理创建仍可用', async () => {
  const h = harness(), create = h.load('maintenanceTasks/createMaintenanceTask.js').createMaintenanceTask
  for (const params of [{ applicantId: 'other' }, { isManagementCreated: true }, { applicantId: {} }, { isManagementCreated: 'false' }]) {
    assert.notEqual((await create({ ...createParams, ...params }, 'user')).code, 200)
  }
  assert.notEqual((await create(createParams, '')).code, 200)
  assert.equal(Object.keys(h.state().maintenance_tasks).length, 0)
  assert.equal((await create({ ...createParams, applicantName: '伪造姓名', applicantQqId: '伪造QQ' }, 'user')).code, 200)
  const task = Object.values(h.state().maintenance_tasks)[0]
  assert.equal(task.applicantId, 'user'); assert.equal(task.applicantName, 'user'); assert.equal(task.applicantQqId, '示例QQ')
  assert.equal((await create({ ...createParams, isManagementCreated: true, applicantInfo: { nickName: '管理任务' } }, 'leader')).code, 200)
  assert.equal((await create({ ...createParams, isManagementCreated: true, applicantId: 'other' }, 'admin')).code, 200)
})

test('报修幂等查询绑定申请人，不返回其他人的同请求标识结果', async () => {
  const h = harness()
  h.state().maintenance_tasks.legacy = { _id: 'legacy', requestId: 'same', applicantId: 'other', maintenanceTaskId: 'secret' }
  const res = await h.load('maintenanceTasks/createMaintenanceTask.js').createMaintenanceTask({ ...createParams, _requestId: 'same' }, 'user')
  assert.equal(res.code, 200); assert.notEqual(res.data.maintenanceTaskId, 'secret')
})

test('认领验证操作者与当前目标角色；成员只能本人认领，管理者保留分配能力', async () => {
  for (const [caller, assignee, allowed] of [['user', 'other', false], ['member', 'other', false],
    ['member', 'member', true], ['leader', 'other', true], ['admin', 'other', true]]) {
    const h = harness()
    h.state().maintenance_tasks.task = { _id: 'task', maintenanceTaskId: 'task', taskStatus: 'pending', applicantId: 'user' }
    const res = await h.load('maintenanceTasks/assignMaintenanceTask.js').assignMaintenanceTask({ maintenanceTaskId: 'task', assigneeId: assignee }, caller)
    assert.equal(res.code === 200, allowed)
    assert.equal(h.state().maintenance_tasks.task.taskStatus, allowed ? 'inProgress' : 'pending')
  }
  const h = harness(); h.state().users.other.role = 'user'
  assert.notEqual((await h.load('maintenanceTasks/assignMaintenanceTask.js').assignMaintenanceTask({ maintenanceTaskId: 'task', assigneeId: 'other' }, 'leader')).code, 200)
})

test('确认直接提交本地选择；排班与待办一起提交，重试不重复，历史待办ID和字段保留', async () => {
  const h = harness()
  assert.equal((await h.confirm(['s0', 's1'])).code, 200)
  assert.equal(Object.keys(h.state().duty_toDo_list).length, 2)
  assert.equal(h.state().duty_slots.s0.dutyHolderId, 'member')
  const saved = structuredClone(h.state())
  assert.equal((await h.confirm(['s0', 's1'])).code, 200)
  assert.deepEqual(h.state(), saved)
  const old = harness()
  old.state().duty_toDo_list.legacy = { _id: 'legacy', dutySlotId: 's0', toDoListUserId: 'member', status: 'pending', retained: 1 }
  assert.equal((await old.confirm(['s0'])).code, 200)
  assert.equal(Object.keys(old.state().duty_toDo_list).length, 1)
  assert.equal(old.state().duty_toDo_list.legacy.retained, 1)
})

test('值班参数、权限、当前周、编辑和系统锁在服务端拒绝，失败不写记录', async () => {
  for (const change of [h => h.state().users.member.role = 'user', h => h.state().duty_slots.s0.weekNumber = 7,
    h => h.state().duty_config.global.isEditingEnabled = false, h => h.state().duty_config.global.isSystemLock = true,
    h => h.state().duty_slots.s0.date = '2026-10-25']) {
    const h = harness(); change(h); const saved = structuredClone(h.state())
    assert.notEqual((await h.confirm(['s0'])).code, 200); assert.deepEqual(h.state(), saved)
  }
  for (const ids of [[], ['s0', 's0'], ['s0', 's1', 's2', 's3'], [{}], 's0']) {
    assert.notEqual((await harness().confirm(ids)).code, 200)
  }
})

test('确认拒绝他人预选／确认／未过期锁；允许自己锁与空闲过期锁', async () => {
  for (const patch of [{ assignedUser: 'other' }, { dutyHolderId: 'other' },
    { dutyHolderId: 'other', dutyHolderName: '其他成员' },
    { lockStatus: 'locked', lockUserId: 'other', lockExpireTime: new Date('2026-10-27T00:00:00Z') },
    { lockStatus: 'locked', lockUserId: 'other', lockExpireTime: '非法时间' }]) {
    const h = harness(); Object.assign(h.state().duty_slots.s0, patch)
    const saved = structuredClone(h.state()); assert.notEqual((await h.confirm(['s0'])).code, 200); assert.deepEqual(h.state(), saved)
  }
  for (const lockUserId of ['member', 'other']) {
    const h = harness(); Object.assign(h.state().duty_slots.s0, { lockStatus: 'locked', lockUserId,
      lockExpireTime: new Date(lockUserId === 'member' ? '2026-10-27T00:00:00Z' : '2026-10-25T00:00:00Z') })
    assert.equal((await h.confirm(['s0'])).code, 200)
  }
})

test('预选沿用五分钟锁，确认包含已确认和预选配额；省略ID只确认本人预选', async () => {
  const h = harness()
  assert.equal((await h.select(['s0', 's1', 's2'])).code, 200)
  assert.equal(h.state().duty_slots.s0.lockExpireTime - h.state().duty_slots.s0.lockTime, 300000)
  assert.notEqual((await h.confirm(['s3'])).code, 200)
  assert.equal((await h.confirm()).code, 200)
  assert.equal(Object.keys(h.state().duty_toDo_list).length, 3)
})

test('待办、时段、配置写入任意失败全部回滚，恢复后可重试', async () => {
  for (const name of ['duty_toDo_list', 'duty_slots', 'duty_config']) {
    const h = harness(), saved = structuredClone(h.state()); h.fail(name)
    assert.notEqual((await h.confirm(['s0', 's1'])).code, 200); assert.deepEqual(h.state(), saved)
    h.fail(''); assert.equal((await h.confirm(['s0', 's1'])).code, 200)
  }
})

test('取消预选与确认共享事务，确认后不能取消；并发取消不会删除已确认待办', async () => {
  const h = harness()
  await h.select(['s0'])
  const cancel = () => h.load('dutySchedule/removeDutySelection.js').removeDutySelection({ selectedSlots: ['s0'] }, 'member')
  assert.equal((await cancel()).data.preSelectedCancelled, 1)
  assert.equal(h.state().duty_slots.s0.dutyHolderId, null)
  await h.select(['s0'])
  const results = await Promise.all([h.confirm(['s0']), cancel()])
  assert.equal(results.filter(r => r.code === 200).length, 1)
  if (h.state().duty_slots.s0.dutyHolderName) {
    assert.equal(Object.keys(h.state().duty_toDo_list).length, 1)
    const saved = structuredClone(h.state())
    assert.notEqual((await cancel()).code, 200)
    assert.deepEqual(h.state(), saved)
  } else assert.equal(Object.keys(h.state().duty_toDo_list).length, 0)
})

test('汇总和调度的时区算法保持一致，汇总路径也拒绝非法日期', () => {
  let now = '2026-10-26T02:30:00Z'
  class Clock extends Date { static now() { return Date.parse(now) } }
  const ctx = { exports: {}, Date: Clock, require: () => ({ init() {}, database: () => ({}) }) }
  vm.runInNewContext(fs.readFileSync('cloudfunctions/equivalentWorkloadAssessment/updateSummary.js', 'utf8'), ctx)
  assert.equal(ctx.calculateDutyStatus('2026-10-26', '10:00', '11:00'), 'inProgress')
  assert.equal(ctx.calculateDutyStatus('2026-02-30', '10:00', '11:00'), null)
  now = '2026-10-26T03:00:01Z'
  assert.equal(ctx.calculateDutyStatus('2026-10-26', '10:00', '11:00'), 'ended')
})

test('并发抢同一时段、同成员不同选择及切周冲突都不会覆盖或突破配额', async () => {
  const h = harness()
  const results = await Promise.all([h.confirm(['s0'], 'member'), h.confirm(['s0'], 'other')])
  assert.equal(results.filter(r => r.code === 200).length, 1)
  assert.equal(Object.keys(h.state().duty_toDo_list).length, 1)
  const quota = harness()
  await Promise.all([quota.select(['s0', 's1']), quota.confirm(['s2', 's3'])])
  assert.ok(Object.values(quota.state().duty_slots).filter(s => s.dutyHolderId === 'member').length <= 3)
  const week = harness()
  week.beforeCommit(() => week.change(s => { s.duty_config.global.currentWeek++ }))
  assert.notEqual((await week.confirm(['s0'])).code, 200)
  assert.equal(week.state().duty_config.global.currentWeek, 9)
  assert.equal(week.state().duty_slots.s0.dutyHolderId, '')
})

test('北京时间开始前、开始、结束与跨日边界正确；非法日期不可结算', () => {
  const h = harness(), calculate = h.load('dutySchedule/dutyStatusManager.js').calculateDutyStatus
  for (const [time, expected] of [['01:59:59', 'pending'], ['02:00:00', 'inProgress'], ['02:30:00', 'inProgress'],
    ['03:00:00', 'inProgress'], ['03:00:01', 'ended']]) {
    h.time(`2026-10-26T${time}Z`); assert.equal(calculate('2026-10-26', '10:00', '11:00'), expected)
  }
  h.time('2026-10-25T16:30:00Z'); assert.equal(calculate('2026-10-26', '00:00', '01:00'), 'inProgress')
  assert.equal(calculate('2026-02-30', '10:00', '11:00'), null)
  assert.equal(calculate('2026-10-26', '25:00', '26:00'), null)
})

function endedSlot(h) {
  Object.assign(h.state().duty_slots.s0, { dutyHolderId: 'member', assignedUser: 'member', dutyHolderName: '成员', dutyStatus: 'pending', date: '2026-10-25' })
  h.state().duty_toDo_list.todo = { _id: 'todo', dutySlotId: 's0', toDoListUserId: 'member', status: 'pending' }
}

test('结算忽略传入的身份、日期、旧状态，正常结算加权且保留手调与历史ID', async () => {
  const h = harness(); endedSlot(h)
  assert.equal((await h.status({ dutySlotId: 's0', dutyHolderId: 'other', dutyStatus: 'ended', date: '2099-01-01' })).success, true)
  assert.equal(h.state().ewaSummary.legacy.dutyEW, 20)
  assert.equal(h.state().ewaSummary.legacy.totalEW, 72)
  assert.equal(h.state().ewaSummary.legacy.manualDutyEW, -2)
  assert.equal(h.state().ewaSummary.legacy.retained, '保留字段')
  assert.equal(h.state().duty_toDo_list.todo.status, 'ended')
  const saved = structuredClone(h.state()); await h.status({ dutySlotId: 's0', dutyStatus: 'pending' })
  assert.deepEqual(h.state(), saved)
})

test('工作量、排班或待办写入失败一起回滚，重试补结算；并发只入账一次', async () => {
  for (const name of ['ewaSummary', 'duty_slots', 'duty_toDo_list']) {
    const h = harness(); endedSlot(h); const saved = structuredClone(h.state()); h.fail(name)
    assert.equal((await h.status('s0')).success, false); assert.deepEqual(h.state(), saved)
    h.fail(''); assert.equal((await h.status('s0')).success, true); assert.equal(h.state().ewaSummary.legacy.dutyEW, 20)
  }
  const h = harness(); endedSlot(h)
  const results = await Promise.all([h.status('s0'), h.status('s0')])
  assert.equal(results.filter(r => r.success && r.ewAdded).length, 1)
  assert.equal(h.state().ewaSummary.legacy.dutyEW, 20)
})

test('历史ended不自动补发或回退，异常工作量拒绝覆盖，单项上限300', async () => {
  const old = harness(); endedSlot(old); old.state().duty_slots.s0.dutyStatus = 'ended'
  const saved = structuredClone(old.state()); await old.status('s0'); assert.deepEqual(old.state(), saved)
  const bad = harness(); endedSlot(bad); bad.state().ewaSummary.legacy.dutyEW = '异常值'
  assert.equal((await bad.status('s0')).success, false); assert.equal(bad.state().duty_slots.s0.dutyStatus, 'pending')
  const cap = harness(); endedSlot(cap); cap.state().ewaSummary.legacy.dutyEW = 299
  assert.equal((await cap.status('s0')).success, true)
  assert.equal(cap.state().ewaSummary.legacy.dutyEW, 300); assert.equal(cap.state().ewaSummary.legacy.totalEW, 100)
})

test('空汇总用固定ID创建；缺失／重复时段或重复汇总不修改历史数据', async () => {
  const h = harness(); endedSlot(h); h.state().ewaSummary = {}
  assert.equal((await h.status('s0')).success, true)
  const created = Object.values(h.state().ewaSummary)[0]
  assert.match(created._id, /^ewa_/); assert.equal(created.dutyEW, 2); assert.equal(created.totalEW, 0.2)
  const duplicate = harness(); endedSlot(duplicate)
  duplicate.state().ewaSummary.duplicate = { ...duplicate.state().ewaSummary.legacy, _id: 'duplicate' }
  const saved = structuredClone(duplicate.state())
  assert.equal((await duplicate.status('s0')).success, false); assert.deepEqual(duplicate.state(), saved)
  assert.equal((await duplicate.status('missing')).success, false)
})

test('批量结算完整分页超过100段，重复ID只处理一次', async () => {
  const h = harness()
  h.state().duty_slots = Object.fromEntries(Array.from({ length: 105 }, (_, i) => {
    const id = 's' + String(i).padStart(3, '0')
    return [id, { _id: id, dutySlotId: id, dutyHolderId: 'member', dutyHolderName: '成员', dutyStatus: 'ended',
      date: '2026-10-25', startTime: '10:00', endTime: '11:00' }]
  }))
  const status = h.load('dutySchedule/dutyStatusManager.js')
  assert.equal((await status.scheduledStatusUpdate()).totalChecked, 105)
  assert.equal((await status.batchUpdateDutyStatus(['s000', 's000'])).totalChecked, 1)
})

test('两个外部结算action拒绝普通用户和伪造TriggerName，管理者只扫描可信数据', async () => {
  for (const action of ['batchUpdateDutyStatus', 'scheduledStatusUpdate']) {
    const h = harness(); endedSlot(h)
    const entry = h.load('dutySchedule/index.js')
    const payload = { action, TriggerName: 'autoWeekSwitcherTimer', params: { dutySlots: [{ dutySlotId: 'fake', dutyHolderId: 'other' }] } }
    for (const user of ['user', 'member', '']) {
      h.caller(user); assert.equal((await entry.main(payload, {})).code, 403)
    }
    assert.equal(h.state().ewaSummary.legacy.dutyEW, 18)
    h.caller('leader'); assert.equal((await entry.main(payload, {})).success, true)
    assert.equal(h.state().ewaSummary.legacy.dutyEW, 20)
  }
})

test('扣除值班使用加权总分，未来未结算排班删除不扣历史工作量', async () => {
  const h = harness(), ew = h.load('dutySchedule/dutyEWManager.js')
  assert.equal((await ew.batchRemoveDutyEW([{ dutyHolderId: 'member', dutyStatus: 'pending' }])).success, true)
  assert.equal(h.state().ewaSummary.legacy.dutyEW, 18)
  assert.equal((await ew.removeDutyEW('member', 1)).success, true)
  assert.equal(h.state().ewaSummary.legacy.dutyEW, 16)
  assert.equal(h.state().ewaSummary.legacy.totalEW, 71.6)
})

test('值班新增接口保留人工调整并计算72分，非法增量不改账目', async () => {
  const h = harness(), ew = h.load('dutySchedule/dutyEWManager.js')
  assert.equal((await ew.addDutyEW('member', 1)).success, true)
  assert.equal(h.state().ewaSummary.legacy.totalEW, 72)
  assert.equal(h.state().ewaSummary.legacy.manualDutyEW, -2)
  const saved = structuredClone(h.state())
  for (const count of [-1, 0.5, NaN, Infinity]) assert.equal((await ew.addDutyEW('member', count)).success, false)
  assert.deepEqual(h.state(), saved)
})

test('实际wx-server-sdk的确认与结算将全部写入携带同一事务ID，支持缺失文档与serverDate', async () => {
  const cloud = require('../cloudfunctions/dutySchedule/node_modules/wx-server-sdk')
  cloud.init({ env: 'local-test-no-network' })
  const db = cloud.database({ throwOnNotFound: false }), Db = db._db.constructor
  const originalRequest = Db.reqClass, calls = []
  let settling = false
  const user = { _id: 'member', openid: 'member', role: 'member', nickName: '示例' }
  const config = { _id: 'global', currentWeek: 8, currentYear: 2026, isEditingEnabled: true }
  const slot = { _id: 's0', dutySlotId: 's0', weekNumber: 8, year: 2026, isAvailable: true,
    date: '2099-10-27', startTime: '10:00', endTime: '11:00', timeSlot: '上午' }
  Db.reqClass = class {
    async send(api, params) {
      calls.push({ api, params })
      if (api === 'database.startTransaction') return { transactionId: 'safety-transaction' }
      if (api === 'database.getDocument') {
        const row = params.collectionName === 'users' ? user : params.collectionName === 'duty_config' ? config :
          params.collectionName === 'duty_slots' ? (settling ? { ...slot, date: '2000-01-01', dutyHolderId: 'member', dutyHolderName: '成员', dutyStatus: 'pending' } : slot) :
          params.collectionName === 'duty_toDo_list' && settling ? { _id: 'todo', dutySlotId: 's0', toDoListUserId: 'member', status: 'pending' } : null
        return { data: { list: row ? [JSON.stringify(row)] : [] } }
      }
      if (api === 'database.modifyDocument') return { data: { updated: 1 } }
      if (['database.commitTransaction', 'database.abortTransaction'].includes(api)) return {}
      throw new Error(`测试禁止外部请求：${api}`)
    }
  }
  const cache = {}
  function load(name) {
    if (cache[name]) return cache[name]
    const exports = {}; cache[name] = exports
    vm.runInNewContext(fs.readFileSync(path.resolve('cloudfunctions/dutySchedule', name + '.js'), 'utf8'), {
      exports, Date, console: { log() {}, error() {} },
      require: key => key === 'wx-server-sdk' ? { init() {}, database: () => db } : key.startsWith('.') ? load(key.slice(2)) : require(key)
    })
    return exports
  }
  try {
    const confirmed = await load('confirmDutySelection').confirmDutySelection({ selectedSlots: ['s0'] }, 'member')
    assert.equal(confirmed.code, 200, confirmed.message)
    const confirmWrites = calls.filter(c => c.api === 'database.modifyDocument')
    assert.equal(confirmWrites.length, 3)
    assert.ok(confirmWrites.every(c => c.params.transactionId === 'safety-transaction'))
    assert.ok(confirmWrites.some(c => c.params.data.includes('createTime')))
    assert.equal(calls.at(-1).api, 'database.commitTransaction')
    calls.length = 0; settling = true
    const settled = await load('dutyStatusManager').updateDutySlotStatus('s0')
    assert.equal(settled.success, true, settled.message)
    const statusWrites = calls.filter(c => c.api === 'database.modifyDocument')
    assert.equal(statusWrites.length, 3)
    assert.ok(statusWrites.every(c => c.params.transactionId === 'safety-transaction'))
    assert.equal(calls.at(-1).api, 'database.commitTransaction')
  } finally { Db.reqClass = originalRequest }
})
