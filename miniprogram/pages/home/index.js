const { getLayout } = require('../../utils/layout');
const cloudImageManager = require('../../utils/cloudImageManager');
const iconManager = require('../../utils/iconManager');
const api = require('../../utils/apiAdapter');
const swr = require('../../utils/swrCache');
const dutyNow = require('../../utils/dutyNow');

// 维修任务状态文案（与列表页 / 管理页 / 详情页保持一致）
const TASK_STATUS_MAP = {
  pending: '待受理',
  inProgress: '进行中',
  completed: '已完成',
  cancelled: '已取消'
};

// 报修进度轨的三个节点
const REPAIR_STEPS = [
  { key: 'pending', label: '待受理' },
  { key: 'inProgress', label: '处理中' },
  { key: 'completed', label: '已完成' }
];

// 工作台数据的缓存有效期（秒）
const WIDGET_TTL = { duty: 120, todos: 60 };
// 刷新下限：距上次请求不足这个间隔就不再打扰后端。
// 取 10s 是为了和 app.js 待办角标的节奏对齐（那边 TTL 10s + 单航班），
// 同时保证「切个页面回来就能看到新建的报修」——原来 60s 的静默期才是数据发馊的原因。
const WIDGET_MIN_INTERVAL_MS = 10 * 1000;

// 首帧就同步取到导航栏高度，避免 onLoad 里再 setData 造成的内容空档/布局跳动
const LAYOUT = getLayout();
const WINDOW_INFO = { windowWidth: LAYOUT.windowWidth };
const STATUS_BAR_HEIGHT = LAYOUT.statusBarHeight;
const NAV_BAR_HEIGHT = LAYOUT.navBarHeight;

// 首帧直出：启动页已预热临时URL缓存，这里同步取用，避免首屏先渲染一片骨架屏
const INITIAL_SWIPER_IMAGES = cloudImageManager.resolveCachedTempUrls(cloudImageManager.getHomeSwiperImages());
const INITIAL_SPECIAL_EVENTS = cloudImageManager.resolveCachedTempUrls(cloudImageManager.getHomeSpecialEvents());
const INITIAL_TEAM_SPIRIT = cloudImageManager.resolveCachedTempUrls(cloudImageManager.getHomeTeamSpirit());

Page({
  data: {
    // 状态栏高度
    statusBarHeight: STATUS_BAR_HEIGHT,
    navBarHeight: NAV_BAR_HEIGHT,
    navbarContentHeight: LAYOUT.navbarContentHeight,
    navbarRight: LAYOUT.navbarRight,
    tabbarHeight: LAYOUT.tabbarHeight,

    // 图标资源
    iconLogo: iconManager.get('common_logo'),

    // 页面滑动与动画
    
    // 轮播图
    swiperImages: INITIAL_SWIPER_IMAGES,
    swiperCurrent: 0,
    swiperImageErrors: {},
    swiperInterval: 3500,
    swiperDuration: 300,
    
    // 功能入口配置
    functionEntries: [
      { id: 1, title: '我要报修', icon: iconManager.get('home_repair'), route: '/pages/repair/index', requireAuth: false, primary: true },
      { id: 2, title: '值班表', icon: iconManager.get('home_duty'), route: '/pages/team/duty/roster/index', requireAuth: true, requiredRole: 'member' },
      { id: 3, title: '维修任务', icon: iconManager.get('home_maintenance'), route: '/pages/team/maintenance/list/index', requireAuth: true, requiredRole: 'member' },
      { id: 4, title: '志愿活动', icon: iconManager.get('home_volunteer'), route: '/pages/team/volunteer/list/index', requireAuth: true, requiredRole: 'member' }
    ],

    // ===== 今日工作台（仅呈现普通用户可见的信息） =====
    userRole: 'user',
    greeting: '你好',
    todayText: '',
    roleText: '',

    // 值班（此刻谁在值班 + 一周值班条）
    duty: null,
    dutyText: { main: '', sub: '', tone: 'muted' },
    dutyLoading: true,

    // 我的待办（我提交的报修进度，仅呈现，不设跳转）
    myTodos: [],
    myTodosTotal: 0,
    todoConfirming: false,

    // 荣誉履带：轻触暂停
    honorsPaused: false,

    // 导航栏是否已滚离顶部（决定毛玻璃的透明度档位）
    navScrolled: false,

    // 内容展示
    specialEvents: INITIAL_SPECIAL_EVENTS,
    specialSmall: INITIAL_SPECIAL_EVENTS.slice(1, 3), // 特色活动「1 大 + 2 小」中的两张小图
    teamSpirit: INITIAL_TEAM_SPIRIT,
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

    // 今日工作台：与图片加载相互独立，不阻塞首帧
    this.initHomeWidgets();
    this._unsubMaintenance = app.subscribe('maintenanceChanged', () => { this._lastTodosFetch = 0; this.loadMyTodos && this.loadMyTodos(true); });
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
    const tab = this.getTabBar && this.getTabBar();
    tab && tab.setSelectedByRoute && tab.setSelectedByRoute();

    // 回到首页时刷新工作台（超过 60s 才重新请求），并恢复「此刻值班」的时间刷新
    this.initHomeWidgets();
    this.startDutyTicker();
  },

  onHide: function () {
    this.stopDutyTicker();
  },

  onReady: function () {
    // 页面渲染完成
  },

  
  // 页面滚动监听
  onPageScroll: function(e) {
    const scrollTop = (e && e.scrollTop) || 0;

    // 导航栏状态：只在跨过阈值时 setData，避免逐帧刷新
    this.applyNavbarScroll(scrollTop);

    // 荣誉图懒加载：节流即可
    if (this._scrollTimer) {
      return;
    }

    this._scrollTimer = setTimeout(() => {
      this._scrollTimer = null;
      this.checkLoadRemainingHonors(scrollTop);
    }, 100);
  },

  // 滚过一点就切到「更实的玻璃底」，回顶时再透回头图。
  // 阈值留了回滞（8 / 2），防止在临界点来回抖动。
  applyNavbarScroll: function (scrollTop) {
    const scrolled = this._navScrolled ? scrollTop > 2 : scrollTop > 8;
    if (scrolled === this._navScrolled) return;
    this._navScrolled = scrolled;
    this.setData({ navScrolled: scrolled });
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




  // 轮播图图片加载失败处理
  onImageError: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isInteger(index) && index >= 0) this.setData({ [`swiperImageErrors[${index}]`]: true });
  },

  // 检查触摸点是否在横向滑动区域内（轮播图 / 团队风采横滑条）
  // 命中则不触发「滑动切 Tab」，避免横滑时误切页面

  // 初始化特色活动数据
  initSpecialEvents: function() {
    if (this.data.isPageUnloaded) return Promise.resolve();
    
    this.setData({ isLoadingSpecialEvents: true });
    const specialEvents = cloudImageManager.getHomeSpecialEvents();

    return cloudImageManager.convertCloudFileIdsToTempUrls(specialEvents).then((withTempUrls) => {
      if (!this.data.isPageUnloaded) {
        this.setData({ 
          specialEvents: withTempUrls,
          specialSmall: withTempUrls.slice(1, 3),
          isLoadingSpecialEvents: false
        });
      }
    }).catch(() => {
      if (!this.data.isPageUnloaded) {
        this.setData({ 
          specialEvents,
          specialSmall: specialEvents.slice(1, 3),
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

  openTodoList() { require('../../utils/router').userRouter.toTodo(); },
  openRepairProgress(e) {
    const id = e.currentTarget.dataset.id;
    if (id) require('../../utils/router').navigateTo('/pages/user/todo/maintenance-detail/index', { taskId: id });
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

  // ==================== 今日工作台（值班 / 我的 / 招募 / 数据） ====================

  // 问候语、日期、角色文案
  buildHeadText: function () {
    const now = new Date();
    const h = now.getHours();
    let base = '你好';
    if (h < 5) base = '夜深了';
    else if (h < 11) base = '上午好';
    else if (h < 14) base = '中午好';
    else if (h < 18) base = '下午好';
    else base = '晚上好';

    let nickName = '';
    try {
      const app = getApp();
      const info = (app && app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {};
      nickName = String(info.nickName || '').trim();
    } catch (e) {}

    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const roleTextMap = { user: '同学', member: '组员', leader: '组长', admin: '管理员' };

    return {
      greeting: nickName ? `${base}，${nickName}` : base,
      todayText: `${now.getMonth() + 1}月${now.getDate()}日 ${weekNames[now.getDay()]}`,
      roleText: roleTextMap[this._role || 'user'] || '同学'
    };
  },

  getOpenid: function () {
    try {
      const app = getApp();
      if (app && app.globalData && app.globalData.openid) return app.globalData.openid;
      const info = wx.getStorageSync('userInfo') || {};
      return info.openid || '';
    } catch (e) {
      return '';
    }
  },

  // 工作台入口：先缓存直出，再后台刷新（绝不阻塞首帧）
  // 注意：首页只呈现「普通用户视角」的信息——当下值班状态 + 我自己的报修进度。
  // 维修组内部的东西（EW、待认领任务池、我的值班等）一律不在首页出现。
  initHomeWidgets: function () {
    const app = getApp();
    const role = (app && app.globalData && app.globalData.role) || wx.getStorageSync('role') || 'user';

    // setData 是异步的：角色判断同时落到实例字段，供后续同步读取
    this._role = role;

    this.setData({ userRole: role });
    this.setData(this.buildHeadText());

    // 缓存只负责首帧不空白，数据新鲜度交给下面的补拉
    this.renderWidgetsFromCache();
    this.refreshWidgets(false);
  },

  // 补拉工作台数据（值班 + 我的待办）
  // force=true 用于下拉刷新：无视间隔，强制拉一次
  refreshWidgets: function (force) {
    if (!force && Date.now() - (this._widgetsFetchedAt || 0) < WIDGET_MIN_INTERVAL_MS) {
      return Promise.resolve();
    }
    this._widgetsFetchedAt = Date.now();
    return Promise.all([this.loadDutyStatus(), this.loadMyTodos()]);
  },

  // 下拉刷新：手动路径，必须绕开间隔限制，否则用户拉一下却什么都没发生
  onPullDownRefresh: function () {
    this.refreshWidgets(true).then(() => {
      wx.stopPullDownRefresh();
      wx.showToast({ title: '已刷新', icon: 'none', duration: 1200 });
    }).catch(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 用缓存填充区块，不发请求
  renderWidgetsFromCache: function () {
    const openid = this.getOpenid();

    const cachedDuty = swr.get('home:duty');
    if (cachedDuty && cachedDuty.exists && cachedDuty.data) {
      this._dutyPayload = cachedDuty.data;
      this.applyDutyStatus();
    }

    const cachedTodos = swr.get(`home:todos:${openid}`);
    if (cachedTodos && cachedTodos.exists) {
      this.applyTodos(cachedTodos.data || []);
    }
  },

  // 值班数据：所有人可见（云函数未做角色限制）
  loadDutyStatus: function () {
    return api.call('dutySchedule', { action: 'getDutySlots', params: {} })
      .then((res) => {
        if (this.data.isPageUnloaded) return;
        if (res && res.success && res.data) {
          this._dutyPayload = res.data;
          swr.set('home:duty', res.data, WIDGET_TTL.duty);
        }
        this.applyDutyStatus();
      })
      .catch(() => {
        if (this.data.isPageUnloaded) return;
        // 请求失败：保留已有缓存，否则显示「暂不可用」兜底
        this.applyDutyStatus();
      });
  },

  // 依据缓存的原始数据重算值班状态（可随时用当前时间刷新，不必重新请求）
  applyDutyStatus: function () {
    const duty = dutyNow.buildDutyStatus(this._dutyPayload, new Date());

    this.setData({
      duty,
      dutyText: dutyNow.buildDutyText(duty),
      dutyLoading: false
    });
  },

  // 「此刻值班 / 还剩多久」每分钟刷新一次
  startDutyTicker: function () {
    this.stopDutyTicker();
    this._dutyTicker = setInterval(() => {
      if (this.data.isPageUnloaded) {
        this.stopDutyTicker();
        return;
      }
      if (!this._dutyPayload) return;
      this.applyDutyStatus();
    }, 60 * 1000);
  },

  stopDutyTicker: function () {
    if (this._dutyTicker) {
      clearInterval(this._dutyTicker);
      this._dutyTicker = null;
    }
  },

  // 我的待办：我提交的报修进度（普通用户视角，所有角色一视同仁）
  loadMyTodos: function () {
    const openid = this.getOpenid();
    if (!openid) return Promise.resolve();

    return api.call('userToDoList', {
      action: 'getTodoList',
      params: { type: 'maintenance', userId: openid }
    }).then((res) => {
      if (this.data.isPageUnloaded) return;
      // 失败时既不覆盖已有列表、也不写缓存，否则一次 500 会让卡片空 60s
      if (!res || !res.success) return;
      const list = Array.isArray(res.data) ? res.data : [];
      // 只呈现进行中的：已完成 / 已撤销不再占用首页位置
      const active = list.filter(t => t && (t.taskStatus === 'pending' || t.taskStatus === 'inProgress'));
      swr.set(`home:todos:${openid}`, active, WIDGET_TTL.todos);
      this.applyTodos(active);
    }).catch(() => {});
  },

  // 全部进行中的待办都铺出来，总数由标题旁的数量胶囊提示
  applyTodos: function (active) {
    const list = (active || []).map(t => this.buildTodoItem(t));
    this.setData({
      myTodos: list,
      myTodosTotal: list.length
    });
  },

  buildTodoItem: function (task) {
    const stepIndex = task.taskStatus === 'inProgress' ? 1 : 0;
    return {
      taskId: task.taskId || '',
      title: task.level3 || task.level2 || '维修任务',
      category: [task.level1, task.level2].filter(Boolean).join(' · '),
      taskStatus: task.taskStatus,
      statusText: TASK_STATUS_MAP[task.taskStatus] || '',
      steps: REPAIR_STEPS.map((s, i) => ({ key: s.key, label: s.label, on: i <= stepIndex, cur: i === stepIndex })),
      assigneeName: task.assigneeName || '',
      appointmentTime: task.appointmentTime || '',
      canConfirm: task.taskStatus === 'inProgress'
    };
  },

  // 申请人确认完成（与待办页同一套接口）
  onConfirmTodo: async function (e) {
    const taskId = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!taskId || this.data.todoConfirming) return;

    const modalRes = await new Promise(resolve => {
      wx.showModal({
        title: '确认完成',
        content: '确认此维修任务已完成吗？',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes || !modalRes.confirm) return;

    this.setData({ todoConfirming: true });
    wx.showLoading({ title: '处理中...' });
    try {
      const res = await api.call('maintenanceTasks', {
        action: 'completeMaintenanceTask', config: { retries: 0 },
        params: {
          maintenanceTaskId: taskId,
          completeTime: new Date().toISOString()
        }
      });
      wx.hideLoading();
      if (res && res.success) {
        wx.showToast({ title: '任务已完成', icon: 'success', duration: 1600 });
        swr.clear(`home:todos:${this.getOpenid()}`);
        const app = getApp();
        app.getTodoTotalCount && app.getTodoTotalCount();
        setTimeout(() => { if (!this.data.isPageUnloaded) this.loadMyTodos(); }, 600);
      } else {
        wx.showToast({ title: (res && res.message) || '操作失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      this.setData({ todoConfirming: false });
    }
  },

  // 荣誉履带：轻触暂停 / 继续
  toggleHonorsPause: function () {
    this.setData({ honorsPaused: !this.data.honorsPaused });
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
    if (this._unsubMaintenance) this._unsubMaintenance();
    this.data.isPageUnloaded = true;

    // 清理定时器
    this.stopDutyTicker();
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
