// 只组织展示数据，不参与业务结算；缺失与真实 0 分开。
const SERIES = [
  { key: 'maintenanceEW', name: '维修', weight: 0.5, color: '#0369D7' },
  { key: 'volunteerEW', name: '志愿', weight: 0.4, color: '#19734A' },
  { key: 'dutyEW', name: '值班', weight: 0.1, color: '#8A5700' }
];
function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function format(value) {
  const result = number(value);
  return result === null ? '—' : String(Number(result.toFixed(2)));
}
function summarize(list) {
  const rows = SERIES.map(series => {
    const values = list.map(row => number(row[series.key]));
    const value = values.some(value => value === null) ? null : values.reduce((a,b) => a+b, 0);
    const contribution = value === null ? null : value * series.weight;
    return { ...series, value, contribution, valueText: format(value), contributionText: format(contribution) };
  });
  const totals = list.map(row => number(row.totalEW));
  const total = totals.some(value => value === null) ? null : totals.reduce((a,b) => a+b,0);
  return { rows, total, totalText: format(total), hasMissing: total === null || rows.some(row => row.value === null) };
}
module.exports = { SERIES, number, format, summarize };
