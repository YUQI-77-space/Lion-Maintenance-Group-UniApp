// 运行：node --test tests/tabbar.test.js；只检查组件状态时序，不访问云资源。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const memberTabs = ['home/index', 'team/home/index', 'repair/index', 'user/profile/index']
  .map(route => ({ pagePath: `pages/${route}` }));
const userTabs = memberTabs.filter(tab => !tab.pagePath.includes('team/'));

function setup(tabs = memberTabs) {
  let definition;
  let pages = [];
  const listeners = new Set();
  const switches = [];
  const toasts = [];
  const wx = { switchTab: options => switches.push(options), showToast: value => toasts.push(value) };
  const app = {
    globalData: { currentTabs: tabs },
    subscribe(event, callback) {
      assert.equal(event, 'tabsChanged');
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
  const context = {
    module: { exports: {} },
    Component: value => { definition = value; },
    getApp: () => app,
    getCurrentPages: () => pages,
    wx,
    console: { error() {} }
  };
  vm.runInNewContext(fs.readFileSync('miniprogram/utils/router.js', 'utf8'), {
    ...context, require: () => ({ getTab: name => name })
  });
  const router = context.module.exports;
  vm.runInNewContext(fs.readFileSync('miniprogram/custom-tab-bar/index.js', 'utf8'), {
    ...context, require: name => name.includes('router') ? router : { getLayout: () => ({ safeBottom: 34 }) }
  });
  function create(route, ownerReady = true) {
    const frames = [];
    const renders = [];
    const bar = {
      ...definition.methods, data: structuredClone(definition.data),
      setData(patch, callback) {
        Object.assign(this.data, patch);
        frames.push(structuredClone(this.data));
        if (callback) renders.push(callback);
      }
    };
    const page = { route, getTabBar: () => ownerReady ? bar : null };
    pages = [page];
    definition.lifetimes.attached.call(bar);
    return {
      bar, page, frames,
      render: () => renders.splice(0).forEach(callback => callback()),
      show: () => { pages = [page]; definition.pageLifetimes.show.call(bar); },
      hide: () => definition.pageLifetimes.hide.call(bar),
      detach: () => definition.lifetimes.detached.call(bar)
    };
  }
  return { create, switches, toasts, wx, router, definition,
    publish(next) {
      app.globalData.currentTabs = next;
      listeners.forEach(callback => callback(next));
    }
  };
}

function tap(bar, pagePath) {
  bar.onTap({ currentTarget: { dataset: { url: `/${pagePath}` } } });
}

for (const tabs of [userTabs, memberTabs]) {
  test(`${tabs.length} 个导航：每个入口首次提交即选中正确按钮，无默认首页中间帧`, () => {
    const env = setup(tabs);
    for (const [index, tab] of tabs.entries()) {
      const { bar, frames } = env.create(tab.pagePath);
      assert.equal(frames.length, 1);
      assert.equal(frames[0].selected, index);
      assert.equal(bar.data.safeBottom, 34);
    }
  });

  test(`${tabs.length} 个导航：全部切换组合、重复点击及旧实例回调`, () => {
    for (const from of tabs) for (const to of tabs) {
      const env = setup(tabs);
      const source = env.create(from.pagePath);
      tap(source.bar, to.pagePath);
      if (from === to) {
        assert.equal(source.frames.length, 1);
        assert.equal(env.switches.length, 0);
        continue;
      }
      assert.equal(source.bar.data.selected, tabs.indexOf(to));
      assert.equal(env.switches.length, 1, '导航立即启动，不等待旧页渲染完成');
      tap(source.bar, tabs[0].pagePath);
      source.render();
      assert.equal(env.switches.length, 1, '跳转中防重');
      source.hide();
      assert.equal(source.bar.data.selected, tabs.indexOf(from), '隐藏时即恢复所属页，重现前没有错误选中帧');
      const target = env.create(to.pagePath);
      const before = source.frames.length;
      env.switches[0].complete();
      assert.equal(source.frames.length, before, '成功不污染隐藏实例');
      assert.equal(target.frames[0].selected, tabs.indexOf(to));
      source.bar.forceRefresh();
      assert.equal(source.bar.data.selected, tabs.indexOf(from), '隐藏实例刷新仍使用所属路由');
      source.show();
      assert.equal(source.bar.data.selected, tabs.indexOf(from));
      assert.equal(env.router.isTabSwitching(), false);
    }
  });
}

test('角色增减导航时，列表与选中项原子更新；移除所属入口后不误选其他项', () => {
  const env = setup(userTabs);
  const source = env.create('pages/repair/index');
  env.create('pages/home/index');
  env.publish(memberTabs);
  assert.equal(source.frames.at(-1).tabs.length, 4);
  assert.equal(source.frames.at(-1).selected, 2);
  env.publish(userTabs);
  assert.equal(source.frames.at(-1).tabs.length, 3);
  assert.equal(source.frames.at(-1).selected, 1);
  const team = env.create('pages/team/home/index');
  assert.equal(team.bar.data.selected, -1);
  team.detach();
  const before = team.frames.length;
  env.publish(memberTabs);
  assert.equal(team.frames.length, before);
});

test('所属页尚未绑定时不猜选中项，页面 onShow 提供路由后一次纠正', () => {
  const env = setup();
  const source = env.create('pages/home/index', false);
  assert.equal(source.frames[0].selected, -1);
  source.bar.setSelectedByRoute('pages/repair/index');
  assert.equal(source.bar.data.selected, 2);
  source.bar.forceRefresh();
  assert.equal(source.bar.data.selected, 2);
});

test('跳转失败恢复原选中项并解锁，禁用及非法入口不导航', () => {
  const env = setup();
  const source = env.create('pages/repair/index');
  source.bar.setInteractionLocked(true);
  tap(source.bar, 'pages/home/index');
  assert.equal(env.router.isTabSwitching(), false);
  source.bar.setInteractionLocked(false);
  tap(source.bar, 'pages/not-a-tab/index');
  assert.equal(env.router.isTabSwitching(), false);
  tap(source.bar, 'pages/home/index');
  source.render();
  env.switches[0].fail(new Error('跳转失败'));
  env.switches[0].complete();
  assert.equal(source.bar.data.selected, 2);
  assert.equal(env.router.isTabSwitching(), false);
  assert.equal(env.toasts.length, 1);
  tap(source.bar, 'pages/user/profile/index');
  source.render();
  assert.equal(env.switches.length, 2);
});

test('跨页面实例及业务路由共享锁，旧请求完成不能释放新请求的锁', () => {
  const env = setup();
  const source = env.create('pages/home/index');
  tap(source.bar, 'pages/repair/index');
  const target = env.create('pages/repair/index');
  tap(target.bar, 'pages/user/profile/index');
  assert.equal(target.bar.data.selected, 2, '被防重时不错误高亮');
  assert.equal(env.router.switchTab('/pages/team/home/index'), false);
  assert.equal(env.switches.length, 1);
  env.switches[0].fail(new Error('失败'));
  tap(target.bar, 'pages/user/profile/index');
  assert.equal(env.switches.length, 2);
  env.switches[0].complete();
  assert.equal(env.router.isTabSwitching(), true, '迟到 complete 不释放另一次导航');
  env.switches[1].complete();
  assert.equal(env.router.isTabSwitching(), false);
});

test('原生导航同步异常能恢复并重试；路由过滤非法及当前页', () => {
  const env = setup();
  const source = env.create('pages/home/index');
  assert.equal(env.router.switchTab('/pages/not-a-tab/index'), false);
  assert.equal(env.router.switchTab(null), false);
  assert.equal(env.router.switchTab('/pages/home/index'), false);
  const original = env.wx.switchTab;
  env.wx.switchTab = () => { throw new Error('原生异常'); };
  tap(source.bar, 'pages/repair/index');
  assert.equal(source.bar.data.selected, 0);
  assert.equal(env.router.isTabSwitching(), false);
  env.wx.switchTab = original;
  tap(source.bar, 'pages/repair/index');
  assert.equal(env.switches.length, 1);
});
