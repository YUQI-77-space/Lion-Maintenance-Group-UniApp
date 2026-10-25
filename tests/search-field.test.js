// node --test tests/search-field.test.js；仅本地事件与页面逻辑，不访问云端。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(`miniprogram/${file}`, 'utf8');
function load(file, component = false) {
  let definition;
  const stub = new Proxy({}, { get: () => () => '' });
  vm.runInNewContext(read(file), {
    Component: value => { definition = value; }, Page: value => { definition = value; },
    getApp: () => ({ globalData: {} }), wx: {}, console, setTimeout, clearTimeout,
    require: name => name.includes('activityStatusManager') ? { ActivityStatusMixin: {} } : stub
  });
  const instance = { ...definition, ...(component ? definition.methods : {}),
    data: { ...(definition.data || {}), ...(component ? { value: '' } : {}) },
    events: [], setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { this.events.push({ name, detail }); }
  };
  return instance;
}
test('连续输入、图标与键盘确认传递最新值；外部回填仍可搜索', () => {
  const field = load('components/search-field/index.js', true);
  field.onInput({ detail: { value: '清灰', cursor: 2 } });
  field.onConfirm();
  assert.equal(field.events[0].detail.value, '清灰');
  assert.equal(field.events[1].name, 'confirm');
  assert.equal(field.events[1].detail.value, '清灰');
  field.setData({ value: '电风扇' });
  field.onConfirm();
  assert.equal(field.events[2].detail.value, '电风扇');
});
test('清空只分发一次 clear，焦点与失焦保留原生事件内容，图标失败有回退', () => {
  const field = load('components/search-field/index.js', true);
  field.setData({ value: '旧关键词' });
  field.onClear();
  assert.equal(field.data.value, '');
  assert.equal(field.events.length, 1);
  assert.equal(field.events[0].name, 'clear');
  assert.equal(field.events[0].detail.value, '');
  field.onFocus({ detail: { height: 300 } });
  field.onBlur({ detail: { value: '' } });
  assert.equal(field.events[1].detail.height, 300);
  assert.equal(field.events[2].name, 'blur');
  field.onIconError();
  assert.equal(field.data.iconFailed, true);
});
test('志愿活动清空不回退到旧关键词，重置分页且保留状态筛选', () => {
  const page = load('pages/team/volunteer/manage/index.js');
  page.setData({ searchKeyword: '旧关键词', currentStatus: 'ended', page: 3 });
  let count = 0;
  page.getActivitiesList = () => { count++; };
  page.triggerCardAnimation = () => {};
  page.handleSearchConfirm({ detail: { value: '' } });
  assert.equal(page.data.searchKeyword, '');
  assert.equal(page.data.currentStatus, 'ended');
  assert.equal(page.data.page, 1);
  assert.equal(page.data.hasMore, true);
  assert.equal(page.data.activities.length, 0);
  assert.equal(count, 1);
});
test('维修任务与功能页清空恢复原列表，保留业务筛选', () => {
  for (const [file, clear, source, target] of [
    ['pages/team/maintenance/manage/index.js', 'clearSearchInput', 'originalFilteredTasks', 'filteredTasks'],
    ['pages/team/home/more/index.js', 'clearSearch', 'allFunctions', 'functions']
  ]) {
    const page = load(file);
    const items = [{ id: 'example' }];
    page.setData({ searchKeyword: '旧关键词', activeTab: 'completed', [source]: items });
    page[clear]();
    assert.equal(page.data.searchKeyword, '');
    assert.equal(page.data.activeTab, 'completed');
    assert.equal(page.data[target], items);
  }
});
