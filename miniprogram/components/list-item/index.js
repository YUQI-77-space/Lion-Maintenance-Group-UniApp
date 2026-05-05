Component({
  properties: {
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
    // 标签（如"新"字标签）
    label: {
      type: String,
      value: ''
    },
    // 头像URL
    avatar: {
      type: String,
      value: ''
    },
    // 图标（emoji或文字）
    icon: {
      type: String,
      value: ''
    },
    // 右侧显示值
    value: {
      type: String,
      value: ''
    },
    // 是否显示箭头
    showArrow: {
      type: Boolean,
      value: false
    },
    // 是否显示开关
    showSwitch: {
      type: Boolean,
      value: false
    },
    // 开关是否选中
    checked: {
      type: Boolean,
      value: false
    },
    // 开关是否禁用
    disabled: {
      type: Boolean,
      value: false
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    },
    // 内容区自定义类
    contentClass: {
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
    },
    onSwitchChange(e) {
      this.triggerEvent('change', { value: e.detail.value });
    }
  }
});
