// 只读计数徽章：业务页面负责提供数量和语义名称。
Component({
  options: { virtualHost: true },
  properties: {
    count: { type: Number, value: 0 },
    label: { type: String, value: '待处理事项' }
  }
});
