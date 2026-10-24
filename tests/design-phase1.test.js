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
    const shown = [];
    page.selectComponent = id => ({ showImage: () => shown.push(id) });
    page.data.totalCount = 12;
    page.onImageLoadComplete({ currentTarget: { id: 'photo-0', dataset: { index: 0 } }, detail: {} });
    assert.deepEqual(shown, ['#photo-0']);
    assert.equal(page.data.imageErrors[0], false);
    page.onImageLoadComplete({ currentTarget: { id: 'photo-1', dataset: { index: 1 } }, detail: { error: true } });
    assert.deepEqual(shown, ['#photo-0', '#photo-1']);
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

test('更多功能：搜索／清除与单次跳转保留，四级角色原拦截不变', () => {
  for (const role of ['user', 'member', 'leader', 'admin']) {
    for (const type of ['daily', 'manage']) {
      const { page, calls } = loadPage('pages/team/home/more/index', role);
      page.onLoad({ type });
      page.onShow();
      const blocked = role === 'user' || (type === 'manage' && role === 'member');
      assert.equal(calls.filter(call => call[0] === 'modal').length, blocked ? 1 : 0);
      if (blocked) continue;
      page.onSearchInput({ detail: { value: '维修任务' } });
      assert.equal(page.data.functions.length, 1);
      const target = page.data.functions[0].path;
      page.navigateTo({ currentTarget: { dataset: { path: target } } });
      assert.deepEqual(calls.filter(call => call[0] === 'navigate'), [['navigate', target]]);
      page.onSearchInput({ detail: { value: '不存在的功能' } });
      assert.equal(page.data.functions.length, 0);
      page.clearSearch();
      assert.equal(page.data.functions.length, type === 'daily' ? 5 : 4);
    }
  }
});
