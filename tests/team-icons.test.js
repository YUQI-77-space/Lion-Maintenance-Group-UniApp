// node --test tests/team-icons.test.js；仅检查本地图标映射与资源引用，不访问云端。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram');
const expected = {
  team_calendar: 'duty', team_maintenance: 'maintenance', team_volunteer: 'volunteer',
  team_manual: 'manual', manage_duty: 'duty-manage', manage_maintenance: 'maintenance-manage',
  manage_volunteer: 'volunteer-manage', manage_ewa: 'ewa-manage', manage_members: 'members-manage'
};

function manager(config) {
  const context = { module: { exports: {} }, require: () => config, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/iconManager.js'), 'utf8'), context);
  return context.module.exports;
}

test('图标局部映射：原有九个名称在切换图标集后均返回新 SVG', () => {
  for (const currentSet of ['default', 'alternate', 'missing']) {
    const icons = manager({ currentSet, sets: {}, defaults: { icon: '/fallback.png' } });
    for (const [name, file] of Object.entries(expected)) {
      const actual = icons.get(name);
      assert.equal(actual, `/assets/icons/team/${file}.svg`);
      assert.ok(fs.existsSync(path.join(root, actual)));
    }
  }
});

test('图标局部映射：无关图标与默认回退保持原配置', () => {
  const icons = manager({ currentSet: 'default', sets: { default: {
    basePath: '/icons/', tabsPath: '/tabs/', icons: { common_logo: 'logo.png', tab_home: 'home.png' }
  } }, defaults: { icon: '/empty.png' } });
  assert.equal(icons.get('common_logo'), '/icons/logo.png');
  assert.equal(icons.getTab('tab_home'), '/tabs/home.png');
  assert.equal(icons.get('unknown'), '/empty.png');
});

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(js|json|wxml|wxss|svg)$/.test(entry.name) ? [file] : [];
  });
}

test('图标受影响回归：完整小程序源码不再引用旧资源或首页临时名称', () => {
  const oldNames = ['calendar.png', 'maintenance.png', 'volunteer.png', '维修手册.png',
    'duty-manage.png', 'maintenance_manage.png', 'volunteer_manage.png', 'ewa_manage.png', 'members.svg'];
  const icons = manager({ sets: {}, defaults: {} });
  const pages = new Set();
  for (const file of sources(root)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /team_cover_|fallbackIcon|onFunctionIconError/, file);
    for (const old of oldNames) {
      const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.doesNotMatch(source, new RegExp(`['"/]${escaped}(?=['"?#]|$)`), file);
    }
    for (const match of source.matchAll(/iconManager\.get\(['"]([^'"]+)['"]\)/g)) {
      if (!expected[match[1]]) continue;
      assert.ok(fs.existsSync(path.join(root, icons.get(match[1]))), file);
      pages.add(path.relative(root, file).replace(/\\/g, '/'));
    }
  }
  assert.deepEqual([...pages].sort(), [
    'pages/team/duty/manage/index.js', 'pages/team/home/index.js', 'pages/team/manual/index.js',
    'pages/team/volunteer/list/index.js', 'pages/team/volunteer/manage/index.js', 'pages/user/todo/index.js'
  ]);
});
