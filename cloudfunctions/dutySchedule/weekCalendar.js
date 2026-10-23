// 使用北京时间计算自然周，不依赖云函数或开发机的本地时区。
const DAY_MS = 86400000
const CST_OFFSET_MS = 8 * 3600000

function parseStartDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('请先设置有效的学期开始日期')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
    throw new Error('学期开始日期必须是真实有效的周一')
  }
  return date.getTime()
}

function getWeekCalendar(startDate, weekNumber) {
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 20) {
    throw new Error('周次必须是 1 到 20 的整数')
  }
  const startMs = parseStartDate(startDate) + (weekNumber - 1) * 7 * DAY_MS
  return {
    weekNumber,
    // year 是学期的数据分区年份；跨年周仍归属同一学期。
    year: new Date(parseStartDate(startDate)).getUTCFullYear(),
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date(startMs + 6 * DAY_MS).toISOString().slice(0, 10)
  }
}

function getActualWeek(startDate, nowMs = Date.now()) {
  const startMs = parseStartDate(startDate)
  const weekNumber = Math.floor((nowMs + CST_OFFSET_MS - startMs) / (7 * DAY_MS)) + 1
  if (weekNumber < 1 || weekNumber > 20) throw new Error('当前日期不在本学期第 1～20 周内，请核对开学日')
  return { ...getWeekCalendar(startDate, weekNumber), today: new Date(nowMs + CST_OFFSET_MS).toISOString().slice(0, 10) }
}

module.exports = { parseStartDate, getWeekCalendar, getActualWeek }
