// 维修分类数据（一级/二级/三级）
// 与报修流程使用的类型 ID 保持一致，供多处页面只读展示/选择复用
module.exports = [
  {
    id: 1,
    name: '电子数码类',
    subcategories: [
      {
        id: 11,
        name: '笔记本类',
        types: [
          { id: 111, name: '笔记本清灰' },
          { id: 112, name: '笔记本电池更换' },
          { id: 113, name: '笔记本加装固态' },
          { id: 114, name: '笔记本C盘清理/磁盘空间管理' },
          { id: 115, name: '笔记本软件安装' },
          { id: 116, name: '笔记本系统重装' },
          { id: 117, name: '笔记本故障检修' },
          { id: 118, name: '笔记本卡顿掉帧' },
          { id: 119, name: '其他（详细描述维修类别）' }
        ]
      },
      {
        id: 12,
        name: '手机类',
        types: [
          { id: 121, name: '手机屏幕清洁' },
          { id: 122, name: '手机贴膜换膜' },
          { id: 124, name: '其他（详细描述维修类别）' }
        ]
      },
      {
        id: 13,
        name: '鼠标类',
        types: [
          { id: 131, name: '鼠标故障检修' }
        ]
      },
      {
        id: 14,
        name: '键盘类',
        types: [
          { id: 141, name: '键盘故障检修' }
        ]
      },
      {
        id: 15,
        name: '其他',
        types: [
          { id: 151, name: '具体内容' }
        ]
      }
    ]
  },
  {
    id: 2,
    name: '电路机械类',
    subcategories: [
      { id: 21, name: '吹风机类', types: [{ id: 211, name: '吹风机故障维修' }] },
      { id: 22, name: '热水壶类', types: [{ id: 221, name: '热水壶故障维修' }] },
      { id: 23, name: '自行车类', types: [{ id: 231, name: '自行车保养维修' }, { id: 232, name: '自行车故障检修' }] },
      { id: 24, name: '收音机', types: [{ id: 241, name: '收音机故障检修' }] },
      { id: 25, name: '电风扇类', types: [{ id: 251, name: '电风扇故障检修' }] },
      { id: 26, name: '其他', types: [{ id: 261, name: '具体内容' }] }
    ]
  },
  {
    id: 3,
    name: '工具借用类',
    subcategories: [
      { id: 31, name: '螺丝刀', types: [{ id: 311, name: '螺丝刀借用' }] },
      { id: 32, name: '扳手', types: [{ id: 321, name: '扳手借用' }] },
      { id: 33, name: '打气筒', types: [{ id: 331, name: '打气筒借用' }] },
      { id: 34, name: '老虎钳', types: [{ id: 341, name: '老虎钳借用' }] },
      { id: 35, name: '电烙铁', types: [{ id: 351, name: '电烙铁借用' }] },
      { id: 36, name: '其他', types: [{ id: 361, name: '具体内容' }] }
    ]
  }
];


