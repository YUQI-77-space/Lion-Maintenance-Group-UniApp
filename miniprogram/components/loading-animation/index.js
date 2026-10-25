// 双方块交错上浮翻转；尺寸变化不改变动画节奏。
Component({
  properties: {
    size: { type: String, value: 'default' },
    customClass: { type: String, value: '' },
    label: { type: String, value: '加载中' },
    inverse: { type: Boolean, value: false },
    reducedMotion: { type: Boolean, value: false }
  },
  data: { paused: false },
  pageLifetimes: {
    show() { this.setData({ paused: false }); },
    hide() { this.setData({ paused: true }); }
  }
});
