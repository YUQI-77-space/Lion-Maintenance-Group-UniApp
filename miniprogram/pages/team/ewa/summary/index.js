const api = require('../../../../utils/apiAdapter');
const router = require('../../../../utils/router');
const display = require('../../../../utils/ewaDisplay');

Page({
  data: {
    loading: true, loadError: '', loaded: false, updatedAt: '', totalUsers: 0,
    totalText: '—', rows: [], hasMissing: false, pieChartData: [], barChartData: [],
    chartColors: display.SERIES.map(item => item.color), canvasWidth: 240,
    pieWidth: 240, pieHeight: 216
  },
  onLoad() {
    if (!router.checkPermission('member')) return;
    const { windowWidth } = require('../../../../utils/layout').getLayout();
    const canvasWidth = Math.max(160, Math.floor(windowWidth - 128 * windowWidth / 750));
    this.setData({ canvasWidth, pieWidth: Math.min(canvasWidth,260), pieHeight: Math.round(Math.min(canvasWidth,260)*.9) });
    this.fetchSummary();
  },
  async fetchSummary() {
    if (this._fetching || !router.checkPermission('member')) return;
    this._fetching = true;
    this.setData({ loading: !this.data.loaded, loadError: '' });
    try {
      // 汇总覆盖全部分页，不能将前 100 人误标为团队合计。
      let page = 1;
      const list = [];
      while (true) {
        const result = await api.call('equivalentWorkloadAssessment', {
          action: 'getRanking', params: { page, pageSize: 100, sortField: 'totalEW', sortOrder: 'desc', includeUserRanking: false }
        });
        if (!result.success || !result.data || !Array.isArray(result.data.list)) throw new Error(result.message || '汇总读取失败');
        const batch = result.data.list;
        list.push(...batch);
        if (!batch.length || (typeof result.data.total === 'number' ? list.length >= result.data.total : batch.length < 100)) break;
        page += 1;
      }
      const summary = display.summarize(list);
      this.setData({
        loaded: true, totalUsers: list.length, ...summary,
        updatedAt: require('../../../../utils/time').formatToMinute(new Date()),
        pieChartData: summary.rows.filter(row => row.contribution > 0).map(row => ({ name: row.name, value: row.contribution, color: row.color })),
        barChartData: summary.rows.filter(row => row.value !== null).map(row => ({ name: row.name, value: row.value, color: row.color }))
      });
    } catch (error) {
      this.setData({ loadError: error.message || '无法读取汇总，请重试' });
    } finally {
      this._fetching = false;
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },
  onPullDownRefresh() { return this.fetchSummary(); }
});
