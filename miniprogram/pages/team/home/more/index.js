// pages/team/home/more/index.js
const iconManager = require('../../../utils/iconManager');

Page({
  data: {
    type: '', // 'daily' 或 'manage'
    pageTitle: '',
    functions: [], // 当前显示的功能列表（筛选后）
    allFunctions: [], // 所有功能列表（未筛选）
    searchKeyword: '', // 搜索关键词
    // 图标资源
    iconSearch: iconManager.get('common_search'),
    iconClose: iconManager.get('common_close'),
    iconEmpty: iconManager.get('common_empty'),
    // 日常功能配置
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
        path: '/pages/team/manual/index'
      },
      {
        id: 'software',
        name: '软件库',
        icon: iconManager.get('team_software'),
        path: '/pages/team/software/index'
      }
    ],
    // 管理功能配置
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
        name: 'EWA系统管理',
        icon: iconManager.get('manage_ewa'),
        path: '/pages/team/ewa/manage/index'
      }
    ]
  },

  onLoad: function (options) {
    const type = options.type || 'daily';
    this.setData({ type: type });
    this.initPageData();
  },

  onShow: function () {
    // 检查用户权限
    this.checkUserPermission();
  },

  // 初始化页面数据
  initPageData: function () {
    const { type } = this.data;
    let pageTitle = '';
    let allFunctions = [];

    if (type === 'daily') {
      pageTitle = '日常功能';
      allFunctions = this.data.dailyFunctions;
    } else if (type === 'manage') {
      pageTitle = '管理功能';
      allFunctions = this.data.manageFunctions;
    }

    this.setData({
      pageTitle: pageTitle,
      allFunctions: allFunctions,
      functions: allFunctions, // 初始时显示所有功能
      searchKeyword: '' // 重置搜索关键词
    });

    // 设置导航栏标题
    wx.setNavigationBarTitle({
      title: pageTitle
    });
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
    const isLeader = role === 'leader' || role === 'admin';

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

    // 检查管理功能权限
    if (this.data.type === 'manage' && !isLeader) {
      wx.showModal({
        title: '提示',
        content: '您没有权限访问管理功能',
        showCancel: false,
        success: function (res) {
          wx.navigateBack();
        }
      });
      return;
    }
  },

  // 页面导航
  navigateTo: function (e) {
    const path = e.currentTarget.dataset.path;
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
  },

  // 搜索输入处理
  onSearchInput: function (e) {
    const keyword = e.detail.value;
    this.setData({
      searchKeyword: keyword
    });
    this.performSearch(keyword);
  },

  // 搜索确认处理
  onSearchConfirm: function (e) {
    const keyword = e.detail.value;
    this.performSearch(keyword);
  },

  // 执行搜索
  performSearch: function (keyword) {
    const { allFunctions } = this.data;
    
    if (!keyword || keyword.trim() === '') {
      // 如果搜索关键词为空，显示所有功能
      this.setData({
        functions: allFunctions
      });
      return;
    }

    // 按功能名称进行模糊搜索
    const trimmedKeyword = keyword.trim().toLowerCase();
    const filteredFunctions = allFunctions.filter(item => {
      return item.name.toLowerCase().includes(trimmedKeyword);
    });

    this.setData({
      functions: filteredFunctions
    });
  },

  // 清除搜索
  clearSearch: function () {
    this.setData({
      searchKeyword: '',
      functions: this.data.allFunctions
    });
  }
});
