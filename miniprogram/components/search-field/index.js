Component({
  properties: {
    value: { type: String, value: '' },
    placeholder: { type: String, value: '搜索' },
    label: { type: String, value: '' },
    maxlength: { type: Number, value: 140 }
  },
  data: { iconFailed: false },
  methods: {
    onInput(e) {
      this.setData({ value: e.detail.value });
      this.triggerEvent('input', e.detail);
    },
    onConfirm() {
      this.triggerEvent('confirm', { value: this.data.value });
    },
    onClear() {
      this.setData({ value: '' });
      this.triggerEvent('clear', { value: '' });
    },
    onFocus(e) { this.triggerEvent('focus', e.detail); },
    onBlur(e) { this.triggerEvent('blur', e.detail); },
    onIconError() { this.setData({ iconFailed: true }); }
  }
});
