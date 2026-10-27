// 身份与在职状态分开；缺少字段的历史成员默认在职。
function isRetired() {
  const app = getApp();
  const user = (app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {};
  return user.employmentStatus === 'retired' || user.membershipStatus === 'removed';
}
function canWrite() {
  if (!isRetired()) return true;
  wx.showToast({ title: '已退休，仅可查看历史记录', icon: 'none' });
  return false;
}
module.exports = { isRetired, canWrite };
