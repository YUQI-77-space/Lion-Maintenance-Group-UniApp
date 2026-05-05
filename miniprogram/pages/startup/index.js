const iconManager = require('../../utils/iconManager');

Page({
  data: {
    showContent: false,
    fadeOut: false,
    // 启动页背景图（本地资源）
    backgroundImage: iconManager.getStartup('1'),
    // TabBar 图标预加载
    iconTabHomeActive: iconManager.getTab('tab_home_active'),
    iconTabHomeNormal: iconManager.getTab('tab_home_normal')
  },

  timer: null,
  preloadTimer: null,
  _minTimer: null,
  _maxTimer: null,
  _minDwellDone: false,
  _preloadDone: false,
  _verifyDone: false,
  _navigated: false,
  _minDwellMs: 2000,
  _maxWaitMs: 6500,

  onLoad(options) {
    console.log('[Startup] 启动页加载');

    // 并行启动远程验证，利用启动停留时间完成校验，避免淡出后再等待
    try {
      const app = getApp();
      // 单张整图直出：不再进行临时URL转换与事件订阅，直接渲染 data.backgroundImage
      this._verifyPromise = (app && typeof app.verifyUserAccountRemotely === 'function')
        ? app.verifyUserAccountRemotely(1200)
        : Promise.resolve(false);
      // 标记验证完成，用于聚合判断
      this._verifyPromise.then(() => { this._verifyDone = true; this._tryNavigate(); }).catch(() => { this._verifyDone = true; this._tryNavigate(); });
    } catch (e) {
      this._verifyPromise = Promise.resolve(false);
      this._verifyDone = true;
    }
    // 根据网络情况设置最小停留与最大等待时间
    try {
      wx.getNetworkType({
        success: (res) => {
          const isSlow = res.networkType === '2g' || res.networkType === 'none';
          // 最小停留固定为2s（不含退出动画）
          this._minDwellMs = 2000;
          this._maxWaitMs = isSlow ? 8000 : 6500;
          this._startDwellTimers();
        },
        fail: () => {
          this._minDwellMs = 2000;
          this._maxWaitMs = 7000;
          this._startDwellTimers();
        }
      });
    } catch (e) {
      this._minDwellMs = 2000;
      this._maxWaitMs = 7000;
      this._startDwellTimers();
    }
  },

  onReady() {
    wx.nextTick(() => {
      this.setData({ showContent: true });
    });

    // 启动首页资源预加载任务（返回Promise），并设置合理超时兜底
    this.preloadTimer = setTimeout(() => {
      const PRELOAD_TIMEOUT = 3200;
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; this._preloadDone = true; this._tryNavigate(); } };
      try {
        const maybePromise = this.preloadHomeResources();
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(() => done()).catch(() => done());
        } else {
          // 非Promise，给一个短延时视为完成
          setTimeout(done, 600);
        }
      } catch (e) {
        setTimeout(done, 400);
      }
      // 预加载超时保护
      setTimeout(done, PRELOAD_TIMEOUT);
    }, 300);
  },

  onImageLoad(e) {
    console.log('[Startup] 启动图加载成功');
  },

  // 图片加载失败事件
  onImageError(e) {
    console.error('[Startup] 启动图加载失败');
  },

  onUnload() {
    if (this.timer) { try { clearTimeout(this.timer); } catch (e) {} this.timer = null; }
    if (this.preloadTimer) { try { clearTimeout(this.preloadTimer); } catch (e) {} this.preloadTimer = null; }
    if (this._minTimer) { try { clearTimeout(this._minTimer); } catch (e) {} this._minTimer = null; }
    if (this._maxTimer) { try { clearTimeout(this._maxTimer); } catch (e) {} this._maxTimer = null; }
  },

  // 路由守卫：本地缓存优先，后台静默验证（避免登录页闪现）
  async guardAndNavigate() {
    if (this._navigated) return;
    this._navigated = true;
    // 清理计时器
    if (this._minTimer) { try { clearTimeout(this._minTimer); } catch (e) {} this._minTimer = null; }
    if (this._maxTimer) { try { clearTimeout(this._maxTimer); } catch (e) {} this._maxTimer = null; }
    if (this.timer) { try { clearTimeout(this.timer); } catch (e) {} this.timer = null; }

    try {
      const app = getApp();
      
      // 执行跳转
      const doNavigate = (toHome) => {
        console.log('[Startup] 路由决策:', toHome ? '进入首页' : '进入登录页');
        if (toHome) {
          wx.switchTab({
            url: '/pages/home/index',
            fail: (err) => {
              console.error('[Startup] 跳转首页失败:', err);
              wx.reLaunch({ url: '/pages/home/index' });
            }
          });
        } else {
          wx.reLaunch({
            url: '/pages/login/index',
            fail: (err) => {
              console.error('[Startup] 跳转登录失败:', err);
            }
          });
        }
      };

      // 淡出并跳转
      const finish = (shouldGoHome) => {
        this.setData({ fadeOut: true });
        setTimeout(() => doNavigate(!!shouldGoHome), 520);
      };

      // ===== 策略1：优先检查本地缓存（秒判，避免闪现登录页） =====
      const localUserInfo = wx.getStorageSync('userInfo');
      const localOpenid = wx.getStorageSync('openid');
      const localIsLogin = wx.getStorageSync('isLogin');
      
      // 如果本地有完整的登录信息，直接进首页，远程验证作为后台任务
      if (localIsLogin && localUserInfo && localOpenid) {
        console.log('[Startup] 检测到本地登录信息，直接进入首页');
        console.log('[Startup] 用户:', localUserInfo.name || localUserInfo.nickName, '角色:', localUserInfo.role || 'user');
        
        // 后台静默验证（不阻塞跳转，不影响用户体验）
        if (this._verifyPromise && typeof this._verifyPromise.then === 'function') {
          this._verifyPromise
            .then(verified => {
              if (verified) {
                console.log('[Startup] 后台验证成功，用户状态有效');
              } else {
                console.warn('[Startup] 后台验证失败，但不影响已进入的首页');
                // 可选：如果验证失败，在首页显示提示，让用户重新登录
              }
            })
            .catch(err => {
              console.warn('[Startup] 后台验证异常:', err.message);
            });
        }
        
        // 立即跳转首页，不等待远程验证
        return finish(true);
      }

      // ===== 策略2：本地无登录信息，等待远程验证（首次登录场景） =====
      console.log('[Startup] 本地无登录信息，等待远程验证...');
      
      // 尝试等待远程验证（带超时保护）
      if (this._verifyPromise && typeof this._verifyPromise.then === 'function') {
        try {
          const verified = await Promise.race([
            this._verifyPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('验证超时')), 1500))
          ]);
          
          if (verified) {
            console.log('[Startup] 远程验证成功，进入首页');
            return finish(true);
          } else {
            console.log('[Startup] 远程验证失败，进入登录页');
            return finish(false);
          }
        } catch (err) {
          console.warn('[Startup] 远程验证异常或超时:', err.message);
          // 验证超时/失败，进入登录页
          return finish(false);
        }
      }

      // ===== 策略3：兜底，直接跳转登录页 =====
      console.log('[Startup] 无可用验证方式，进入登录页');
      return finish(false);
      
    } catch (err) {
      console.error('[Startup] 路由守卫异常:', err);
      // 异常情况，安全起见跳转登录页
      this.setData({ fadeOut: true });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/login/index' });
      }, 520);
    }
  },

  // 预加载首页资源（返回 Promise）
  preloadHomeResources() {
    console.log('[Startup] 预加载首页资源');
    const cloudImageManager = require('../../utils/cloudImageManager');
    const iconManager = require('../../utils/iconManager');
    const tasks = [];
    try {
      const t = cloudImageManager.prefetchHomeTempUrls && cloudImageManager.prefetchHomeTempUrls({ includeHonors: false });
      if (t && typeof t.then === 'function') tasks.push(t.catch(() => {}));
    } catch (e) {}

    // 批量预热常用图片
    tasks.push(new Promise((resolve) => {
      const imagesToPreload = [
        iconManager.getTab('tab_home_active'),
        iconManager.getTab('tab_home_normal'),
        iconManager.get('status_todo'),
        iconManager.get('status_message'),
        iconManager.get('home_repair'),
        iconManager.get('home_duty'),
        iconManager.get('home_maintenance'),
        iconManager.get('home_volunteer')
      ];
      const batchSize = 3;
      let index = 0;
      const loadBatch = () => {
        const batch = imagesToPreload.slice(index, index + batchSize);
        batch.forEach(src => { wx.getImageInfo({ src, success: () => {}, fail: () => {} }); });
        index += batchSize;
        if (index < imagesToPreload.length) {
          setTimeout(loadBatch, 120);
        } else {
          resolve(true);
        }
      };
      loadBatch();
    }));

    // 非阻塞刷新消息/待办（不纳入阻塞条件）
    try {
      const app = getApp();
      if (app.globalData.isLogin && app.globalData.openid) {
        setTimeout(() => {
          app.getUnreadMessageCount && app.getUnreadMessageCount();
          app.getTodoTotalCount && app.getTodoTotalCount();
        }, 1200);
      }
    } catch (e) {}

    return Promise.allSettled(tasks);
  },

  // 启动最小/最大停留计时
  _startDwellTimers() {
    if (this._minTimer) { try { clearTimeout(this._minTimer); } catch (e) {} }
    if (this._maxTimer) { try { clearTimeout(this._maxTimer); } catch (e) {} }
    this._minTimer = setTimeout(() => { this._minDwellDone = true; this._tryNavigate(); }, this._minDwellMs);
    this._maxTimer = setTimeout(() => { if (!this._navigated) { this.guardAndNavigate(); } }, this._maxWaitMs);
  },

  // 聚合条件尝试导航
  _tryNavigate() {
    if (this._navigated) return;
    if (this._minDwellDone && this._verifyDone && this._preloadDone) {
      this.guardAndNavigate();
    }
  },

  // 分享配置
  onShareAppMessage() {
    const iconManager = require('../../utils/iconManager');
    return {
      title: '维修组管理系统 - 提供更好的服务，遇见更好的自己！',
      path: '/pages/home/index',
      imageUrl: iconManager.get('common_logo')
    };
  }
});

