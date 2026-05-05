Component({
  properties: {
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    },
    // 是否包含导航栏
    withNavbar: {
      type: Boolean,
      value: false
    },
    // 是否包含底部标签栏
    withTabbar: {
      type: Boolean,
      value: false
    },
    // 自定义padding
    padding: {
      type: String,
      value: ''
    },
    // 导航栏高度（rpx）
    navbarHeight: {
      type: Number,
      value: 88
    }
  },

  data: {
    paddingStyle: ''
  },

  lifetimes: {
    attached() {
      this.updatePaddingStyle();
    }
  },

  methods: {
    updatePaddingStyle() {
      const { withNavbar, withTabbar, padding } = this.data;
      let style = padding ? `padding: ${padding};` : '';

      if (withNavbar && withTabbar) {
        style += `padding-top: ${this.data.navbarHeight + 20}rpx;`;
        style += `padding-left: var(--space-md);`;
        style += `padding-right: var(--space-md);`;
        style += `padding-bottom: calc(100rpx + env(safe-area-inset-bottom));`;
      } else if (withNavbar) {
        style += `padding-top: ${this.data.navbarHeight + 20}rpx;`;
        style += `padding-left: var(--space-md);`;
        style += `padding-right: var(--space-md);`;
      } else if (withTabbar) {
        style += `padding: var(--space-md);`;
        style += `padding-bottom: calc(100rpx + env(safe-area-inset-bottom));`;
      } else {
        style += `padding: var(--space-md);`;
      }

      this.setData({ paddingStyle: style });
    }
  }
});
