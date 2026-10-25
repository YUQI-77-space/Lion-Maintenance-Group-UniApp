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
      value: '#EEF1F5'
    }
  },

  data: {
    loaded: false,        // 单个图片是否加载完成
    loadError: false,
    showRealImage: false // 是否显示真实图片
  },

  observers: {
    src(src) {
      // 荣誉尺寸等父页数据更新不应让同一地址重新进入加载态。
      if (src === this._imageSrc) return;
      this._imageSrc = src;
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
        loadError: false,
        showRealImage: true
      });
      
      this.triggerEvent('imageloadcomplete', e.detail);
    },

    onImageError(e) {
      this.setData({
        loadError: true,
        loaded: false,
        showRealImage: false
      });
      
      this.triggerEvent('imageloadcomplete', { error: true });
    },

    // 保留旧调用兼容；图片加载成功后已自动展示。
    showImage() {
      if (this.data.loaded && !this.data.loadError) {
        this.setData({ showRealImage: true });
      }
    }
  }
});
