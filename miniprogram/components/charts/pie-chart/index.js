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
    legendItems: []
  },

  lifetimes: {
    attached() {
      this.colors = BaseChart.COLORS;
    },
    ready() {
      // 兜底：部分场景下组件初始化时属性 observer 不会触发，这里补一次绘制
      if (this._animationStarted) return;
      const chartData = this.data.chartData;
      if (chartData && chartData.length) {
        this.updateChart(chartData);
      }
    },
    detached() {
      BaseChart.stop(this);
    }
  },

  methods: {
    updateChart(newVal) {
      const chartData = newVal !== undefined ? newVal : this.data.chartData;
      if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
        this.setData({ legendItems: [] });
        return;
      }

      this._animationStarted = true;
      this.setData({ chartData });
      BaseChart.animate(this, '#pieCanvas');

      const totalWeighted = chartData.reduce((sum, item) => sum + (item.value || 0), 0) || 0;

      if (totalWeighted === 0) {
        this.setData({ legendItems: [] });
        return;
      }

      const palette = this.colors || BaseChart.COLORS;
      // 饼图按加权值作图，图例只给「名称 + 加权占比」，不混排原始值，避免两个口径互相误读
      const legendItems = chartData.map((item, index) => ({
        name: item.name,
        percent: ((Number(item.value || 0) / totalWeighted) * 100).toFixed(1) + '%',
        color: item.color || palette[index % palette.length]
      }));

      this.setData({ legendItems });
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
    }
  }
});
