// pages/team/manual/index.js
const iconManager = require('../../../utils/iconManager');

Page({
  data: {
    // 图标资源
    iconManual: iconManager.get('team_manual')
  },

  onLoad: function (options) {
    // 检查用户权限
    this.checkUserPermission();
  },

  onShow: function () {
    
  },

  // 检查用户权限
  checkUserPermission: function () {
    const app = getApp();
    if (!app || !app.globalData) {
      console.error('app或app.globalData不存在');
      setTimeout(() => {
        this.checkUserPermission();
      }, 500);
      return;
    }

    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    const isMember = role === 'member' || role === 'leader' || role === 'admin';

    // 检查是否是维修组成员
    if (!isMember) {
      wx.showModal({
        title: '提示',
        content: '您不是维修组成员，无法访问此页面',
        showCancel: false,
        success: function (res) {
          wx.navigateBack();
        }
      });
      return;
    }
  }
})

