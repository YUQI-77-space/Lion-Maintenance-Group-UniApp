// node --test tests/loading.test.js；不访问云端。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, globals = {}) {
  const module = { exports: {} };
  let definition;
  vm.runInNewContext(fs.readFileSync(`miniprogram/${file}`, 'utf8'), {
    module, Promise, Set, getCurrentPages: () => [],
    Component: value => { definition = value; },
    Behavior: value => value, ...globals
  });
  return definition || module.exports;
}

test('等待弹层支持显示前挂载、文案更新、遮罩、重复关闭及页面归属清理', async () => {
  const first = {}, second = {};
  let pages = [first];
  const loading = load('utils/loading.js', { getCurrentPages: () => pages });
  const events = [];
  await loading.show({ title: '保存中', mask: true, success: result => events.push(result.errMsg) });
  const unsubscribe = loading.subscribe(() => events.push(loading.getState(first).visible));
  assert.equal(loading.getState(first).title, '保存中');
  assert.equal(loading.getState(first).mask, true);
  assert.equal(events[0], 'showLoading:ok');
  assert.equal(events[1], true);
  await loading.show({ title: '下载中' });
  assert.equal(loading.getState(first).title, '下载中');
  assert.equal(loading.getState(first).mask, false);
  assert.equal(loading.getState(second).visible, false);
  pages = [first, second];
  await loading.show({ mask: true });
  loading.clear(first);
  assert.equal(loading.getState(second).visible, true);
  loading.clear(second);
  assert.equal(loading.getState(second).visible, false);
  unsubscribe();
  const count = events.length;
  await loading.hide();
  await loading.hide();
  assert.equal(events.length, count);
});

test('弹层在页面隐藏、组件卸载时清理，卸载退订；动画后台暂停', () => {
  const page = {};
  const loading = load('utils/loading.js', { getCurrentPages: () => [page] });
  const overlay = load('components/loading-overlay/index.js', {
    getCurrentPages: () => [page], require: () => loading
  });
  const instance = { data: {}, setData(patch) { Object.assign(this.data, patch); } };
  overlay.lifetimes.attached.call(instance);
  loading.show({ title: '提交中' });
  assert.equal(instance.data.visible, true);
  overlay.pageLifetimes.hide.call(instance);
  assert.equal(instance.data.visible, false);
  overlay.lifetimes.detached.call(instance);
  loading.show();
  assert.equal(instance.data.visible, false);
  const animation = load('components/loading-animation/index.js');
  animation.pageLifetimes.hide.call(instance);
  assert.equal(instance.data.paused, true);
  animation.pageLifetimes.show.call(instance);
  assert.equal(instance.data.paused, false);
});

test('自定义刷新防重，转发滚动和触底，完成或失败后停止', async () => {
  const behavior = load('utils/pageRefresh.js');
  let done, calls = 0, bottom = 0, top;
  const instance = {
    data: { unifiedRefreshing: false },
    setData(patch) { Object.assign(this.data, patch); },
    onPullDownRefresh() { calls++; return new Promise(resolve => { done = resolve; }); },
    onPageScroll(event) { top = event.scrollTop; },
    onReachBottom() { bottom++; }
  };
  behavior.methods.onUnifiedRefresh.call(instance);
  behavior.methods.onUnifiedRefresh.call(instance);
  assert.equal(calls, 1);
  assert.equal(instance.data.unifiedRefreshing, true);
  done();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.data.unifiedRefreshing, false);
  behavior.methods.onUnifiedScroll.call(instance, { detail: { scrollTop: 150 } });
  behavior.methods.onUnifiedBottom.call(instance);
  assert.equal(top, 150);
  assert.equal(bottom, 1);
  instance.onPullDownRefresh = () => Promise.reject(new Error('请求失败'));
  behavior.methods.onUnifiedRefresh.call(instance);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.data.unifiedRefreshing, false);
});

test('全量页面挂载弹层，旧动画与系统 loading 调用清零，刷新使用自定义槽', () => {
  const root = path.resolve('miniprogram');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  for (const route of app.pages) {
    assert.match(fs.readFileSync(path.join(root, route + '.wxml'), 'utf8'), /<loading-overlay\s+id="global-loading"\s*\/>/, route);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(root, route + '.json'))).enablePullDownRefresh, true, route);
  }
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  }
  for (const file of walk(root)) {
    if (!/\.(js|wxml|wxss)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /wx\.(?:showLoading|hideLoading|showNavigationBarLoading)\s*\(|typing-circle|typing-shadow|@keyframes\s+(?:spin|rotation)\b/, file);
    for (const tag of text.match(/<button\b[^>]*>/g) || []) assert.doesNotMatch(tag, /\sloading=/, file);
    for (const tag of text.match(/<scroll-view\b[^>]*>/g) || []) {
      if (tag.includes('refresher-enabled')) assert.match(tag, /refresher-default-style="none"/, file);
    }
  }
});
