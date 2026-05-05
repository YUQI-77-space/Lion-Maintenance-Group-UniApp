// 云函数通用调用适配器

// 统一响应结构归一化
function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return { success: false, code: 500, message: '无效响应', data: null };
  }

  if (typeof raw.code === 'number') {
    return {
      success: raw.code === 200,
      code: raw.code,
      message: raw.message || '',
      data: raw.data !== undefined ? raw.data : null,
    };
  }

  if (typeof raw.success === 'boolean') {
    return {
      success: raw.success,
      code: raw.success ? 200 : 500,
      message: raw.message || '',
      data: raw.data !== undefined ? raw.data : null,
    };
  }

  if (typeof raw.valid === 'boolean') {
    return {
      success: raw.valid,
      code: raw.valid ? 200 : 401,
      message: raw.message || '',
      data: raw.user !== undefined ? raw.user : (raw.data !== undefined ? raw.data : null),
    };
  }

  return { success: true, code: 200, message: '', data: raw };
}

// 工具函数
function generateRequestId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `rid_${Date.now()}_${random}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  if (!(typeof ms === 'number' && ms > 0)) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const err = new Error(`request timeout after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      setTimeout(() => reject(err), ms);
    })
  ]);
}

function isTransientNetworkError(err) {
  const msg = (err && (err.errMsg || err.message || '')) + '';
  const lower = msg.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('network') ||
    lower.includes('request:fail') ||
    lower.includes('fail http') ||
    lower.includes('socket')
  );
}

const DEFAULT_RETRY_POLICY = {
  retries: 2,            // 额外重试次数（总尝试=1+retries）
  baseDelayMs: 300,      // 初始退避
  factor: 2,             // 乘数
  maxDelayMs: 3000,      // 最大退避
  jitter: true           // 抖动
};

function computeBackoffDelay(attemptIndex, policy) {
  const { baseDelayMs, factor, maxDelayMs, jitter } = policy;
  let delayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, attemptIndex));
  if (jitter) {
    const rand = Math.random() * 0.4 + 0.8; // 0.8x - 1.2x
    delayMs = Math.floor(delayMs * rand);
  }
  return delayMs;
}

// 云函数调用主方法
async function call(name, payload) {
  const action = payload && payload.action;
  const originalParams = (payload && payload.params) || {};
  const timeout = payload && typeof payload.timeout === 'number' ? payload.timeout : undefined;

  const policy = {
    ...DEFAULT_RETRY_POLICY,
    retries: payload && payload.config && typeof payload.config.retries === 'number'
      ? payload.config.retries
      : DEFAULT_RETRY_POLICY.retries,
  };

  const requestId = (payload && payload.config && payload.config.requestId) || generateRequestId();
  const paramsWithId = { ...originalParams, _requestId: requestId };

  let attempt = 0;
  while (attempt <= policy.retries) {
    try {
      const callFn = wx.cloud.callFunction({
        name,
        data: { action: action, params: paramsWithId },
        config: payload && payload.config
      });
      const res = await withTimeout(callFn, timeout);
      try {
        const unified = normalizeResult(res && res.result);
        return unified;
      } catch (e) {
        return { success: false, code: 500, message: e.message || '解析失败', data: null };
      }
    } catch (err) {
      const isRetryable = isTransientNetworkError(err);
      const isLastAttempt = attempt >= policy.retries;
      if (!isRetryable || isLastAttempt) {
        const message = (err && (err.errMsg || err.message)) || '网络错误';
        return { success: false, code: 503, message, data: null };
      }
      const backoff = computeBackoffDelay(attempt, policy);
      await delay(backoff);
      attempt += 1;
      continue;
    }
  }

  return { success: false, code: 500, message: '未知错误', data: null };
}

module.exports = { call, normalizeResult, generateRequestId }; 