const iconManager = require('../../../utils/iconManager');
const linkConfig = require('../../../config/linkConfig');

// 首帧就同步取到导航栏高度与角色，避免 onLoad 里再 setData 造成的内容空档/布局跳动
const WINDOW_INFO = (() => { try { return wx.getWindowInfo() || {}; } catch (e) { return {}; } })();
const STATUS_BAR_HEIGHT = WINDOW_INFO.statusBarHeight || 20;
const NAV_BAR_HEIGHT = STATUS_BAR_HEIGHT + 44;
const INITIAL_ROLE = (() => {
  try {
    const app = getApp();
    return (app && app.globalData && app.globalData.role) || wx.getStorageSync('role') || 'user';
  } catch (e) {
    return 'user';
  }
})();
const INITIAL_IS_MEMBER = INITIAL_ROLE === 'member' || INITIAL_ROLE === 'leader' || INITIAL_ROLE === 'admin';
const INITIAL_IS_LEADER = INITIAL_ROLE === 'leader' || INITIAL_ROLE === 'admin';

Page({
  data: {
    // 导航栏高度
    statusBarHeight: STATUS_BAR_HEIGHT,
    navBarHeight: NAV_BAR_HEIGHT,

    themeClass: '',
    role: INITIAL_ROLE,
    isMember: INITIAL_IS_MEMBER,
    isLeader: INITIAL_IS_LEADER,
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
    isAnimating: false
  },

  onLoad: function (options) {
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
    const isMember = role === 'member' || role === 'leader' || role === 'admin';
    const isLeader = role === 'leader' || role === 'admin';

    // 角色未变化时不 setData，避免每次切回本页都白白触发一次整页渲染
    if (role !== this.data.role || isMember !== this.data.isMember || isLeader !== this.data.isLeader) {
      this.setData({
        role: role,
        isMember: isMember,
        isLeader: isLeader
      });
    }

    if (!isMember) {
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
  // 仅复位滑动切换的防抖标记：页面根节点不再挂 animation，避免整页合成层与切换瞬间的空白帧
  initAnimation: function () {
    if (this.data.isAnimating) {
      this.setData({ isAnimating: false });
    }
  },

  // 滑动切换 Tab：直接切换，不再先把整页淡出
  animateAndSwitch: function (direction, url) {
    if (this.data.isAnimating || !url) return;
    this.setData({ isAnimating: true });
    wx.switchTab({ url });
    // 兜底复位，避免切换失败后标记卡死
    setTimeout(() => {
      if (this.data.isAnimating) {
        this.setData({ isAnimating: false });
      }
    }, 400);
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