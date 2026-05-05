// components/charts/pie-chart/index.js
const BaseChart = require('../base-chart.js');

Component({
  properties: {
    chartData: {
      type: Array,
      value: [],
      observer: 'updateChart'
    },
    width: {
      type: Number,
      value: 300
    },
    height: {
      type: Number,
      value: 300
    },
    legend: {
      type: Boolean,
      value: true
    },
    padding: {
      type: Number,
      value: 24
    }
  },

  data: {
    animationProgress: 0,
    legendItems: [],
    legendSummary: null
  },

  lifetimes: {
    attached() {
      this.colors = BaseChart.COLORS;
    }
  },

  methods: {
    updateChart(newVal) {
      const chartData = newVal !== undefined ? newVal : this.data.chartData;
      if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
        this.setData({ legendItems: [], legendSummary: null });
        return;
      }
      
      this.setData({ chartData });
      BaseChart.animate(this);
      
      const totalWeighted = chartData.reduce((sum, item) => sum + (item.value || 0), 0) || 0;
      const totalRaw = chartData.reduce((sum, item) => sum + Number(item.rawValue || item.value || 0), 0) || 0;

      if (totalWeighted === 0) {
        this.setData({ legendItems: [], legendSummary: null });
        return;
      }

      const legendItems = chartData.map((item, index) => ({
        name: item.name,
        value: Number(item.rawValue || item.value || 0),
        displayValue: this.formatValue(item.rawValue || item.value || 0),
        percent: ((Number(item.value || 0) / totalWeighted) * 100).toFixed(1) + '%',
        color: item.color || this.colors[index % this.colors.length]
      }));
      
      this.setData({
        legendItems,
        legendSummary: {
          raw: this.formatValue(totalRaw),
          weighted: this.formatValue(totalWeighted)
        }
      });
    },

    // 使用公共绘制方法
    drawChart() {
      BaseChart.drawCanvas(this, '#pieCanvas');
    },

    renderChart(ctx) {
      this.renderPieChart(ctx);
    },

    renderPieChart(ctx) {
      const { chartData, width, height, animationProgress, padding } = this.data;
      
      if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 2 - padding;
      const total = chartData.reduce((sum, item) => sum + (item.value || 0), 0);
      
      ctx.clearRect(0, 0, width, height);

      let startAngle = -Math.PI / 2;
      chartData.forEach((item, index) => {
        const weight = item.value || 0;
        if (weight <= 0 || total <= 0) return;

        const angle = (weight / total) * 2 * Math.PI * animationProgress;
        const endAngle = startAngle + angle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = item.color || this.colors[index % this.colors.length];
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        startAngle = endAngle;
      });
    },

    formatValue(value) {
      if (value === null || value === undefined || isNaN(value)) return '0';
      const num = Number(value);
      if (Math.abs(num) < 1000) return num.toFixed(1);
      if (Math.abs(num) < 10000) return num.toFixed(0);
      return (num / 10000).toFixed(1) + '万';
    }
  }
});
