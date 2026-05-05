const router = require('../../utils/router');
const avatarManager = require('../../utils/avatarManager');
const api = require('../../utils/apiAdapter');
const sensitiveWordFilter = require('../../utils/sensitiveWordFilter');
const iconManager = require('../../utils/iconManager');

Page({
  data: {
    userInfo: {
      avatarUrl: '',
      nickName: '',
      qqId: '',
      studentId: '',
      authCode: ''
    },
    privacyAgree: false,
    isCheckingLogin: true,
    themeClass: '',
    // 图标资源
    iconLogo: iconManager.get('common_logo'),
    iconDefaultAvatar: iconManager.getDefault().avatar
  },

  onLoad: function (options) {
    this.checkLoginStatus();
  },

  // 检查登录状态
  checkLoginStatus: function() {
    const app = getApp();
    
    if (app.globalData.isLogin && app.globalData.openid) {
      this.redirectAfterLogin();
      return;
    }

    const openid = wx.getStorageSync('openid');
    const userInfo = wx.getStorageSync('userInfo');
    
    if (openid && userInfo) {
      this.verifySession(openid, userInfo);
    } else {
      this.setData({ isCheckingLogin: false });
      this.initDatabase();
    }
  },

  // 验证会话有效性
  verifySession: async function(openid, userInfo) {
    try {
      await api.call('login', { action: 'verifySession' });
      
      const app = getApp();
      app.globalData.userInfo = userInfo;
      app.globalData.openid = openid;
      const roleFromStorage = wx.getStorageSync('role') || 'user';
      app.updateUserRole && app.updateUserRole(roleFromStorage);
      app.globalData.isLogin = true;
      
      wx.setStorageSync('userInfo', userInfo);
      wx.setStorageSync('openid', openid);
      wx.setStorageSync('isLogin', true);
      
      this.redirectAfterLogin();
    } catch (err) {
      console.error('验证会话请求失败，显示登录表单', err);
      this.setData({ isCheckingLogin: false });
      this.initDatabase();
    }
  },

  // 数据库初始化
  initDatabase: async function() {
    try {
      await api.call('initDataBase', {
        action: 'initAllCollection',
        params: {}
      });
    } catch (err) {
      console.error('数据库初始化失败', err);
    }
  },

  // 用户信息输入处理
  onChooseAvatar: function (e) {
    const avatarUrl = e.detail.avatarUrl;
    if (avatarUrl) {
      this.setData({ 'userInfo.avatarUrl': avatarUrl });
    }
  },

  onInputNickName: function (e) {
    this.setData({ 'userInfo.nickName': e.detail.value });
  },





  // 表单输入处理
  inputChange: function (e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    this.setData({ [`userInfo.${field}`]: value });
    
    if (field === 'authCode' && value && value.length > 10) {
      wx.showToast({
        title: '权限码已粘贴',
        icon: 'success',
        duration: 1500
      });
    }
  },

  // 用户信息保存
  saveUserInfo: async function () {
    const userInfo = this.data.userInfo;
    
    if (!userInfo.avatarUrl) {
      wx.showToast({ title: '请选择头像', icon: 'none' });
      return;
    }
    
    if (!userInfo.nickName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    
    const nicknameValidation = sensitiveWordFilter.validateNickname(userInfo.nickName);
    if (!nicknameValidation.valid) {
      wx.showToast({
        title: nicknameValidation.message,
        icon: 'none',
        duration: 3000
      });
      return;
    }
    
    if (!userInfo.qqId) {
      wx.showToast({ title: '请输入QQ号', icon: 'none' });
      return;
    }
    
    if (!/^[0-9]{5,11}$/.test(userInfo.qqId)) {
      wx.showToast({ title: '请输入正确的QQ号（5-11位数字）', icon: 'none' });
      return;
    }
    
    if (!userInfo.studentId) {
      wx.showToast({ title: '请输入学号/工号', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '正在保存', mask: true });
    this.loginAndSaveUserInfo(userInfo);
  },

  // 登录并保存用户信息
  loginAndSaveUserInfo: async function(userInfo) {
    const app = getApp();
    try {
      const res = await api.call('login', {
        action: 'userInfoAcquisition',
        params: {}
      });

      if (res.success && res.data && res.data.openid) {
        app.globalData.openid = res.data.openid;
        wx.setStorageSync('openid', res.data.openid);
        await this.saveUserInfoToCloud(userInfo, res.data.openid);
      } else {
        wx.hideLoading();
        wx.showToast({
          title: '登录失败，请重试',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('获取openid失败', err);
      wx.hideLoading();
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none'
      });
    }
  },

  // 保存用户信息到云数据库
  saveUserInfoToCloud: async function(userInfo, openid) {
    const app = getApp();
    
    try {
      const uploadResult = await avatarManager.handleAvatarUpload(userInfo.avatarUrl, openid);
      
      // 头像上传失败的处理
      if (!uploadResult.success) {
        console.warn('头像上传失败', uploadResult.error);
        wx.hideLoading();
        
        // 弹出选择框让用户决定
        const modalRes = await new Promise((resolve) => {
          wx.showModal({
            title: '头像上传失败',
            content: '检测到当前网络环境（如校园网）可能限制了图片上传。\n\n您可以选择：\n1. 使用默认头像继续注册\n2. 切换到流量网络后重新提交',
            confirmText: '使用默认头像',
            cancelText: '重新提交',
            success: (res) => resolve(res)
          });
        });
        
        if (!modalRes.confirm) {
          // 用户选择重新提交
          wx.showToast({
            title: '请切换网络后重新提交',
            icon: 'none',
            duration: 2500
          });
          return;
        }
        
        // 用户选择使用默认头像继续
        console.log('用户选择使用默认头像继续注册');
      }
      
      // 定义默认头像（使用本地图片）
      const DEFAULT_AVATAR = iconManager.get('common_logo');
      
      const completeUserInfo = {
        ...userInfo,
        openid: openid,
        avatarUrl: uploadResult.success ? userInfo.avatarUrl : DEFAULT_AVATAR,
        cloudAvatarUrl: uploadResult.success ? uploadResult.cloudAvatarUrl : null,
        cloudAvatarFileID: uploadResult.success ? uploadResult.cloudAvatarFileID : null,
        useDefaultAvatar: !uploadResult.success // 标记是否使用默认头像
      };
      
      wx.showLoading({ title: '正在保存', mask: true });
      
      const saveRes = await api.call('users', {
        action: 'saveUserInfo',
        params: { userInfo: completeUserInfo }
      });

      if (saveRes.success) {
        app.globalData.userInfo = completeUserInfo;
        wx.setStorageSync('userInfo', completeUserInfo);
        
        // 如果使用了默认头像，提示用户
        if (!uploadResult.success) {
          wx.showToast({
            title: '已使用默认头像注册',
            icon: 'none',
            duration: 2000
          });
        }
        
        await this.getUserRole();
      } else {
        throw new Error(saveRes.message || '保存用户信息失败');
      }
      
    } catch (error) {
      console.error('处理用户信息保存失败', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
    }
  },

  // 获取用户角色
  getUserRole: async function() {
    const app = getApp();
    
    try {
      const res = await api.call('login', {
        action: 'userPermissionAuthentication',
        params: { authCode: this.data.userInfo.authCode }
      });
      
      wx.hideLoading();
      
      const role = (res.success && res.data && res.data.role) ? res.data.role : 'user';
      
      app.updateUserRole && app.updateUserRole(role);
      app.globalData.isLogin = true;
      wx.setStorageSync('isLogin', true);
      
      wx.showToast({
        title: '登录成功',
        icon: 'success'
      });
      
      // 角色已更新，直接进入"首页"Tab，确保一进入系统就渲染正确导航
      try {
        router.switchTab && router.switchTab(router.ROUTES.HOME);
      } catch (e) {
        wx.switchTab({ url: '/pages/home/index' });
      }
    } catch (err) {
      console.error('获取用户权限失败', err);
      wx.hideLoading();
      
      const app = getApp();
      app.updateUserRole && app.updateUserRole('user');
      app.globalData.isLogin = true;
      wx.setStorageSync('isLogin', true);
      
      wx.showToast({
        title: '登录成功',
        icon: 'success'
      });
      
      // 角色已更新，直接进入"首页"Tab，确保一进入系统就渲染正确导航
      try {
        router.switchTab && router.switchTab(router.ROUTES.HOME);
      } catch (e) {
        wx.switchTab({ url: '/pages/home/index' });
      }
    }
  },

  // 跳转到登录后的页面
  redirectAfterLogin: function () {
    // 使用路由导航
    router.loginRouter.afterLogin();
  },

  // 打开微信官方隐私协议
  openOfficialPrivacy: function (e) {
    // 阻止事件冒泡，避免触发父级的togglePrivacyAgree
    if (e) {
      e.stopPropagation && e.stopPropagation();
    }
    
    // 调用微信官方隐私协议API
    try {
      wx.openPrivacyContract({
        success: () => {
          console.log('隐私协议页面打开成功');
        },
        fail: (error) => {
          console.error('隐私协议页面打开失败', error);
          wx.showToast({
            title: '打开隐私协议失败',
            icon: 'none'
          });
        }
      });
    } catch (error) {
      console.error('调用隐私协议API失败', error);
      wx.showToast({
        title: '隐私协议功能不可用',
        icon: 'none'
      });
    }
  },



  // 切换隐私协议同意状态
  togglePrivacyAgree: function () {
    this.setData({
      privacyAgree: !this.data.privacyAgree
    });
  },




}) 