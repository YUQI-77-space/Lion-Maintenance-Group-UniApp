/**
 * 图表公共方法
 * 为 pie-chart 和 bar-chart 提供共享的动画和 Canvas 处理逻辑
 */

class BaseChart {
  // 颜色配置
  static COLORS = ['#0066FF', '#00C9A7', '#FFA940', '#FF6B9D', '#9C6ADE'];

  // 获取颜色
  static getColor(index) {
    return this.COLORS[index % this.COLORS.length];
  }

  // 缓动函数：easeOutCubic
  static easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // 启动动画
  static animate(component, onComplete) {
    let progress = 0;
    const duration = onComplete === 'bar' ? 1200 : 1500;
    const interval = 16;
    const steps = duration / interval;

    const timer = setInterval(() => {
      progress += 1 / steps;
      if (progress >= 1) {
        progress = 1;
        clearInterval(timer);
      }
      
      component.setData({ animationProgress: this.easeOutCubic(progress) }, () => {
        this.drawCanvas(component);
      });
    }, interval);
  }

  // 绘制 Canvas（公共初始化逻辑）
  static drawCanvas(component, canvasId) {
    const query = component.createSelectorQuery();
    query.select(canvasId)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;
        
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        
        canvas.width = component.data.width * dpr;
        canvas.height = component.data.height * dpr;
        ctx.scale(dpr, dpr);

        component.renderChart(ctx);
      });
  }

  // 浅色化颜色（用于渐变）
  static lightenColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255))
      .toString(16).slice(1);
  }
}

module.exports = BaseChart;
