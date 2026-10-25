// 原生下拉刷新迁移到 scroll-view 后，继续分发页面原有业务处理。
module.exports = Behavior({
  data: { unifiedRefreshing: false, unifiedScrollTop: 0 },
  methods: {
    onUnifiedRefresh() {
      if (this.data.unifiedRefreshing) return;
      this.setData({ unifiedRefreshing: true });
      try {
        const request = this.onPullDownRefresh();
        if (request && typeof request.finally === 'function') {
          request.finally(() => this.setData({ unifiedRefreshing: false })).catch(() => {});
        }
      } catch (error) {
        this.setData({ unifiedRefreshing: false });
        throw error;
      }
    },
    onUnifiedScroll(event) {
      if (this.onPageScroll) this.onPageScroll(event.detail);
    },
    onUnifiedBottom() {
      if (this.onReachBottom) this.onReachBottom();
    }
  }
});
