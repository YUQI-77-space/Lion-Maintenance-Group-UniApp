const loading = require('../../utils/loading');
Component({
  data: { visible: false, title: '', mask: false },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      this._page = pages[pages.length - 1];
      this._unsubscribe = loading.subscribe(() => this.setData(loading.getState(this._page)));
    },
    detached() {
      if (this._unsubscribe) this._unsubscribe();
      loading.clear(this._page);
    }
  },
  pageLifetimes: { hide() { loading.clear(this._page); } },
  methods: { block() {} }
});
