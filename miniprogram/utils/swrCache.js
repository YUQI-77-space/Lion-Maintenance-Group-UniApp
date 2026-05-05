// 简易 SWR 缓存：优先展示缓存数据，后台静默刷新
// - 使用内存 + 本地存储双层缓存
// - TTL 过期后仍可读旧数据用于首屏占位，再触发刷新

const memoryCache = {};

function now() {
  return Date.now();
}

function readStorage(key) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {}
}

function makeRecord(data, ttlMs) {
  const ts = now();
  return {
    data,
    createdAt: ts,
    ttlMs,
    expireAt: ts + ttlMs
  };
}

function isFresh(record) {
  if (!record) return false;
  return record.expireAt > now();
}

// 读取缓存
// 返回 { data, fresh, exists, createdAt, expireAt }
function get(key) {
  const mem = memoryCache[key];
  let rec = mem || readStorage(key);
  if (!rec) return { data: null, fresh: false, exists: false };
  if (!mem) memoryCache[key] = rec;
  return {
    data: rec.data,
    fresh: isFresh(rec),
    exists: true,
    createdAt: rec.createdAt,
    expireAt: rec.expireAt
  };
}

// 写入缓存，ttlSec: 秒
function set(key, data, ttlSec) {
  const ttlMs = Math.max(0, (ttlSec || 0) * 1000);
  const rec = makeRecord(data, ttlMs);
  memoryCache[key] = rec;
  writeStorage(key, rec);
}

// 判断是否需要重新验证（过期或接近过期）
function shouldRevalidate(key) {
  const { fresh, exists } = get(key);
  return !exists || !fresh;
}

// 清除缓存
function clear(key) {
  delete memoryCache[key];
  try { wx.removeStorageSync(key); } catch (e) {}
}

module.exports = {
  get,
  set,
  shouldRevalidate,
  clear
};


