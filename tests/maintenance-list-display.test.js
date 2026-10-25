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
