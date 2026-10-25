// node --test tests/list-card-visibility.test.js；检查真实 WXSS 的类选择器层叠，不访问云资源。
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
  test(`${page} 首次插入及带旧动画类的卡片均即时可见`, () => {
    const base = path.join(root, 'pages', page, 'index');
    assert.match(fs.readFileSync(`${base}.wxml`, 'utf8'), /class="[^"]*\bmg-data-page\b/);
    const sheet = readSheet(path.join(root, 'app.wxss')) + readSheet(`${base}.wxss`);
    for (const classes of [[card], [card, 'card-animate']]) {
      const style = cardStyle(sheet, classes);
      assert.equal(style.animation, 'none', '卡片不依赖入场动画');
      assert.equal(style.opacity, '1', '禁用动画后不能停留在透明初态');
      assert.equal(style.transform, 'none', '卡片不保留入场位移');
    }
  });
}
