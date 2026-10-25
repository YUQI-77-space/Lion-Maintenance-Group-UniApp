// pages/user/about/index.js
const iconManager = require('../../../utils/iconManager');

Page({
  data: {
    // 图标资源
    iconLogo: iconManager.get('common_logo'),
    // 当前年份
    currentYear: new Date().getFullYear(),
    // 维修业务清单
    services: [
      { title: '电脑维护', description: '清灰换件 · 软件配置' },
      { title: '电器维修', description: '吹风机 · 充电宝 · 收音机' },
      { title: '自行车维修', description: '保养维修 · 补胎充气' },
      { title: '咨询与工具', description: '维修咨询 · 五金工具借用' }
    ]
  },

  /**
   * 复制文本到剪贴板
   */
  copyText(e) {
    const text = e.currentTarget.dataset.text;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: '复制成功',
          icon: 'success',
          duration: 2000
        });
      },
      fail: () => {
        wx.showToast({
          title: '复制失败',
          icon: 'none',
          duration: 2000
        });
      }
    });
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    // 用户点击右上角分享
    return {
      title: '南京师范大学维修组',
      path: '/pages/user/about/index'
    }
  }
})
