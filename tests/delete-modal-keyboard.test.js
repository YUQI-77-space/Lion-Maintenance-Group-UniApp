// 仅本地验证键盘事件与删除守卫，不调用云函数。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page() {
  let definition, hidden = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/team/maintenance/detail/index.js'), 'utf8'), {
    Page: value => { definition = value; },
    getApp: () => ({ globalData: { role: 'leader' } }),
    require: () => ({}),
    wx: { hideKeyboard: () => { hidden++; }, showToast() {} }, console
  });
  const instance = { ...definition, data: { ...definition.data, showDeleteConfirmModal: true },
    setData(patch) { Object.assign(this.data, patch); } };
  return { instance, hidden: () => hidden };
}

test('删除确认键盘：升起、切换高度和收起均同步可用区域', () => {
  const { instance } = page();
  for (const height of [280, 360, 0, -10]) {
    instance.onDeleteKeyboardHeightChange({ detail: { height } });
    assert.equal(instance.data.deleteKeyboardHeight, Math.max(0, height));
  }
  instance.onDeleteKeyboardHeightChange({ detail: {} });
  assert.equal(instance.data.deleteKeyboardHeight, 0);
});

test('删除确认键盘：关闭后或页面销毁后忽略迟到事件', () => {
  const h = page();
  h.instance.data.deleteKeyboardHeight = 300;
  h.instance.cancelDeleteConfirm();
  assert.equal(h.hidden(), 1);
  assert.equal(h.instance.data.deleteKeyboardHeight, 0);
  h.instance.onDeleteKeyboardHeightChange({ detail: { height: 320 } });
  assert.equal(h.instance.data.deleteKeyboardHeight, 0);
  h.instance.onUnload();
  h.instance.data.showDeleteConfirmModal = true;
  h.instance.onDeleteKeyboardHeightChange({ detail: { height: 320 } });
  assert.equal(h.instance.data.deleteKeyboardHeight, 0);
});

test('删除确认键盘：页面隐藏清理高度，任务编号不匹配仍禁止删除', async () => {
  const { instance } = page();
  instance.data.deleteKeyboardHeight = 300;
  instance.onHide();
  assert.equal(instance.data.deleteKeyboardHeight, 0);
  instance.canManageTask = () => true;
  instance.data.taskToDelete = { maintenanceTaskId: '20261101' };
  instance.data.deleteConfirmInput = '错误编号';
  await instance.confirmDelete();
  assert.equal(instance.data.showDeleteConfirmModal, true);
  assert.equal(instance.data.deleting, false);
  assert.equal(instance.data.operationBusy, false);
});
