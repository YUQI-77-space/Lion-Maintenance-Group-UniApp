const api = require('../../../utils/apiAdapter');
const router = require('../../../utils/router');
const roles = { member: '组员', leader: '组长', admin: '管理员' };
const departments = ['运营管理部', '电子技术部', '机电维修部'];

async function call(action, params) {
  const result = await api.call('users', { action, params, timeout: 15000,
    config: { requestId: params && params._requestId } });
  if (result.code === 401 || result.code === 403) {
    await getApp().refreshUserInfo({ sync: false });
    router.checkPermission('leader');
  }
  return result;
}
function checkPermission() { return router.checkPermission('leader'); }
module.exports = { call, checkPermission, roles, departments, generateRequestId: api.generateRequestId };
