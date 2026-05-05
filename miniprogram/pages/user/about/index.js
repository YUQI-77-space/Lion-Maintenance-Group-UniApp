// pages/user/about/index.js
const iconManager = require('../../../utils/iconManager');

Page({
  data: {
    // 图标资源
    iconLogo: iconManager.get('common_logo'),
    // 当前年份
    currentYear: new Date().getFullYear()
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 页面加载时执行
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

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