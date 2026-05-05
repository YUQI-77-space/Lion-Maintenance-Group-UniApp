/**
 * 时间工具（前端）
 * 统一管理时间解析/格式化/转换，减少各页面重复实现与时区不一致问题
 * 使用方式：const time = require('./time')
 */

/**
 * 获取当前运行环境（develop/trial/release）
 * @returns {('develop'|'trial'|'release')}
 */
function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return (info && info.miniProgram && info.miniProgram.envVersion) || 'release';
  } catch (e) {
    return 'release';
  }
}

/**
 * 安全创建 Date 实例
 * @param {string|number|Date} input
 * @returns {Date|null}
 */
function toDate(input) {
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') {
    // 兼容带/不带时区的 ISO 字符串
    const d = new Date(input);
    if (!isNaN(d.getTime())) return d;

    // iOS 兼容：手动解析 'YYYY-MM-DD HH:mm:ss' 或 'YYYY-MM-DD' 格式
    // iOS 不支持 new Date('YYYY-MM-DD HH:mm:ss')，需要用 T 替换空格或手动解析
    const isoFixed = input.replace(' ', 'T');
    const d2 = new Date(isoFixed);
    if (!isNaN(d2.getTime())) return d2;

    // 纯手动解析（最可靠的跨平台方案）
    const match = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})[:.]?(\d{0,2})[:.]?(\d{0,2}))?/);
    if (match) {
      const [, year, month, day, hour = 0, minute = 0, second = 0] = match;
      const parsed = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1, // 月份从 0 开始
        parseInt(day, 10),
        parseInt(hour, 10),
        parseInt(minute, 10),
        parseInt(second, 10) || 0
      );
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

/**
 * 将 Date 格式化为 'YYYY-MM-DD HH:mm:ss'
 * @param {Date|string|number} input
 * @returns {string}
 */
function formatDateTime(input) {
  const d = toDate(input) || new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

/**
 * 将 Date 格式化为 'YYYY-MM-DD HH:mm'（到分钟）
 * @param {Date|string|number} input
 * @returns {string}
 */
function formatToMinute(input) {
  const full = formatDateTime(input);
  return full.slice(0, 16);
}

/**
 * 获取 ISO8601 字符串（UTC，尾部 'Z'）
 * @param {Date|string|number} input
 * @returns {string}
 */
function toISOStringZ(input) {
  const d = toDate(input) || new Date();
  return d.toISOString();
}

/**
 * 获取 ISO8601 字符串并附带时区偏移（默认 +08:00）
 * @param {Date|string|number} input
 * @param {number} offsetHours
 * @returns {string}
 */
function toISOWithOffset(input, offsetHours = 8) {
  const d = toDate(input) || new Date();
  const offsetMs = offsetHours * 60 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  const iso = local.toISOString().replace('Z', '');
  const sign = offsetHours >= 0 ? '+' : '-';
  const abs = Math.abs(offsetHours);
  const hh = abs.toString().padStart(2, '0');
  const mm = '00';
  return `${iso}${sign}${hh}:${mm}`;
}

/**
 * 解析 ISO 字符串，优先处理带时区的形式
 * @param {string} iso
 * @returns {Date|null}
 */
function parseISO(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 当前时间（Date 对象）
 * @returns {Date}
 */
function now() {
  return new Date();
}

/**
 * 将日期显示为 'M月D日 周X'
 * @param {Date|string|number} input
 * @returns {string}
 */
function formatWeekDate(input) {
  const d = toDate(input) || new Date();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekDay = weekDays[d.getDay()];
  return `${month}月${day}日 ${weekDay}`;
}

/**
 * 调试辅助：仅在非 release 环境输出
 */
function debugLog() {
  if (getEnvVersion() !== 'release') {
    // eslint-disable-next-line no-console
    console.log.apply(console, arguments);
  }
}

module.exports = {
  getEnvVersion,
  toDate,
  formatDateTime,
  formatToMinute,
  toISOStringZ,
  toISOWithOffset,
  parseISO,
  now,
  formatWeekDate,
  debugLog,
}; 