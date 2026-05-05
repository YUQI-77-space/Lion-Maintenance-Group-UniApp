/**
 * 离线队列（Outbox）骨架
 * - 目标：在不改页面的前提下，提供写操作的离线排队与断线重放能力
 * - 使用：后续在写操作处改为 outbox.add(...) 或封装适配后接入
 * - 当前文件仅提供能力，不进行自动接入，避免影响现有功能
 */

const api = require('./apiAdapter');
const network = require('./network');

// 存储键与版本
const STORAGE_KEY = 'OUTBOX_QUEUE_V1';

// 队列项结构：
// {
//   id: string,                 // 幂等ID，同时用于 apiAdapter.config.requestId
//   name: string,               // 云函数名
//   action: string,             // 动作
//   params: object,             // 参数
//   createdAt: number,
//   attempts: number,           // 已尝试次数
//   maxAttempts: number,        // 最大尝试次数（含首次）
//   status: 'pending'|'done'|'failed',
//   lastError: string|null,
//   nextAvailableAt: number     // 下次可重试时间戳（ms）
// }

const DEFAULT_MAX_ATTEMPTS = 6; // 总尝试次数（与 apiAdapter 内部重试叠加）
const BASE_BACKOFF_MS = 1000;   // 1s
const BACKOFF_FACTOR = 2;       // 指数退避
const MAX_BACKOFF_MS = 30 * 1000; // 30s
const MAX_QUEUE_LENGTH = 200;   // 防止无限增长

let processing = false; // 并发保护
let autoStarted = false; // 自动重放是否启动
let unsubscribeNetwork = null; // 取消网络监听

function now() { return Date.now(); }

function computeBackoffDelay(attemptIndex) {
  const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(BACKOFF_FACTOR, Math.max(0, attemptIndex - 1)));
  const jitter = Math.random() * 0.4 + 0.8; // 0.8x - 1.2x
  return Math.floor(delay * jitter);
}

function loadQueue() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveQueue(queue) {
  try {
    wx.setStorageSync(STORAGE_KEY, queue);
  } catch (e) {}
}

function trimQueue(queue) {
  if (queue.length <= MAX_QUEUE_LENGTH) return queue;
  // 移除最旧且非 pending 的；仍超长则从最旧 pending 开始删
  let result = queue.slice();
  result.sort((a, b) => a.createdAt - b.createdAt);
  let i = 0;
  while (result.length > MAX_QUEUE_LENGTH && i < result.length) {
    if (result[i].status !== 'pending') {
      result.splice(i, 1);
    } else {
      i++;
    }
  }
  while (result.length > MAX_QUEUE_LENGTH) {
    result.shift();
  }
  return result;
}

function createItem(name, action, params, options = {}) {
  const id = options.requestId || api.generateRequestId();
  const item = {
    id,
    name,
    action,
    params: params || {},
    createdAt: now(),
    attempts: 0,
    maxAttempts: typeof options.maxAttempts === 'number' ? options.maxAttempts : DEFAULT_MAX_ATTEMPTS,
    status: 'pending',
    lastError: null,
    nextAvailableAt: 0
  };
  return item;
}

/**
 * 入队：返回队列项
 */
function add(name, action, params, options = {}) {
  const queue = loadQueue();
  const item = createItem(name, action, params, options);
  queue.push(item);
  saveQueue(trimQueue(queue));
  return item;
}

/**
 * 取消队列项（尚未开始处理）
 */
function cancel(id) {
  if (!id) return false;
  const queue = loadQueue();
  const idx = queue.findIndex(x => x.id === id && x.status === 'pending');
  if (idx >= 0) {
    queue.splice(idx, 1);
    saveQueue(queue);
    return true;
  }
  return false;
}

function isEligible(item) {
  return item.status === 'pending' && item.nextAvailableAt <= now();
}

async function processItem(item) {
  // 等待网络在线
  if (!network.isOnline()) {
    await network.awaitOnline();
  }

  item.attempts += 1;
  try {
    const res = await api.call(item.name, {
      action: item.action,
      params: item.params,
      config: { requestId: item.id, retries: 0 }
    });

    if (res && res.success) {
      item.status = 'done';
      item.lastError = null;
      return { success: true, result: res };
    }

    // 业务失败：不再重试，避免重复副作用
    item.status = 'failed';
    item.lastError = (res && res.message) || '业务失败';
    return { success: false, result: res };
  } catch (err) {
    // 网络/未知异常：根据 attempts 退避重试
    if (item.attempts >= item.maxAttempts) {
      item.status = 'failed';
      item.lastError = (err && (err.message || err.errMsg)) || '未知错误';
      return { success: false, error: err };
    }
    const backoff = computeBackoffDelay(item.attempts);
    item.nextAvailableAt = now() + backoff;
    item.lastError = (err && (err.message || err.errMsg)) || '网络错误';
    return { success: false, retry: true, error: err };
  }
}

/**
 * 处理队列：一次或直到为空
 */
async function processQueue(options = {}) {
  if (processing) return { running: true };
  processing = true;
  try {
    const untilEmpty = !!options.untilEmpty;
    let safetyCounter = 0; // 防御性防止无限循环

    do {
      let queue = loadQueue();
      const idx = queue.findIndex(isEligible);
      if (idx < 0) {
        // 没有可处理项，结束
        return { done: true };
      }

      const item = queue[idx];
      const result = await processItem(item);

      // 根据状态更新/移除
      const updated = loadQueue();
      const pos = updated.findIndex(x => x.id === item.id);
      if (pos >= 0) {
        if (item.status === 'done' || item.status === 'failed') {
          updated.splice(pos, 1);
        } else {
          updated[pos] = item;
        }
        saveQueue(updated);
      }

      safetyCounter += 1;
      if (safetyCounter > 500) {
        return { aborted: true };
      }
    } while (options.untilEmpty);

    return { done: true };
  } finally {
    processing = false;
  }
}

/**
 * 启动自动重放（仅在本模块范围生效；默认不自动启用）
 * - 监听网络恢复后触发处理
 * - 间隔轮询兜底（避免错过事件）
 */
function startAuto() {
  if (autoStarted) return;
  autoStarted = true;

  // 网络恢复时处理
  try {
    unsubscribeNetwork = network.onStatusChange(async (online) => {
      if (!online) return;
      try { await processQueue({ untilEmpty: false }); } catch (e) {}
    });
  } catch (e) {}

  // 简易轮询兜底
  const TICK_MS = 15 * 1000;
  const timer = setInterval(async () => {
    try { await processQueue({ untilEmpty: false }); } catch (e) {}
  }, TICK_MS);

  // 返回停止函数
  return () => {
    if (unsubscribeNetwork) { try { unsubscribeNetwork(); } catch (e) {} }
    clearInterval(timer);
    autoStarted = false;
  };
}

/**
 * 查询队列快照
 */
function snapshot() {
  return loadQueue();
}

module.exports = {
  add,
  cancel,
  processQueue,
  startAuto,
  snapshot
}; 