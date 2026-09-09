// components/charts/bar-chart/index.js
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
      value: 250
    },
    // 自定义配色：按 chartData 顺序取色，未传时回落到 BaseChart.COLORS
    colors: {
      type: Array,
      value: []
    }
  },

  data: {
    animationProgress: 0
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
      if (!chartData || !Array.isArray(chartData) || chartData.length === 0) return;
      
      this._animationStarted = true;
      this.setData({ chartData });
      BaseChart.animate(this, '#barCanvas', 1200);
    },

    renderChart(ctx) {
      this.renderBarChart(ctx);
    },

    renderBarChart(ctx) {
      const { chartData, width, height, animationProgress } = this.data;
      
      if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
        ctx.clearRect(0, 0, width, height);
        return;
      }

      const padding = { top: 30, right: 20, bottom: 50, left: 50 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;

      ctx.clearRect(0, 0, width, height);

      const palette = (this.data.colors && this.data.colors.length) ? this.data.colors : this.colors;
      // 全为 0 时用 1 兜底，避免除零导致柱子高度变成 NaN
      const rawMax = Math.max(...chartData.map(item => Number(item.value) || 0));
      const maxValue = rawMax > 0 ? rawMax : 1;
      const scale = chartHeight / maxValue;
      const barWidth = chartWidth / chartData.length * 0.6;
      const gap = chartWidth / chartData.length * 0.4;

      this.drawYAxis(ctx, padding, chartWidth, chartHeight, maxValue);

      chartData.forEach((item, index) => {
        const value = Number(item.value) || 0;
        const x = padding.left + (chartWidth / chartData.length) * index + gap / 2;
        const barHeight = value * scale * animationProgress;
        const y = padding.top + chartHeight - barHeight;

        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
        const color = palette[index % palette.length];
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, BaseChart.lightenColor(color, 30));
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);

        ctx.beginPath();
        ctx.arc(x + barWidth / 2, y + 4, 4, Math.PI, 0);
        ctx.fill();

        if (animationProgress === 1) {
          ctx.fillStyle = '#333';
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(value.toFixed(1), x + barWidth / 2, y - 12);
        }

        ctx.fillStyle = '#666';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const label = item.name.length > 4 ? item.name.slice(0, 4) : item.name;
        ctx.fillText(label, x + barWidth / 2, padding.top + chartHeight + 10);
      });
    },

    drawYAxis(ctx, padding, chartWidth, chartHeight, maxValue) {
      const steps = 5;
      const stepValue = maxValue / steps;

      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#999';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (let i = 0; i <= steps; i++) {
        const y = padding.top + chartHeight - (chartHeight / steps) * i;
        const value = (stepValue * i).toFixed(0);

        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();

        ctx.fillText(value, padding.left - 10, y);
      }
    }
  }
});
