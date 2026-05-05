Component({
  properties: {
    // 图标URL
    icon: {
      type: String,
      value: ''
    },
    // 图标样式类（用于纯文字图标）
    iconClass: {
      type: String,
      value: ''
    },
    // 标题
    title: {
      type: String,
      value: ''
    },
    // 描述
    desc: {
      type: String,
      value: ''
    },
    // 徽章（数字或文字）
    badge: {
      type: String,
      value: ''
    },
    // 徽章样式
    badgeClass: {
      type: String,
      value: ''
    },
    // 是否显示箭头
    showArrow: {
      type: Boolean,
      value: false
    },
    // 是否懒加载
    lazyLoad: {
      type: Boolean,
      value: true
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    },
    // 尺寸变体
    size: {
      type: String,
      value: 'normal' // normal | small | large
    },
    // 跳转路径
    path: {
      type: String,
      value: ''
    },
    // 索引（用于父组件识别）
    itemIndex: {
      type: Number,
      value: 0
    },
    // 背景颜色
    bgColor: {
      type: String,
      value: ''
    }
  },

  methods: {
    onTap(e) {
      const { path, itemIndex } = this.data;
      if (path) {
        wx.navigateTo({ url: path });
      }
      this.triggerEvent('tap', { path, index: itemIndex });
    }
  }
});
