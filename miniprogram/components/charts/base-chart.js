/**
 * 图表公共方法
 * 为 pie-chart 和 bar-chart 提供共享的动画和 Canvas 处理逻辑
 */

class BaseChart {
  // 颜色配置
  static COLORS = ['#0369D7', '#19734A', '#8A5700'];

  // 获取颜色
  static getColor(index) {
    return this.COLORS[index % this.COLORS.length];
  }

  // 缓动函数：easeOutCubic
  static easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // 启动动画；canvasId 是组件内 canvas 的选择器，必须由调用方传入，否则查询不到节点、画布始终空白
  static animate(component, canvasId, duration = 1500) {
    // 同一组件重复触发（如刷新后数据变化）时，先停掉上一轮动画，避免多个定时器同时绘制
    this.stop(component);

    component.setData({ animationProgress: 1 }, () => this.drawCanvas(component, canvasId));
  }

  // 停止动画（组件卸载或重新播放前调用）
  static stop(component) {
    if (component && component._chartTimer) {
      clearInterval(component._chartTimer);
      component._chartTimer = null;
    }
  }

  // 绘制 Canvas（公共初始化逻辑）
  static drawCanvas(component, canvasId) {
    const query = component.createSelectorQuery();
    query.select(canvasId)
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvasInfo = res && res[0];
        if (!canvasInfo || !canvasInfo.node) {
          // 只提示一次，避免每帧刷屏
          if (!component._queryWarned) {
            component._queryWarned = true;
            console.warn('[base-chart] 未获取到 canvas 节点:', canvasId);
          }
          return;
        }

        const canvas = canvasInfo.node;
        const ctx = canvas.getContext('2d');
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 1;

        const targetWidth = Math.round(component.data.width * dpr);
        const targetHeight = Math.round(component.data.height * dpr);

        // 仅在画布尺寸变化时重新赋值：赋值会清空画布并复位变换
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          component._ctxScaled = false;
        }

        // 用绝对变换代替相对 scale：
        // 若每帧都调用 ctx.scale(dpr, dpr)，而画布尺寸未变时不会复位变换，
        // 缩放会逐帧叠加，图形很快被放大到画布外，最终表现为一片空白
        if (typeof ctx.setTransform === 'function') {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          component._ctxScaled = true;
        } else if (!component._ctxScaled) {
          ctx.scale(dpr, dpr);
          component._ctxScaled = true;
        }

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
