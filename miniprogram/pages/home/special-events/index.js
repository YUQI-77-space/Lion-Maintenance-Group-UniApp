// pages/home/special-events/index.js
const cloudImageManager = require('../../../utils/cloudImageManager');

Page({
  behaviors: [require('../../../utils/pageRefresh')],
  data: {
    specialEvents: [],
    loading: false,
    hasMore: true,
    pageSize: 12,
    currentPage: 1,
    isInitialized: false,
    imageErrors: {}
  },

  onLoad: function (options) {
    this.loadSpecialEvents();
  },

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

    return cloudImageManager.convertCloudFileIdsToTempUrls(pageResult.images).then((withTempUrls) => {
      const newEvents = this.data.currentPage === 1 ? withTempUrls : [...this.data.specialEvents, ...withTempUrls];

      this.setData({
        specialEvents: newEvents,
        loading: false,
        hasMore: pageResult.hasMore,
        currentPage: this.data.currentPage + 1,
        isInitialized: true
      });
    }).catch((err) => {
      console.warn('转换临时链接失败，回退直接使用原始地址:', err);
      const newEvents = this.data.currentPage === 1 ? pageResult.images : [...this.data.specialEvents, ...pageResult.images];

      this.setData({
        specialEvents: newEvents,
        loading: false,
        hasMore: pageResult.hasMore,
        currentPage: this.data.currentPage + 1,
        isInitialized: true
      });
    });
  },

  // 图片加载完成事件
  onImageLoadComplete: function(e) {
    this.setData({
      imageErrors: { ...this.data.imageErrors, [e.currentTarget.dataset.index]: !!e.detail.error }
    });
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    if (this.data.loading) {
      this.setData({ unifiedRefreshing: false });
      return;
    }
    this.setData({
      specialEvents: [],
      imageErrors: {},
      hasMore: true,
      currentPage: 1,
      isInitialized: false
    });
    return this.loadSpecialEvents(true);
  },

  // 上拉加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadSpecialEvents();
    }
  }
});
