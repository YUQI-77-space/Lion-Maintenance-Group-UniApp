Component({
  properties: {
    // 标题文字
    title: {
      type: String,
      value: ''
    },
    // 标题样式变体
    titleClass: {
      type: String,
      value: ''
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    },
    // 是否显示更多
    showMore: {
      type: Boolean,
      value: false
    },
    // 更多文字
    moreText: {
      type: String,
      value: '更多'
    },
    // 是否显示箭头
    showArrow: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    onMoreTap() {
      this.triggerEvent('more');
    }
  }
});
