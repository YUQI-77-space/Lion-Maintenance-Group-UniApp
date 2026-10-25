// node --test tests/todo-detail-avatars.test.js；仅模拟数据库，不访问云端。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ owned = true, failAvatars = false, assistants = ['helper', 'owner'] } = {}) {
  const queries = [];
  const task = {
    applicantId: 'owner', assigneeId: 'lead',
    additionalAssignees: assistants.map(assigneeId => ({ assigneeId, assigneeName: assigneeId })),
    taskStatus: 'completed', level1: '电子', ew: 8
  };
  const db = {
    command: { in: ids => ids },
    collection(name) {
      const query = { name };
      return {
        where(value) { query.where = value; return this; },
        field(value) { query.field = value; return this; },
        limit(value) { query.limit = value; return this; },
        async get() {
          queries.push(query);
          if (name === 'maintenance_toDo_list') return { data: owned ? [{ ...task, taskId: 'task' }] : [] };
          if (name === 'maintenance_tasks') return { data: [structuredClone(task)] };
          if (failAvatars) throw new Error('头像查询失败');
          return { data: query.where.openid.filter(id => id !== 'helper').map(openid => ({
            openid, avatarUrl: `https://example.test/${openid}.png`, cloudAvatarFileID: `cloud://${openid}`,
            privateField: '不能返回'
          })) };
        }
      };
    }
  };
  const context = { exports: {}, console: { log() {}, warn() {}, error() {} },
    require: name => { assert.equal(name, 'wx-server-sdk'); return { init() {}, database: () => db }; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/userToDoList/getTodoDetail.js'), 'utf8'), context);
  return { run: async () => JSON.parse(JSON.stringify(await context.exports.getTodoDetail({ type: 'maintenance', id: 'task' }, 'owner'))), queries };
}

test('仅查询任务相关人员的头像，去重并保留已有业务值；缺失头像使用空资料', async () => {
  const { run, queries } = harness();
  const result = await run();
  assert.equal(result.code, 200);
  assert.equal(result.data.ew, 8);
  assert.equal(result.data.applicantAvatar.avatarUrl, 'https://example.test/owner.png');
  assert.equal(result.data.assigneeAvatar.cloudAvatarFileID, 'cloud://lead');
  assert.deepEqual(result.data.additionalAssignees[0].avatarProfile, {});
  assert.equal(result.data.additionalAssignees[1].avatarProfile.avatarUrl, result.data.applicantAvatar.avatarUrl);
  assert(!JSON.stringify(result.data).includes('不能返回'));
  const query = queries.find(q => q.name === 'users');
  assert.deepEqual([...query.where.openid], ['owner', 'lead', 'helper']);
  assert.deepEqual(Object.keys(query.field).sort(), ['_id', 'avatarUrl', 'cloudAvatarFileID', 'openid']);
});

test('没有本人待办时不读取主任务或任何头像', async () => {
  const { run, queries } = harness({ owned: false });
  assert.equal((await run()).code, 404);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].where.toDoListUserId, 'owner');
});

test('头像查询失败不阻断详情读取', async () => {
  const { run } = harness({ failAvatars: true });
  const result = await run();
  assert.equal(result.code, 200);
  assert.deepEqual(result.data.applicantAvatar, {});
  assert.equal(result.data.ew, 8);
});

test('人员超过单次读取上限时完整分批查询', async () => {
  const { run, queries } = harness({ assistants: Array.from({ length: 105 }, (_, i) => `helper${i}`) });
  const result = await run();
  assert.equal(result.data.additionalAssignees.at(-1).avatarProfile.cloudAvatarFileID, 'cloud://helper104');
  assert.deepEqual(queries.filter(q => q.name === 'users').map(q => q.where.openid.length), [100, 7]);
});
