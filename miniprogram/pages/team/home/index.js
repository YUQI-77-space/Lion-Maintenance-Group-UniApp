const iconManager = require('../../../utils/iconManager');
const linkConfig = require('../../../config/linkConfig');

Page({
  data: {
    // 导航栏高度
    statusBarHeight: 0,
    navBarHeight: 0,

    themeClass: '',
    role: 'user',
    isMember: false,
    isLeader: false,
    // 功能模块配置
    dailyFunctions: [
      {
        id: 'duty',
        name: '值班表',
        icon: iconManager.get('team_calendar'),
        path: '/pages/team/duty/roster/index'
      },
      {
        id: 'maintenance',
        name: '维修任务',
        icon: iconManager.get('team_maintenance'),
        path: '/pages/team/maintenance/list/index'
      },
      {
        id: 'volunteer',
        name: '志愿活动',
        icon: iconManager.get('team_volunteer'),
        path: '/pages/team/volunteer/list/index'
      },
      {
        id: 'manual',
        name: '维修手册',
        icon: iconManager.get('team_manual'),
        link: linkConfig.team_manual
      }
    ],
    manageFunctions: [
      {
        id: 'dutyManage',
        name: '值班管理',
        icon: iconManager.get('manage_duty'),
        path: '/pages/team/duty/manage/index'
      },
      {
        id: 'maintenanceManage',
        name: '维修任务管理',
        icon: iconManager.get('manage_maintenance'),
        path: '/pages/team/maintenance/manage/index'
      },
      {
        id: 'volunteerManage',
        name: '志愿活动管理',
        icon: iconManager.get('manage_volunteer'),
        path: '/pages/team/volunteer/manage/index'
      },
      {
        id: 'ewaManage',
        name: 'EWA管理',
        icon: iconManager.get('manage_ewa'),
        path: '/pages/team/ewa/manage/index'
      }
    ],
    // Logo图标
    iconLogo: iconManager.get('common_logo'),
    _touchStartX: 0,
    _touchStartY: 0,
    pageAnimation: {},
    isAnimating: false
  },

  onLoad: function (options) {
    // 获取系统信息，设置状态栏高度
    const windowInfo = wx.getWindowInfo();
    const statusBarHeight = windowInfo.statusBarHeight || 20;
    const navBarHeight = statusBarHeight + 44; // 状态栏高度 + 导航栏内容高度(44px)
    
    this.setData({
      statusBarHeight: statusBarHeight,
      navBarHeight: navBarHeight
    });
    
    this.checkUserRole();
  },

  onShow: function () {
    this.checkUserRole();
    this.initAnimation();
    const tab = this.getTabBar && this.getTabBar();
    tab && tab.setSelectedByRoute && tab.setSelectedByRoute();
  },

  // 用户权限检查
  checkUserRole: function () {
    const app = getApp();
    // 使用同步存储作为回退，确保即使 app.globalData 未就绪也能获取角色
    const role = (app && app.globalData && app.globalData.role) || wx.getStorageSync('role') || 'user';
    this.setData({
      role: role,
      isMember: role === 'member' || role === 'leader' || role === 'admin',
      isLeader: role === 'leader' || role === 'admin'
    });

    if (!this.data.isMember) {
      wx.showModal({
        title: '提示',
        content: '您不是维修组成员，无法访问此页面',
        showCancel: false,
        success: function (res) {
          wx.switchTab({ url: '/pages/user/profile/index' });
        }
      });
    }
  },

  onTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    this.setData({ _touchStartX: e.touches[0].clientX, _touchStartY: e.touches[0].clientY });
  },
  onTouchEnd(e) {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - this.data._touchStartX;
    const dy = endY - this.data._touchStartY;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx < 60 || absDy > 40) return;

    const { getTabOrder } = require('../../../utils/router');
    const tabOrder = getTabOrder();
    const pages = getCurrentPages();
    const route = '/' + pages[pages.length - 1].route;
    const idx = tabOrder.indexOf(route);
    if (idx === -1) return;

    const nextIdx = dx < 0 ? (idx + 1) % tabOrder.length : (idx - 1 + tabOrder.length) % tabOrder.length;
    const direction = dx < 0 ? 'left' : 'right';
    this.animateAndSwitch(direction, tabOrder[nextIdx]);
  },

  // 页面动画
  initAnimation: function () {
    try {
      const animation = wx.createAnimation({ duration: 0 });
      animation.opacity(1).translateX(0).step();
      this.setData({ pageAnimation: animation.export(), isAnimating: false });
    } catch (e) {}
  },

  animateAndSwitch: function (direction, url) {
    if (this.data.isAnimating) return;
    this.setData({ isAnimating: true });
    try {
      const animation = wx.createAnimation({ duration: 220, timingFunction: 'ease-in-out' });
      const offset = direction === 'left' ? -40 : 40;
      animation.translateX(offset).opacity(0.0).step();
      this.setData({ pageAnimation: animation.export() });
      setTimeout(() => { wx.switchTab({ url }); }, 230);
    } catch (e) { wx.switchTab({ url }); }
  },

  // 页面导航
  navigateTo: function (e) {
    const path = e.currentTarget.dataset.path;
    const link = e.currentTarget.dataset.link;
    
    // 如果是外部链接，复制链接并提示操作步骤
    if (link) {
      wx.showModal({
        title: '维修手册',
        content: '链接已复制到剪贴板，点击上方弹出的"打开链接"即可在浏览器查看',
        confirmText: '知道了',
        showCancel: false,
        success: () => {
          wx.setClipboardData({
            data: link,
            fail: () => {
              wx.showToast({
                title: '复制失败，请手动长按复制',
                icon: 'none'
              });
            }
          });
        }
      });
      return;
    }
    
    // 内部页面跳转
    if (!path || path.trim() === '') {
      console.error('导航路径为空:', path);
      wx.showToast({ title: '页面路径错误', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: path,
      fail: (err) => {
        console.error('页面跳转失败:', err, 'path:', path);
        wx.showToast({ title: '页面跳转失败', icon: 'none' });
      }
    });
  }
}) 