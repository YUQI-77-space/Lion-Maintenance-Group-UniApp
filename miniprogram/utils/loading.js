// 业务等待弹层共用此入口，不修改微信全局 API。
let state = { visible: false, title: '', mask: false };
let owner = null;
const listeners = new Set();
function currentPage() {
  const pages = getCurrentPages();
  return pages[pages.length - 1];
}
function notify() { listeners.forEach(listener => listener()); }
function complete(options, method) {
  const result = { errMsg: `${method}:ok` };
  if (typeof options.success === 'function') options.success(result);
  if (typeof options.complete === 'function') options.complete(result);
  return Promise.resolve(result);
}
module.exports = {
  show(options = {}) {
    owner = currentPage();
    state = { visible: true, title: options.title || '加载中', mask: !!options.mask };
    notify();
    return complete(options, 'showLoading');
  },
  hide(options = {}) {
    state = { visible: false, title: '', mask: false };
    owner = null;
    notify();
    return complete(options, 'hideLoading');
  },
  subscribe(listener) {
    listeners.add(listener);
    listener();
    return () => listeners.delete(listener);
  },
  getState(page) { return { ...state, visible: state.visible && owner === page }; },
  clear(page) { if (owner === page) this.hide(); }
};
