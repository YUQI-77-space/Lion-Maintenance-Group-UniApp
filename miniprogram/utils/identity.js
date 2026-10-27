// 只接收同一账号的不旧于当前版本的资料，防止晚到响应恢复已撤销的角色。
function isCurrentUserInfo(app, incoming) {
  const current = app.globalData.userInfo || {};
  if (app.globalData.openid && incoming.openid !== app.globalData.openid) return false;
  return (incoming.version || 0) >= (current.version || 0);
}

// 身份变更与 tab 结构无关；只通知当前页面，隐藏页在下次 onShow 重验。
function notifyIdentityChanged(app) {
  const user = app.globalData.userInfo || {};
  const role = app.globalData.role || 'user';
  const retired = user.employmentStatus === 'retired' || user.membershipStatus === 'removed';
  const key = JSON.stringify([app.globalData.openid || '', role, retired]);
  if (app._identityKey === key) return;
  app._identityKey = key;
  app.publish('identityChanged', { role, employmentStatus: retired ? 'retired' : 'active' });
  if (typeof getCurrentPages !== 'function') return;
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page || page._applyingOwnIdentity) return;
  const route = page.route || '';
  const management = /^pages\/team\/(members\/(manage|detail)|(?:maintenance|volunteer)\/(manage|create)|(?:duty|ewa)\/manage)\/index$/.test(route) ||
    (route === 'pages/team/maintenance/detail/index' && page.data.fromManage) ||
    (route === 'pages/team/volunteer/detail/index' && page.data.isFromManagePage);
  if (management && !app.checkPermission('leader')) {
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
    wx.showToast({ title: '身份已变化，请重新进入', icon: 'none' });
    require('./router').switchTab('/pages/team/home/index');
    return;
  }
  if (typeof page.onIdentityChanged === 'function') page.onIdentityChanged();
}

module.exports = { notifyIdentityChanged, isCurrentUserInfo };
