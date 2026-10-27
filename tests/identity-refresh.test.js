// 身份事件及页面时序回归：只隔离微信 API，不连接云端。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function session(role) {
  let app, page, resolveUser
  const events = [], navigation = []
  const tabs = ['home', 'team', 'repair', 'user'].map(pagePath => ({ pagePath }))
  const wx = { getStorageSync() {}, setStorageSync() {}, disableAlertBeforeUnload() {}, showToast() {} }
  const router = { computeTabsByRole: () => tabs, switchTab: route => navigation.push(route) }
  const context = { module: { exports: {} }, wx, getApp: () => app, getCurrentPages: () => page ? [page] : [],
    require: () => router }
  vm.runInNewContext(fs.readFileSync('miniprogram/utils/identity.js', 'utf8'), context)
  const identity = context.module.exports
  const quiet = { log() {}, error() {}, warn() {} }
  vm.runInNewContext(fs.readFileSync('miniprogram/app.js', 'utf8'), {
    App: value => { app = value }, wx, console: quiet, setTimeout, clearTimeout,
    require: name => name.endsWith('/identity') ? identity : name.endsWith('/router') ? router
      : name.endsWith('/apiAdapter') ? { call: () => new Promise(done => { resolveUser = done }) } : {}
  })
  Object.assign(app.globalData, { role, openid: 'self', isLogin: true, userInfo: { role, openid: 'self', version: 1 }, currentTabs: tabs })
  app.publish = (...args) => events.push(args)
  app.prefetchUserDepartment = async () => {}
  app.updateUserRole(role)
  events.length = 0
  return { app, events, navigation, identity, wx, show: value => { page = value },
    respond: value => resolveUser(value),
    home() {
      let definition
      vm.runInNewContext(fs.readFileSync('miniprogram/pages/team/home/index.js', 'utf8'), {
        Page: value => { definition = value }, wx, getApp: () => app, console: quiet,
        require: name => name.endsWith('/layout') ? { getLayout: () => ({}) }
          : name.endsWith('/iconManager') ? { get: () => '' }
          : name.endsWith('/memberStatus') ? { isRetired: () => app.globalData.userInfo.employmentStatus === 'retired' } : {}
      })
      page = { ...definition, route: 'pages/team/home/index', data: structuredClone(definition.data),
        setData(patch) { Object.assign(this.data, patch) } }
      return page
    }
  }
}

test('后台刷新晚于Page.onShow返回时，升降角色仍立即同步团队入口并发布身份事件', async () => {
  for (const [before, after] of [['member', 'leader'], ['leader', 'member']]) {
    const h = session(before), page = h.home()
    h.app.onShow({})
    page.onShow()
    h.respond({ success: true, data: { openid: 'self', role: after, version: 2 } })
    await new Promise(done => setImmediate(done))
    assert.equal(h.app.globalData.role, after)
    assert.equal(page.data.role, after)
    assert.equal(page.data.isLeader, after === 'leader')
    assert.equal(h.events.filter(([name]) => name === 'identityChanged').length, 1)
    assert.equal(h.events.filter(([name]) => name === 'tabsChanged').length, 0)
    h.app.updateUserRole(after)
    assert.equal(h.events.filter(([name]) => name === 'identityChanged').length, 1)
  }
})

test('管理页面在降权或退休后退出；本人提交由结果处理避免重复跳转', () => {
  for (const route of ['members/manage', 'members/detail', 'maintenance/manage', 'volunteer/manage', 'duty/manage', 'ewa/manage', 'maintenance/create', 'volunteer/create']) {
    const h = session('leader')
    h.show({ route: `pages/team/${route}/index`, data: {} })
    h.app.updateUserRole('member')
    assert.deepEqual(h.navigation, ['/pages/team/home/index'])
  }
  const h = session('leader')
  const page = { route: 'pages/team/members/detail/index', data: {}, _applyingOwnIdentity: true }
  h.show(page)
  h.app.updateUserRole('member')
  assert.equal(h.navigation.length, 0)
  page._applyingOwnIdentity = false
  h.app.updateUserRole('leader')
  h.app.globalData.userInfo.employmentStatus = 'retired'
  h.app.updateUserRole('leader')
  assert.deepEqual(h.navigation, ['/pages/team/home/index'])
})

test('其他业务收到403后统一刷新身份，不递归刷新本人资料接口', async () => {
  let refreshes = 0
  const context = { module: { exports: {} }, setTimeout, clearTimeout,
    getApp: () => ({ refreshUserInfo: async () => { refreshes++ } }),
    wx: { cloud: { callFunction: async () => ({ result: { code: 403, message: '身份已变化' } }) } } }
  vm.runInNewContext(fs.readFileSync('miniprogram/utils/apiAdapter.js', 'utf8'), context)
  const api = context.module.exports
  assert.equal((await api.call('maintenanceTasks', { action: 'assignMaintenanceTask' })).code, 403)
  assert.equal(refreshes, 1)
  await api.call('users', { action: 'getUserByOpenId' })
  assert.equal(refreshes, 1)
})

test('晚到的旧身份响应不能恢复已撤销的角色，也不能切换为其他账号', async () => {
  const h = session('leader'), page = h.home()
  const pending = h.app.refreshUserInfo({ sync: false })
  h.app.globalData.userInfo = { openid: 'self', role: 'member', version: 2 }
  h.app.updateUserRole('member')
  h.respond({ success: true, data: { openid: 'self', role: 'leader', version: 1 } })
  await pending
  assert.equal(h.app.globalData.role, 'member')
  assert.equal(page.data.role, 'member')
  assert.equal(h.app.globalData.userInfo.version, 2)
  assert.equal(h.identity.isCurrentUserInfo(h.app, { openid: 'other', role: 'admin', version: 99 }), false)
})

test('管理员可使用维修和志愿管理详情操作，降权后立即失去相同操作', () => {
  for (const domain of ['maintenance', 'volunteer']) {
    let definition
    const app = { globalData: { role: 'admin' } }
    vm.runInNewContext(fs.readFileSync(`miniprogram/pages/team/${domain}/detail/index.js`, 'utf8'), {
      Page: value => { definition = value }, getApp: () => app,
      require: name => name.endsWith('memberStatus') ? { isRetired: () => false } : name.endsWith('iconManager') ? { get: () => '' } : {},
      wx: {}, console
    })
    const page = { ...definition, data: { fromManage: true, isFromManagePage: true, userRole: 'admin' } }
    const canManage = domain === 'maintenance' ? page.canManageTask : page.canManageActivity
    assert.equal(canManage.call(page), true)
    page.data.userRole = 'member'
    assert.equal(canManage.call(page), false)
  }
})
