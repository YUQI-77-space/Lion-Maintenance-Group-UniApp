// pages/team/ewa/summary/index.js
const api = require('../../../../utils/apiAdapter')

// 图表配色统一到全局设计变量，饼图与柱状图共用同一套，避免同一类工作量出现两种颜色
// 维修 = 品牌蓝 var(--primary)，志愿 = 警告橙 var(--warning)，值班 = 青绿
const CHART_COLORS = {
  maintenance: '#0000CD',
  volunteer: '#FAAD14',
  duty: '#00C9A7'
}
// 与 barChartData 的顺序（维修 / 志愿 / 值班）保持一致
const CHART_COLOR_LIST = [CHART_COLORS.maintenance, CHART_COLORS.volunteer, CHART_COLORS.duty]

Page({
  data: {
    loading: true,
    summaryData: {
      totalUsers: 0,
      totalEW: 0,
      totalMaintenanceEW: 0,
      totalDutyEW: 0,
      totalVolunteerEW: 0
    },
    pieChartData: [],
    barChartData: [],
    ringChartData: [],
    chartColors: CHART_COLOR_LIST,
    showCharts: false,
    canvasWidth: 300,
    pieWidth: 260,
    pieHeight: 234
  },

  onLoad() {
    this.calculateCanvasSize()
    this.fetchSummary()
  },

  calculateCanvasSize() {
    const { windowWidth } = wx.getWindowInfo()
    // 画布宽度要扣掉页面内边距 24rpx 与卡片内边距 28rpx（左右各一份），否则会溢出卡片
    const horizontalPadding = (24 + 28) * 2 * windowWidth / 750
    const canvasWidth = Math.max(Math.floor(windowWidth - horizontalPadding), 240)
    const pieWidth = Math.min(canvasWidth, 260)
    this.setData({
      canvasWidth,
      pieWidth,
      pieHeight: Math.round(pieWidth * 0.9)
    })
  },

  formatEW(value) {
    if (value === null || value === undefined || isNaN(value)) return '0'
    const num = Number(value)
    if (num % 1 === 0) return num.toString()
    return Number(num.toFixed(2)).toString()
  },

  async fetchSummary() {
    this.setData({ loading: true })
    try {
      const result = await api.call('equivalentWorkloadAssessment', {
        action: 'getRanking',
        params: { page: 1, pageSize: 100, sortField: 'totalEW', sortOrder: 'desc', includeUserRanking: false }
      })
      if (result.success) {
        const { list = [] } = result.data || {}
        let totalEW = 0
        let totalMaintenanceEW = 0
        let totalDutyEW = 0
        let totalVolunteerEW = 0
        list.forEach(item => {
          totalEW += item.totalEW || 0
          totalMaintenanceEW += item.maintenanceEW || 0
          totalDutyEW += item.dutyEW || 0
          totalVolunteerEW += item.volunteerEW || 0
        })
        // 加权系数与加权合计
        const weights = {
          maintenance: 0.5,
          volunteer: 0.4,
          duty: 0.1
        }

        const weightedMaintenance = totalMaintenanceEW * weights.maintenance
        const weightedVolunteer = totalVolunteerEW * weights.volunteer
        const weightedDuty = totalDutyEW * weights.duty

        const weightedTotal = weightedMaintenance + weightedVolunteer + weightedDuty

        // 饼图数据（使用加权值作图，保留原始值用于展示）
        const pieChartData = [
          {
            name: '维修工作量',
            value: weightedMaintenance,
            rawValue: totalMaintenanceEW,
            color: CHART_COLORS.maintenance
          },
          {
            name: '志愿工作量',
            value: weightedVolunteer,
            rawValue: totalVolunteerEW,
            color: CHART_COLORS.volunteer
          },
          {
            name: '值班工作量',
            value: weightedDuty,
            rawValue: totalDutyEW,
            color: CHART_COLORS.duty
          }
        ].filter(item => item.rawValue > 0)

        const barChartData = [
          { name: '维修', value: totalMaintenanceEW },
          { name: '志愿', value: totalVolunteerEW },
          { name: '值班', value: totalDutyEW }
        ]

        // 各类工作量占比（基于加权值，确保合计=100%）
        const ringChartData = pieChartData.map(item => ({
          name: item.name.replace('工作量', ''),
          value: item.rawValue,
          weightedValue: item.value,
          percentage: weightedTotal > 0 ? (item.value / weightedTotal * 100) : 0,
          color: item.color
        }))

        this.setData({
          summaryData: {
            totalUsers: list.length,
            totalEW,
            totalMaintenanceEW,
            totalDutyEW,
            totalVolunteerEW
          },
          pieChartData,
          barChartData,
          ringChartData
        })

        // 延迟显示图表，产生入场动画效果
        setTimeout(() => {
          this.setData({ showCharts: true })
        }, 300)
      } else {
        wx.showToast({ title: result.message || '获取汇总失败', icon: 'none' })
      }
    } catch (e) {
      console.error('获取汇总失败', e)
      wx.showToast({ title: '获取汇总失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
      wx.stopPullDownRefresh()
    }
  },

  onPullDownRefresh() {
    this.fetchSummary()
  }
})


