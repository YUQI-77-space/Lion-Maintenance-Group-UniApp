// node --test tests/design-phase2.test.js；仅使用本地源码，不访问云资源。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tokens = require('../docs/知识库/Design/design-tokens.json');
const read = file => fs.readFileSync(path.resolve('miniprogram', file), 'utf8');

function component(name) {
  let definition;
  vm.runInNewContext(read(`components/${name}/index.js`), {
    Component: value => { definition = value; },
    require: () => ({}), console
  });
  const events = [];
  const instance = {
    ...definition.methods, data: structuredClone(definition.data || {}),
    properties: Object.fromEntries(Object.entries(definition.properties).map(([key, value]) => [key, value.value])),
    setData(value) { Object.assign(this.data, value); },
    triggerEvent(...args) { events.push(args); }
  };
  return { definition, instance, events };
}

test('显式 Token 的颜色、字体、间距、圆角和尺寸与权威 JSON 一致', () => {
  const sheet = read('styles/design-tokens.wxss');
  const values = Object.fromEntries([...sheet.matchAll(/(--mg-[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
  for (const [name, value] of Object.entries(tokens.color)) assert.equal(values[`--mg-color-${name}`], value);
  for (const name of ['display', 'title', 'section', 'body', 'label', 'caption']) {
    assert.equal(values[`--mg-font-${name}`], tokens.typography[name].fontSize);
    assert.equal(values[`--mg-line-${name}`], tokens.typography[name].lineHeight);
  }
  for (const [name, value] of Object.entries(tokens.space)) assert.equal(values[`--mg-space-${name}`], value);
  for (const [name, value] of Object.entries(tokens.radius)) assert.equal(values[`--mg-radius-${name}`], value);
  for (const name of ['avatar-sm', 'avatar-md', 'avatar-lg', 'touch-target-min', 'button', 'button-compact', 'input-min', 'textarea-min']) {
    assert.equal(values[`--mg-size-${name}`], tokens.size[name]);
  }
  assert.ok(!/\bpage\s*\{/.test(sheet));
});

test('全部规定色彩组合达到对比度要求', () => {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const pair of tokens.contrastChecks) {
    const a = luminance(tokens.color[pair.foreground]), b = luminance(tokens.color[pair.background]);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= pair.minimum, `${pair.foreground}/${pair.background}`);
  }
});

test('六页显式接入、组件隔离内自带 Token；阶段3后全局使用同一 Token', () => {
  const pages = ['user/about', 'home/team-spirit', 'home/special-events', 'team/home/more', 'team/manual', 'team/software'];
  for (const page of pages) {
    const sheet = read(`pages/${page}/index.wxss`);
    assert.match(sheet, /@import "\/styles\/design-primitives.wxss"/);
    assert.doesNotMatch(sheet, /--mg-[\w-]+\s*:/);
    assert.match(read(`pages/${page}/index.wxml`), /class="[^"]*\bmg-theme mg-page\b/);
  }
  for (const name of ['section-header', 'avatar-display', 'skeleton-image']) {
    assert.match(read(`components/${name}/index.wxss`), /@import "..\/..\/styles\/design-tokens.wxss"/);
    assert.match(read(`components/${name}/index.wxml`), /class="[^"]*\bmg-theme\b/);
  }
  // 阶段2的隔离边界已由阶段3的全局接入替代；继续验证只有一套设计值。
  assert.match(read('app.wxss'), /styles\/common\.wxss/);
  assert.match(read('styles/common.wxss'), /variables\.wxss/);
  assert.match(read('styles/variables.wxss'), /design-tokens\.wxss/);
  assert.match(read('styles/variables.wxss'), /--primary:\s*var\(--mg-color-brand\)/);
  assert.doesNotMatch(read('styles/variables.wxss'), /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(read('styles/design-primitives.wxss'), /(?:^|\n)\.(?:btn|form-[\w-]+|card)\b/);
});

test('区块标题保留属性与 more 事件，原生更多按钮不引入路由', () => {
  const { definition, instance, events } = component('section-header');
  assert.deepEqual(Object.keys(definition.properties), ['title', 'titleClass', 'customClass', 'meta', 'showMore', 'moreText', 'showArrow']);
  assert.equal(definition.properties.meta.type.name, 'String');
  assert.equal(definition.properties.meta.value, '');
  assert.match(read('components/section-header/index.wxml'), /<text class="section-meta" wx:if="{{ meta }}">{{ meta }}<\/text>/);
  instance.onMoreTap();
  assert.deepEqual(events, [['more']]);
  assert.match(read('components/section-header/index.wxml'), /<button[\s\S]*?bindtap="onMoreTap"/);
});

test('头像保留全部属性、原点击许可与事件内容、失败回退来源', () => {
  const { definition, instance, events } = component('avatar-display');
  assert.deepEqual(Object.keys(definition.properties), ['userInfo', 'openid', 'size', 'customClass', 'showBorder', 'clickable']);
  instance.properties.userInfo = { nickName: '用于长姓名测试的示例成员' };
  instance.data.displayAvatarUrl = 'example-avatar';
  instance.onAvatarClick();
  assert.equal(events.length, 0);
  instance.properties.clickable = true;
  instance.onAvatarClick();
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'avatarclick');
  assert.equal(events[0][1].userInfo, instance.properties.userInfo);
  assert.equal(events[0][1].avatarUrl, 'example-avatar');
  instance.onImageError();
  assert.equal(instance.data.displayAvatarUrl, '/images/default/default-avatar.png');
});

test('图片自动展示，保留完成／失败事件、默认属性与旧放行方法兼容', () => {
  const { definition, instance, events } = component('skeleton-image');
  assert.deepEqual(Object.keys(definition.properties), ['src', 'mode', 'lazyLoad', 'placeholderColor']);
  assert.equal(instance.properties.placeholderColor, tokens.color['bg-subtle']);
  instance.onImageLoad({ detail: { width: 800, height: 600 } });
  assert.equal(instance.data.showRealImage, true);
  assert.equal(events[0][0], 'imageloadcomplete');
  assert.equal(events[0][1].width, 800);
  instance.onImageLoad({ detail: {} });
  assert.equal(events.length, 1);
  instance.showImage();
  assert.equal(instance.data.showRealImage, true);
  instance.onImageError({});
  assert.equal(instance.data.loadError, true);
  assert.equal(instance.data.loaded, false);
  assert.equal(instance.data.showRealImage, false);
  instance.showImage();
  assert.equal(instance.data.showRealImage, false);
  assert.equal(events[1][0], 'imageloadcomplete');
  assert.equal(events[1][1].error, true);
  assert.doesNotMatch(read('components/skeleton-image/index.wxss'), /infinite|@keyframes/);
});
