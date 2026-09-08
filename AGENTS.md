# 维修组管理系统（Maintenance Group APP）

> 南师大仙林校区物科院维修组官方微信小程序：报修、团队/任务管理、EWA 工作量评估、值班调度、志愿活动。
> 技术栈：**原生微信小程序（前端）＋ 腾讯云开发 TCB 云函数（后端）**，单仓库，Node 运行时。

## Project

- 前端根 `miniprogram/`，后端根 `cloudfunctions/`（每个云函数是独立部署单元，各自带 `package.json` 与 `node_modules`）。
- 共 **29 个注册页面、4 个自定义 tabBar**（首页 `home` / 维修组 `team` / 报修 `repair` / 我的 `user`），页面清单与 tab 配置见 `miniprogram/app.json`。
- 入口 `miniprogram/app.js`：`wx.cloud.init` → 自动登录与角色还原 → 版本静默热更新 → 事件总线（`subscribe/publish/unsubscribe`）→ `globalData`（`userInfo/openid/role/isLogin/userDepartment/currentTabs`…）。云环境 ID、appid 分别硬编码在 `app.js`、`project.config.json`。
- 页面目录惯例：`pages/<域>/<模块>/index.{js,json,wxml,wxss}`；`index.json` 负责该页的组件/导航配置。
- 业务文档：`README.md`（总览），数据库结构权威来源为 `cloudfunctions/initDataBase/` 下的 `init*.js` 集合初始化器。

## Commands

- **无根 package.json，也没有 lint/test/build 脚本**（云函数内的 `npm test` 是占位）。开发/预览/上传一律走「微信开发者工具」打开仓库根目录。
- 云函数依赖：进入目录后 `cd cloudfunctions/<name> && npm install`；部署在开发者工具中右键云函数 →「上传并部署：云端安装依赖」。依赖仅 `wx-server-sdk`（~2.6.3）。
- 新环境初始化：手动触发一次 `initDataBase` 云函数建立全部集合。
- 注意 `miniprogram/config/`、`miniprogram/images/`、`项目管理/`、`node_modules` 被 `.gitignore`/`.cursorignore` 排除：涉及外部链接、媒体资源的需求只写代码引用，不要假设这些路径可被索引到。

## Architecture

### 前端 `miniprogram/`
- `pages/startup|login`：启动守卫（登录判断/资源预加载）与注册登录（头像上传、权限码验证）。
- `pages/home`：Tab1 首页；含 `special-events`（特色活动）、`team-spirit`（团队风采），均为分页懒加载。
- `pages/repair`：Tab3 报修向导（多级分类、动态必填、收费提示）+ `map` 分类可视化地图。
- `pages/team`：Tab2 维修组（成员侧），下辖 `duty`（值班 roster/manage）、`ewa`（EWA 管理/汇总图表）、`maintenance`（维修任务 list/detail/manage/create）、`volunteer`（志愿活动）、`manual|software`（飞书外链）。
- `pages/user`：Tab4 我的，下辖 `profile`、`todo`（三类待办及详情）、`message`、`about`。
- `custom-tab-bar/`：自定义 tabBar（角色决定可显示 tab、含交互锁）。
- `components/`：7 个公共组件（`avatar-display/charts/entry-item/feedback-modal/loading-animation/section-header/skeleton-image`）；`charts` 内含自研 Canvas 饼图/柱状图组件。
- `utils/`：核心调用链，AI 改前端时先熟悉——
  - `apiAdapter.js`：**唯一** 云函数调用入口，封装重试/退避/超时/响应归一化；
  - `router.js`：集中路由表 + 角色化导航 + tab 管理；
  - `outbox.js`/`network.js`/`swrCache.js`：离线操作队列、网络监听、SWR 缓存；
  - `cloudImageManager.js`/`avatarManager.js`/`iconManager.js`：云存储图片与图标管理；
  - `subscriptionAuth.js`/`time.js`/`repairCategories.js`/`activityStatusManager.js`/`sensitiveWordFilter.js`。
- `styles/`：`variables.wxss`（CSS 变量，主题色 `#3a75fb` 等）、`common.wxss`、`custom-navbar.wxss`。

### 后端 `cloudfunctions/`（11 个，按 action 分发）
| 云函数 | 职责 | 主要集合 |
|---|---|---|
| `login` | openid 登录、权限码→角色、users/proUsers 同步 | users, proUsers |
| `users` | 用户/部门/应急联系人/敏感词 | users, proUsers |
| `maintenanceTasks` | 维修任务全流程 + EW 计量 | maintenance_tasks, maintenance_toDo_list |
| `volunteerActivities` | 志愿活动全流程 + EW 计量 | voluntary_activities, volunteer_toDo_list |
| `dutySchedule` | 值班：预选/确认/锁/周切换/提醒 | duty_slots, duty_config, duty_toDo_list |
| `equivalentWorkloadAssessment` | EWA 计算/排名/Excel 导出 | ewaSummary |
| `userToDoList` | 个人待办聚合与状态 | *_toDo_list |
| `messages` | 站内消息 + 发送日志 | messages, message_send_logs |
| `pendingFeedbackMessages` | 待反馈弹窗消息 | pending_feedback_messages |
| `subscriptionMessage` | 微信订阅消息推送/调度 | scheduler_logs 等 |
| `initDataBase` | 集合初始化（新环境必跑） | 全部 |

每个云函数 `index.js` 只做 action 分发，业务逻辑按文件拆分（如 `maintenanceTasks/createMaintenanceTask.js`），同目录互相 require。

## Conventions

- **前端调后端只走 `api.call(name, { action, params, timeout?, config: { retries? } })`**（`utils/apiAdapter`），禁止在页面里直接 `wx.cloud.callFunction`；响应已统一为 `{ success, code, message, data }`，业务只看 `success && data`。
- **action 命名**：小驼峰动词（如 `getUserByOpenId`、`createMaintenanceTask`）；云函数内 `switch (event.action)` 分发，并把 `event.params` 展开到事件对象（`{...event, ...event.params}`）；云函数返回值统一 `{ success, message, data }`（或 `code: 200` 风格，apiAdapter 都能归一化）。
- **角色体系四级**：`user < member < leader < admin`，权限判断走 `app.checkPermission(requiredRole)` 与 `router`；角色同时落 `globalData.role` 与本地 storage `role`。普通用户登录页需填权限码才能成为 member/leader（权限码硬编码在 `login`/`users` 云函数，勿外泄、勿写进文档）。
- **前端页面写法**：`Page({ data, onLoad/onShow…, 业务方法 })`；data 键、状态字段用小驼峰；分页固定 `page/pageSize/hasMore/loadingMore`；下拉刷新用 `onRefresherRefresh`（scroll-view refresher）；状态机字符串如维修任务 `pending/inProgress/completed/cancelled`。组件用 `Component({ properties, data, methods })`。
- **离线与可靠**：写操作敏感于断网场景时接入 `outbox`（离线队列）或 `apiAdapter` 的重试；读多写少用 `swrCache`；发布订阅用 `app.subscribe/publish`（记得在 onUnload 退订）。
- **数据库**：集合名多为 snake_case 复数（例外 `users/proUsers`、`ewaSummary`）；时间字段用 `db.serverDate()`；openid 从 `cloud.getWXContext().OPENID` 取，不要信任前端传入。
- **业务规则勿破坏**：EWA 加权公式 `维修×0.5 + 志愿×0.4 + 值班×0.1`（单科目上限 300）；值班每周预选最多 3 段、确认后不可自撤、有锁与冷却；部门切换有冷却时间；启动页负责登录守卫，页面不自行绕过。
- 注释与提交信息用中文；前端 ES6+、无第三方前端依赖（图表为自研 Canvas）。

## Notes

- （留空：后续发现的坑、决策记录可随时追加在此。）
