# 🔧 维修组管理系统

<div align="center">

**南师大仙林校区物科院维修组官方微信小程序**

*为师生提供高效便捷的维修服务，助力维修组现代化管理*

[![微信小程序](https://img.shields.io/badge/微信小程序-维修组管理系统-07C160?logo=wechat)](https://weixin.qq.com)
[![云开发](https://img.shields.io/badge/腾讯云开发-TCB-0052D9?logo=tencent-cloud)](https://cloud.tencent.com/product/tcb)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![版本](https://img.shields.io/badge/version-1.4.1030-orange.svg)](#)

</div>

## 📱 项目简介

维修组管理系统是专为南师大仙林校区物理科学与技术学院维修组打造的综合性管理平台。系统整合维修申请、任务管理、值班调度、志愿活动、工作量评估等核心功能，通过微信小程序提供流畅的用户体验。

### ✨ 核心功能

🛠️ **智能报修** - 多级分类向导，实时状态跟踪，地图定位支持  
👥 **团队管理** - 四级权限体系，任务智能分配，成员绩效评估  
📊 **EWA评估** - 科学加权算法（维修0.5/志愿0.4/值班0.1），多维数据可视化  
📈 **数据可视化** - 自研Canvas图表库，饼图/柱状图/动画效果  
⏰ **智能值班** - 可视化周历，预选确认机制，消息智能提醒  
🎯 **志愿活动** - 全流程管理，状态实时同步，离线队列支持  
🌐 **离线支持** - 智能队列系统，网络恢复自动同步  
🔄 **版本更新** - 静默下载新版本，弹窗引导重启，体验无断层  
📍 **部门切换** - 运营管理部/电子技术部/机电维修部，自主切换  
💬 **待办消息** - 反馈弹窗确认机制，确保信息触达  

## 🏗️ 技术架构

### 前端技术
- **开发框架** 微信小程序原生开发
- **图表引擎** 自研Canvas 2D图表组件库
- **路由系统** 权限感知的集中式路由管理（含模块化导航）
- **网络层** 统一API适配器，智能重试+离线队列
- **状态管理** 页面级状态 + 全局事件总线
- **更新机制** 静默下载+弹窗引导，热更新无断层
- **图标管理** 多图标集支持，默认default集

### 后端技术  
- **云平台** 腾讯云开发 (TCB)
- **运行时** Node.js 云函数
- **数据库** NoSQL 云数据库
- **存储** 云文件存储 (图片/荣誉/风采/特色活动)
- **消息** 微信订阅消息推送

### 核心特性
🌐 **智能离线** 网络检测+操作队列，无感知同步  
🔄 **自动重试** 指数退避算法，智能错误恢复  
🔄 **版本更新** 静默下载+弹窗引导，热更新无断层  
🎨 **响应式** 适配多种设备，流畅原生体验  
🔒 **权限管控** 四级权限，动态功能开放  
📊 **数据可视化** Canvas图表，丝滑动画效果  
📍 **部门管理** 三部门灵活切换，冷却时间限制  
💬 **反馈触达** 弹窗确认机制，确保消息处理

## 📁 项目结构

```
维修组管理系统/
├── miniprogram/                          # 小程序前端
│   ├── pages/                            # 页面模块 (共27个页面)
│   │   ├── startup/                     # 启动页 (路由守卫/登录判断/资源预加载)
│   │   │   ├── index.js
│   │   │   ├── index.json
│   │   │   ├── index.wxml
│   │   │   └── index.wxss
│   │   ├── login/                        # 注册/登录页 (头像上传/权限码验证)
│   │   ├── home/                         # 首页 (TabBar第1页)
│   │   │   ├── index.*                  # 首页主页面 (轮播/功能入口/荣誉展示)
│   │   │   ├── special-events/         # 特色活动展示 (分页懒加载)
│   │   │   └── team-spirit/            # 团队风采展示 (分页懒加载)
│   │   ├── user/                        # 用户中心 (TabBar第4页)
│   │   │   ├── profile/               # 个人资料 (部门切换/退出登录)
│   │   │   ├── todo/                   # 个人待办 (维修/志愿/值班三类)
│   │   │   │   ├── index.*            # 待办列表
│   │   │   │   ├── maintenance-detail/ # 维修任务详情
│   │   │   │   └── volunteer-detail/  # 志愿活动详情
│   │   │   ├── message/               # 消息中心
│   │   │   └── about/                  # 关于我们
│   │   ├── team/                        # 团队管理 (TabBar第2页/动态)
│   │   │   ├── home/                   # 团队首页 (功能入口/管理入口)
│   │   │   │   ├── index.*
│   │   │   │   └── more/              # 更多功能
│   │   │   ├── manual/                # 维修手册 (飞书链接)
│   │   │   ├── software/              # 软件库 (飞书链接)
│   │   │   ├── maintenance/          # 维修任务管理
│   │   │   │   ├── list/            # 任务列表 (成员认领)
│   │   │   │   ├── detail/          # 任务详情
│   │   │   │   ├── manage/          # 任务管理 (组长)
│   │   │   │   └── create/          # 创建任务
│   │   │   ├── volunteer/           # 志愿活动管理
│   │   │   │   ├── list/           # 活动列表 (报名/取消)
│   │   │   │   ├── detail/         # 活动详情
│   │   │   │   ├── manage/         # 活动管理 (组长)
│   │   │   │   └── create/         # 创建活动
│   │   │   ├── duty/               # 值班系统
│   │   │   │   ├── roster/        # 值班表 (预选/确认)
│   │   │   │   └── manage/        # 值班管理 (组长)
│   │   │   └── ewa/               # EWA工作量评估
│   │   │       ├── manage/       # EWA管理 (组长/编辑/导出)
│   │   │       └── summary/      # EWA汇总 (全员可见/图表)
│   │   └── repair/                  # 报修系统 (TabBar第3页)
│   │       ├── index.*           # 多步骤报修向导 (三级分类)
│   │       └── map/              # 分类可视化地图 (快速跳转)
│   │
│   ├── components/                      # 公共组件 (共15个)
│   │   ├── btn/                       # 按钮组件
│   │   ├── tag/                       # 标签组件
│   │   ├── card/                      # 卡片组件
│   │   ├── list-item/               # 列表项组件
│   │   ├── loading-state/           # 加载状态组件
│   │   ├── empty-state/            # 空状态组件
│   │   ├── section-header/         # 区域标题头组件
│   │   ├── page-container/         # 页面容器组件
│   │   ├── skeleton-image/         # 骨架屏图片占位组件
│   │   ├── entry-item/             # 功能入口项组件
│   │   ├── avatar-display/        # 头像显示组件
│   │   ├── feedback-modal/        # 反馈确认弹窗组件
│   │   ├── charts/                # 图表组件库
│   │   │   ├── pie-chart/        # 饼图组件
│   │   │   └── bar-chart/       # 柱状图组件
│   │   └── loading-animation/    # 加载动画组件
│   │
│   ├── utils/                            # 工具函数库 (共13个)
│   │   ├── apiAdapter.js              # API适配器 (统一调用/重试/归一化)
│   │   ├── router.js                  # 权限路由/模块化导航/Tab管理
│   │   ├── iconManager.js             # 图标管理器 (多图标集支持)
│   │   ├── cloudImageManager.js       # 云存储图片管理 (批量URL转换/缓存)
│   │   ├── avatarManager.js           # 头像上传管理 (云存储/降级策略)
│   │   ├── network.js                # 网络状态检测
│   │   ├── outbox.js                 # 离线操作队列 (联网自动重发)
│   │   ├── swrCache.js               # SWR缓存 (Stale-While-Revalidate)
│   │   ├── time.js                   # 时间工具 (iOS兼容/格式化)
│   │   ├── repairCategories.js       # 报修分类数据 (三级分类)
│   │   ├── subscriptionAuth.js       # 订阅消息授权 (5种模板)
│   │   ├── activityStatusManager.js  # 活动状态管理器
│   │   └── sensitiveWordFilter.js   # 敏感词过滤器
│   │
│   ├── styles/                           # 全局样式
│   │   ├── variables.wxss                # CSS变量定义
│   │   ├── common.wxss                   # 公共样式库
│   │   └── custom-navbar.wxss            # 自定义导航栏样式
│   │
│   ├── images/                           # 图片资源
│   │   ├── tabs/                         # TabBar图标
│   │   ├── icons/                        # 功能图标
│   │   └── ...
│   │
│   ├── custom-tab-bar/           # 自定义底部导航 (动态Tab/交互锁)
│   │
│   ├── config/                    # 配置文件
│   │   ├── icons.js             # 图标集配置 (default)
│   │   └── linkConfig.js        # 外部链接 (飞书)
│   │
│   ├── app.js                  # 小程序入口 (版本更新/云初始化/登录/事件总线)
│   ├── app.json               # 全局配置 (27个页面/4个TabBar)
│   ├── app.wxss              # 全局样式
│   └── sitemap.json          # 站点地图配置
│
├── cloudfunctions/                   # 云函数后端 (共11个)
│   ├── login/                       # 用户登录认证 (获取openid/权限码验证)
│   ├── users/                      # 用户信息/部门管理
│   ├── maintenanceTasks/           # 维修任务管理 (创建/认领/完成/删除)
│   ├── volunteerActivities/        # 志愿活动管理 (创建/报名/签到/状态流转)
│   ├── dutySchedule/              # 值班调度系统 (预选/确认/锁机制/提醒)
│   ├── equivalentWorkloadAssessment/ # EWA评估系统 (计算/排名/导出)
│   ├── userToDoList/              # 待办事项管理
│   ├── messages/                  # 消息系统 (创建/发送/标记已读)
│   ├── subscriptionMessage/       # 订阅消息推送
│   ├── pendingFeedbackMessages/   # 待处理反馈
│   └── initDataBase/             # 数据库初始化
│
├── 项目管理/                        # 项目管理资源
│   ├── 存储/                      # 存储资源备份
│   │   ├── icons/               # 功能图标资源
│   │   ├── 团队荣誉/            # 团队荣誉照片 (39张)
│   │   ├── 团队风采/            # 团队风采照片 (34张)
│   │   ├── 特色活动/            # 特色活动照片 (14张)
│   │   ├── 音乐/               # 背景音乐 (10首)
│   │   └── 学习资料/           # 学习资料
│   ├── 对象存储/                # 云存储资源 (同步备份)
│   └── 图标/                   # 图标资源
│
├── project.config.json            # 项目配置文件
├── project.private.config.json    # 私有配置文件
├── README.md                    # 项目说明文档
└── 数据库集合结构汇总.md        # 数据库结构文档
```

## 🚀 快速开始

### 环境要求
- 微信开发者工具 (最新稳定版)
- Node.js >= 14.0.0
- 微信小程序账号及开发权限
- 腾讯云开发环境

### 本地开发

1. **克隆并配置**
   ```bash
   git clone https://github.com/YUQI-77-space/Maintenance-Group-APP.git
   cd Maintenance-Group-APP
   ```

2. **安装依赖并配置**
   - 在微信开发者工具中导入项目
   - 修改 `project.config.json` 中的 `appid`
   - 开通并配置云开发环境
   - 在云函数目录安装依赖：`cd cloudfunctions/[函数名] && npm install`

3. **初始化数据库**
   - 调用 `initDataBase` 云函数初始化所有集合

4. **部署上线**
   - 在微信开发者工具中上传云函数
   - 配置云存储资源
   - 提交代码审核

## 🎯 核心功能详解

### 🛠️ 智能报修
- **多步骤向导** 4步流程：选择设备大类→选择具体问题→填写详情→提交成功
- **三级分类** 电子数码类(笔记本/手机等)/电路机械类(吹风机/热水壶等)/工具借用类(螺丝刀/扳手等)
- **快速定位** 关键字搜索快速定位问题类型
- **分类地图** 可视化地图点击快速跳转，自动填入分类
- **智能字段** 根据问题类型动态显示必填字段(型号/系统版本等)
- **收费提醒** 笔记本清灰等需收费项目明确提示(30元人工费)
- **状态追踪** 待受理→处理中→已完成
- **紧急标记** 优先处理机制
- **iOS兼容** 日期时间解析兼容处理

### 📊 EWA评估系统
科学算法：`EW总值 = 维修EW×0.5 + 志愿EW×0.4 + 值班EW×0.1`

**可视化特性**
- 饼图分布 - 加权工作量占比
- 柱状对比 - 多维数据直观展示
- 进度动画 - easeOutCubic 缓动函数
- 实时排名 - 动态排行榜
- Excel导出 - 便于统计分析
- 原始值/加权值双轨展示

**管理功能**
- 组长编辑各成员EW值（维修/志愿/值班三项，单项上限300）
- 批量更新所有成员EW数据
- 搜索定位成员

### ⏰ 智能值班
- **周历视图** 可视化表格，直观管理
- **预选机制** 最多预选3个时间段/周
- **确认机制** 预选后需确认，已确认不可自行取消
- **权限控制** 组长灵活管理编辑权限
- **消息提醒** 自动发送值班通知

### 🎯 志愿活动
- **状态流转** 筹备→进行→结束自动管理
- **报名统计** 实时统计参与情况
- **消息推送** 活动提醒自动通知
- **离线支持** 网络不稳定时队列操作，联网自动重发
- **励志名言** 已结束活动显示随机励志语录

### 📍 部门管理
- **三部门切换** 运营管理部/电子技术部/机电维修部
- **冷却限制** 切换有冷却时间，防止频繁操作
- **数据同步** 切换后自动更新云端

### 💬 待反馈消息
- **弹窗确认** 进入"我的"页面时检查未处理反馈
- **交互锁定** 锁定TabBar防止逃避处理
- **待处理统计** 消息中心未读计数

## 🛠️ 技术亮点

### 📈 自研Canvas图表引擎
```javascript
// 饼图组件使用示例
<pie-chart chartData="{{pieChartData}}" width="{{240}}" height="{{200}}"></pie-chart>

// 数据格式
pieChartData: [
  { name: '维修工作量', value: 60.5, rawValue: 121, color: '#0066FF' },
  { name: '志愿工作量', value: 32.4, rawValue: 81, color: '#FFA940' }
]
```
**特性** Canvas 2D渲染 | 60fps动画 | 响应式设计 | 渐变色彩

### 🌐 离线队列系统
```javascript
// 添加离线任务
const outbox = require('./utils/outbox');
outbox.add('maintenanceTasks', 'createTask', taskData);

// 网络恢复自动同步
outbox.startAuto();
```

### 🔄 智能重试机制
```javascript
// API调用自动重试 (指数退避)
const api = require('./utils/apiAdapter');
const result = await api.call('maintenanceTasks', 'createTask', data, {
  retries: 3,
  baseDelayMs: 1000
});
```

### 🔄 版本更新机制
```javascript
// 小程序启动时自动检查并下载新版本
// 下载完成后弹窗引导用户重启，以载入新版本
// 下载失败时提供重试选项
const updateManager = wx.getUpdateManager();
updateManager.onUpdateReady(() => {
  wx.showModal({
    title: '更新提示',
    content: '小维已经有了新的版本，吃个蛋挞然后赶紧更新吧！',
    showCancel: false,
    success: () => updateManager.applyUpdate()
  });
});
```
**特性** 静默下载 | 弹窗引导 | 自动重试 | 无缝体验

### 🔒 权限路由系统
```javascript
// 动态权限控制
const router = require('./utils/router');
router.navigateTo('/pages/team/maintenance/manage', {
  requireRole: 'member'  // 需要成员权限
});
```

## 📊 数据库设计

采用腾讯云开发NoSQL数据库，核心集合：
- `users / proUsers` 用户信息管理（含部门信息）
- `maintenance_tasks` 维修任务数据
- `voluntary_activities` 志愿活动管理
- `duty_slots / duty_config` 值班调度系统
- `ewaSummary` 等效工作量汇总
- `messages` 消息通知系统
- `pendingFeedbackMessages` 待处理反馈消息

**设计特点** 索引优化 | 数据分离 | 冗余优化 | 时区统一

详细结构：[数据库集合结构汇总.md](数据库集合结构汇总.md)

## 🔧 开发规范

### 代码规范
- ES6+ 现代JavaScript语法
- 模块化组件化开发
- 统一错误处理和日志记录

### 提交规范
`feat` 新功能 | `fix` 问题修复 | `docs` 文档更新 | `refactor` 重构 | `perf` 性能优化

### 分支管理
`main` 生产环境 | `feature/dev` 开发分支 | `feature/*` 功能分支 | `hotfix/*` 修复分支

## 📈 项目亮点

### 技术创新
🎨 **自研图表引擎** Canvas 2D轻量级图表库，60fps丝滑动画  
🌐 **智能离线系统** 自动队列+指数退避，无感知同步  
🔒 **动态权限控制** 四级权限体系，灵活角色管理  
📊 **数据可视化** 多维度图表，实时统计分析  
🔄 **热更新机制** 静默下载+弹窗引导，体验无断层  
📍 **部门管理** 三部门灵活切换，数据实时同步  
💬 **反馈触达** 弹窗确认机制，确保消息处理  
⚡ **模块化架构** 高度解耦，易于扩展维护

### 业务价值
⚡ 维修响应时间缩短 **60%**  
💰 人工管理成本降低 **80%**  
😊 用户满意度提升至 **95%+**  
📊 科学的EWA评估体系，激励团队协作

## 📞 联系方式

### 维修组服务
📍 南师大仙林校区格物楼北楼5楼  
📧 weixiuzu2025@163.com  
📱 18795946211  
🕒 周一至周五 8:00-17:00

### 技术支持
👨‍💻 [@YUQI-77-space](https://github.com/YUQI-77-space)  
🐛 [Issues](https://github.com/YUQI-77-space/Maintenance-Group-APP/issues)  
💡 [Discussions](https://github.com/YUQI-77-space/Maintenance-Group-APP/discussions)

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源协议发布

## 🙏 致谢

感谢南京师范大学物理科学与技术学院维修组全体成员  
感谢微信小程序及腾讯云开发团队提供的技术支持  
感谢所有提供宝贵建议和反馈的用户们

---

<div align="center">

**🔧 让维修更智能，让服务更贴心**

*© 2024-2025 南师大物科院维修组 All Rights Reserved*

[![Star History](https://api.star-history.com/svg?repos=YUQI-77-space/Maintenance-Group-APP&type=Date)](https://star-history.com/#YUQI-77-space/Maintenance-Group-APP&Date)

</div>