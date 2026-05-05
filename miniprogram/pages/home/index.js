const cloudImageManager = require('../../utils/cloudImageManager');
const iconManager = require('../../utils/iconManager');

Page({
  data: {
    // 状态栏高度
    statusBarHeight: 0,
    navBarHeight: 0,

    // 图标资源
    iconLogo: iconManager.get('common_logo'),

    // 页面滑动与动画
    _touchStartX: 0,
    _touchStartY: 0,
    pageAnimation: {},
    isAnimating: false,
    
    // 轮播图
    swiperImages: [],
    swiperCurrent: 0,
    swiperInterval: 3500,
    swiperDuration: 300,
    swiperTouching: false,
    
    // 功能入口配置
    functionEntries: [
      { id: 1, title: '我要报修', icon: iconManager.get('home_repair'), route: '/pages/repair/index', requireAuth: false, bgColor: '#EBF5FF' },
      { id: 2, title: '值班表', icon: iconManager.get('home_duty'), route: '/pages/team/duty/roster/index', requireAuth: true, requiredRole: 'member', bgColor: '#E8F5E9' },
      { id: 3, title: '维修任务', icon: iconManager.get('home_maintenance'), route: '/pages/team/maintenance/list/index', requireAuth: true, requiredRole: 'member', bgColor: '#FFF8E1' },
      { id: 4, title: '志愿活动', icon: iconManager.get('home_volunteer'), route: '/pages/team/volunteer/list/index', requireAuth: true, requiredRole: 'member', bgColor: '#F3E5F5' }
    ],
    
    // 内容展示
    specialEvents: [],
    teamSpirit: [],
    teamHonors: [],
    conveyorDuration: 12000,
    
    // 加载状态管理
    isLoadingSpecialEvents: false,
    isLoadingTeamSpirit: false,
    isLoadingTeamHonors: false,
    honorsLoadingProgress: 0, // 荣誉图片加载进度 (0-100)
    honorsAllLoaded: false, // 标记所有荣誉图片是否已加载
    
    // 页面状态管理
    isPageUnloaded: false, // 标记页面是否已卸载
    isDataLoaded: false, // 标记数据是否已加载过
    dataLoadTime: 0, // 数据加载时间戳

    // 网络自适应
    _networkType: 'unknown'
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
    
    this.initAnimation();
    
    // 记录网络类型，用于自适应加载策略
    try {
      wx.getNetworkType({
        success: (res) => {
          this._networkType = res.networkType || 'unknown';
        }
      });
    } catch (e) {}
    
    // 数据加载标记：使用 App 级缓存，Tab 切换时不丢失
    const app = getApp();
    if (!app._homeDataLoaded) {
      app._homeDataLoaded = true;
      app._homeDataLoadTime = Date.now();
      this.initSwiperImages();
      this.scheduleContentLoad();
      this.setData({ isDataLoaded: true });
    } else {
      // 临时URL过期检查（30分钟）
      const now = Date.now();
      const loadTime = app._homeDataLoadTime || 0;
      const thirtyMinutes = 30 * 60 * 1000;

      if (now - loadTime > thirtyMinutes && this.data.teamHonors.length > 0) {
        app._homeDataLoadTime = now;
        this.reloadTeamHonors();
      }
    }
  },
  
  // 内容加载调度 - 并行加载策略
  scheduleContentLoad: function() {
    const isSlowNet = this._networkType === '2g' || this._networkType === 'none';
    // 慢网：串行+错峰；正常：并行
    if (isSlowNet) {
      this.initSpecialEvents()
        .then(() => this.initTeamSpirit())
        .then(() => {
          setTimeout(() => { if (!this.data.isPageUnloaded) this.initTeamHonors(true); }, 500);
        })
        .catch(() => {
          setTimeout(() => { if (!this.data.isPageUnloaded) this.initTeamHonors(true); }, 600);
        });
    } else {
      Promise.all([
        this.initSpecialEvents(),
        this.initTeamSpirit()
      ]).then(() => {
        setTimeout(() => {
          if (!this.data.isPageUnloaded) {
            this.initTeamHonors(false);
          }
        }, 300);
      }).catch(() => {
        setTimeout(() => {
          if (!this.data.isPageUnloaded) {
            this.initTeamHonors(false);
          }
        }, 300);
      });
    }
  },

  onShow: function () {
    this.initAnimation();
    const tab = this.getTabBar && this.getTabBar();
    tab && tab.setSelectedByRoute && tab.setSelectedByRoute();
  },

  onReady: function () {
    // 页面渲染完成
  },

  
  // 页面滚动监听
  onPageScroll: function(e) {
    // 使用节流优化性能
    if (this._scrollTimer) {
      return;
    }
    
    this._scrollTimer = setTimeout(() => {
      this._scrollTimer = null;
      
      // 检查是否需要加载剩余的荣誉图片
      this.checkLoadRemainingHonors(e.scrollTop);
    }, 100);
  },
  
  // 检查是否需要加载剩余的荣誉图片
  checkLoadRemainingHonors: function(scrollTop) {
    if (this.data.honorsAllLoaded || this.data.isLoadingTeamHonors || this._isCheckingHonorsLoad) {
      return;
    }
    
    this._isCheckingHonorsLoad = true;
    
    const query = wx.createSelectorQuery();
    query.select('.team-honors-section').boundingClientRect();
    query.selectViewport().scrollOffset();
    
    query.exec((res) => {
      this._isCheckingHonorsLoad = false;
      
      if (!res || res.length < 2) return;
      
      const [honorsRect, viewport] = res;
      if (!honorsRect) return;
      
      const viewportHeight = viewport.height || 667;
      const triggerDistance = 800;
      
      if (honorsRect.top < viewportHeight + triggerDistance && honorsRect.bottom > 0) {
        if (!this.data.honorsAllLoaded && !this.data.isLoadingTeamHonors) {
          this.loadRemainingHonors();
        }
      }
    });
  },


  // 触摸滑动切换页面
  onTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    this.setData({ 
      _touchStartX: touch.clientX, 
      _touchStartY: touch.clientY 
    });
    this.checkIfTouchInSwiper(touch.clientX, touch.clientY);
  },

  onTouchEnd(e) {
    // 检查是否在轮播图区域内滑动，如果是则不处理页面切换
    if (this.data.swiperTouching) return;
    
    // 额外检查：如果最近200ms内有轮播图触摸，也不处理
    if (this._swiperTouchTime && (Date.now() - this._swiperTouchTime < 200)) {
      return;
    }

    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - this.data._touchStartX;
    const dy = endY - this.data._touchStartY;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx < 60 || absDy > 40) return;

    const { getTabOrder } = require('../../utils/router');
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

  // 页面动画控制
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
      setTimeout(() => {
        wx.switchTab({ url });
      }, 230);
    } catch (e) {
      wx.switchTab({ url });
    }
  },

  // 轮播图数据初始化
  initSwiperImages: function() {
    const swiperImages = cloudImageManager.getHomeSwiperImages();

    return cloudImageManager.convertCloudFileIdsToTempUrls(swiperImages).then((withTempUrls) => {
      if (!this.data.isPageUnloaded) {
        this.setData({ swiperImages: withTempUrls }, () => {
          cloudImageManager.preloadImages(withTempUrls);
        });
      }
    }).catch((err) => {
      if (!this.data.isPageUnloaded) {
        this.setData({ swiperImages }, () => {
          cloudImageManager.preloadImages(swiperImages);
        });
      }
    });
  },

  // 轮播图切换事件（节流）
  onSwiperChange: function(e) {
    if (this.swiperChangeTimer) {
      clearTimeout(this.swiperChangeTimer);
    }
    
    this.swiperChangeTimer = setTimeout(() => {
      if (!this.data.isPageUnloaded && this.data.swiperCurrent !== e.detail.current) {
        this.setData({ swiperCurrent: e.detail.current });
      }
    }, 100);
  },

  onSwiperTouchStart: function(e) {
    this.setData({ swiperTouching: true });
    this._swiperTouchTime = Date.now();
  },

  onSwiperTouchMove: function(e) {
    // 持续更新触摸时间，确保滑动过程中不会被中断
    this._swiperTouchTime = Date.now();
  },

  onSwiperTouchEnd: function(e) {
    // 延迟重置状态，确保滑动完全结束
    setTimeout(() => {
      this.setData({ swiperTouching: false });
    }, 50);
  },

  // 轮播图图片加载失败处理
  onImageError: function(e) {
    // 轮播图加载失败，不影响功能
  },

  // 检查触摸点是否在轮播图区域内
  checkIfTouchInSwiper: function(clientX, clientY) {
    const query = wx.createSelectorQuery();
    query.select('.swiper-section').boundingClientRect((rect) => {
      if (rect) {
        const isInSwiper = clientX >= rect.left && 
                          clientX <= rect.right && 
                          clientY >= rect.top && 
                          clientY <= rect.bottom;
        
        if (isInSwiper) {
          this.setData({ swiperTouching: true });
          this._swiperTouchTime = Date.now();
        }
      }
    }).exec();
  },

  // 初始化特色活动数据
  initSpecialEvents: function() {
    if (this.data.isPageUnloaded) return Promise.resolve();
    
    this.setData({ isLoadingSpecialEvents: true });
    const specialEvents = cloudImageManager.getHomeSpecialEvents();

    return cloudImageManager.convertCloudFileIdsToTempUrls(specialEvents).then((withTempUrls) => {
      if (!this.data.isPageUnloaded) {
        this.setData({ 
          specialEvents: withTempUrls,
          isLoadingSpecialEvents: false
        });
      }
    }).catch(() => {
      if (!this.data.isPageUnloaded) {
        this.setData({ 
          specialEvents,
          isLoadingSpecialEvents: false
        });
      }
    });
  },

  // 初始化团队风采数据
  initTeamSpirit: function() {
    if (this.data.isPageUnloaded) return Promise.resolve();
    
    this.setData({ isLoadingTeamSpirit: true });
    const teamSpirit = cloudImageManager.getHomeTeamSpirit();

    return cloudImageManager.convertCloudFileIdsToTempUrls(teamSpirit).then((withTempUrls) => {
      if (!this.data.isPageUnloaded) {
        this.setData({ 
          teamSpirit: withTempUrls,
          isLoadingTeamSpirit: false
        });
      }
    }).catch(() => {
      if (!this.data.isPageUnloaded) {
        this.setData({ 
          teamSpirit,
          isLoadingTeamSpirit: false
        });
      }
    });
  },

  // 功能入口点击事件（兼容 entry-item 组件）
  onEntryItemTap: function(e) {
    const index = e.detail.index;
    if (index !== undefined) {
      this.onFunctionEntryTap({ currentTarget: { dataset: { index } } });
    }
  },

  // 功能入口点击事件
  onFunctionEntryTap: function(e) {
    const index = e.currentTarget.dataset.index;
    const entry = this.data.functionEntries[index];
    
    if (!entry || !entry.route) {
      return;
    }

    // 检查是否需要权限验证
    if (entry.requireAuth) {
      // 获取用户角色
      const app = getApp();
      const userRole = app.globalData.role || wx.getStorageSync('role') || 'user';
      
      // 检查是否有足够权限
      if (entry.requiredRole === 'member') {
        if (userRole !== 'member' && userRole !== 'leader' && userRole !== 'admin') {
          wx.showModal({
            title: '权限不足',
            content: '只有维修组成员才能访问此功能',
            showCancel: false,
            confirmText: '我知道了'
          });
          return;
        }
      } else if (entry.requiredRole === 'leader') {
        if (userRole !== 'leader' && userRole !== 'admin') {
          wx.showModal({
            title: '权限不足',
            content: '只有维修组组长才能访问此功能',
            showCancel: false,
            confirmText: '我知道了'
          });
          return;
        }
      }
    }

    // 权限验证通过，执行跳转（自动兼容 TabBar 页面）
    const router = require('../../utils/router');
    router.navigateTo(entry.route);
  },



  // 特色活动更多按钮
  onSpecialEventsMore: function() {
    wx.navigateTo({
      url: '/pages/home/special-events/index',
      fail: (err) => {
        wx.showToast({
          title: '页面开发中',
          icon: 'none'
        });
      }
    });
  },

  // 团队风采更多按钮
  onTeamSpiritMore: function() {
    wx.navigateTo({
      url: '/pages/home/team-spirit/index',
      fail: (err) => {
        wx.showToast({
          title: '页面开发中',
          icon: 'none'
        });
      }
    });
  },


  // 初始化团队荣誉数据（首屏加载按网络自适应）
  initTeamHonors: function(isSlowNet) {
    if (this.data.isPageUnloaded) return;
    
    const honorsConfig = cloudImageManager.getHomeTeamHonorsConfig();
    const INITIAL_LOAD_COUNT = isSlowNet ? Math.min(8, honorsConfig.total) : 15;
    
    this.setData({ 
      isLoadingTeamHonors: true,
      honorsLoadingProgress: 0,
      honorsAllLoaded: false
    });
    
    const initialHonors = cloudImageManager.getHomeTeamHonorsRange(1, INITIAL_LOAD_COUNT).map(item => ({
      ...item,
      orientation: this.getEstimatedOrientation(item.id),
      displayWidth: 200,
      loaded: false
    }));

    cloudImageManager.convertCloudFileIdsToTempUrls(initialHonors).then((withTempUrls) => {
      if (this.data.isPageUnloaded) return;
      
      this.setData({ 
        teamHonors: withTempUrls,
        honorsLoadingProgress: Math.round((INITIAL_LOAD_COUNT / honorsConfig.total) * 100),
        isLoadingTeamHonors: false
      });
      
      if (INITIAL_LOAD_COUNT >= honorsConfig.total) {
        this.setData({ honorsAllLoaded: true });
      }
    }).catch(() => {
      this.setData({ 
        teamHonors: initialHonors,
        honorsLoadingProgress: Math.round((INITIAL_LOAD_COUNT / honorsConfig.total) * 100),
        isLoadingTeamHonors: false
      });
      
      wx.showToast({
        title: '图片加载较慢',
        icon: 'none',
        duration: 2000
      });
    });
  },

  // 加载剩余荣誉图片
  loadRemainingHonors: function() {
    if (this.data.isPageUnloaded || this.data.honorsAllLoaded || this.data.isLoadingTeamHonors) {
      return;
    }
    
    this.setData({ isLoadingTeamHonors: true });
    
    const honorsConfig = cloudImageManager.getHomeTeamHonorsConfig();
    const INITIAL_LOAD_COUNT = this._networkType === '2g' || this._networkType === 'none' ? 8 : 15;
    const currentCount = this.data.teamHonors.length;
    
    if (currentCount >= honorsConfig.total) {
      this.setData({ 
        honorsAllLoaded: true,
        isLoadingTeamHonors: false,
        honorsLoadingProgress: 100
      });
      return;
    }
    
    const remainingHonors = cloudImageManager.getHomeTeamHonorsRange(
      INITIAL_LOAD_COUNT + 1, 
      honorsConfig.total
    ).map(item => ({
      ...item,
      orientation: this.getEstimatedOrientation(item.id),
      displayWidth: 200,
      loaded: false
    }));
    
    cloudImageManager.convertCloudFileIdsToTempUrls(remainingHonors).then((withTempUrls) => {
      if (this.data.isPageUnloaded) return;
      
      const allHonors = [...this.data.teamHonors, ...withTempUrls];
      const duration = this.getConveyorDurationByTotalWidth(allHonors);
      
      this.setData({ 
        teamHonors: allHonors,
        conveyorDuration: duration,
        honorsLoadingProgress: 100,
        honorsAllLoaded: true,
        isLoadingTeamHonors: false
      });
    }).catch(() => {
      const allHonors = [...this.data.teamHonors, ...remainingHonors];
      const duration = this.getConveyorDurationByTotalWidth(allHonors);
      
      this.setData({ 
        teamHonors: allHonors,
        conveyorDuration: duration,
        honorsAllLoaded: true,
        isLoadingTeamHonors: false
      });
    });
  },
  
  // 重新加载团队荣誉（URL过期处理）
  reloadTeamHonors: function() {
    if (this.data.isPageUnloaded || this.data.isLoadingTeamHonors) return;
    
    this.setData({ 
      teamHonors: [],
      isLoadingTeamHonors: true,
      honorsLoadingProgress: 0,
      honorsAllLoaded: false
    });
    
    this.initTeamHonors();
    this.setData({ dataLoadTime: Date.now() });
  },

  // 预估图片方向
  getEstimatedOrientation: function(index) {
    const landscapeIndexes = [1, 3, 5, 8, 10, 12, 15, 17, 18, 20, 22, 25, 27, 28, 30, 32, 34, 35, 37];
    return landscapeIndexes.includes(index) ? 'landscape' : 'portrait';
  },

  // 计算履带动画时长
  getConveyorDurationByTotalWidth: function(items) {
    const gap = 16;
    const totalWidth = items.reduce((sum, it) => sum + it.displayWidth + gap, 0);
    const duration = Math.max(15000, Math.min(50000, totalWidth * 25));
    return duration;
  },

  // 荣誉图片加载完成
  onHonorImageLoad: function(e) {
    if (this.data.isPageUnloaded) return;
    
    const { id } = e.currentTarget.dataset;
    const { width, height } = e.detail;
    
    if (!width || !height) return;

    const FIXED_HEIGHT = 280;
    const actualRatio = width / height;
    const displayWidth = Math.round(FIXED_HEIGHT * actualRatio);
    const isLandscape = actualRatio >= 1;

    const updated = this.data.teamHonors.map(item =>
      item.id === id
        ? { 
            ...item, 
            orientation: isLandscape ? 'landscape' : 'portrait', 
            ratio: actualRatio, 
            displayWidth: displayWidth,
            loaded: true
          }
        : item
    );

    const duration = this.getConveyorDurationByTotalWidth(updated);
    
    this.setData({ 
      teamHonors: updated, 
      conveyorDuration: duration 
    });
  },

  // 荣誉图片加载失败
  onHonorImageError: function(e) {
    const { id } = e.currentTarget.dataset;
    
    if (!this._failedHonorImages) {
      this._failedHonorImages = new Set();
    }
    this._failedHonorImages.add(id);
    
    const updated = this.data.teamHonors.map(item =>
      item.id === id ? { ...item, failed: true, loaded: false } : item
    );
    
    this.setData({ teamHonors: updated });
    
    const failedCount = this._failedHonorImages.size;
    const totalCount = this.data.teamHonors.length;
    
    // 失败超过10%提示重新加载
    if (failedCount > totalCount * 0.1 && !this._hasShownReloadTip) {
      this._hasShownReloadTip = true;
      
      wx.showModal({
        title: '图片加载提示',
        content: `有${failedCount}张荣誉图片加载失败，可能是网络问题。是否重新加载？`,
        confirmText: '重新加载',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) {
            this._failedHonorImages.clear();
            this._hasShownReloadTip = false;
            this.reloadTeamHonors();
          }
        }
      });
    }
  },

  // 荣誉图片点击（禁用预览）
  onHonorTap: function(e) {
    return;
  },



  // 页面卸载时清理资源
  onUnload: function() {
    this.data.isPageUnloaded = true;
    
    // 清理定时器
    if (this.swiperChangeTimer) {
      clearTimeout(this.swiperChangeTimer);
      this.swiperChangeTimer = null;
    }
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
    
    // 清理缓存
    if (this._failedHonorImages) {
      this._failedHonorImages.clear();
      this._failedHonorImages = null;
    }
    this._hasShownReloadTip = false;
    this._isCheckingHonorsLoad = false;
    this._swiperTouchTime = null;
  }
});
