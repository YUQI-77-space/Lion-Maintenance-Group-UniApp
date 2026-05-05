Component({
  properties: {
    // 类型
    type: {
      type: String,
      value: 'default' // default | primary | success | warning | danger
    },
    // 是否填充背景
    filled: {
      type: Boolean,
      value: false
    },
    // 尺寸
    size: {
      type: String,
      value: 'normal' // small | normal | large
    },
    // 是否可关闭
    closable: {
      type: Boolean,
      value: false
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap');
    },
    onClose(e) {
      e.stopPropagation();
      this.triggerEvent('close');
    }
  }
});
