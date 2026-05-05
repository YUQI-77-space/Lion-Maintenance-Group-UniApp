// 路由导航工具类
const iconManager = require('./iconManager');
const ROUTES = {
  HOME: '/pages/home/index',
  USER: {
    PROFILE: '/pages/user/profile/index',
    TODO: '/pages/user/todo/index',
    MESSAGE: '/pages/user/message/index',
    ABOUT: '/pages/user/about/index',
  },
  LOGIN: '/pages/login/index',
  TEAM: {
    HOME: '/pages/team/home/index',
    MAINTENANCE: {
      LIST: '/pages/team/maintenance/list/index',
      DETAIL: '/pages/team/maintenance/detail/index',
      MANAGE: '/pages/team/maintenance/manage/index',
    },
    VOLUNTEER: {
      LIST: '/pages/team/volunteer/list/index',
      DETAIL: '/pages/team/volunteer/detail/index',
      CREATE: '/pages/team/volunteer/create/index',
      MANAGE: '/pages/team/volunteer/manage/index',
    },
    EWA: {
      MANAGE: '/pages/team/ewa/manage/index',
    },
  },
  REPAIR: '/pages/repair/index',
};

// TabBar 页面管理
const TAB_PAGES = new Set([
  ROUTES.HOME,
  ROUTES.USER.PROFILE,
  ROUTES.TEAM.HOME,
  ROUTES.REPAIR
]);

function isTabPage(url) {
  if (!url) return false;
  const pure = url.split('?')[0];
  return TAB_PAGES.has(pure);
}

function switchTab(url) {
  wx.switchTab({
    url,
    fail: (err) => {
      console.error('切换Tab失败:', err, 'URL:', url);
      wx.showToast({ title: '页面跳转失败', icon: 'none' });
    }
  });
}

// 计算角色对应的 Tab 配置（对象数组），供 app.updateUserRole 使用
function computeTabsByRole(role) {
  const tabConfigs = {
    home: {
      pagePath: 'pages/home/index',
      text: '首页',
      iconPath: iconManager.getTab('tab_home'),
      selectedIconPath: iconManager.getTab('tab_home_active')
    },
    team: {
      pagePath: 'pages/team/home/index',
      text: '维修组',
      iconPath: iconManager.getTab('tab_team'),
      selectedIconPath: iconManager.getTab('tab_team_active')
    },
    repair: {
      pagePath: 'pages/repair/index',
      text: '报修',
      iconPath: iconManager.getTab('tab_repair'),
      selectedIconPath: iconManager.getTab('tab_repair_active')
    },
    user: {
      pagePath: 'pages/user/profile/index',
      text: '我的',
      iconPath: iconManager.getTab('tab_profile'),
      selectedIconPath: iconManager.getTab('tab_user_active')
    }
  };
  if (role === 'member' || role === 'leader' || role === 'admin') {
    return [tabConfigs.home, tabConfigs.team, tabConfigs.repair, tabConfigs.user];
  }
  return [tabConfigs.home, tabConfigs.repair, tabConfigs.user];
}

// 获取用户角色对应的Tab顺序
function getTabOrder() {
  try {
    const app = getApp();
    // 优先从全局 currentTabs 读取（由 app.updateUserRole 计算并发布）
    const tabs = app && app.globalData && Array.isArray(app.globalData.currentTabs)
      ? app.globalData.currentTabs
      : null;
    if (tabs && tabs.length > 0) {
      try {
        return tabs.map(t => `/${t.pagePath}`);
      } catch (_) {}
    }

    // 兼容回退到角色逻辑
    const role = app && app.getEffectiveRole ? app.getEffectiveRole() : 'user';
    if (role === 'member' || role === 'leader' || role === 'admin') {
      return [ROUTES.HOME, ROUTES.TEAM.HOME, ROUTES.REPAIR, ROUTES.USER.PROFILE];
    }
    return [ROUTES.HOME, ROUTES.REPAIR, ROUTES.USER.PROFILE];
  } catch (e) {
    console.error('获取Tab顺序失败:', e);
    return [ROUTES.HOME, ROUTES.REPAIR, ROUTES.USER.PROFILE];
  }
}

// 导航类型枚举
const NavigateType = {
  NAVIGATE: 'navigate',
  REDIRECT: 'redirect',
  RELAUNCH: 'relaunch',
  NAVIGATE_BACK: 'navigateBack',
};

// 基础导航方法
function baseNavigate(url, type = NavigateType.NAVIGATE, params = {}, delta = 1) {
  if (type === NavigateType.NAVIGATE_BACK) {
    wx.navigateBack({ delta });
    return;
  }
  
  if (!url || url.trim() === '') {
    console.error('=== 导航错误详情 ===');
    console.error('URL值:', url);
    console.error('URL类型:', typeof url);
    console.error('导航类型:', type);
    console.error('参数:', params);
    console.error('调用栈:', new Error().stack);
    console.error('==================');
    
    wx.showToast({ title: '页面路径错误', icon: 'none' });
    return;
  }
  
  let targetUrl = url;
  const queryParams = Object.keys(params);
  
  if (queryParams.length > 0) {
    targetUrl += '?';
    queryParams.forEach((key, index) => {
      targetUrl += `${key}=${encodeURIComponent(params[key])}`;
      if (index < queryParams.length - 1) {
        targetUrl += '&';
      }
    });
  }

  switch (type) {
    case NavigateType.NAVIGATE:
      if (isTabPage(targetUrl)) {
        switchTab(targetUrl);
      } else {
        wx.navigateTo({ 
          url: targetUrl,
          fail: (err) => {
            console.error('页面跳转失败:', err, 'URL:', targetUrl);
            wx.showToast({ title: '页面跳转失败', icon: 'none' });
          }
        });
      }
      break;
    case NavigateType.REDIRECT:
      if (isTabPage(targetUrl)) {
        switchTab(targetUrl);
      } else {
        wx.redirectTo({ 
          url: targetUrl,
          fail: (err) => {
            console.error('页面重定向失败:', err, 'URL:', targetUrl);
            wx.showToast({ title: '页面重定向失败', icon: 'none' });
          }
        });
      }
      break;
    case NavigateType.RELAUNCH:
      wx.reLaunch({ 
        url: targetUrl,
        fail: (err) => {
          console.error('重启应用失败:', err, 'URL:', targetUrl);
          wx.showToast({ title: '应用重启失败', icon: 'none' });
        }
      });
      break;
    default:
      if (isTabPage(targetUrl)) {
        switchTab(targetUrl);
      } else {
        wx.navigateTo({ 
          url: targetUrl,
          fail: (err) => {
            console.error('默认页面跳转失败:', err, 'URL:', targetUrl);
            wx.showToast({ title: '页面跳转失败', icon: 'none' });
          }
        });
      }
  }
}

// 导航方法封装
function navigateTo(url, params = {}) {
  baseNavigate(url, NavigateType.NAVIGATE, params);
}

function redirectTo(url, params = {}) {
  baseNavigate(url, NavigateType.REDIRECT, params);
}

function reLaunch(url, params = {}) {
  baseNavigate(url, NavigateType.RELAUNCH, params);
}

function navigateBack(delta = 1) {
  baseNavigate('', NavigateType.NAVIGATE_BACK, {}, delta);
}

// 权限检查
function checkLogin(callback) {
  const app = getApp();
  if (!app.globalData.isLogin) {
    redirectTo(ROUTES.LOGIN);
    return false;
  }
  
  if (typeof callback === 'function') {
    callback();
  }
  return true;
}

function checkPermission(requiredRole, callback, autoNavigate = true) {
  if (!checkLogin()) {
    return false;
  }
  
  const app = getApp();
  const hasPermission = app.checkPermission(requiredRole);
  
  if (!hasPermission && autoNavigate) {
    wx.showToast({
      title: '您没有权限访问此页面',
      icon: 'none'
    });
    
    setTimeout(() => {
      switchTab(ROUTES.USER.PROFILE);
    }, 1500);
    return false;
  }
  
  if (hasPermission && typeof callback === 'function') {
    callback();
  }
  
  return hasPermission;
}

// 模块化路由组织
const userRouter = {
  toProfile() {
    switchTab(ROUTES.USER.PROFILE);
  },
  
  toTodo() {
    navigateTo(ROUTES.USER.TODO);
  },
  
  toMessage() {
    navigateTo(ROUTES.USER.MESSAGE);
  },
  
  toAbout() {
    navigateTo(ROUTES.USER.ABOUT);
  }
};

const loginRouter = {
  toLogin() {
    redirectTo(ROUTES.LOGIN);
  },
  
  afterLogin() {
    switchTab(ROUTES.HOME);
  }
};

const teamRouter = {
  toHome() {
    switchTab(ROUTES.TEAM.HOME);
  },
  
  toMaintenanceList() {
    navigateTo(ROUTES.TEAM.MAINTENANCE.LIST);
  },
  
  toMaintenanceDetail(id) {
    navigateTo(ROUTES.TEAM.MAINTENANCE.DETAIL, { id });
  },
  
  toMaintenanceManage(checkLeaderPermission = true) {
    if (checkLeaderPermission) {
      checkPermission('leader', () => {
        navigateTo(ROUTES.TEAM.MAINTENANCE.MANAGE);
      });
    } else {
      navigateTo(ROUTES.TEAM.MAINTENANCE.MANAGE);
    }
  },
  
  toVolunteerList() {
    navigateTo(ROUTES.TEAM.VOLUNTEER.LIST);
  },
  
  toVolunteerDetail(id) {
    navigateTo(ROUTES.TEAM.VOLUNTEER.DETAIL, { id });
  },
  
  toVolunteerCreate(checkLeaderPermission = true) {
    if (checkLeaderPermission) {
      checkPermission('leader', () => {
        navigateTo(ROUTES.TEAM.VOLUNTEER.CREATE);
      });
    } else {
      navigateTo(ROUTES.TEAM.VOLUNTEER.CREATE);
    }
  },
  
  toVolunteerManage(checkLeaderPermission = true) {
    if (checkLeaderPermission) {
      checkPermission('leader', () => {
        navigateTo(ROUTES.TEAM.VOLUNTEER.MANAGE);
      });
    } else {
      navigateTo(ROUTES.TEAM.VOLUNTEER.MANAGE);
    }
  },
  
  toEwaManage(checkLeaderPermission = true) {
    if (checkLeaderPermission) {
      checkPermission('leader', () => {
        navigateTo(ROUTES.TEAM.EWA.MANAGE);
      });
    } else {
      navigateTo(ROUTES.TEAM.EWA.MANAGE);
    }
  }
};

const repairRouter = {
  toRepair() {
    switchTab(ROUTES.REPAIR);
  }
};

module.exports = {
  ROUTES,
  NavigateType,
  navigateTo,
  redirectTo,
  reLaunch,
  navigateBack,
  checkLogin,
  checkPermission,
  userRouter,
  loginRouter,
  teamRouter,
  repairRouter,
  switchTab,
  getTabOrder,
  computeTabsByRole
}; 