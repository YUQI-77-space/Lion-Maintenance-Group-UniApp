// pages/home/team-spirit/index.js
const app = getApp();
const cloudImageManager = require('../../../utils/cloudImageManager');

// 页面级数据缓存键
const CACHE_KEY = 'teamSpiritCache';

Page({
  data: {
    teamSpirit: [],
    loading: false,
    hasMore: true,
    pageSize: 12,
    currentPage: 1,
    skeletonCount: 12,
    isInitialized: false,
    // 追踪已加载图片数量
    loadedCount: 0,
    totalCount: 0
  },

  onLoad: function (options) {
    this.loadTeamSpirit();
  },

  onShow: function () {},

  onReady: function () {},

  onHide: function () {},

  onUnload: function () {},

  // 加载团队风采图片
  loadTeamSpirit: function(forceRefresh = false) {
    if (this.data.loading || (!forceRefresh && !this.data.hasMore && this.data.teamSpirit.length > 0)) {
      return;
    }

    this.setData({ loading: true });

    if (!forceRefresh && this.data.currentPage === 1 && this.data.teamSpirit.length > 0) {
      this.setData({ loading: false, isInitialized: true });
      return;
    }

    const pageResult = cloudImageManager.getTeamSpiritDetailImages(this.data.currentPage, this.data.pageSize);

    if (pageResult.images.length === 0) {
      this.setData({
        loading: false,
        hasMore: false,
        isInitialized: true
      });
      return;
    }

    cloudImageManager.convertCloudFileIdsToTempUrls(pageResult.images).then((withTempUrls) => {
      const newSpirit = this.data.currentPage === 1 ? withTempUrls : [...this.data.teamSpirit, ...withTempUrls];

      this.setData({
        teamSpirit: newSpirit,
        loading: false,
        hasMore: pageResult.hasMore,
        currentPage: this.data.currentPage + 1,
        isInitialized: true,
        loadedCount: 0,
        totalCount: withTempUrls.length
      });

      this.saveToCache();
    }).catch((err) => {
      console.warn('转换临时链接失败，回退直接使用原始地址:', err);
      const newSpirit = this.data.currentPage === 1 ? pageResult.images : [...this.data.teamSpirit, ...pageResult.images];

      this.setData({
        teamSpirit: newSpirit,
        loading: false,
        hasMore: pageResult.hasMore,
        currentPage: this.data.currentPage + 1,
        isInitialized: true,
        loadedCount: 0,
        totalCount: pageResult.images.length
      });
    });
  },

  // 图片加载完成事件
  onImageLoadComplete: function(e) {
    const newLoadedCount = this.data.loadedCount + 1;
    this.setData({ loadedCount: newLoadedCount });

    // 所有图片加载完成后，显示真实图片
    if (newLoadedCount >= this.data.totalCount && this.data.totalCount > 0) {
      this.showAllImages();
    }
  },

  // 显示所有真实图片
  showAllImages: function() {
    const components = this.selectAllComponents('.skeleton-image');
    components.forEach(comp => {
      if (comp.showImage) {
        comp.showImage();
      }
    });
  },

  // 保存数据到全局缓存
  saveToCache: function() {
    try {
      const cacheData = {
        teamSpirit: this.data.teamSpirit,
        hasMore: this.data.hasMore,
        currentPage: this.data.currentPage,
        timestamp: Date.now()
      };
      if (app.globalData) {
        app.globalData[CACHE_KEY] = cacheData;
      }
    } catch (e) {
      console.warn('保存缓存失败:', e);
    }
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    this.setData({
      teamSpirit: [],
      hasMore: true,
      currentPage: 1,
      isInitialized: false,
      loadedCount: 0,
      totalCount: 0
    });
    this.loadTeamSpirit(true);
    wx.stopPullDownRefresh();
  },

  // 上拉加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadTeamSpirit();
    }
  }
});
