# 维修组管理系统协作规范

适用于本仓库的代码、文档、云资源维护与 Agent 协作。

## 1. 项目与阅读入口

南师大仙林校区物科院维修组官方微信小程序，提供报修、团队与任务管理、EWA 工作量评估、值班调度及志愿活动。

- 技术栈：原生微信小程序（WXML/WXSS/ES6+）＋腾讯云开发 TCB 云函数（Node.js），单仓库；不新增前端框架或第三方前端依赖。
- 项目总览见 [README.md](README.md)；页面与 tab 配置以 `miniprogram/app.json` 为准，数据库结构以 `cloudfunctions/initDataBase/init*.js` 集合初始化器为准。
- `miniprogram/app.js` 负责云初始化、登录与角色还原、版本更新、事件总线及 `globalData`；云环境 ID、appid 分别见 `app.js`、`project.config.json`，操作前核对目标。
- 区分「建议方案」「已实现」「已验证」；设计规范是目标基线，历史报告只代表记录时的结果，不作为当前状态或验证证据。
- `miniprogram/config/`、`miniprogram/images/`、`项目管理/`、`node_modules/` 被忽略；涉及外链与媒体时只写代码引用，不假定这些资源可被索引到。

## 2. 开发与协作

- 修改代码前读取已安装的 `ponytail` Skill（通常为 `~/.codex/skills/ponytail/SKILL.md`，设置 `CODEX_HOME` 时以其目录为准），理解需求并追踪真实调用链。
- 优先复用现有模块、标准库、微信平台能力和已安装依赖；不为未来需求增加抽象、依赖、空目录或样板，不省略输入校验、权限、数据保护和必要错误处理。
- 新功能先定位业务域；入口只做启动、装配或分发，业务逻辑归所属模块。不按固定行数拆文件，不为方便把逻辑堆入 `app.js` 或云函数入口。
- 重构默认保持接口、action、状态值、数据库结构及已有业务数据；移动文件同步检查 require、路由、配置与资源引用。
- 子 Agent 仅用于复杂规划、深度调研、架构推演和跨材料分析；常规查询、文案调整、代码修改、测试、构建等执行工作由主 Agent 完成。
- 委派时明确问题、材料、预期结论与禁区：子 Agent 只读分析，不修改文件、不执行命令或脚本、不操作应用、不提交发布，也不再委派。主 Agent 核对建议并亲自执行、验证，不将建议表述为已完成。

### 验证与工作区

- 仓库无根 `package.json`，无根 lint/test/build 脚本；云函数内 `npm test` 为占位，不得作为验证通过的依据。
- 测试和其他自动化操作优先使用脚本配合微信开发者工具 CLI（`cli.bat`），按需结合小程序自动化接口、接口调用与日志检查，尽量不使用 Codex 的 Computer Use。
- 使用 CLI 前先查当前安装版本的 `--help` 与官方文档，确认支持的命令、服务端口和自动化配置；遇到不可用先排查配置或寻找脚本方案，不直接转为界面操作。微信开发者工具打开仓库根目录，支持开发、预览、上传及必要的真实交互验收。
- 按影响范围验证：局部修改检查直接链路；公共组件、全局样式、权限、缓存、数据结构或跨域调用变化扩大范围。说明检查范围、结果与未覆盖项，不因每次编辑或最终总结重复运行仍有效且已覆盖本次范围的检查。
- 仅在脚本与 CLI 无法覆盖必要的真实交互，或用户明确要求时使用 Computer Use；使用前说明具体缺口，操作与截图限于必要范围。不以模拟结果代替仍需实机验证的能力。
- 不向仓库根目录散落临时脚本、日志和检查产物；临时文件集中存放并在收尾清理，需追溯的证据按文档规则归档。不得删除断言、缩小检查范围或改写历史结果来获得通过。

## 3. 代码地图与接口约定

### 前端 `miniprogram/`

| 位置 | 职责 |
| --- | --- |
| `pages/startup/`、`pages/login/` | 登录守卫、预加载、注册登录 |
| `pages/home/`、`pages/repair/` | 首页、特色活动与团队风采；报修向导与分类地图 |
| `pages/team/`、`pages/user/` | 成员、值班、EWA、维修任务、志愿活动、手册/软件外链；个人资料、待办、消息、关于 |
| `custom-tab-bar/`、`components/` | 角色化 tab 与交互锁；公共组件、自研 Canvas 图表 |
| `utils/apiAdapter.js`、`utils/router.js` | 云函数统一调用；路由、角色化导航与 tab 管理 |
| `utils/outbox.js`、`utils/network.js`、`utils/swrCache.js` | 离线队列、网络监听与 SWR 缓存 |
| `utils/cloudImageManager.js`、`utils/avatarManager.js`、`utils/iconManager.js` | 云图片、头像与图标管理 |
| `styles/` | 公共变量、样式与自定义导航栏 |

- 页面通常为 `pages/<域>/<模块>/index.{js,json,wxml,wxss}`，`index.json` 管理组件与导航配置；使用 `Page({ data, ... })`、`Component({ properties, data, methods })`。
- data、状态字段与 action 用小驼峰；分页统一 `page/pageSize/hasMore/loadingMore`，scroll-view 下拉刷新用 `onRefresherRefresh`。保留既有状态机，如维修任务 `pending/inProgress/completed/cancelled`。
- **前端调用云函数只走** `api.call(name, { action, params, timeout?, config: { retries? } })`（`utils/apiAdapter`），禁止页面直接 `wx.cloud.callFunction`。响应统一为 `{ success, code, message, data }`，按 `success` 和所需 `data` 判断业务结果。
- 断网敏感的写操作按需接入 `outbox` 或适当重试，注意幂等性；读多写少复用 `swrCache`。事件使用 `app.subscribe/publish/unsubscribe`，页面在 `onUnload` 退订。

### 后端 `cloudfunctions/`

每个云函数是独立部署单元，独立管理 `package.json` 和依赖；`index.js` 负责 action 分发，业务按文件拆分并在同目录 require。

| 云函数 | 职责 / 主要集合 |
| --- | --- |
| `login`、`users` | 登录、角色、用户、部门、应急联系人、敏感词 / `users`、`proUsers` |
| `maintenanceTasks` | 维修任务与 EW / `maintenance_tasks`、`maintenance_toDo_list` |
| `volunteerActivities` | 志愿活动与 EW / `voluntary_activities`、`volunteer_toDo_list` |
| `dutySchedule` | 值班预选、确认、锁、周切换与提醒 / `duty_slots`、`duty_config`、`duty_toDo_list` |
| `equivalentWorkloadAssessment` | EWA 计算、排名与 Excel 导出 / `ewaSummary` |
| `userToDoList` | 个人待办聚合与状态 / `*_toDo_list` |
| `messages`、`pendingFeedbackMessages` | 站内消息与日志 / `messages`、`message_send_logs`；反馈弹窗 / `pending_feedback_messages` |
| `subscriptionMessage`、`initDataBase` | 订阅消息推送与调度 / `scheduler_logs` 等；集合初始化 |

- action 使用动词小驼峰（如 `getUserByOpenId`），通过 `switch (event.action)` 分发，按既有方式展开参数 `{ ...event, ...event.params }`。
- 返回 `{ success, message, data }`；既有 `code: 200` 风格由 apiAdapter 兼容，不另造响应格式。
- 集合沿用现有命名（通常 snake_case，例外如 `proUsers`、`ewaSummary`）；时间字段用 `db.serverDate()`。调用者 openid 从 `cloud.getWXContext().OPENID` 获取，不信任前端传入身份；权限校验在后端落实。

### 权限与业务不变量

- 角色顺序 `user < member < leader < admin`；前端权限与导航使用 `app.checkPermission(requiredRole)` 和 `router`，角色同步到 `globalData.role` 与 storage `role`。启动页负责登录守卫，页面不得绕过。
- 登录页通过权限码成为 member/leader；相关代码位于 `login`、`users` 云函数，权限码不得外泄或写入文档。
- EWA：`维修×0.5 + 志愿×0.4 + 值班×0.1`，单科目上限 300。
- 值班每周最多预选 3 段，确认后不可自行撤销，保留锁与冷却；部门切换保留冷却时间。

## 4. 云资源与数据维护

- 优先使用官方 CloudBase CLI、SDK 脚本或已连接的 CloudBase MCP，界面操作作为备用。工具不可用时先查官方文档与当前版本 `--help`。
- 云函数依赖：进入 `cloudfunctions/<name>/` 执行 `npm install`，或在开发者工具选择「上传并部署：云端安装依赖」。新环境手动触发一次 `initDataBase` 初始化集合。
- 独立 CLI 为 `@cloudbase/cli`（`tcb`），与开发者工具的 `cli.bat` 不同；后者端口关闭不代表独立 CLI/SDK 不可用。
- CLI 授权：`npm install -g @cloudbase/cli` → `tcb login` → `tcb env list`。用户完成浏览器/设备码授权后核对账号与项目环境，不假定复用开发者工具登录态。
- CLI v3 可用 `tcb db nosql execute`、`tcb db nosql dump`、`tcb fn deploy`；执行前核对版本、参数并显式指定环境 ID。本项目使用文档数据库，不套用 MySQL 操作。
- 复杂审查与迁移使用官方 `@cloudbase/node-sdk`，资源管理可用 `@cloudbase/manager-node`；按 SDK 文档配置凭证，不假定复用 CLI 登录态。凭证仅保存在本地环境或受支持的凭证存储中，不进入代码、Git、日志或聊天。
- 数据修复默认 dry-run（只读），完整分页，报告缺失、重复与异常。写入前备份受影响记录，仅修改目标字段，支持幂等重试；写后复查数量、内容及已有业务值。备份和含成员资料的报告必须放在已确认被 Git 忽略的目录。
- 官方参考：[CLI 安装与授权](https://docs.cloudbase.net/cli-v1/install)、[文档数据库命令](https://docs.cloudbase.net/cli-v1/db/nosql/management)、[Node.js SDK](https://cloud.tencent.com/document/product/876/47058)。

## 5. UI/UX 设计

- 界面、组件及交互的设计、修改或评审前，读取 [设计索引](docs/知识库/Design/README.md)、对应规范与 [设计 Token](docs/知识库/Design/design-tokens.json)。设计选择须能追溯到规范，并说明实际验证情况。
- 使用项目 [ui-ux-pro-max Skill](.agents/skills/ui-ux-pro-max/SKILL.md)，同时遵守 [小程序适配规则](docs/知识库/Design/06-Skill使用规范.md)；检索脚本使用实际项目路径，不照抄上游 `CLAUDE_PLUGIN_ROOT`。
- 原生小程序、业务规则、权限及项目设计规范优先于外部 Skill 的框架、字体、营销布局与动效建议，不引入在线字体依赖。
- 官方品牌蓝为 `#0369D7`（RGB 3,105,215）；使用规范中的同源色阶与语义 Token，不自行换色或重绘标志。既有样式未必迁移完成，不将旧色值当作设计基准。
- 前端改造遵循开发库中对应设计文档的阶段计划，验收记录归开发库。

## 6. 沟通与文档

- 默认使用简体中文，注释与提交信息用中文；先说结果，再给必要依据、验证与限制。进度更新说明发现与下一步，不堆操作流水。
- 并列事项用短列表，同类方案与职责映射适合表格；复杂流程、架构与状态关系按需使用 Mermaid，不为简单事实强行绘图。
- Markdown 标题、段落、列表、表格及代码块之间留空行，代码块标明语言；文件与来源使用可点击链接。不编造引用、能力或测试记录。

| 归档位置 | 内容与命名 |
| --- | --- |
| `docs/知识库/` | 可复用的规范、范式及稳定权威说明；按主题维护，使用稳定文件名 |
| `docs/开发库/` | 需求、实施方案、设计推演、规划、审查、开发与验收记录；复用对应分类，统一 `YYYY-MM-DD-标题.md` |

- 开发库日期为文档创建日期；小幅修订保留文件名，新阶段另建文档。不在知识库新增执行记录。
- 稳定结论再整理进知识库并关联来源；重大进展同步更新受影响的权威说明。开发记录写清实际改动、验证及未完成项，历史记录不冒充当前状态。
- 移动或重命名文档时同步更新引用；保护需保留的原始证据，不为整理目录删除有效材料。
