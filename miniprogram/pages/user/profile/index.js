const router = require('../../../utils/router');
const avatarManager = require('../../../utils/avatarManager');
const api = require('../../../utils/apiAdapter');
const iconManager = require('../../../utils/iconManager');

Page({
  data: {
    // 导航栏高度
    statusBarHeight: 0,
    navBarHeight: 0,

    // 图标资源
    iconLogo: iconManager.get('common_logo'),
    iconArrowRight: iconManager.get('common_arrow_right'),

    userInfo: {},
    role: 'user',
    roleName: '普通用户',
    functionList: [
      {
        id: 'todo',
        name: '待办事项',
        icon: iconManager.get('status_todo'),
        path: '/pages/user/todo/index'
      },
      {
        id: 'message',
        name: '消息',
        icon: iconManager.get('status_message'),
        path: '/pages/user/message/index'
      },
      {
        id: 'about',
        name: '关于我们',
        icon: iconManager.get('common_about'),
        path: '/pages/user/about/index'
      }
    ],
    _touchStartX: 0,
    _touchStartY: 0,
    pageAnimation: {},
    isAnimating: false,
    // 消息与待办计数
    unreadMessageCount: 0,
    todoCount: 0,
    themeClass: '',
    // 待反馈消息
    pendingFeedbackMessages: [],
    currentFeedbackMessage: null,
    showFeedbackModal: false,
    // 部门相关
    departmentList: ['运营管理部', '电子技术部', '机电维修部'],
    departmentIndex: 0,
    currentDepartment: ''

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
    
    this.getUserInfo();
    // 初始化计数回调
    const app = getApp();
    const initialUnread = (app.globalData && typeof app.globalData.unreadMessageCount === 'number') ? app.globalData.unreadMessageCount : 0;
    this.setData({ unreadMessageCount: initialUnread });
    app.globalData.messageUpdateCallback = (count) => {
      if (typeof count === 'number') {
        this.setData({ unreadMessageCount: count });
      }
    };
    try {
      const cachedTodo = wx.getStorageSync('todoTotalCount');
      if (typeof cachedTodo === 'number') {
        this.setData({ todoCount: cachedTodo });
      } else if (typeof app.globalData.todoTotalCount === 'number') {
        this.setData({ todoCount: app.globalData.todoTotalCount });
      }
    } catch (e) {}
    app.globalData.todoCountUpdateCallback = (total) => {
      if (typeof total === 'number') {
        this.setData({ todoCount: total });
      }
    };
    
    app.globalData.profileRefreshCallback = () => {
      console.log('收到个人资料刷新通知');
      this.getUserInfo();
    };

    this.checkPendingFeedbackMessages();

    // 监听部门信息更新
    if (typeof app.subscribe === 'function') {
      this._unsubDeptReady = app.subscribe('userDepartmentReady', (payload) => {
        const department = payload && typeof payload === 'object'
          ? payload.department
          : (typeof payload === 'string' ? payload : '');
        this.applyDepartmentInfo(department);
      });
    }
    this.applyDepartmentFromGlobal();
  },

  onShow: function () {
    const app = getApp();
    if (app.globalData && app.globalData.needRefreshProfile) {
      console.log('检测到需要刷新个人资料');
      app.globalData.needRefreshProfile = false;
      app.globalData.userInfo = null;
    }

    this.getUserInfo();
    this.initAnimation();

    // 刷新计数（使用全局方法避免重复调用）
    app.getUnreadMessageCount && app.getUnreadMessageCount();
    if (typeof app.globalData.unreadMessageCount === 'number') {
      this.setData({ unreadMessageCount: app.globalData.unreadMessageCount });
    }
    app.getTodoTotalCount && app.getTodoTotalCount();
    if (typeof app.globalData.todoTotalCount === 'number') {
      this.setData({ todoCount: app.globalData.todoTotalCount });
    }

    const tab = this.getTabBar && this.getTabBar();
    tab && tab.setSelectedByRoute && tab.setSelectedByRoute();

    this.checkPendingFeedbackMessages();
  },

  // 底部导航交互控制
  setTabbarInteractionLocked(locked) {
    try {
      const tab = this.getTabBar && this.getTabBar();
      if (tab && typeof tab.setInteractionLocked === 'function') {
        tab.setInteractionLocked(!!locked);
      }
    } catch (e) {}
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

    const nextIdx = dx < 0
      ? (idx + 1) % tabOrder.length
      : (idx - 1 + tabOrder.length) % tabOrder.length;

    const direction = dx < 0 ? 'left' : 'right';
    this.animateAndSwitch(direction, tabOrder[nextIdx]);
  },

  // 用户信息获取
  getUserInfo: async function () {
    const app = getApp();
    
    if (!app || !app.globalData) {
      console.error('app或app.globalData不存在');
      setTimeout(() => {
        this.getUserInfo();
      }, 500);
      return;
    }
    
    if (app.globalData.userInfo) {
      const role = app.globalData.role || 'user';
      let roleName = '普通用户';
      
      if (role === 'member') {
        roleName = '维修组成员';
      } else if (role === 'leader') {
        roleName = '维修组组长';
      }
      
      this.setData({
        userInfo: app.globalData.userInfo,
        role: role,
        roleName: roleName
      });
      
      this.updateAvatarDisplay(app.globalData.userInfo, app.globalData.openid);
      
      // 如果是维修组成员，获取部门信息
      if (role === 'member' || role === 'leader') {
        this.applyDepartmentFromGlobal();
        this.getDepartmentInfo();
      }
    } else if (app.globalData.openid) {
      try {
        const result = await api.call('users', { action: 'getUserByOpenId', params: { openid: app.globalData.openid } });
        if (result.success && result.data) {
          const userInfo = result.data;
          const role = app.globalData.role || 'user';
          let roleName = '普通用户';
          if (role === 'member') {
            roleName = '维修组成员';
          } else if (role === 'leader') {
            roleName = '维修组组长';
          }
          this.setData({ userInfo, role, roleName });
          app.globalData.userInfo = userInfo;
          this.updateAvatarDisplay(userInfo, app.globalData.openid);
          
          // 如果是维修组成员，获取部门信息
          if (role === 'member' || role === 'leader') {
            this.applyDepartmentFromGlobal();
            this.getDepartmentInfo();
          }
        } else {
          this.goToLogin();
        }
      } catch (err) {
        console.error('获取用户信息失败', err);
        this.goToLogin();
      }
    } else {
      this.goToLogin();
    }
  },

  goToLogin: function () {
    router.loginRouter.toLogin();
  },



  // 跳转到功能页面
  navigateTo: function (e) {
    const path = e.currentTarget.dataset.path;
    const id = e.currentTarget.dataset.id;
    
    // 根据ID使用对应的路由方法
    switch (id) {
      case 'todo':
        router.userRouter.toTodo();
        break;
      case 'message':
        router.userRouter.toMessage();
        break;
      case 'about':
        router.userRouter.toAbout();
        break;
      default:
        router.navigateTo(path);
    }
  },

  // 更新头像显示URL
  updateAvatarDisplay: async function(userInfo, openid) {
    try {
      if (!userInfo || !openid) {
        return;
      }
      
      // 检查是否需要强制刷新头像（修改头像后）
      const app = getApp();
      const forceRefresh = app.globalData.needRefreshAvatar || false;
      if (forceRefresh) {
        console.log('检测到头像更新标记，强制刷新头像');
        app.globalData.needRefreshAvatar = false;
      }
      
      // 获取最佳的头像显示URL
      const displayAvatarUrl = await avatarManager.getAvatarDisplayUrl(userInfo, openid, forceRefresh);
      
      // 如果获取到的URL与当前显示的不同，更新显示
      if (displayAvatarUrl !== userInfo.avatarUrl) {
        this.setData({
          'userInfo.avatarUrl': displayAvatarUrl
        });
        
      }
      
    } catch (error) {
      console.error('更新头像显示失败', error);
    }
  },

  // 初始化动画（进入页面或显示时复位）
  initAnimation: function () {
    try {
      const animation = wx.createAnimation({ duration: 0 });
      animation.opacity(1).translateX(0).step();
      this.setData({ pageAnimation: animation.export(), isAnimating: false });
    } catch (e) {
      // 忽略不支持动画的环境
    }
  },
  // 执行动画并在结束后切换Tab
  animateAndSwitch: function (direction, url) {
    if (this.data.isAnimating) return;
    this.setData({ isAnimating: true });
    try {
      const animation = wx.createAnimation({ duration: 220, timingFunction: 'ease-in-out' });
      const offset = direction === 'left' ? -40 : 40;
      animation.translateX(offset).opacity(0.0).step();
      this.setData({ pageAnimation: animation.export() });
      setTimeout(() => {
        wx.switchTab({ url });
      }, 230);
    } catch (e) {
      wx.switchTab({ url });
    }
  },

  // 退出登录
  logout: function () {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: function (res) {
        if (res.confirm) {
          // 清除本地存储
          wx.removeStorageSync('userInfo');
          wx.removeStorageSync('openid');
          wx.removeStorageSync('role');
          wx.removeStorageSync('isLogin');
          
          // 清除全局数据
          const app = getApp();
          app.globalData.userInfo = null;
          app.globalData.openid = '';
          app.globalData.role = 'user';
          app.globalData.isLogin = false;
          
          // 跳转到登录页面
          router.loginRouter.toLogin();
        }
      }
    });
  },

  // 获取待办事项数量
  getTodoCount: async function() {
    try {
      const result = await api.call('userToDoList', {
        action: 'getTodoCount',
        params: { type: 'all' }
      });
      if (result.success && result.data && typeof result.data.total === 'number') {
        this.setData({ todoCount: result.data.total });
      } else {
        this.setData({ todoCount: 0 });
      }
    } catch (err) {
      console.error('获取待办事项数量失败', err);
      this.setData({ todoCount: 0 });
    }
  },

  /**
   * 检查待反馈消息
   */
  async checkPendingFeedbackMessages() {
    try {
      const result = await api.call('pendingFeedbackMessages', {
        action: 'getUnreadFeedbackMessages',
        params: {}
      });

      if (result && result.success) {
        const messages = result.data || [];
        
        this.setData({
          pendingFeedbackMessages: messages
        });

        // 如果有未读消息，显示第一条
        if (messages.length > 0) {
          this.showNextFeedbackMessage();
        }
      } else {
        console.error('获取待反馈消息失败:', result && (result.message || result.code));
      }
    } catch (error) {
      console.error('检查待反馈消息出错:', error);
    }
  },

  /**
   * 显示下一条待反馈消息
   */
  showNextFeedbackMessage() {
    const messages = this.data.pendingFeedbackMessages;
    if (messages.length === 0) {
      // 没有更多消息，隐藏弹窗
      this.setData({
        showFeedbackModal: false,
        currentFeedbackMessage: null
      });
      // 解除底部导航交互锁
      this.setTabbarInteractionLocked(false);
      return;
    }

    // 显示第一条消息
    const currentMessage = messages[0];
    this.setData({
      currentFeedbackMessage: currentMessage,
      showFeedbackModal: true
    });

    // 锁定底部导航交互，防止切换页面逃避处理
    this.setTabbarInteractionLocked(true);
  },

  /**
   * 处理待反馈消息确认
   */
  async onFeedbackConfirm(e) {
    const { messageId, success, error } = e.detail;

    if (success) {
      // 从本地列表中移除已确认的消息
      const updatedMessages = this.data.pendingFeedbackMessages.filter(
        msg => msg._id !== messageId
      );
      
      this.setData({
        pendingFeedbackMessages: updatedMessages
      });

      // 显示下一条消息（如果有的话）
      setTimeout(() => {
        this.showNextFeedbackMessage();
      }, 300);

    } else {
      console.error('待反馈消息处理失败:', error);
      wx.showToast({
        title: '确认失败，请重试',
        icon: 'none'
      });
    }
    
    // 无论成功与否，都应重置组件的加载状态
    const modal = this.selectComponent('#feedbackModal');
    if (modal) {
      modal.resetConfirmState();
    }
  },

  applyDepartmentFromGlobal: function() {
    try {
      const app = getApp();
      if (!app || !app.globalData) return;
      const department = app.globalData.userDepartment
        || (app.globalData.userInfo && app.globalData.userInfo.department)
        || '';
      this.applyDepartmentInfo(department);
    } catch (e) {}
  },

  applyDepartmentInfo: function(department) {
    const safeDept = typeof department === 'string' ? department : '';
    const idx = this.data.departmentList.indexOf(safeDept);
    const nextIndex = safeDept && idx >= 0 ? idx : 0;
    if (safeDept === (this.data.currentDepartment || '') && nextIndex === this.data.departmentIndex) {
      return;
    }
    this.setData({
      currentDepartment: safeDept,
      departmentIndex: nextIndex
    });
  },

  // 获取部门信息
  getDepartmentInfo: async function() {
    try {
      const app = getApp();
      if (!app || !app.globalData) return;
      const openid = app.globalData.openid;
      if (!openid || (this.data.role !== 'member' && this.data.role !== 'leader')) {
        this.applyDepartmentInfo('');
        return;
      }

      // 优先使用已缓存的数据
      this.applyDepartmentFromGlobal();

      if (typeof app.prefetchUserDepartment === 'function') {
        const result = await app.prefetchUserDepartment(openid);
        if (result) {
          this.applyDepartmentInfo(result.department || '');
          return;
        }
      }

      // 兜底：直接请求
      const fallback = await api.call('users', { action: 'getProUserByOpenId', params: { openid } });
      if (fallback && fallback.success) {
        const proUser = fallback.data;
        const department = proUser && proUser.department ? proUser.department : '';
        this.applyDepartmentInfo(department);
        if (app.globalData) {
          app.globalData.userDepartment = department;
          app.globalData.userDepartmentLastChange = proUser ? proUser.lastDepartmentChangeTime || null : null;
        }
      } else {
        this.applyDepartmentInfo('');
      }
    } catch (err) {
      console.error('获取部门信息失败', err);
    }
  },

  // 部门选择变化
  onDepartmentChange: async function(e) {
    const selectedIndex = e.detail.value;
    const selectedDepartment = this.data.departmentList[selectedIndex];
    
    if (selectedDepartment === this.data.currentDepartment) {
      return; // 没有变化
    }
    
    wx.showLoading({ title: '切换中...', mask: true });
    
    try {
      const result = await api.call('users', { 
        action: 'updateDepartment', 
        params: { department: selectedDepartment } 
      });
      
      wx.hideLoading();
      
      if (result.success) {
        wx.showToast({
          title: '部门切换成功',
          icon: 'success'
        });
        
        this.setData({
          currentDepartment: selectedDepartment,
          departmentIndex: selectedIndex
        });
        
        // 更新全局用户信息与全局状态
        const app = getApp();
        const now = (result.data && result.data.lastDepartmentChangeTime) || Date.now();
        if (app.globalData.userInfo) {
          app.globalData.userInfo.department = selectedDepartment;
          app.globalData.userInfo.lastDepartmentChangeTime = now;
        }
        app.globalData.userDepartment = selectedDepartment;
        app.globalData.userDepartmentLastChange = now;
        if (typeof app.publish === 'function') {
          app.publish('userDepartmentReady', { department: selectedDepartment, lastDepartmentChangeTime: now });
        }
        if (typeof app.prefetchUserDepartment === 'function') {
          app.prefetchUserDepartment(app.globalData.openid, { force: true }).catch(() => {});
        }
      } else {
        const message = result.remainingTime
          ? '切换过于频繁，请稍后再试'
          : (result.message || '切换失败');
        wx.showToast({
          title: message,
          icon: 'none',
          duration: 3000
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('切换部门失败', err);
      wx.showToast({
        title: '切换失败，请重试',
        icon: 'none'
      });
    }
  },

  onUnload() {
    const app = getApp();
    if (app && app.globalData) {
      if (app.globalData.messageUpdateCallback) {
        app.globalData.messageUpdateCallback = null;
      }
      if (app.globalData.todoCountUpdateCallback) {
        app.globalData.todoCountUpdateCallback = null;
      }
      if (app.globalData.profileRefreshCallback) {
        app.globalData.profileRefreshCallback = null;
      }
    }
    if (typeof this._unsubDeptReady === 'function') {
      this._unsubDeptReady();
      this._unsubDeptReady = null;
    }
    // 兜底：离开页面时解除底部导航交互锁
    this.setTabbarInteractionLocked(false);
  }
}) 