// 本地回归：node --test cloudfunctions/dutySchedule/weekSafety.test.js
// 使用隔离内存数据库注入冲突与故障，不连接云端。
const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const calendar = require('./weekCalendar')

function harness(overrides = {}, now = '2026-10-19T10:30:00+08:00') {
  let state = {
    duty_config: { global: { startDate: '2026-09-07', currentWeek: 6, currentYear: 2026, ...overrides } },
    duty_slots: {}, users: { leader: { openid: 'leader', role: 'leader' }, member: { openid: 'member', role: 'member' } },
    duty_toDo_list: { preserved: { dutySlotId: '202610193', status: 'pending' } },
    ewaSummary: { preserved: { dutyEW: 12 } }
  }
  let revision = 0
  let failureAfter = 0
  let rollbackCount = 0
  let beforeCommit = null
  const clone = value => structuredClone(value)
  function collection(store, name, transactional = false) {
    return {
      where(query) {
        return { get: async () => ({ data: Object.values(store[name] || {}).filter(row => Object.keys(query).every(key => row[key] === query[key])) }) }
      },
      doc(id) {
        return {
          get: async () => ({ data: clone((store[name] || {})[id] || null) }),
          set: async ({ data }) => {
            if (transactional && failureAfter && --failureAfter === 0) throw new Error('注入写入失败')
            store[name][id] = clone(data)
          },
          update: async ({ data }) => { Object.assign(store[name][id], clone(data)) }
        }
      }
    }
  }
  const db = {
    collection: name => collection(state, name),
    serverDate: () => new Date(now),
    startTransaction: async () => {
      const snapshot = clone(state)
      const version = revision
      return {
        collection: name => collection(snapshot, name, true),
        commit: async () => {
          if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; hook() }
          if (revision !== version) throw new Error('事务写冲突')
          state = snapshot
          revision++
        },
        rollback: async () => { rollbackCount++ }
      }
    }
  }
  class Clock extends Date { static now() { return Date.parse(now) } }
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'member' }) }
  const cache = {}
  function load(file) {
    if (cache[file]) return cache[file]
    const exports = {}
    cache[file] = exports
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, file + '.js'), 'utf8'), {
      exports, Date: Clock, console: { log() {}, error() {}, warn() {} },
      require: name => name === 'wx-server-sdk' ? cloud : name === './weekCalendar'
        ? { ...calendar, getActualWeek: start => calendar.getActualWeek(start, Clock.now()) }
        : load(name.slice(2))
    }, { filename: file + '.js' })
    return exports
  }
  return {
    load, state: () => state,
    setTime: value => { now = value },
    failAfter: count => { failureAfter = count },
    rollbacks: () => rollbackCount,
    beforeCommit: hook => { beforeCommit = hook },
    changeConfig: data => { Object.assign(state.duty_config.global, data); revision++ }
  }
}

test('北京时间周界、非法日期与跨年学期', () => {
  assert.equal(calendar.getActualWeek('2026-09-07', Date.parse('2026-10-18T23:59:59+08:00')).weekNumber, 6)
  assert.equal(calendar.getActualWeek('2026-09-07', Date.parse('2026-10-19T00:00:00+08:00')).weekNumber, 7)
  assert.equal(calendar.getActualWeek('2026-09-07', Date.parse('2026-10-23T20:00:00+08:00')).startDate, '2026-10-19')
  assert.equal(calendar.getActualWeek('2026-09-07', Date.parse('2027-01-01T12:00:00+08:00')).year, 2026)
  for (const value of ['2026-02-30', '2026-10-20', '', '2026-13-01']) assert.throws(() => calendar.parseStartDate(value))
  for (const week of [0, 21, 1.2, NaN]) assert.throws(() => calendar.getWeekCalendar('2026-09-07', week))
  assert.throws(() => calendar.getActualWeek('2026-09-07', Date.parse('2026-09-06T23:00:00+08:00')))
})

test('自动切周在周一 10:30 生效，重复执行不再前进', async () => {
  const h = harness()
  const auto = h.load('autoWeekSwitcher')
  assert.equal((await auto.main()).code, 200)
  assert.equal(h.state().duty_config.global.currentWeek, 7)
  assert.equal(Object.keys(h.state().duty_slots).length, 35)
  const saved = structuredClone(h.state())
  assert.equal((await auto.main()).code, 200)
  assert.deepEqual(h.state(), saved)
  for (const [overrides, time] of [[{}, '2026-10-19T10:29:59+08:00'], [{ autoSwitchEnabled: false }, '2026-10-19T10:30:00+08:00']]) {
    const skipped = harness(overrides, time)
    await skipped.load('autoWeekSwitcher').main()
    assert.equal(skipped.state().duty_config.global.currentWeek, 6)
    assert.equal(Object.keys(skipped.state().duty_slots).length, 0)
  }
})

test('自动追赶落后多周，不自动回退超前周次，不越过学期上限', async () => {
  const lag = harness({ currentWeek: 2 })
  await lag.load('autoWeekSwitcher').main()
  assert.equal(lag.state().duty_config.global.currentWeek, 7)
  const ahead = harness({ currentWeek: 8 })
  await ahead.load('autoWeekSwitcher').main()
  assert.equal(ahead.state().duty_config.global.currentWeek, 8)
  const end = harness({ currentWeek: 20 }, '2027-02-01T10:30:00+08:00')
  assert.notEqual((await end.load('autoWeekSwitcher').main()).code, 200)
  assert.equal(end.state().duty_config.global.currentWeek, 20)
})

test('校准先预览，回调超前周次时保留排班、待办、工作量与锁', async () => {
  const h = harness({ currentWeek: 8, isEditingEnabled: false, isSystemLock: true })
  const handler = h.load('switchToWeek')
  const slot = { date: '2026-10-19', weekNumber: 7, year: 2026, dutyHolderId: 'someone', dutyHolderName: '成员', lock: { owner: 'someone' } }
  h.state().duty_slots['202610194'] = structuredClone(slot)
  h.state().duty_slots.future = { dutyHolderId: 'future-user', date: '2026-10-26' }
  const original = structuredClone(h.state())
  const preview = await handler.calibrateCurrentWeek({}, 'leader')
  assert.equal(preview.code, 200)
  assert.equal(preview.data.weekNumber, 7)
  assert.deepEqual(h.state(), original)
  const apply = { preview: false, expected: preview.data.expected, targetWeek: preview.data.weekNumber }
  assert.equal((await handler.calibrateCurrentWeek(apply, 'leader')).code, 200)
  assert.equal(h.state().duty_config.global.currentWeek, 7)
  assert.equal(h.state().duty_config.global.isEditingEnabled, false)
  assert.equal(h.state().duty_config.global.isSystemLock, true)
  assert.deepEqual(h.state().duty_slots['202610194'], slot)
  assert.deepEqual(h.state().duty_slots.future, original.duty_slots.future)
  assert.deepEqual(h.state().duty_toDo_list, original.duty_toDo_list)
  assert.deepEqual(h.state().ewaSummary, original.ewaSummary)
  const saved = structuredClone(h.state())
  assert.notEqual((await handler.calibrateCurrentWeek(apply, 'leader')).code, 200)
  assert.deepEqual(h.state(), saved)
  await h.load('autoWeekSwitcher').main()
  assert.deepEqual(h.state(), saved)
})

test('手动先切到本周，自动随后触发不再加一', async () => {
  const h = harness()
  assert.equal((await h.load('switchToWeek').switchToWeek({ weekNumber: 7 }, 'leader')).code, 200)
  await h.load('autoWeekSwitcher').main()
  assert.equal(h.state().duty_config.global.currentWeek, 7)
  assert.equal(Object.keys(h.state().duty_slots).length, 35)
})

test('写入中断回滚，不留下部分时段或新的当前周', async () => {
  const h = harness()
  const original = structuredClone(h.state())
  h.failAfter(12)
  assert.notEqual((await h.load('autoWeekSwitcher').main()).code, 200)
  assert.deepEqual(h.state(), original)
  assert.equal(h.rollbacks(), 1)
  assert.equal((await h.load('autoWeekSwitcher').main()).code, 200)
  assert.equal(Object.keys(h.state().duty_slots).length, 35)
})

test('并发手动与自动切周最多提交一次，冲突失败不覆盖已有数据', async () => {
  const h = harness()
  const results = await Promise.all([
    h.load('autoWeekSwitcher').main(),
    h.load('switchToWeek').switchToWeek({ weekNumber: 7 }, 'leader')
  ])
  assert.ok(results.some(result => result.code === 200))
  assert.equal(h.state().duty_config.global.currentWeek, 7)
  assert.equal(Object.keys(h.state().duty_slots).length, 35)
  assert.equal(h.rollbacks(), 1)
})

test('预览后配置变更、提交时配置冲突都拒绝校准', async () => {
  for (const changeAtCommit of [false, true]) {
    const h = harness({ currentWeek: 8 })
    const handler = h.load('switchToWeek')
    const preview = await handler.calibrateCurrentWeek({}, 'leader')
    if (changeAtCommit) h.beforeCommit(() => h.changeConfig({ currentWeek: 9 }))
    else h.changeConfig({ currentWeek: 9 })
    const res = await handler.calibrateCurrentWeek({ preview: false, expected: preview.data.expected, targetWeek: 7 }, 'leader')
    assert.notEqual(res.code, 200)
    assert.equal(h.state().duty_config.global.currentWeek, 9)
    assert.equal(Object.keys(h.state().duty_slots).length, 0)
  }
})

test('校准确认时已跨周，必须重新预览', async () => {
  const h = harness({ currentWeek: 8 }, '2026-10-25T23:59:59+08:00')
  const handler = h.load('switchToWeek')
  const preview = await handler.calibrateCurrentWeek({}, 'leader')
  const saved = structuredClone(h.state())
  h.setTime('2026-10-26T00:00:01+08:00')
  assert.notEqual((await handler.calibrateCurrentWeek({ preview: false, expected: preview.data.expected, targetWeek: 7 }, 'leader')).code, 200)
  assert.deepEqual(h.state(), saved)
})

test('保留定时器路由，小程序不能伪造 TriggerName 获得系统切周权限', async () => {
  let caller = 'member'
  let timerCalls = 0
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'), {
    exports, console: { log() {}, error() {} },
    require: name => name === 'wx-server-sdk'
      ? { init() {}, getWXContext: () => ({ OPENID: caller }) }
      : name === './autoWeekSwitcher' ? { main: async () => { timerCalls++; return { code: 200 } } } : {}
  })
  assert.equal((await exports.main({ TriggerName: 'autoWeekSwitcherTimer', action: 'unknown' }, {})).code, 400)
  assert.equal(timerCalls, 0)
  caller = undefined
  assert.equal((await exports.main({ Type: 'Timer', TriggerName: 'autoWeekSwitcherTimer' }, {})).code, 200)
  assert.equal(timerCalls, 1)
})

test('权限和异常数据保护：成员不能校准/切周/改配置，ID 冲突不覆盖', async () => {
  const h = harness()
  const original = structuredClone(h.state())
  const handler = h.load('switchToWeek')
  assert.notEqual((await handler.calibrateCurrentWeek({}, 'member')).code, 200)
  assert.notEqual((await handler.switchToWeek({ weekNumber: 7 }, 'member')).code, 200)
  assert.notEqual((await h.load('updateDutyConfig').updateDutyConfig({ configType: 'currentWeek', value: 9 }, 'member')).code, 200)
  assert.notEqual((await h.load('updateDutyConfig').updateDutyConfig({ configType: 'currentWeek', value: 9 }, 'leader')).code, 200)
  assert.deepEqual(h.state(), original)
  h.state().duty_slots['202610191'] = { date: '2026-10-19', year: 2026, weekNumber: 2, dutyHolderId: 'preserved' }
  const before = structuredClone(h.state())
  assert.notEqual((await handler.switchToWeek({ weekNumber: 7 }, 'leader')).code, 200)
  assert.deepEqual(h.state(), before)
})

test('跨年生成使用实际日期 ID，学期年份保持不变', async () => {
  const h = harness({}, '2027-01-04T10:30:00+08:00')
  assert.equal((await h.load('autoWeekSwitcher').main()).code, 200)
  assert.equal(h.state().duty_config.global.currentYear, 2026)
  assert.equal(h.state().duty_slots['202701041'].date, '2027-01-04')
  assert.equal(h.state().duty_slots['202701041'].year, 2026)
})

test('仓库实际 wx-server-sdk 2.6.3 的事务接口与服务端时间序列化兼容', async () => {
  const cloud = require('wx-server-sdk')
  cloud.init({ env: 'local-test-no-network' })
  const db = cloud.database({ throwOnNotFound: false })
  const Db = db._db.constructor
  const originalRequest = Db.reqClass
  const calls = []
  Db.reqClass = class {
    async send(api, params) {
      calls.push({ api, params })
      if (api === 'database.startTransaction') return { transactionId: 'isolated-test' }
      if (api === 'database.getDocument') {
        const row = params.collectionName === 'users' ? { openid: 'leader', role: 'leader' }
          : params.collectionName === 'duty_config' ? { startDate: '2026-09-07', currentWeek: 6, currentYear: 2026 } : null
        return { data: { list: row ? [JSON.stringify(row)] : [] } }
      }
      if (api === 'database.modifyDocument') return { data: { updated: 1 } }
      if (['database.commitTransaction', 'database.abortTransaction'].includes(api)) return {}
      throw new Error(`测试禁止外部请求：${api}`)
    }
  }
  try {
    const exports = {}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'switchToWeek.js'), 'utf8'), {
      exports, Date, console: { log() {}, error() {}, warn() {} },
      require: name => name === 'wx-server-sdk' ? { init() {}, database: () => db } : calendar
    })
    const res = await exports.switchToWeek({ weekNumber: 7 }, 'leader')
    assert.equal(res.code, 200, res.message)
    const writes = calls.filter(call => call.api === 'database.modifyDocument')
    assert.equal(writes.length, 36)
    assert.ok(writes.every(call => call.params.transactionId === 'isolated-test'))
    assert.equal(calls.at(-1).api, 'database.commitTransaction')
    assert.ok(writes[0].params.data.includes('createTime'))
  } finally {
    Db.reqClass = originalRequest
  }
})

test('首页按完整日期匹配今天，不将下周五视为今天，不循环寻找过去时段', () => {
  const duty = require('../../miniprogram/utils/dutyNow')
  const payload = {
    weekDates: [{ dayOfWeek: 5, dayName: '周五', date: '2026-10-30' }],
    tableData: [{ timeSlotInfo: { startTime: '15:30', endTime: '17:30' }, dailySlots: [{ status: 'assigned', slotData: { dutyHolderName: '其他周成员', dutyHolderId: 'someone' } }] }]
  }
  assert.equal(duty.buildDutyStatus(payload, new Date(2026, 9, 23, 16)).available, false)
  assert.equal(duty.findMySlotsToday(payload, 'someone', new Date(2026, 9, 23, 16)), null)
  payload.weekDates = [{ date: '2026-10-19', dayOfWeek: 1 }, { date: '2026-10-23', dayOfWeek: 5 }]
  payload.tableData[0].dailySlots.push({ status: 'available', slotData: { isAvailable: true } })
  assert.equal(duty.buildDutyStatus(payload, new Date(2026, 9, 23, 21)).next, null)
})
