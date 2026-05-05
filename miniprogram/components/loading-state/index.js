Component({
  properties: {
    // 加载文字
    text: {
      type: String,
      value: ''
    },
    // 尺寸
    size: {
      type: String,
      value: 'normal' // small | normal | large
    },
    // 自定义样式类
    customClass: {
      type: String,
      value: ''
    }
  }
});
