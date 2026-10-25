// pages/home/team-spirit/index.js
const cloudImageManager = require('../../../utils/cloudImageManager');

Page({
  behaviors: [require('../../../utils/pageRefresh')],
  data: {
    teamSpirit: [],
    loading: false,
    hasMore: true,
    pageSize: 12,
    currentPage: 1,
    isInitialized: false,
    // 页面级图片失败状态，用于展示刷新提示
    imageErrors: {}
  },

  onLoad: function (options) {
    this.loadTeamSpirit();
  },

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

    return cloudImageManager.convertCloudFileIdsToTempUrls(pageResult.images).then((withTempUrls) => {
      const newSpirit = this.data.currentPage === 1 ? withTempUrls : [...this.data.teamSpirit, ...withTempUrls];

      this.setData({
        teamSpirit: newSpirit,
        loading: false,
        hasMore: pageResult.hasMore,
        currentPage: this.data.currentPage + 1,
        isInitialized: true
      });
    }).catch((err) => {
      console.warn('转换临时链接失败，回退直接使用原始地址:', err);
      const newSpirit = this.data.currentPage === 1 ? pageResult.images : [...this.data.teamSpirit, ...pageResult.images];

      this.setData({
        teamSpirit: newSpirit,
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
      teamSpirit: [],
      imageErrors: {},
      hasMore: true,
      currentPage: 1,
      isInitialized: false
    });
    return this.loadTeamSpirit(true);
  },

  // 上拉加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadTeamSpirit();
    }
  }
});
