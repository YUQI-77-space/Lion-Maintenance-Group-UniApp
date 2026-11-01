// 纯本地行为回归：消息操作成功即同步徽标，旧查询不能覆盖新计数。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  let app, page, modal;
  const calls = [], counts = [];
  let respond = async () => ({ success: true });
  const context = {
    console: { log() {}, warn() {}, error() {} },
    App: value => { app = value; },
    Page: value => { page = value; },
    getApp: () => app,
    wx: { showToast() {}, showModal: value => { modal = value; } },
    require: key => {
      if (key.includes('apiAdapter')) return { call: (name, payload) => {
        calls.push(payload);
        return respond(payload);
      } };
      if (key.includes('loading')) return { show() {}, hide() {} };
      if (key.includes('time')) return { formatToMinute: () => '' };
      return {};
    }
  };
  function load(file) {
    const source = fs.readFileSync(path.join(__dirname, '../miniprogram', file), 'utf8');
    vm.runInNewContext(`(function() {\n${source}\n})();`, context);
  }
  load('app.js');
  app.globalData = { openid: 'self', unreadMessageCount: 2, messageUpdateCallback: count => counts.push(count) };
  load('pages/user/message/index.js');
  page.data = { ...page.data, userOpenid: 'self', messages: [{ isRead: false }, { isRead: false }], messageNumber: 2 };
  page.setData = patch => Object.assign(page.data, patch);
  return { app, page, calls, counts, respond: fn => { respond = fn; }, confirm: () => modal.success({ confirm: true }) };
}

for (const action of ['single', 'all', 'clear']) {
  for (const success of [true, false]) {
    test(`消息操作 ${action} ${success ? '成功立即同步且不追加查询' : '失败保留徽标'}`, async () => {
      const h = harness();
      h.app._lastUnreadAt = Date.now(); // 复现 10 秒 TTL 内操作。
      h.respond(async () => ({ success }));
      if (action === 'single') await h.page.markAsRead({ currentTarget: { dataset: { index: 0 } } });
      if (action === 'all') await h.page.markAllAsRead();
      if (action === 'clear') { h.page.clearAllMessages(); await h.confirm(); }
      assert.equal(h.app.globalData.unreadMessageCount, success ? (action === 'single' ? 1 : 0) : 2);
      assert.equal(h.calls.length, 1);
      assert.deepEqual(h.counts, success ? [action === 'single' ? 1 : 0] : []);
      assert.equal(h.page._writingMessages, false);
    });
  }
}

test('消息操作 连续点击只提交一次，失败后允许重试', async () => {
  const h = harness(), request = deferred();
  h.respond(() => request.promise);
  const first = h.page.markAllAsRead();
  await h.page.markAllAsRead();
  h.page.clearAllMessages();
  assert.equal(h.calls.length, 1);
  request.resolve({ success: false });
  await first;
  h.respond(async () => ({ success: true }));
  await h.page.markAllAsRead();
  assert.equal(h.app.globalData.unreadMessageCount, 0);
});

test('跨页计数 旧全局查询不能覆盖已读后的即时计数', async () => {
  const h = harness(), request = deferred();
  h.respond(() => request.promise);
  const query = h.app.getUnreadMessageCount();
  h.app.updateUnreadMessageCount(0, 'self');
  request.resolve({ success: true, data: { messages: [{ isRead: false }] } });
  await query;
  assert.equal(h.app.globalData.unreadMessageCount, 0);
  assert.deepEqual(h.counts, [0]);
  await h.app.getUnreadMessageCount();
  assert.equal(h.calls.length, 1, '返回我的页时应复用刚同步的计数');
});

test('跨页计数 旧消息列表不能覆盖清空后的列表和徽标', async () => {
  const h = harness(), request = deferred();
  h.respond(payload => payload.action === 'getMessage' ? request.promise : Promise.resolve({ success: true }));
  const query = h.page.loadMessages();
  h.page.clearAllMessages();
  await h.confirm();
  request.resolve({ success: true, data: { messages: [{ isRead: false }], messageNumber: 1 } });
  await query;
  assert.equal(h.page.data.messages.length, 0);
  assert.equal(h.app.globalData.unreadMessageCount, 0);
});

test('跨页计数 消息加载复用已有响应，空列表同步为零', async () => {
  const h = harness();
  h.respond(async () => ({ success: true, data: { messages: [], messageNumber: 0 } }));
  await h.page.loadMessages();
  assert.equal(h.app.globalData.unreadMessageCount, 0);
  assert.equal(h.calls.length, 1);
});

test('跨页计数 全局查询先返回时消息列表仍正常加载', async () => {
  const h = harness(), request = deferred();
  h.respond(() => request.promise);
  const query = h.page.loadMessages();
  h.app.updateUnreadMessageCount(1, 'self');
  request.resolve({ success: true, data: { messages: [{ isRead: false }], messageNumber: 1 } });
  await query;
  assert.equal(h.page.data.messages.length, 1);
  assert.equal(h.page.data.messageNumber, 1);
});

test('跨页计数 账号切换后忽略旧账号结果', async () => {
  const h = harness(), request = deferred();
  h.respond(() => request.promise);
  const query = h.app.getUnreadMessageCount();
  h.app.globalData.openid = 'other';
  h.app.updateUnreadMessageCount(0, 'self');
  request.resolve({ success: true, data: { messages: [] } });
  await query;
  assert.equal(h.app.globalData.unreadMessageCount, 2);
  assert.deepEqual(h.counts, []);
});
