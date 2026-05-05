// pages/home/special-events/index.js
const app = getApp();
const cloudImageManager = require('../../../utils/cloudImageManager');
const iconManager = require('../../../utils/iconManager');

// 页面级数据缓存键
const CACHE_KEY = 'specialEventsCache';

Page({
  data: {
    specialEvents: [],
    loading: false,
    hasMore: true,
    pageSize: 12,
    currentPage: 1,
    skeletonCount: 12,
    isInitialized: false,
    loadedCount: 0,
    totalCount: 0,
    iconEmpty: iconManager.get('common_empty')
  },

  onLoad: function (options) {
    this.loadSpecialEvents();
  },

  onShow: function () {},

  onReady: function () {},

  onHide: function () {},

  onUnload: function () {},

  // 加载特色活动图片
  loadSpecialEvents: function(forceRefresh = false) {
    if (this.data.loading || (!forceRefresh && !this.data.hasMore && this.data.specialEvents.length > 0)) {
      return;
    }

    this.setData({ loading: true });

    if (!forceRefresh && this.data.currentPage === 1 && this.data.specialEvents.length > 0) {
      this.setData({ loading: false, isInitialized: true });
      return;
    }

    const pageResult = cloudImageManager.getSpecialEventsDetailImages(this.data.currentPage, this.data.pageSize);

    if (pageResult.images.length === 0) {
      this.setData({
        loading: false,
        hasMore: false,
        isInitialized: true
      });
      return;
    }

    cloudImageManager.convertCloudFileIdsToTempUrls(pageResult.images).then((withTempUrls) => {
      const newEvents = this.data.currentPage === 1 ? withTempUrls : [...this.data.specialEvents, ...withTempUrls];

      this.setData({
        specialEvents: newEvents,
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
      const newEvents = this.data.currentPage === 1 ? pageResult.images : [...this.data.specialEvents, ...pageResult.images];

      this.setData({
        specialEvents: newEvents,
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
        specialEvents: this.data.specialEvents,
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
      specialEvents: [],
      hasMore: true,
      currentPage: 1,
      isInitialized: false,
      loadedCount: 0,
      totalCount: 0
    });
    this.loadSpecialEvents(true);
    wx.stopPullDownRefresh();
  },

  // 上拉加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadSpecialEvents();
    }
  }
});
