// node --test tests/list-card-visibility.test.js；检查真实 WXSS 的类选择器层叠，不访问云资源。
// 约定：列表卡片加载结束后按序入场（公共 mg-card-enter），基础类保持可见，
// 动画只作用于 .card-animate，且延迟与结束态不得让卡片停留在透明状态。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../miniprogram');

function readSheet(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import\s+["']([^"']+)["'];/g, (_, target) =>
      readSheet(target.startsWith('/') ? path.join(root, target) : path.resolve(path.dirname(file), target)));
}

// 仅处理本回归涉及的普通类与后代选择器；忽略伪类、媒体查询和关键帧。
function cardStyle(sheet, cardClasses) {
  const result = {};
  const weights = {};
  const ancestors = new Set(['mg-theme', 'mg-data-page', 'page-container']);
  for (const [, selectors, body] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.trim().split(/,\s*/)) {
      if (!/^\.[\w-]+(?:\.[\w-]+)*(?:\s+\.[\w-]+(?:\.[\w-]+)*)*$/.test(selector)) continue;
      const parts = selector.split(/\s+/).map(part => part.slice(1).split('.'));
      if (!parts.at(-1).every(name => cardClasses.includes(name))) continue;
      if (!parts.slice(0, -1).every(part => part.every(name => ancestors.has(name)))) continue;
      const weight = parts.flat().length;
      for (const declaration of body.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 0) continue;
        const property = declaration.slice(0, colon).trim();
        if (weight < (weights[property] || 0)) continue;
        weights[property] = weight;
        result[property] = declaration.slice(colon + 1).trim();
      }
    }
  }
  return result;
}

for (const [page, card] of [
  ['team/maintenance/list', 'task-card'],
  ['team/maintenance/manage', 'task-card'],
  ['team/volunteer/list', 'activity-card'],
  ['team/volunteer/manage', 'activity-card'],
  ['user/todo', 'task-card']
]) {
  test(`${page} 卡片基础态可见，带 card-animate 时按序滑入`, () => {
    const base = path.join(root, 'pages', page, 'index');
    assert.match(fs.readFileSync(`${base}.wxml`, 'utf8'), /class="[^"]*\bmg-data-page\b/);
    const sheet = readSheet(path.join(root, 'app.wxss')) + readSheet(`${base}.wxss`);
    // 媒体查询不在本文的层叠计算范围内，先整体取出再计算普通规则
    const reducedBlocks = [...sheet.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g)].map(match => match[0]);
    const styleSheet = sheet.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g, '');

    // 基础态：没有入场类也必须可见，避免动画缺失或被打断后停在透明初态
    const plain = cardStyle(styleSheet, [card]);
    assert.notEqual(plain.opacity, '0', '卡片基础态不能是透明');
    assert.equal(plain.animation, undefined, '卡片基础态不承载入场动画');

    // 入场态：公共 keyframes + backwards，延迟期间才使用 0% 帧，结束后回到可见基础态
    const animated = cardStyle(styleSheet, [card, 'card-animate']);
    assert.match(animated.animation || '', /mg-card-enter/, '入场应使用公共 mg-card-enter');
    assert.match(animated.animation || '', /backwards/, '延迟期间必须用 backwards 保持初帧');
    assert.doesNotMatch(animated.animation || '', /forwards|both/, '结束态由基础样式提供，不叠加 forwards/both');

    // 减少动效偏好下关闭入场，但不得把卡片隐藏
    assert.ok(reducedBlocks.some(block => /card-animate[\s\S]*animation: none/.test(block)),
      '需要有针对卡片入场的 prefers-reduced-motion 兜底');
  });
}
