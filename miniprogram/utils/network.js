/**
 * 网络状态工具（前端）
 * - 统一在线状态获取与订阅
 * - 提供 awaitOnline() 便于在队列/重放时等待网络恢复
 */

let currentOnline = true;
const listeners = new Set();

function notify(status) {
  for (const fn of Array.from(listeners)) {
    try { fn(status); } catch (e) {}
  }
}

/**
 * 初始化网络状态监听（幂等）
 */
function initNetworkListener() {
  if (initNetworkListener._inited) return;
  initNetworkListener._inited = true;

  try {
    wx.getNetworkType({
      success: (res) => {
        currentOnline = res.networkType !== 'none';
        notify(currentOnline);
      }
    });
  } catch (e) {}

  try {
    wx.onNetworkStatusChange && wx.onNetworkStatusChange((res) => {
      const online = !!res.isConnected && res.networkType !== 'none';
      if (online !== currentOnline) {
        currentOnline = online;
        notify(currentOnline);
      }
    });
  } catch (e) {}
}

/**
 * 是否在线
 * @returns {boolean}
 */
function isOnline() {
  return currentOnline;
}

/**
 * 订阅网络状态变化
 * @param {(online:boolean)=>void} cb
 * @returns {() => void} 取消订阅函数
 */
function onStatusChange(cb) {
  if (typeof cb === 'function') {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }
  return () => {};
}

/**
 * 等待网络恢复（可选超时）
 * @param {number} timeoutMs 超时时间，默认不超时
 * @returns {Promise<void>}
 */
function awaitOnline(timeoutMs) {
  if (isOnline()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;
    const off = onStatusChange((online) => {
      if (!online) return;
      if (timer) clearTimeout(timer);
      off();
      resolve();
    });
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timer = setTimeout(() => {
        off();
        reject(new Error('等待网络恢复超时'));
      }, timeoutMs);
    }
  });
}

module.exports = {
  initNetworkListener,
  isOnline,
  onStatusChange,
  awaitOnline
}; 