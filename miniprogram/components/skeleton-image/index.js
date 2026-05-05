// components/skeleton-image/index.js
Component({
  properties: {
    src: {
      type: String,
      value: ''
    },
    mode: {
      type: String,
      value: 'aspectFill'
    },
    lazyLoad: {
      type: Boolean,
      value: false
    },
    placeholderColor: {
      type: String,
      value: '#e8ecef'
    }
  },

  data: {
    loaded: false,        // 单个图片是否加载完成
    loadError: false,
    showRealImage: false // 是否显示真实图片
  },

  lifetimes: {
    attached() {
      this.setData({
        loaded: false,
        loadError: false,
        showRealImage: false
      });
    }
  },

  methods: {
    onImageLoad(e) {
      if (this.data.loaded) return;
      
      this.setData({
        loaded: true,
        loadError: false
      });
      
      this.triggerEvent('imageloadcomplete', e.detail);
    },

    onImageError(e) {
      this.setData({
        loadError: true,
        loaded: false
      });
      
      this.triggerEvent('imageloadcomplete', { error: true });
    },

    // 显示真实图片（由父组件控制）
    showImage() {
      this.setData({ showRealImage: true });
    }
  }
});
