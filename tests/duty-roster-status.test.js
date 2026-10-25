// 本地展示状态回归，不调用云函数或写入真实值班记录。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('值班网格以文字区分预选、待确认、本人确认，并保留他人占用', () => {
  let page;
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/team/duty/roster/index.js', 'utf8'), {
    Page: value => { page = value; },
    require: name => name.includes('iconManager') ? { get: () => '' } : {},
    getApp: () => ({ globalData: { userInfo: { openid: 'example-self' } } })
  });
  const slot = id => ({ slotData: { dutySlotId: id, isAvailable: true } });
  page.data.configData = { isEditingEnabled: true };
  page.data.selectedSlots = ['local', 'occupied'];
  page.data.userSlots = { confirmedSlots: [{ dutySlotId: 'confirmed' }], preSelectedSlots: [{ dutySlotId: 'pending' }] };
  const occupied = slot('occupied');
  occupied.slotData.dutyHolderName = '测试成员';
  page.data.tableData = [{ dailySlots: [slot('available'), slot('local'), slot('pending'), slot('confirmed'), occupied] }];
  page.setData = patch => Object.assign(page.data, patch);
  page.updateTableDisplayStatus();
  assert.deepEqual(Array.from(page.data.tableData[0].dailySlots, item => item.statusText), ['可选', '已预选', '待确认', '已确认', '测试成员已占用']);
  assert.equal(page.data.tableData[0].dailySlots[3].canSelect, false);
  assert.equal(page.data.tableData[0].dailySlots[4].canSelect, false);
  page.data.selectedSlots = [];
  page.updateTableDisplayStatus();
  assert.equal(page.data.tableData[0].dailySlots[1].statusText, '可选');
});
