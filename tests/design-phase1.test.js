// 运行：node --test tests/design-phase1.test.js
// 仅验证本阶段的页面显示事件和既有操作合同，不访问云资源。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(route, role = 'member', images = {}) {
  let definition;
  const calls = [];
  const wx = {
    getStorageSync: () => role,
    showModal: value => calls.push(['modal', value]),
    navigateBack: () => calls.push(['back']),
    navigateTo: value => calls.push(['navigate', value.url]),
    setNavigationBarTitle() {},
    setClipboardData: value => calls.push(['copy', value.data]),
    stopPullDownRefresh() {},
    showToast() {}
  };
  const app = { globalData: { role } };
  const file = path.resolve('miniprogram', route + '.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: name => {
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), name + '.js')), name);
      return name.includes('iconManager') ? { get: name => name } : images;
    }, console, Date
  });
  const page = { ...definition, data: structuredClone(definition.data),
    setData(value) { Object.assign(this.data, value); } };
  return { page, calls };
}

for (const slug of ['team-spirit', 'special-events']) {
  test(`${slug}：慢图不拦截其他图片，失败结束骨架并显示说明`, () => {
    const { page } = loadPage(`pages/home/${slug}/index`);
    let definition;
    vm.runInNewContext(fs.readFileSync('miniprogram/components/skeleton-image/index.js', 'utf8'), {
      Component: value => { definition = value; }
    });
    const image = { ...definition.methods, data: structuredClone(definition.data),
      setData(value) { Object.assign(this.data, value); },
      triggerEvent(name, detail) {
        page.onImageLoadComplete({ currentTarget: { dataset: { index: 0 } }, detail });
      } };
    page.data.totalCount = 12;
    image.onImageLoad({ detail: {} });
    assert.equal(image.data.showRealImage, true);
    assert.equal(page.data.imageErrors[0], false);
    page.onImageLoadComplete({ currentTarget: { id: 'photo-1', dataset: { index: 1 } }, detail: { error: true } });
    assert.equal(image.data.showRealImage, true);
    assert.equal(page.data.imageErrors[1], true);
    page.onImageLoadComplete({ currentTarget: { id: 'photo-1', dataset: { index: 1 } }, detail: {} });
    assert.equal(page.data.imageErrors[1], false);
  });

  test(`${slug}：沿用分页来源、每页 12 张、追加与末页；刷新清除旧失败显示`, async () => {
    const key = slug === 'team-spirit' ? 'teamSpirit' : 'specialEvents';
    const method = slug === 'team-spirit' ? 'loadTeamSpirit' : 'loadSpecialEvents';
    const requests = [];
    const images = {
      [slug === 'team-spirit' ? 'getTeamSpiritDetailImages' : 'getSpecialEventsDetailImages'](page, size) {
        requests.push([page, size]);
        return { images: [{ id: page, url: `photo-${page}` }], hasMore: page === 1 };
      },
      convertCloudFileIdsToTempUrls: async value => value
    };
    const { page } = loadPage(`pages/home/${slug}/index`, 'member', images);
    page[method]();
    await new Promise(resolve => setImmediate(resolve));
    page.onReachBottom();
    await new Promise(resolve => setImmediate(resolve));
    page.onReachBottom();
    assert.deepEqual(requests, [[1, 12], [2, 12]]);
    assert.equal(page.data[key].length, 2);
    assert.equal(page.data.hasMore, false);
    page.data.imageErrors = { 0: true };
    page.onPullDownRefresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(Object.keys(page.data.imageErrors).length, 0);
    assert.equal(page.data[key].length, 1);
  });
}

test('关于页：四个复制值与既有处理保持一致，每次点击只调用一次复制', () => {
  const { page, calls } = loadPage('pages/user/about/index');
  const markup = fs.readFileSync('miniprogram/pages/user/about/index.wxml', 'utf8');
  const values = [...markup.matchAll(/data-text="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(values, ['966514978', '南师大仙林校区格物楼北楼5楼玻璃房', 'weixiuzu2025@163.com', '18805189371']);
  for (const value of values) page.copyText({ currentTarget: { dataset: { text: value } } });
  assert.deepEqual(calls, values.map(value => ['copy', value]));
});

test('手册说明页保留四级角色访问边界', () => {
  for (const role of ['user', 'member', 'leader', 'admin']) {
    const { page, calls } = loadPage('pages/team/manual/index', role);
    page.onLoad({});
    assert.equal(calls.filter(call => call[0] === 'modal').length, role === 'user' ? 1 : 0);
    if (role === 'user') {
      calls[0][1].success({ confirm: true });
      assert.equal(calls.filter(call => call[0] === 'back').length, 1);
    }
  }
});
