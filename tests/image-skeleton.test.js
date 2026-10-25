// node --test tests/image-skeleton.test.js；模拟图片事件与相册分页，不访问云端。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(file, mocks = {}) {
  let definition;
  vm.runInNewContext(fs.readFileSync(`miniprogram/${file}`, 'utf8'), {
    Component: value => { definition = value; },
    Page: value => { definition = value; },
    require: name => mocks[name] || {}, wx: { stopPullDownRefresh() {} }, console
  });
  const instance = {
    ...definition, ...definition.methods, data: structuredClone(definition.data), events: [],
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { this.events.push({ name, detail }); }
  };
  return instance;
}

test('图片独立完成即展示；换源后重新占位，失败结束骨架，再换源可恢复', () => {
  const image = load('components/skeleton-image/index.js');
  image.observers.src.call(image, 'first');
  assert.equal(image.data.showRealImage, false);
  image.onImageLoad({ detail: { width: 800, height: 600 } });
  assert.equal(image.data.showRealImage, true);
  assert.equal(image.events[0].detail.width, 800);
  image.observers.src.call(image, 'first');
  assert.equal(image.data.showRealImage, true);
  image.observers.src.call(image, 'second');
  assert.equal(image.data.loaded, false);
  assert.equal(image.data.showRealImage, false);
  image.onImageError({});
  image.showImage();
  assert.equal(image.data.loadError, true);
  assert.equal(image.data.showRealImage, false);
  assert.equal(image.events[1].detail.error, true);
  image.observers.src.call(image, 'third');
  assert.equal(image.data.loadError, false);
  image.onImageLoad({ detail: {} });
  assert.equal(image.data.showRealImage, true);
});

for (const [folder, field, method, getter] of [
  ['special-events', 'specialEvents', 'loadSpecialEvents', 'getSpecialEventsDetailImages'],
  ['team-spirit', 'teamSpirit', 'loadTeamSpirit', 'getTeamSpiritDetailImages']
]) {
  function gallery(manager) {
    return load(`pages/home/${folder}/index.js`, { '../../../utils/cloudImageManager': manager });
  }

  test(`${folder}：慢加载保留旧照片，阻止重复分页与刷新，完成后追加并停止请求`, async () => {
    let resolve;
    let calls = 0;
    const page = gallery({
      [getter]: () => { calls++; return { images: [{ id: 2, url: 'cloud://2' }], hasMore: false }; },
      convertCloudFileIdsToTempUrls: () => new Promise(done => { resolve = done; })
    });
    page.setData({ [field]: [{ id: 1, url: 'first' }], currentPage: 2, isInitialized: true });
    page[method]();
    assert.equal(page.data.loading, true);
    page.onReachBottom();
    page.onPullDownRefresh();
    assert.equal(calls, 1);
    assert.equal(page.data[field][0].url, 'first');
    assert.equal(page.data.currentPage, 2);
    resolve([{ id: 2, url: 'second' }]);
    await new Promise(done => setImmediate(done));
    assert.equal(page.data.loading, false);
    assert.equal(page.data[field].length, 2);
    assert.equal(page.data[field][1].url, 'second');
    assert.equal(page.data.hasMore, false);
    page.onReachBottom();
    assert.equal(calls, 1);
  });

  test(`${folder}：无照片结束初始化，URL 转换失败回退原图，单图失败有刷新提示`, async () => {
    const manager = { [getter]: () => ({ images: [], hasMore: false }) };
    const page = gallery(manager);
    page[method]();
    assert.equal(page.data.loading, false);
    assert.equal(page.data.isInitialized, true);
    assert.equal(page.data.hasMore, false);
    manager[getter] = () => ({ images: [{ id: 1, url: 'cloud://1' }], hasMore: false });
    manager.convertCloudFileIdsToTempUrls = () => Promise.reject(new Error('模拟断网'));
    page.onPullDownRefresh();
    await new Promise(done => setImmediate(done));
    assert.equal(page.data.loading, false);
    assert.equal(page.data[field][0].url, 'cloud://1');
    page.onImageLoadComplete({ currentTarget: { dataset: { index: 0 } }, detail: { error: true } });
    assert.equal(page.data.imageErrors[0], true);
    page.onImageLoadComplete({ currentTarget: { dataset: { index: 0 } }, detail: {} });
    assert.equal(page.data.imageErrors[0], false);
  });
}
