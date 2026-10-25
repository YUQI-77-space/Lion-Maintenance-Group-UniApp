// node --test tests/member-management-frontend.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const adapter = require('../miniprogram/utils/apiAdapter')

function page(name, call) {
  let definition
  const requests = []
  const member = { userId: 'member', openid: 'member', version: 1, role: 'member', nickName: '成员', studentId: '20260001', qqId: '123456',
    department: '电子技术部', isEmergencyContact: false, permissions: { canEdit: true, canRemove: true, canChangeRole: false } }
  const members = { call: async (...args) => { requests.push(args); return call ? call(...args) : { success: true, data: structuredClone(member) } },
    checkPermission: () => true, generateRequestId: () => 'stable-request', roles: { member: '组员' }, departments: ['电子技术部', '机电维修部'] }
  const wx = { showToast() {}, showModal: async () => ({ confirm: false }), navigateBack() {} }
  const app = { globalData: { openid: 'actor' }, publish() {}, async refreshUserInfo() {} }
  const context = {
    Page: value => { definition = value }, require: key => key === '../api' ? members : { teamRouter: {} },
    getApp: () => app, wx,
    setTimeout, clearTimeout
  }
  if (name !== 'manage') {
    const shared = { ...context, module: { exports: {} }, require: key => key === './api' ? members : { teamRouter: {} } }
    vm.runInNewContext(fs.readFileSync(path.resolve('miniprogram/pages/team/members/page.js'), 'utf8'), shared)
    context.require = () => shared.module.exports
  }
  vm.runInNewContext(fs.readFileSync(path.resolve(`miniprogram/pages/team/members/${name}/index.js`), 'utf8'), context)
  const instance = { ...definition, data: structuredClone(definition.data),
    setData(update) { Object.assign(this.data, update) } }
  return { instance, requests, member, wx, app }
}

test('手动重试的请求标识通过 apiAdapter 保持不变', async () => {
  let api
  const captured = []
  vm.runInNewContext(fs.readFileSync(path.resolve('miniprogram/pages/team/members/api.js'), 'utf8'), {
    require: key => key.endsWith('apiAdapter') ? {
      ...adapter, call: async (name, payload) => { captured.push(payload); return { success: true, data: {} } }
    } : {}, module: { set exports(value) { api = value } }
  })
  await api.call('removeTeamMember', { _requestId: 'manual-retry', userId: 'member' })
  assert.equal(captured[0].config.requestId, 'manual-retry')
})

test('搜索或筛选的新请求不会被更晚返回的旧请求覆盖', async () => {
  const pending = []
  const { instance } = page('manage', () => new Promise(resolve => pending.push(resolve)))
  const old = instance.load(true)
  instance.data.keyword = '新'
  const latest = instance.load(true)
  pending[1]({ success: true, data: { items: [{ userId: 'new', role: 'member' }], total: 1, hasMore: false } })
  await latest
  pending[0]({ success: true, data: { items: [{ userId: 'old', role: 'member' }], total: 1, hasMore: false } })
  await old
  assert.equal(instance.data.items[0].userId, 'new')
})

test('编辑抽屉返回前台时重验权限，同时保留同版本编辑草稿', async () => {
  const { instance } = page('detail')
  instance._userId = 'member'
  await instance.load()
  instance.data.form.nickName = '尚未保存'
  await instance.load(true)
  assert.equal(instance.data.form.nickName, '尚未保存')
  assert.equal(instance.data.member.nickName, '成员')
})

test('网络失败保留表单和重试标识，不产生新的操作；权限失效清空资料', async () => {
  const { instance, requests } = page('detail', action => action === 'getManagedMemberDetail'
    ? { success: false, code: 403, message: '权限不足' }
    : { success: false, code: 503, message: '网络异常' })
  instance._userId = 'member'
  instance.data.member = { version: 1, permissions: { canEdit: true } }
  instance.data.form = { nickName: '草稿' }
  await instance.submit('updateManagedMember', { fields: { nickName: '草稿' } })
  await instance.submit('updateManagedMember', { fields: { nickName: '草稿' } })
  assert.equal(requests[0][1]._requestId, requests[1][1]._requestId)
  assert.equal(instance.data.form.nickName, '草稿')
  assert.equal(instance.data.saving, false)
  await instance.load(true)
  assert.equal(instance.data.member, null)
  assert.equal(Object.keys(instance.data.form).length, 0)
})

test('移出原因与最终确认分两步，确认前不调用写接口', async () => {
  const { instance, requests } = page('detail')
  await instance.load()
  instance.openRemove()
  await instance.remove()
  assert.equal(instance.data.removeStep, 'reason')
  instance.onReason({ detail: { value: '  毕业离组  ' } })
  assert.equal(instance.data.reasonValid, true)
  await instance.remove()
  assert.equal(instance.data.removeStep, 'confirm')
  assert.equal(requests.length, 1)
  instance.closeRemove()
  assert.equal(instance.data.removeVisible, true)
  assert.equal(instance.data.removeStep, 'reason')
  assert.equal(instance.data.removeReason, '  毕业离组  ')
  await instance.remove()
  await instance.remove()
  assert.equal(requests[1][0], 'removeTeamMember')
  assert.equal(requests[1][1].reason, '毕业离组')
})

test('移出遇到交接阻塞保留弹窗；提交期间不能重复提交或关闭', async () => {
  let resolve
  const { instance, requests } = page('detail', action => action === 'getManagedMemberDetail'
    ? { success: true, data: { userId: 'member', version: 1, permissions: { canRemove: true } } }
    : new Promise(done => { resolve = done }))
  await instance.load()
  instance.openRemove()
  instance.onReason({ detail: { value: '本人申请' } })
  await instance.remove()
  const pending = instance.remove()
  instance.closeRemove()
  await instance.remove()
  assert.equal(instance.data.removeVisible, true)
  assert.equal(requests.length, 2)
  resolve({ success: false, code: 409, message: '尚有待交接事项', data: { blockers: [{ id: 'task', type: 'maintenance', title: '待交接任务' }] } })
  await pending
  assert.equal(instance.data.blockers.length, 1)
  assert.equal(instance.data.removeReason, '本人申请')
  assert.equal(instance.data.removeVisible, true)
  assert.equal(instance.data.saving, false)
})

test('编辑抽屉只提交变化字段，保存成功留在详情并刷新', async () => {
  const { instance, requests, wx } = page('detail')
  let returned = false
  wx.showModal = async () => ({ confirm: true })
  wx.navigateBack = () => { returned = true }
  instance._userId = 'member'
  await instance.load()
  instance.edit()
  assert.equal(instance.data.editing, true)
  instance.data.form.nickName = '新昵称'
  await instance.save()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests[1][0], 'updateManagedMember')
  assert.deepEqual(Object.keys(requests[1][1].fields), ['nickName'])
  assert.equal(returned, false)
  assert.equal(instance.data.editing, false)
  assert.equal(requests[2][0], 'getManagedMemberDetail')
})

test('本人降为组员或移出后刷新身份并离开详情，不再请求管理资料', async () => {
  for (const action of ['changeMemberRole', 'removeTeamMember']) {
    const { instance, requests, member, wx, app } = page('detail', current => current === 'getManagedMemberDetail'
      ? { success: true, data: structuredClone(member) }
      : { success: true, data: { version: 2, removed: action === 'removeTeamMember' } })
    app.globalData.openid = member.openid
    let refreshed = false, returned = false
    app.refreshUserInfo = async options => { assert.equal(options.sync, false); refreshed = true }
    wx.navigateBack = () => { assert.equal(refreshed, true); returned = true }
    await instance.load()
    await instance.submit(action, action === 'changeMemberRole' ? { role: 'member' } : { reason: '本人退出' })
    assert.equal(returned, true)
    assert.equal(requests.length, 2)
  }
})

test('组长可通过角色入口调整组员、其他组长和管理员，确认文案显示真实角色', async () => {
  for (const role of ['member', 'leader', 'admin']) {
    const { instance, requests, member, wx } = page('detail')
    member.role = role
    member.permissions.canChangeRole = true
    await instance.load()
    instance.data.roleName = { member: '组员', leader: '组长', admin: '管理员' }[role]
    wx.showModal = async options => {
      assert.ok(options.content.includes('从' + instance.data.roleName + '调整为'))
      return { confirm: true }
    }
    await instance.changeRole()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests[1][0], 'changeMemberRole')
    assert.equal(requests[1][1].role, role === 'member' ? 'leader' : 'member')
  }
})

test('清空搜索和筛选会重新加载未筛选名单', async () => {
  const { instance, requests } = page('manage', () => ({ success: true, data: { items: [], total: 0, hasMore: false } }))
  Object.assign(instance.data, { keyword: '成员', departmentIndex: 1, roleIndex: 2 })
  instance.resetSearch()
  assert.equal(requests[0][1].keyword, '')
  assert.equal(requests[0][1].department, '')
  assert.equal(requests[0][1].role, '')
})

test('未保存编辑提示离开，恢复原值后解除提示', async () => {
  const { instance, wx } = page('detail')
  let guarded = false
  wx.enableAlertBeforeUnload = () => { guarded = true }
  wx.disableAlertBeforeUnload = () => { guarded = false }
  await instance.load()
  instance.edit()
  instance.data.form.nickName = '草稿'
  instance.updateLeaveAlert()
  assert.equal(guarded, true)
  instance.data.form.nickName = instance.data.member.nickName
  instance.updateLeaveAlert()
  assert.equal(guarded, false)
})


test('关闭编辑抽屉时确认丢弃草稿，保存期间禁止关闭', async () => {
  const { instance, wx } = page('detail')
  await instance.load()
  instance.edit()
  instance.data.form.nickName = '未保存'
  await instance.closeEdit()
  assert.equal(instance.data.editing, true)
  wx.showModal = async () => ({ confirm: true })
  instance.data.saving = true
  await instance.closeEdit()
  assert.equal(instance.data.editing, true)
  instance.data.saving = false
  await instance.closeEdit()
  assert.equal(instance.data.editing, false)
  instance.edit()
  assert.equal(instance.data.form.nickName, '成员')
})

test('抽屉保存失败保留草稿并可在原处重试', async () => {
  const { instance, member } = page('detail', action => action === 'getManagedMemberDetail'
    ? { success: true, data: structuredClone(member) }
    : { success: false, code: 503, message: '网络异常' })
  await instance.load()
  instance.edit()
  instance.data.form.nickName = '新昵称'
  await instance.save()
  assert.equal(instance.data.editing, true)
  assert.equal(instance.data.form.nickName, '新昵称')
  assert.equal(instance.data.error, '网络异常')
  assert.equal(instance.data.saving, false)
})
