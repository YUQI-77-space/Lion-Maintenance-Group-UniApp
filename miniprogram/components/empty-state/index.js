Component({
  properties: {
    // 图标URL
    icon: {
      type: String,
      value: ''
    },
    // 是否显示默认图标
    showDefaultIcon: {
      type: Boolean,
      value: true
    },
    // 默认图标（emoji）
    defaultIcon: {
      type: String,
      value: '📭'
    },
    // 主文字
    text: {
      type: String,
      value: '暂无数据'
    },
    // 描述文字
    desc: {
      type: String,
      value: ''
    },
    // 操作按钮文字
    actionText: {
      type: String,
      value: ''
    },
    // 操作按钮样式类
    actionClass: {
      type: String,
      value: ''
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    },
    // 尺寸
    size: {
      type: String,
      value: 'normal' // normal | small
    }
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    }
  }
});
