// utils/dutyNow.js
// 首页「此刻谁在值班」的状态计算。
// 输入是 dutySchedule 云函数 getDutySlots 的返回 data：
//   {
//     weekNumber, year,
//     weekDates: [{ dayOfWeek, dayName, date, dateDisplay }],   // 周一 -> 周日；config.startDate 为空时该数组为空
//     tableData: [{ timeSlotInfo: { name, startTime, endTime }, dailySlots: [{ slotData, status, statusText, canSelect }] }],
//     config, totalSlots, availableSlots, assignedSlots
//   }
// 注意 tableData 的行是「时间段」，列是「星期」，与 weekDates 的下标一一对应。
// 本模块为纯函数、不依赖 wx，便于单独验证各种兜底分支。

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 兜底文案统一在这里维护，避免各处散落
const TEXT = {
  unavailable: '值班信息暂不可用',
  noSchedule: '本周暂无值班安排',
  midEmpty: '此时段暂无值班人员',
  midOff: '此时段不安排值班',
  outOfRange: '当前不在值班时段',
  weekEnded: '本周值班已结束',
  noHolderNext: '暂无人值班'
};

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

// 'HH:mm' -> 分钟数；非法值返回 null
function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// 时长文案：分钟 -> '42 分钟' / '1 小时 20 分'
function formatDuration(mins) {
  const total = Math.max(0, Math.round(mins));
  if (total < 60) return `${total} 分钟`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

// 取某个时间段行在某一天的单元格
function getCell(row, dayIndex) {
  if (!row || !Array.isArray(row.dailySlots)) return null;
  const cell = row.dailySlots[dayIndex];
  if (!cell || !cell.slotData) return null;
  return cell;
}

// 该单元格是否算「已排班」
function isAssigned(cell) {
  return !!cell && cell.status === 'assigned';
}

// 单元格是否是可排班时段（用于一周值班条的可用/空档比例）
function isSchedulable(cell) {
  return !!cell && !!cell.slotData && cell.slotData.isAvailable !== false;
}

function cellHolderName(cell) {
  if (!cell) return '';
  return (cell.slotData && cell.slotData.dutyHolderName) || cell.statusText || '';
}

function normalizeNow(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  if (isNaN(d.getTime())) return new Date();
  return d;
}

function emptyResult(available, text) {
  return {
    available: !!available,
    unavailableText: available ? '' : (text || TEXT.unavailable),
    todayLabel: '',
    todayIndex: -1,
    current: null,
    emptyState: null,
    next: null,
    week: [],
    todayAssignedCount: 0,
    summaryText: ''
  };
}

/**
 * 计算首页值班卡所需的全部状态
 * @param {Object} payload getDutySlots 的 data
 * @param {Date}   now     当前时间（便于测试注入）
 * @returns {Object} 见 emptyResult 的字段说明
 */
function buildDutyStatus(payload, now) {
  const current = normalizeNow(now);

  if (!payload || !Array.isArray(payload.weekDates) || !Array.isArray(payload.tableData)) {
    return emptyResult(false, TEXT.unavailable);
  }

  const weekDates = payload.weekDates;
  const rows = payload.tableData;

  // config.startDate 未配置时，云函数无法推算日期，weekDates 为空 -> dailySlots 也是空的
  const hasAnyCell = rows.some(row => Array.isArray(row.dailySlots) && row.dailySlots.some(cell => cell && cell.slotData));
  if (!weekDates.length || !rows.length || !hasAnyCell) {
    return emptyResult(false, TEXT.noSchedule);
  }

  // 今天在值班表里的位置
  const todayDow = current.getDay();
  const todayDate = `${current.getFullYear()}-${pad2(current.getMonth() + 1)}-${pad2(current.getDate())}`;
  const todayIndex = weekDates.findIndex(d => d && d.date === todayDate);
  if (todayIndex < 0) {
    return emptyResult(false, '值班表日期与本周不一致，请联系组长校准');
  }

  const nowMin = current.getHours() * 60 + current.getMinutes();

  // 每个时间段行的起止分钟（非法时间的时间段直接跳过）
  const rowTimes = rows.map((row, index) => {
    const info = (row && row.timeSlotInfo) || {};
    const start = toMinutes(info.startTime);
    const end = toMinutes(info.endTime);
    return { index, info, start, end };
  });

  // 1) 当前所处的时间段
  const currentRow = rowTimes.find(t => t.start !== null && t.end !== null && nowMin >= t.start && nowMin < t.end) || null;

  let currentOnDuty = null;
  let emptyState = null;

  if (currentRow) {
    const cell = getCell(rows[currentRow.index], todayIndex);
    if (isAssigned(cell)) {
      const totalMin = currentRow.end - currentRow.start;
      const remainMin = currentRow.end - nowMin;
      currentOnDuty = {
        timeSlot: currentRow.info.name || '',
        startTime: currentRow.info.startTime,
        endTime: currentRow.info.endTime,
        holderName: cellHolderName(cell),
        holderId: (cell.slotData && cell.slotData.dutyHolderId) || '',
        remainingText: `还剩 ${formatDuration(remainMin)}`,
        progress: totalMin > 0 ? Math.min(1, Math.max(0, (nowMin - currentRow.start) / totalMin)) : 0
      };
    } else if (cell && cell.status === 'available') {
      // 时段可排班但还没人认领 —— 最常见的兜底场景
      emptyState = { title: TEXT.midEmpty };
    } else {
      // 该时段当天休假（cell 为 null 或 status === 'no-duty'）
      emptyState = { title: TEXT.midOff };
    }
  } else {
    // 处在两个时段之间（如午休）、或早于第一个/晚于最后一个时段
    emptyState = { title: TEXT.outOfRange };
  }

  // 2) 按时间顺序排出「今天剩余时段 + 后续几天」的候选，优先取第一个有人值班的；
  //    整周都没人认领时，退化为第一个可排班的时段（文案里说明"暂无人值班"）。
  const candidates = [];
  const dayCount = weekDates.length;
  for (let step = 0; todayIndex + step < dayCount; step++) {
    const dayIndex = todayIndex + step;
    const dayInfo = weekDates[dayIndex] || {};
    const dayText = step === 0 ? '今天' : (step === 1 ? '明天' : (dayInfo.dayName || DAY_NAMES[dayInfo.dayOfWeek || 0]));
    rowTimes.forEach(t => {
      if (t.start === null || t.end === null) return;
      // 今天只看还没开始的时段
      if (step === 0 && t.start <= nowMin) return;
      candidates.push({
        dayIndex,
        dayText,
        isToday: step === 0,
        info: t.info,
        start: t.start,
        cell: getCell(rows[t.index], dayIndex)
      });
    });
  }

  const pickNext = (item) => ({
    dayText: item.dayText,
    timeSlot: item.info.name || '',
    startTime: item.info.startTime,
    endTime: item.info.endTime,
    holderName: cellHolderName(item.cell),
    hasHolder: isAssigned(item.cell),
    startsInText: item.isToday ? `${formatDuration(item.start - nowMin)}后` : ''
  });

  const firstWithHolder = candidates.find(item => isAssigned(item.cell));
  const firstSchedulable = candidates.find(item => isSchedulable(item.cell));
  const next = firstWithHolder ? pickNext(firstWithHolder)
    : (firstSchedulable ? pickNext(firstSchedulable) : null);

  // 3) 一周值班条
  const week = weekDates.map((dayInfo, dayIndex) => {
    let assignedCount = 0;
    let totalCount = 0;
    rows.forEach(row => {
      const cell = getCell(row, dayIndex);
      if (!cell) return;
      if (isSchedulable(cell)) totalCount += 1;
      if (isAssigned(cell)) assignedCount += 1;
    });
    return {
      dayName: (dayInfo && dayInfo.dayName) || DAY_NAMES[(dayInfo && dayInfo.dayOfWeek) || 0],
      dateDisplay: (dayInfo && dayInfo.dateDisplay) || '',
      isToday: dayIndex === todayIndex,
      assignedCount,
      totalCount,
      hasDuty: assignedCount > 0
    };
  });

  const todayAssignedCount = week[todayIndex] ? week[todayIndex].assignedCount : 0;
  const totalAssigned = week.reduce((sum, d) => sum + d.assignedCount, 0);

  return {
    available: true,
    unavailableText: '',
    todayLabel: (weekDates[todayIndex] && weekDates[todayIndex].dayName) || DAY_NAMES[todayDow],
    todayIndex,
    current: currentOnDuty,
    emptyState,
    next,
    week,
    todayAssignedCount,
    totalAssigned,
    summaryText: totalAssigned ? `本周共 ${totalAssigned} 段值班` : TEXT.noSchedule
  };
}

/**
 * 根据值班状态生成卡片文案（避免在 WXML 里堆三元表达式）
 */
function buildDutyText(status) {
  if (!status || !status.available) {
    return { main: (status && status.unavailableText) || TEXT.unavailable, sub: '', tone: 'muted' };
  }
  if (status.current) {
    return { main: '', sub: '', tone: 'live' };
  }
  const emptyTitle = (status.emptyState && status.emptyState.title) || TEXT.weekEnded;
  const next = status.next;
  if (!next) {
    return { main: emptyTitle, sub: TEXT.weekEnded, tone: 'warn' };
  }
  const slotText = `${next.dayText} ${next.startTime}-${next.endTime}`;
  const sub = next.hasHolder
    ? `下一段：${slotText} ${next.holderName}${next.startsInText ? `（${next.startsInText}）` : ''}`
    : `下一段：${slotText} ${TEXT.noHolderNext}`;
  return { main: emptyTitle, sub, tone: 'warn' };
}

/**
 * 我今天的值班时段
 * 注：首页已不再向用户展示「我的值班」（属于维修组内部信息），此函数暂未使用；
 * 保留是因为值班表 / 待办等页面若要复用同一套时段解析可以直接调用。
 * @returns {null|{count:Number, text:String, slots:Array}}
 */
function findMySlotsToday(payload, openid, now) {
  if (!openid || !payload || !Array.isArray(payload.weekDates) || !Array.isArray(payload.tableData)) return null;

  const current = normalizeNow(now);
  const todayDate = `${current.getFullYear()}-${pad2(current.getMonth() + 1)}-${pad2(current.getDate())}`;
  const todayIndex = payload.weekDates.findIndex(d => d && d.date === todayDate);
  if (todayIndex < 0) return null;

  const slots = [];
  payload.tableData.forEach(row => {
    const cell = getCell(row, todayIndex);
    if (!isAssigned(cell)) return;
    if (((cell.slotData && cell.slotData.dutyHolderId) || '') !== openid) return;
    slots.push({
      timeSlot: (row.timeSlotInfo && row.timeSlotInfo.name) || '',
      startTime: (row.timeSlotInfo && row.timeSlotInfo.startTime) || '',
      endTime: (row.timeSlotInfo && row.timeSlotInfo.endTime) || ''
    });
  });

  if (!slots.length) return null;
  return {
    count: slots.length,
    slots,
    text: slots.map(s => `${s.startTime}-${s.endTime}`).join('、')
  };
}

module.exports = {
  buildDutyStatus,
  buildDutyText,
  findMySlotsToday,
  formatDuration,
  toMinutes,
  TEXT
};
