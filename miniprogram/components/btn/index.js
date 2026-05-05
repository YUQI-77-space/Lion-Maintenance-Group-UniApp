Component({
  properties: {
    // 按钮类型
    type: {
      type: String,
      value: 'primary' // primary | secondary | success | warning | danger | ghost
    },
    // 尺寸
    size: {
      type: String,
      value: 'normal' // small | normal | large
    },
    // 是否禁用
    disabled: {
      type: Boolean,
      value: false
    },
    // 是否显示加载状态
    loading: {
      type: Boolean,
      value: false
    },
    // 是否块级显示
    block: {
      type: Boolean,
      value: false
    },
    // 图标URL
    icon: {
      type: String,
      value: ''
    },
    // 表单类型
    formType: {
      type: String,
      value: ''
    },
    // 开放能力
    openType: {
      type: String,
      value: ''
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    }
  },

  methods: {
    onTap(e) {
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent('tap', e.detail);
    },
    onGetUserInfo(e) {
      this.triggerEvent('getuserinfo', e.detail);
    },
    onContact(e) {
      this.triggerEvent('contact', e.detail);
    },
    onGetPhoneNumber(e) {
      this.triggerEvent('getphonenumber', e.detail);
    }
  }
});
