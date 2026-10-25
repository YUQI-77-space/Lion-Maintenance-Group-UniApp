// node --test tests/volunteer-description.test.js；不访问云资源。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('志愿描述：编辑回填、连续输入和清空同步计数，校验失败保留输入', async () => {
  let definition;
  let reads = 0;
  const api = { call: async () => {
    reads++;
    return { success: true, data: { activity: { title: '维修服务', description: '原有描述' } } };
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/team/volunteer/create/index.js'), 'utf8'), {
    Page: value => { definition = value; }, getApp: () => ({}), require: name => name.endsWith('/loading') ? { show() {}, hide() {} } : api,
    wx: { showLoading() {}, hideLoading() {}, showToast() {}, pageScrollTo() {} }, console
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      if (parts.length === 2) this.data[parts[0]][parts[1]] = value;
      else this.data[key] = value;
    }
  } };
  await page.getActivityDetail('example-activity');
  assert.equal(page.data.descriptionLength, 4);
  assert.equal(page.data.formData.description, '原有描述');
  for (const description of ['新增描述', '中文与 emoji 😀', '', '保留这段输入']) {
    page.onDescriptionInput({ detail: { value: description } });
    assert.equal(page.data.formData.description, description);
    assert.equal(page.data.descriptionLength, description.length);
    assert.equal(page.data.formData.title, '维修服务');
  }
  await page.submitForm({ detail: { value: { title: '', description: page.data.formData.description } } });
  assert.equal(page.data.formData.description, '保留这段输入');
  assert.equal(page.data.descriptionLength, 6);
  assert.equal(page.data.submitting, false);
  assert.ok(page.data.formError);
  assert.equal(reads, 1);
});
