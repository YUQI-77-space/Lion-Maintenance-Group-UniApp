const loadingFeedback = require('../../../../utils/loading');
// pages/team/volunteer/list/index.js
const app = getApp()
const api = require('../../../../utils/apiAdapter')
const time = require('../../../../utils/time')
const network = require('../../../../utils/network')

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
    iconEmpty: iconManager.get('common_empty')
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
   * 获取活动列表
   */
  async getActivitiesList(force = false) {
    const status = this.data.currentStatus || 'all';
    const keyword = this.data.searchKeyword || '';
    const page = this.data.page;
    const signature = `${status}:${keyword}:${page}`;
    if (this._readingSignature === signature || (!this.data.hasMore && !force)) return;
    const generation = this._readGeneration = (this._readGeneration || 0) + 1;
    this._readingSignature = signature;
    const owner = app.globalData.openid || '';
    const cacheKey = `vol:list:${owner}:${app.globalData.role}:${signature}`;
    this.setData({ loading: page === 1 && !this.data.activities.length, loadingMore: page > 1, loadError: '' });
    try {
      const params = { page, pageSize: this.data.pageSize,  };
      if (status !== 'all') params.status = status;
      if (keyword) params.keyword = keyword;
      const result = await api.call('volunteerActivities', { action: 'getVolunteerActivitiesList', params });
      if (generation !== this._readGeneration || status !== (this.data.currentStatus || 'all') || keyword !== (this.data.searchKeyword || '') || page !== this.data.page || owner !== app.globalData.openid) return;
      if (!result.success) throw new Error(result.message || '活动读取失败');
      const raw = result.data && result.data.activities || [];
      const rows = this.processActivities(raw);
      const merged = page === 1 ? rows : [...this.data.activities, ...rows.filter(row => !this.data.activities.some(old => old.activityId === row.activityId))];
      this.setData({ activities: merged, page: page + 1, hasMore: result.data && typeof result.data.hasMore === 'boolean' ? result.data.hasMore : rows.length >= this.data.pageSize });
      swr.set(cacheKey, rows, 60);
    } catch (error) {
      if (generation === this._readGeneration) this.setData({ loadError: error.message || '加载失败，原内容已保留' });
    } finally {
      if (generation === this._readGeneration) {
        this._readingSignature = '';
        this.setData({ loading: false, loadingMore: false, initialLoading: false });
      }
    }
  },
  retryActivities() { return this.getActivitiesList(true); },

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

    // 防御：钳制到合法范围，避免拼出 cardDelays[-N] 这类非法 data path。
    if (startIndex < 0) startIndex = 0;
    if (startIndex >= activities.length) return;

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


  /**
   * 统一处理活动衍生字段，确保缓存与实时加载表现一致
   */
  processActivities(rawActivities = []) {
    const statusMap = { pending: '待发布', inPreparation: '筹备中', inProgress: '进行中', ended: '已结束' };
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
      return cloned;
    });
  },

  /**
   * 处理报名/取消报名
   */
  async handleRegister(e) {
    if (this.data.operationBusy) return;
    this.setData({ operationBusy: true });
    try { return await this._guardedHandleRegister(e); }
    finally { this.setData({ operationBusy: false }); }
  },
  async _guardedHandleRegister(e) {
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
    
    loadingFeedback.show({
      title: isRegistered ? '取消报名中...' : '报名中...',
      mask: true
    });
    
    const action = isRegistered ? 'cancelRegistration' : 'registerForVolunteerActivity';

    try {
      // 离线处理逻辑保持不变
      if (!network.isOnline()) {
        wx.showToast({ title: '当前离线，尚未提交，输入已保留', icon: 'none', duration: 2500 });
        loadingFeedback.hide();
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
      loadingFeedback.hide();
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
