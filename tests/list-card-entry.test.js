// node --test tests/list-card-entry.test.js；纯本地脱敏测试，不访问云资源。
// 契约：入场延迟必须与卡片列表出现在同一次 setData 里。
// 否则页面先渲染出终态列表，再补 card-animate 把卡片拉回入场起点，用户会看到列表闪一下。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const miniprogram = path.resolve(__dirname, '../miniprogram');

function loadPage(name, options = {}) {
  let definition;
  const patches = [];
  const context = {
    Page: value => { definition = value; },
    Component: value => { definition = value; },
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    wx: {
      getStorageSync: () => null, setStorageSync() {}, showToast() {}, showLoading() {}, hideLoading() {},
      navigateTo() {}, navigateBack() {}, stopPullDownRefresh() {}, getWindowInfo: () => ({ windowWidth: 375 }),
      ...options.wx
    },
    getApp: () => ({
      globalData: { openid: 'example-openid', role: 'member', isLogin: true },
      subscribe: () => () => {}, publish() {}, checkPermission: () => true
    }),
    require: key => {
      if (key.includes('apiAdapter')) {
        return { generateRequestId: () => 'example-request', call: async () => options.result };
      }
      if (key.includes('swrCache')) return { get: () => ({ exists: false }), set() {}, clear() {} };
      if (key.includes('subscriptionAuth')) return { requestSubscribeMessage: async () => {} };
      if (key.includes('iconManager')) return { get: () => '' };
      if (key.includes('activityStatusManager')) {
        return { ActivityStatusManager: { processActivitiesForDisplay: list => list }, ActivityStatusMixin: {} };
      }
      if (key.includes('time')) return require('../miniprogram/utils/time');
      return new Proxy({}, { get: () => () => [] });
    }
  };

  vm.runInNewContext(fs.readFileSync(path.join(miniprogram, name), 'utf8'), context);
  const instance = {
    ...definition,
    ...(definition.methods || {}),
    data: structuredClone(definition.data || {}),
    setData(patch, callback) {
      patches.push(patch);
      for (const [key, value] of Object.entries(patch)) {
        const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        keys.slice(0, -1).forEach(part => { target = target[part] || (target[part] = {}); });
        target[keys.at(-1)] = value;
      }
      if (callback) callback();
    }
  };
  return { instance, patches };
}

// 列表写入与入场延迟同批：返回承载列表的那次 setData
function listPatch(patches, listKey) {
  return patches.find(patch => Array.isArray(patch[listKey]));
}

for (const [name, listKey, delaysKey, result] of [
  ['pages/team/maintenance/list/index.js', 'allTasks', 'cardDelays', { success: true, data: { tasks: [{ maintenanceTaskId: 'a' }, { maintenanceTaskId: 'b' }] } }],
  ['pages/team/volunteer/list/index.js', 'activities', 'cardDelays', { success: true, data: { activities: [{ activityId: 'a' }, { activityId: 'b' }] } }],
  ['pages/team/volunteer/manage/index.js', 'activities', 'cardDelays', { success: true, data: { activities: [{ activityId: 'a' }, { activityId: 'b' }] } }],
  ['pages/user/todo/index.js', 'maintenanceTasks', 'maintenanceDelays', { success: true, data: [{ taskId: 'a' }, { taskId: 'b' }] }]
]) {
  const loads = {
    'pages/team/maintenance/list/index.js': instance => instance.loadMaintenanceTasks(true),
    'pages/team/volunteer/list/index.js': instance => instance.getActivitiesList(true),
    'pages/team/volunteer/manage/index.js': instance => instance.getActivitiesList(true),
    'pages/user/todo/index.js': instance => instance.loadMaintenanceTasks()
  };

  test(`${path.dirname(name).replace('pages/', '')} 列表与入场延迟同批下发`, async () => {
    const { instance, patches } = loadPage(name, { result });
    instance.data.hasMore = true;
    await loads[name](instance);

    const withList = listPatch(patches, listKey);
    assert.ok(withList, '应写入列表数据');
    assert.ok(withList[listKey].length > 0);
    assert.ok(delaysKey in withList, '入场延迟必须和列表在同一次 setData');
    assert.equal(Object.keys(withList[delaysKey]).length, withList[listKey].length);
    assert.deepEqual(Object.values(withList[delaysKey]).slice(0, 2), [0, 180]);

    // 列表写入之后不得再单独补延迟：那正是先闪终态再回退到入场起点的成因
    const after = patches.slice(patches.indexOf(withList) + 1);
    assert.ok(after.every(patch => !(delaysKey in patch)), '列表渲染后不应再单独下发延迟');
  });
}

test('页面不再提供两段式入场方法', () => {
  for (const name of [
    'pages/team/maintenance/list/index.js',
    'pages/team/maintenance/manage/index.js',
    'pages/team/volunteer/list/index.js',
    'pages/team/volunteer/manage/index.js',
    'pages/user/todo/index.js'
  ]) {
    const source = fs.readFileSync(path.join(miniprogram, name), 'utf8');
    assert.ok(!/triggerCardAnimation/.test(source), `${name} 不应再有 triggerCardAnimation`);
    assert.match(source, /buildCardDelays/);
  }
});
