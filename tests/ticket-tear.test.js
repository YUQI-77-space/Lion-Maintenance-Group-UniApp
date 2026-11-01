// node --test tests/ticket-tear.test.js；纯本地脱敏测试，不访问云资源。
// 契约：认领成功后先播 460ms 撕拉动画，再刷新列表；刷新不能打断动画，
// 服务端已受理的事实也不能依赖动画结束才成立（动画只是表现层）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const miniprogram = path.resolve(__dirname, '../miniprogram');
const PAGE = 'pages/team/maintenance/list/index.js';

function harness(options = {}) {
  let definition;
  const patches = [];
  const timers = [];
  const calls = [];
  const toasts = [];
  const refreshes = [];
  const context = {
    Page: value => { definition = value; },
    Component() {},
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    wx: {
      getStorageSync: () => null, setStorageSync() {}, showLoading() {}, hideLoading() {},
      getWindowInfo: () => ({ windowWidth: 375 }),
      showModal: async () => ({ confirm: options.confirm !== false }),
      showToast: value => toasts.push(value),
      ...options.wx
    },
    getApp: () => ({ globalData: { openid: 'self-openid', role: 'member', isLogin: true }, subscribe: () => () => {}, publish() {}, checkPermission: () => true }),
    require: key => {
      if (key.includes('apiAdapter')) {
        return {
          generateRequestId: () => 'example-request',
          call: async (name, payload) => {
            calls.push({ name, payload });
            return options.call ? options.call(payload) : { success: true };
          }
        };
      }
      if (key.includes('memberStatus')) return { canWrite: () => options.canWrite !== false, isRetired: () => false };
      if (key.includes('subscriptionAuth')) return { requestAssigneeAuth: async () => {} };
      if (key.includes('swrCache')) return { get: () => ({ exists: false }), set() {}, clear() {} };
      if (key.includes('time')) return require('../miniprogram/utils/time');
      return new Proxy({}, { get: () => () => [] });
    }
  };

  vm.runInNewContext(fs.readFileSync(path.join(miniprogram, PAGE), 'utf8'), context);
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
    },
    loadMaintenanceTasks: async () => { refreshes.push(Date.now()); }
  };
  return { instance, patches, timers, calls, toasts, refreshes };
}

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

test('认领成功先撕票根（460ms）再刷新列表，动画不决定状态', async () => {
  const { instance, timers, calls, refreshes } = harness({
    call: payload => payload.action === 'getMaintenanceTaskDetail'
      ? { success: true, data: { taskStatus: 'pending' } }
      : { success: true }
  });
  instance.data.allTasks = [{ maintenanceTaskId: 'T1', applicantId: 'other-openid', taskStatus: 'pending' }];

  const pending = instance.claimTask({ currentTarget: { dataset: { taskId: 'T1' } } });
  await flush();

  assert.equal(calls.some(call => call.payload.action === 'assignMaintenanceTask'), true);
  assert.equal(instance.data.tornTaskIds.T1, true, '应立刻进入撕拉态');
  assert.equal(refreshes.length, 0, '动画期间不得刷新，否则会打断撕拉');
  const tear = timers.find(timer => timer.ms > 0 && timer.ms <= 460);
  assert.ok(tear, '补足动画等待不得超过 WXSS 的 460ms');

  tear.fn();
  await pending;
  assert.equal(refreshes.length, 1, '撕完再刷新');
  assert.equal(instance.data.tornTaskIds.T1, false, '刷新后清理动画标记');
});

test('受理失败不播放撕拉，直接刷新核对', async () => {
  const { instance, timers, refreshes, toasts } = harness({
    call: payload => payload.action === 'getMaintenanceTaskDetail'
      ? { success: true, data: { taskStatus: 'pending' } }
      : { success: false, message: '任务已被受理' }
  });
  instance.data.allTasks = [{ maintenanceTaskId: 'T1', applicantId: 'other-openid', taskStatus: 'pending' }];

  await instance.claimTask({ currentTarget: { dataset: { taskId: 'T1' } } });

  assert.equal(instance.data.tornTaskIds.T1, undefined);
  assert.equal(timers.length, 0, '失败结果无需等待动画再刷新');
  assert.equal(refreshes.length, 1);
  assert.equal(toasts.at(-1).title, '任务已被受理');
});

test('不能受理自己的报修，已撕下的票根不响应二次点击', async () => {
  const own = harness({});
  own.instance.data.allTasks = [{ maintenanceTaskId: 'T2', applicantId: 'self-openid', taskStatus: 'pending' }];
  await own.instance.claimTask({ currentTarget: { dataset: { taskId: 'T2' } } });
  assert.equal(own.calls.length, 0);
  assert.equal(own.toasts.at(-1).title, '不能受理自己的报修');

  const retap = harness({});
  retap.instance.data.tornTaskIds = { T3: true };
  retap.instance.data.allTasks = [{ maintenanceTaskId: 'T3', applicantId: 'other-openid', taskStatus: 'pending' }];
  await retap.instance.claimTask({ currentTarget: { dataset: { taskId: 'T3' } } });
  assert.equal(retap.calls.length, 0);
});

test('已退休或不可写状态不触发认领', async () => {
  const { instance, calls } = harness({ canWrite: false });
  instance.data.allTasks = [{ maintenanceTaskId: 'T4', applicantId: 'other-openid', taskStatus: 'pending' }];
  await instance.claimTask({ currentTarget: { dataset: { taskId: 'T4' } } });
  assert.equal(calls.length, 0);
});

test('票根结构与撕拉样式满足交互契约', () => {
  const wxml = fs.readFileSync(path.join(miniprogram, 'pages/team/maintenance/list/index.wxml'), 'utf8');
  assert.match(wxml, /class="ticket-stub[^"]*"[\s\S]*?catchtap="claimTask"/, '票根承载认领点击');
  assert.match(wxml, /aria-label="认领任务/, '票根需要可读名称');
  assert.doesNotMatch(wxml, /task-footer|btn-claim/, '认领不再是卡片底部的独立按钮行');

  const wxss = fs.readFileSync(path.join(miniprogram, 'pages/team/maintenance/list/index.wxss'), 'utf8');
  assert.match(wxss, /\.ticket-stub \{[\s\S]*?flex: 0 0 96rpx/, '票根宽度 96rpx＝48px 热区');
  assert.match(wxss, /@keyframes ticket-tear-wipe[\s\S]*?height: 100%/, '撕拉从顶部生长到整条票根');
  assert.match(wxss, /prefers-reduced-motion: reduce[\s\S]*?ticket-stub\.is-tearing[\s\S]*?animation: none/, '减少动效时直接呈现撕痕');
});
