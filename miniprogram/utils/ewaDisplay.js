// 只组织展示数据，不参与业务结算；缺失与真实 0 分开。
function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function format(value) {
  const result = number(value);
  return result === null ? '—' : String(Number(result.toFixed(2)));
}
module.exports = { number, format };
