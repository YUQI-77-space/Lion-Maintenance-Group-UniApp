# 维修组管理系统

南京师范大学仙林校区物理科学与技术学院维修组官方微信小程序，面向师生提供报修服务，支持组内任务处理、成员管理与日常协作。

## 核心功能

- **报修与维修任务**：分类报修、任务认领、进度跟踪与工作量记录。
- **成员管理**：分级权限、部门与资料维护、角色调整及在职／退休状态管理。
- **值班与志愿活动**：值班预选与确认、活动报名及参与记录。
- **EWA 工作量评估**：工作量管理、成员排名与 Excel 导出。
- **待办与消息**：个人待办、站内通知、反馈确认与微信订阅消息。

角色层级为 `user < member < leader < admin`。EWA 按维修、志愿、值班分别以 0.5、0.4、0.1 加权，单科目上限为 300。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 小程序 | 原生 WXML / WXSS / JavaScript，自定义组件与 TabBar |
| 后端 | 腾讯云开发（TCB），Node.js 云函数 |
| 数据与存储 | 云开发文档数据库、云文件存储 |
| 公共能力 | 统一 API 适配、权限路由、事件总线、SWR 缓存与离线操作队列 |

## 目录结构

```text
miniprogram/             # 小程序前端
├── pages/               # 登录、首页、报修、团队与个人中心
├── components/          # 公共组件
├── custom-tab-bar/      # 角色化底部导航
├── utils/               # API、路由、缓存与资源管理
├── styles/              # 设计 Token 与公共样式
└── app.js               # 云初始化、登录态与全局事件
cloudfunctions/          # 按业务域独立部署的云函数
scripts/                 # 开发与运维脚本
tests/                   # 专项测试
docs/                    # 知识库、业务说明与开发记录
project.config.json      # 微信开发者工具项目配置
AGENTS.md                # 开发协作与验证约定
```

页面与导航以 [app.json](miniprogram/app.json) 为准，数据库集合结构以 [初始化器源码](cloudfunctions/initDataBase/) 为准。

## 本地开发

准备微信开发者工具、小程序开发权限及腾讯云开发环境；本地安装云函数依赖时需准备与目标运行时兼容的 Node.js / npm。

1. 克隆仓库，在微信开发者工具中导入**仓库根目录**。
2. 核对 [project.config.json](project.config.json) 中的 `appid`，以及 [app.js](miniprogram/app.js) 中的云环境 ID。
3. 补齐本地配置与媒体资源。`miniprogram/config/`、`miniprogram/images/` 未纳入版本控制，需从维护者取得或按代码引用配置；云存储资源与订阅消息模板需匹配目标环境。
4. 按业务需要部署云函数，选择「上传并部署：云端安装依赖」；本地调试可在对应 `cloudfunctions/<函数名>/` 下执行 `npm install`。
5. 新环境按集合初始化器准备数据库，并根据 [initDataBase 入口](cloudfunctions/initDataBase/index.js) 支持的 action 执行所需初始化；默认调用仅初始化消息日志相关集合。组员管理另见下方业务说明。
6. 编译预览，按改动范围完成调试与必要的真机验证。

仓库无根级 `package.json`；依赖由各云函数独立管理。验证范围遵循 [协作规范](AGENTS.md)，云函数中的占位 `npm test` 不作为通过依据。

## 维护文档

- [协作规范](AGENTS.md)：开发约定、权限边界、验证与云资源维护。
- [设计规范](docs/知识库/Design/README.md)：品牌、组件、页面与交互规则。
- [组员管理](docs/member-management.md)：角色与在职状态、数据保护及部署要求。
- [值班周次校准](docs/duty-week-calibration.md)：周次计算与部署验收说明。
- [开发记录](docs/开发库/)：实施方案、审查与历史验收记录。

问题反馈请提交至 [Issues](https://github.com/YUQI-77-space/Maintenance-Group-APP/issues)，附上复现步骤与必要日志，避免包含成员资料、权限码或凭证。
