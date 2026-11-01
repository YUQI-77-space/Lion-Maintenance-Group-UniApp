// node --test tests/maintenance-list-display.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const time = require('../miniprogram/utils/time');
for (const page of ['list', 'manage']) {
const source = fs.readFileSync(require.resolve('../miniprogram/pages/team/maintenance/' + page + '/index.js'), 'utf8');
const context = { getApp: () => ({}), Page: () => {}, require: name => name.endsWith('/time') ? time : name.endsWith('/iconManager') ? { get: value => value } : {} };
vm.createContext(context);
vm.runInContext(source, context);

test(page + ' 申请时间格式化保留业务字段，缺失及无效时间不冒充当前时间', () => {
  const task = { level3: '笔记本清灰', taskStatus: 'completed', createTime: '2026-10-25 14:30:00' };
  const result = context.formatTask(task);
  assert.equal(result.createTimeFormatted, '2026-10-25 14:30');
  assert.equal(result.level3, task.level3);
  assert.equal(result.createTime, task.createTime);
  assert.equal(result.taskStatusText, '已完成');
  assert.equal(task.createTimeFormatted, undefined);
  for (const createTime of [undefined, null, '', 'invalid', NaN]) {
    assert.equal(context.formatTask({ createTime }).createTimeFormatted, '暂无记录');
  }
});

}

// 执行模板里的真实互斥条件，防止历史终态再次回落到无票根旧卡片。
test('历史任务按业务状态直接展示票根终态，只读及取消记录不可认领', () => {
  const template = fs.readFileSync(require.resolve('../miniprogram/pages/team/maintenance/list/index.wxml'), 'utf8');
  const branches = [...template.matchAll(/<view class="(ticket-stub[^\"]*)"\s+wx:(?:if|elif)="\{\{([^}]+)\}\}"([^>]*)>/g)];
  assert.equal(branches.length, 3);
  function render(taskStatus, readOnly, tornTaskIds = {}) {
    const branch = branches.find(([, , expression]) => vm.runInNewContext(expression, {
      item: { maintenanceTaskId: 'legacy', taskStatus }, readOnly, tornTaskIds
    }));
    return branch && { classes: branch[1], interactive: /catchtap="claimTask"/.test(branch[3]) };
  }
  for (const readOnly of [false, true]) {
    for (const status of ['inProgress', 'completed']) {
      const result = render(status, readOnly);
      assert.match(result.classes, /ticket-stub--torn/, `${status} 无动画历史标记也必须显示撕痕`);
      assert.equal(result.interactive, false);
    }
    assert.match(render('cancelled', readOnly).classes, /ticket-stub--inactive/);
    assert.equal(render('cancelled', readOnly).interactive, false);
    assert.equal(render('unknown', readOnly), undefined, '未知状态不能推断为已受理或可认领');
    assert.equal(render(undefined, readOnly), undefined);
  }
  assert.equal(render('pending', false).interactive, true);
  assert.match(render('pending', true).classes, /ticket-stub--inactive/);
  assert.equal(render('pending', true).interactive, false);
  assert.match(render('completed', false, { legacy: true }).classes, /ticket-stub--torn/, '终态不依赖残留动画标记');
});
