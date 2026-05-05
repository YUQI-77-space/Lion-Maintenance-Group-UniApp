// pages/team/volunteer/list/index.js
const app = getApp()
const api = require('../../../../utils/apiAdapter')
const time = require('../../../../utils/time')
const network = require('../../../../utils/network')
const outbox = require('../../../../utils/outbox')
const SubscriptionAuth = require('../../../../utils/subscriptionAuth')
const swr = require('../../../../utils/swrCache')
const iconManager = require('../../../../utils/iconManager')

Page({
  /**
   * 页面的初始数据
   */
  data: {
    activities: [],
    currentStatus: 'all',
    openid: '',
    userRole: '',
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    initialLoading: true,  // 初始加载状态，用于显示加载动画
    // 卡片入场动画延迟（毫秒）
    cardDelays: {},
    refresherTriggered: false,
    // 图标资源
    iconCalendar: iconManager.get('team_calendar'),
    iconLocation: iconManager.get('status_location'),
    iconPeople: iconManager.get('status_people'),
    iconEmpty: iconManager.get('common_empty'),

    // 励志名言数据库
    inspirationalQuotes: [
      { text: "志愿服务是一种生活态度，不是一种工作。", author: "玛丽·麦卡锡" },
      { text: "帮助别人解决困难和痛苦是人生最大的幸福和快乐。", author: "爱因斯坦" },
      { text: "人生的价值，并不是用时间，而是用深度量去衡量的。", author: "列夫·托尔斯泰" },
      { text: "一个人的价值，应该看他贡献什么，而不应当看他取得什么。", author: "爱因斯坦" },
      { text: "赠人玫瑰，手有余香。", author: "古语" },
      { text: "只要人人都献出一点爱，世界将变成美好的人间。", author: "韦唯" },
      { text: "善良是一种世界通用的语言。", author: "马克·吐温" },
      { text: "真正的快乐来自于帮助他人。", author: "英国谚语" },
      { text: "我们都是来去匆匆的过客，但总要为这个世界留下些什么。", author: "三毛" },
      { text: "最美好的人生途径就是创造价值。", author: "池田大作" },
      { text: "一个人做点好事并不难，难的是一辈子做好事。", author: "雷锋" },
      { text: "要做的事情总找得出时间和机会，不要做的事情总找得出借口。", author: "张爱玲" }
    ]
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 获取用户openid
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo && userInfo.openid) {
      this.setData({ openid: userInfo.openid })
    }
    // 获取角色（用于报名权限判断）
    const role = app.globalData.role || wx.getStorageSync('role') || ''
    if (role !== this.data.userRole) {
      this.setData({ userRole: role })
    }
    
    // 如果有状态参数，则设置当前状态
    if (options.status) {
      this.setData({
        currentStatus: options.status
      })
    }
    
    // 延迟触发动画，确保数据加载后再播放
    this.setData({ 
      initialLoading: true  // 首次加载显示加载动画
    });
    this._isFirstLoad = true;  // 标记首次加载
    this._playedEnterAnimation = false; // 本次页面会话仅播放一次
    
    // 首次加载时获取列表
    this.setData({ page: 1, hasMore: true, activities: [] })
    this.getActivitiesList()
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 只在非首次加载时刷新数据（从其他页面返回时）
    if (!this._isFirstLoad) {
      // 保留现有列表，静默刷新，避免闪烁
      this.setData({ page: 1, hasMore: true })
      this.getActivitiesList()
    }
    this._isFirstLoad = false;
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },



  /**
   * 获取活动列表
   */
  getActivitiesList: async function(force = false) {
    if (!this.data.hasMore || this.data.loading) return;

    const status = this.data.currentStatus || 'all';
    const role = app.globalData.role || wx.getStorageSync('role') || 'user';
    const userInfo = wx.getStorageSync('userInfo') || {};
    const openid = this.data.openid || userInfo.openid || 'anon';
    const cacheKey = `vol:list:${openid}:${status}:${this.data.page}`;
    const TTL_SEC = 60;

    // 🔥 关键修改：首次加载时，即使有缓存也要显示加载动画，避免用户误认为没有加载
    const cached = swr.get(cacheKey);
    const isFirstPageLoad = this.data.page === 1 && this.data.activities.length === 0;
    
    // 🔥 关键修改：首次加载时，始终显示加载动画（即使有缓存也不立即显示）
    // 这样可以确保用户看到加载过程，避免误认为没有加载就是最新数据
    if (isFirstPageLoad && this.data.initialLoading) {
      // 首次加载时，始终显示加载动画，不立即使用缓存
      this.setData({ loading: true });
    } else if (!cached || !cached.exists) {
      // 非首次加载或没有缓存时，显示加载状态
      this.setData({ loading: true });
    } else if (cached && cached.exists && isFirstPageLoad && !this.data.initialLoading) {
      // 非首次加载的首次页（这种情况很少），可以使用缓存快速展示
      const cachedList = Array.isArray(cached.data) ? cached.data : [];
      const hasMoreFromCache = cachedList.length >= this.data.pageSize;
      this.setData({ activities: cachedList, hasMore: hasMoreFromCache });
      this.playEnterAnimationOnce();
    }

    // 去重
    const nowTs = Date.now();
    if (!force) {
      if (this._fetchingVolList) return;
      // 🔥 关键修改：首次加载时，即使缓存新鲜也要继续请求，确保用户看到加载过程
      if (this._lastVolListFetch && nowTs - this._lastVolListFetch < 800 && cached && cached.fresh && !this.data.initialLoading) {
        this.setData({ loading: false });
        return;
      }
    }
    this._fetchingVolList = true;
    this._lastVolListFetch = nowTs;

    const params = {
      page: this.data.page,
      pageSize: this.data.pageSize
    };
    if (status !== 'all') params.status = status;

    try {
      const result = await api.call('volunteerActivities', { action: 'getVolunteerActivitiesList', params });
      if (result.success) {
        const activities = this.processActivities((result.data && result.data.activities) || []);
        const currentPage = this.data.page;  // 保存当前页码，用于判断是否触发动画
        const nextPage = this.data.page + 1;
        const mergedActivities = this.data.page === 1 ? activities : [...this.data.activities, ...activities];
        const backendHasMore = result.data && typeof result.data.hasMore === 'boolean' ? result.data.hasMore : undefined;
        const hasMore = typeof backendHasMore === 'boolean' ? backendHasMore : (activities.length >= this.data.pageSize);
        
        // 🔥 关键修改：首次加载完成后，同时设置数据和关闭加载状态，避免出现空状态中间帧
        if (currentPage === 1 && this.data.initialLoading) {
          // 在同一个setData中同时设置数据和关闭加载状态，避免出现空状态
          this.setData({ 
            activities: mergedActivities, 
            hasMore, 
            page: nextPage,
            initialLoading: false,  // 同时关闭初始加载状态
            loading: false
          });
          swr.set(cacheKey, mergedActivities, TTL_SEC);
          
          // 短暂延迟后播放动画，确保DOM已更新且数据已渲染
          setTimeout(() => {
            this.playEnterAnimationOnce();
          }, 50);
        } else {
          // 非首次加载或非初始加载状态，直接更新数据
          this.setData({ activities: mergedActivities, hasMore, page: nextPage });
          swr.set(cacheKey, mergedActivities, TTL_SEC);
          // 首次加载页渲染时尝试播放一次性动画
          if (currentPage === 1) {
            // 非初始加载的首次页，也需要播放动画
            setTimeout(() => {
              this.playEnterAnimationOnce();
            }, 100);
          }
        }
        if (currentPage === 1) {
          this.prefetchOtherStatuses();
        }
      } else {
        wx.showToast({ title: result.message || '获取活动列表失败', icon: 'none' });
      }
    } catch (err) {
      console.error('获取活动列表失败', err);
      if (!cached || !cached.exists) {
        wx.showToast({ title: '获取活动列表失败', icon: 'none' });
      }
    } finally {
      this._fetchingVolList = false;
      // 如果不是首次加载的延迟设置场景，直接关闭loading
      // 首次加载的loading会在数据设置时关闭，这里不需要重复关闭
      if (!(this.data.page === 1 && this.data.initialLoading)) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  /**
   * 切换状态筛选
   */
  switchStatus(e) {
    const status = e.currentTarget.dataset.status
    if (status === this.data.currentStatus) return
    
    const openid = this.data.openid || (wx.getStorageSync('userInfo') || {}).openid || 'anon';
    const cacheKey = `vol:list:${openid}:${status}:1`;
    const cached = swr.get(cacheKey);
    const hasCached = cached && cached.exists && Array.isArray(cached.data);
    const cachedList = hasCached ? cached.data : [];
    const nextState = {
      currentStatus: status,
      page: 1,
      hasMore: hasCached ? (cachedList.length >= this.data.pageSize) : true,
      activities: hasCached ? cachedList : [],
      animateCards: false,  // 重置动画状态
      initialLoading: false,  // 切换状态时不是初始加载
      loading: !hasCached  // 若有缓存则无需 loading
    };
    
    this.setData(nextState, () => {
      if (hasCached && cachedList.length > 0) {
        this.triggerCardAnimation(0);
      }
    });
    
    this.getActivitiesList()
  },

  // 触发卡片入场动画（依次入场）
  // startIndex: 从第几张开始动画（用于加载更多场景）
  triggerCardAnimation: function(startIndex = 0) {
    const activities = this.data.activities;
    if (!activities || activities.length === 0) return;

    // 如果不是从头开始，保留已有的动画状态
    if (startIndex === 0) {
      this._animatedCount = 0;
    } else {
      this._animatedCount = this._animatedCount || 0;
    }

    // 为每一张卡片设置动画延迟
    const endIndex = activities.length;
    const delays = {};
    for (let i = startIndex; i < endIndex; i++) {
      const delay = (i - startIndex) * 100; // 每张卡片延迟 100ms
      delays[`cardDelays[${i}]`] = delay;
    }

    // 设置延迟数据，触发动画
    this.setData(delays);
  },

  // 仅播放一次的入场动画
  playEnterAnimationOnce: function() {
    if (this._playedEnterAnimation) return;
    const hasData = Array.isArray(this.data.activities) && this.data.activities.length > 0;
    if (!hasData) return;
    this._playedEnterAnimation = true;
    this.triggerCardAnimation(0);
  },

  // 切换后在后台预取其它状态第一页，优化后续切换体验（不改变现有逻辑）
  prefetchOtherStatuses() {
    const statuses = ['all', 'inPreparation', 'inProgress', 'ended'];
    const current = this.data.currentStatus || 'all';
    const others = statuses.filter(s => s !== current);
    const pageSize = this.data.pageSize;
    const openid = this.data.openid || (wx.getStorageSync('userInfo') || {}).openid || 'anon';
    others.forEach((status) => {
      const cacheKey = `vol:list:${openid}:${status}:1`;
      const cached = swr.get(cacheKey);
      if (cached && cached.fresh) return; // 已有新鲜缓存则跳过
      const params = { page: 1, pageSize };
      if (status !== 'all') params.status = status;
      api.call('volunteerActivities', { action: 'getVolunteerActivitiesList', params })
        .then((result) => {
          if (result && result.success) {
            const activities = this.processActivities((result.data && result.data.activities) || []);
            swr.set(cacheKey, activities, 60);
          }
        })
        .catch(() => {});
    });
  },

  /**
   * 统一处理活动衍生字段，确保缓存与实时加载表现一致
   */
  processActivities(rawActivities = []) {
    const statusMap = { inPreparation: '筹备中', inProgress: '进行中', ended: '已结束' };
    const quotes = this.data.inspirationalQuotes || [];
    return rawActivities.map((item) => {
      const cloned = { ...item };
      cloned.startTimeFormatted = this.formatDate(cloned.startTime);
      cloned.recruitmentOpen = cloned.recruitmentOpen !== false;
      const currentCount = Number(cloned.numberOfVolunteers) || 0;
      const quota = Number(cloned.volunteerCount) || 0;
      cloned.isFull = quota > 0 && currentCount >= quota;
      // 🔥 修复：右上角只显示活动状态（根据活动时间分类），不显示"已满员"或"招募暂时关闭"
      // "已满员"和"招募暂时关闭"只显示在按钮上
      cloned.statusText = statusMap[cloned.activityStatus] || '未知';
      if (cloned.activityStatus === 'ended' && quotes.length > 0) {
        const randomIndex = Math.floor(Math.random() * quotes.length);
        const quote = quotes[randomIndex];
        cloned.inspirationalQuote = quote.text;
        cloned.quoteAuthor = quote.author;
      }
      return cloned;
    });
  },

  /**
   * 处理报名/取消报名
   */
  handleRegister: async function(e) {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    
    const { id: activityId, registered: isRegistered, recruitmentOpen, full, status } = e.currentTarget.dataset;
    
    if (recruitmentOpen === false && !isRegistered) {
      wx.showToast({ title: '该活动已关闭招募', icon: 'none' });
      return;
    }
    
    if (full && !isRegistered) {
      wx.showToast({ title: '名额已满，无法报名', icon: 'none' });
      return;
    }
    
    if (!this.data.openid) {
      wx.navigateTo({ url: '/pages/login/index' });
      return;
    }
    
    if (this.data.userRole !== 'member' && this.data.userRole !== 'leader') {
      wx.showToast({ title: '只有维修组成员才能报名活动', icon: 'none' });
      return;
    }
    
    // 如果是报名（非取消报名），先请求订阅消息授权
    if (!isRegistered) {
      try {
        const authResult = await SubscriptionAuth.requestVolunteerAuth({
          showTip: true,
          allowPartialSuccess: true
        });
        
        // 授权失败不阻止报名流程
      } catch (authError) {
        console.error('订阅消息授权异常:', authError);
        // 授权异常不阻止报名流程
      }
    }
    
    wx.showLoading({
      title: isRegistered ? '取消报名中...' : '报名中...',
      mask: true
    });
    
    const action = isRegistered ? 'cancelRegistration' : 'registerForVolunteerActivity';

    try {
      // 离线处理逻辑保持不变
      if (!network.isOnline()) {
        outbox.add('volunteerActivities', action, { activityId });
        wx.showToast({ title: '网络不稳，已加入队列', icon: 'none', duration: 2500 });
        wx.hideLoading();
        return;
      }
      
      const res = await api.call('volunteerActivities', {
        action: action,
        params: { activityId }
      });

      if (res.success) {
        wx.showToast({
          title: isRegistered ? '已取消报名' : '报名成功',
          icon: 'success'
        });
        
        // 注意：订阅消息授权状态不再需要单独记录
        
        const rawIndex = e.currentTarget.dataset.index;
         const index = Number(rawIndex);
         if (!Number.isNaN(index)) {
           const registered = !!isRegistered;
           const delta = registered ? -1 : 1;
           const pathBase = `activities[${index}]`;
           const updates = {};
           const quota = Number(this.data.activities[index].volunteerCount) || 0;
           const newCount = Math.max(0, (this.data.activities[index].numberOfVolunteers || 0) + delta);
           updates[`${pathBase}.isRegistered`] = !registered;
           updates[`${pathBase}.numberOfVolunteers`] = newCount;
           updates[`${pathBase}.isFull`] = quota > 0 && newCount >= quota;
           this.setData(updates);
         } else {
           this.setData({ page: 1, hasMore: true, activities: [] });
           this.getActivitiesList();
         }
      } else {
        wx.showToast({
          title: res.message || (isRegistered ? '取消报名失败' : '报名失败'),
          icon: 'none'
        });
      }
    } catch (err) {
      console.error(isRegistered ? '取消报名失败' : '报名失败', err);
      wx.showToast({
        title: isRegistered ? '取消报名失败' : '报名失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },



  /**
   * 跳转到活动详情页
   */
  goToDetail(e) {
    const activityId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/team/volunteer/detail/index?id=${activityId}`
    })
  },





  /**
   * 格式化日期
   */
  formatDate(date) {
    return time.formatToMinute(date)
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {},

  // scroll-view 下拉刷新
  onRefresherRefresh: function() {
    this.setData({
      page: 1,
      hasMore: true,
      activities: [],
      animateCards: false,
      initialLoading: false
    });
    this.getActivitiesList().finally(() => {
      this.setData({ refresherTriggered: false });
    });
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.getActivitiesList()
    }
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '志愿活动列表',
      path: '/pages/team/volunteer/list/index'
    }
  }
})