const { getLayout } = require('../../../utils/layout');
const iconManager = require('../../../utils/iconManager');
const linkConfig = require('../../../config/linkConfig');

// 首帧就同步取到导航栏高度与角色，避免 onLoad 里再 setData 造成的内容空档/布局跳动
const LAYOUT = getLayout();
const WINDOW_INFO = { windowWidth: LAYOUT.windowWidth };
const STATUS_BAR_HEIGHT = LAYOUT.statusBarHeight;
const NAV_BAR_HEIGHT = LAYOUT.navBarHeight;
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
    navbarContentHeight: LAYOUT.navbarContentHeight,
    navbarRight: LAYOUT.navbarRight,
    tabbarHeight: LAYOUT.tabbarHeight,

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
      },
      {
        id: 'memberManage',
        name: '组员管理',
        icon: iconManager.get('manage_members'),
        path: '/pages/team/members/manage/index'
      }
    ],
    // Logo图标
    iconLogo: iconManager.get('common_logo'),
  },

  onLoad: function (options) {
    this.checkUserRole();
  },

  onShow: function () {
    this.checkUserRole();
    const tab = this.getTabBar && this.getTabBar();
    tab && tab.setSelectedByRoute && tab.setSelectedByRoute(this.route);
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
          require('../../../utils/router').userRouter.toProfile();
        }
      });
    }
  },




  // 页面导航
  navigateTo: function (e) {
    const path = e.currentTarget.dataset.path;
    if (path === '/pages/team/members/manage/index') {
      require('../../../utils/router').teamRouter.toMemberManage();
      return;
    }
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
    require('../../../utils/router').navigateTo(path);
  }
})
