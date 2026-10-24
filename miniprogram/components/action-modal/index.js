Component({
  properties: {
    visible: Boolean, title: String, subtitle: String,
    confirmText: { type: String, value: '确认' },
    cancelText: { type: String, value: '取消' },
    loading: Boolean, disabled: Boolean, danger: Boolean, bottom: Boolean
  },
  methods: {
    stopPropagation() {},
    onMaskTap() { if (this.data.bottom) this.cancel(); },
    cancel() { if (!this.data.loading) this.triggerEvent('cancel'); },
    confirm() { if (!this.data.loading && !this.data.disabled) this.triggerEvent('confirm'); }
  }
});
