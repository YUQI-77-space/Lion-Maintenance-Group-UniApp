Component({
  properties: {
    // 标题
    title: {
      type: String,
      value: ''
    },
    // 副标题
    subtitle: {
      type: String,
      value: ''
    },
    // 右侧额外信息
    extra: {
      type: String,
      value: ''
    },
    // 底部文字
    footer: {
      type: String,
      value: ''
    },
    // 是否显示阴影（极简风格默认关闭）
    shadow: {
      type: Boolean,
      value: false
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    },
    // 跳转路径
    path: {
      type: String,
      value: ''
    }
  },

  methods: {
    onTap() {
      const { path } = this.data;
      if (path) {
        wx.navigateTo({ url: path });
      }
      this.triggerEvent('tap');
    }
  }
});
