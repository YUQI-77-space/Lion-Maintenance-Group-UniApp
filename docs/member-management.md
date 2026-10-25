# 组员管理

## 范围

- 入口位于维修组首页管理功能的第五格，仅组长、管理员可进入。
- 仅查询和管理已经具有 `member / leader / admin` 角色的在组用户。不提供新建账号、添加成员、候选人搜索或恢复入口。
- 组长与管理员均可对所有在组人员修改资料、调整角色和移出，包括自己、其他组长及管理员，不按目标身份限制。角色调整沿用组员与组长之间的任免；管理员也可被调整为组员。
- 资料支持昵称、学号、QQ、部门、应急联系人；头像继续由用户本人维护。
- 移出后保留普通账号、历史业务、全部工作量；不允许通过旧权限码自行恢复。

## 页面与接口

页面：`pages/team/members/manage/index`（名单）、`pages/team/members/detail/index`（详情及编辑抽屉）。

- 名单支持即时搜索、清空搜索、部门/角色筛选与一键重置，整行点击进入详情。
- 详情集中展示成员身份和基本资料，编辑入口打开底部半屏抽屉，字段在抽屉内滚动，底部固定取消和保存按钮；保存后关闭抽屉并刷新详情，未保存关闭或离开时提醒。
- 移出入口只打开 `action-modal`，按“填写原因 → 核对影响与原因 → 确认移出”执行。原因不能为空，提交期间锁定按钮，失败保留原因及请求标识，交接阻塞在弹窗内展示。
- 角色变更保留二次确认；普通资料修改直接保存。详情与抽屉复用 `members/page.js` 中的加载、权限、版本与幂等提交逻辑。

`users` 云函数新增：

| action | 参数 | 返回 |
| --- | --- | --- |
| `getManagedMembers` | `keyword / department / role / page / pageSize` | `items / total / page / pageSize / hasMore` |
| `getManagedMemberDetail` | `userId` | 当前资料、版本及允许的操作 |
| `updateManagedMember` | `userId / version / fields / _requestId` | 新版本 |
| `changeMemberRole` | `userId / version / role / _requestId` | 新版本 |
| `removeTeamMember` | `userId / version / reason / _requestId` | 新版本、`removed=true` |

错误码：`400` 参数错误，`401/403` 身份或权限不足，`404` 已不在组内，`409` 版本冲突、冷却或待交接，`500` 操作失败。

列表每页默认20人。服务端完整分页读取在组身份与组内资料后筛选，适合当前小型团队；名单达到数千人时再迁移为数据库检索和投影索引。列表不返回QQ号。昵称包含匹配、学号完整匹配。

## 数据和事务

不需要批量迁移旧用户：缺失 `version` 视为0，现有内部角色且未被标记移出的用户视为在组。

首次修改会写入 `users.version`；移出时另写 `membershipStatus=removed / removedAt / removedBy / removeReason / roleManaged=true`，并将角色改为 `user`、移除 `proUsers` 投影。任免组长写入 `roleManaged=true`。

`member_management_logs` 是唯一新增集合。操作、双集合更新、必要的EWA姓名同步在同一个事务中提交；日志 `_id` 由操作者和请求标识生成，防止重复提交。事务内重新校验操作者最新角色和目标版本。

日志只保存实际变更字段的前后值，移出时额外保存原成员投影用于人工核对。日志含成员资料，不可开放客户端读写。已有业务记录视为历史快照，不随管理端改名回写；EWA仅同步当前姓名，所有数值保持原样。

移出前检查未完成维修的主/附加受理人、尚未结束的已占用值班（包含预选）、未结束志愿活动的创建人或参加人。日期异常的值班也需先人工确认。返回待交接列表，不自动取消值班、不自动结算工作量。现有任务受理、报名等操作没有统一的跨云函数成员锁；正式移出时应避免同时向该成员派发新任务，并在移出后复核关联业务。

个人资料接口固定操作微信上下文本人，并使用字段白名单。本人切换部门同步 `users / proUsers`、递增版本，与管理端共用一小时冷却。登录同步重新读取数据库身份，避免旧会话重建已移出投影。

## 数据库初始化与上线

本次实现没有对线上数据执行写入，也未部署云函数。

1. 在测试环境部署 `initDataBase`，以已登录组长/管理员身份调用 `action=initMemberManagement`：先传 `params={"dryRun":true}` 审查，再传 `params={"dryRun":false}` 创建日志集合。该操作幂等，不修改已有用户。
2. 将日志集合权限设为“仅管理员可读写”，或应用同目录 `member_management_logs.rules.json`。这里的管理员指云端管理身份；小程序中的 `admin` 也不能直接读写数据库。通过官方 CloudBase CLI/Manager SDK配置并复查规则，云函数保留访问权限。
3. 核实 `users / proUsers` 已有的 `openid` 唯一索引。日志使用默认 `_id` 唯一索引实现幂等；本版没有日志查询页，不增加无用索引。不要直接修改旧成员记录或重跑其他初始化器。
4. 部署 `users` 和 `login`，两个目录的 `syncMemberProjection.js / ensureEwaSummary.js` 必须保持一致。可使用官方CLI，显式指定环境，例如：

```powershell
tcb fn deploy users -e <测试环境ID> --dir cloudfunctions/users --force --install-dependency true
tcb fn deploy login -e <测试环境ID> --dir cloudfunctions/login --force --install-dependency true
```

5. 微信开发者工具编译小程序并使用真实测试身份验收：组员不能进入、组长与管理员管理所有在组人员（含本人、同级组长与管理员）、任免组长、本人降为组员或移出后刷新身份并退出详情、修改后跨页面刷新、移出阻止待交接、部门冷却、并发版本冲突、网络重试、被移出成员重新登录无法恢复。
6. 测试环境验收后，再对实际生产环境执行同样的初始化/权限核查/部署，最后预览或上传小程序。部署前备份本次涉及的云函数版本及集合规则；如需成员数据导出，放入 Git 忽略的 `.eidos/` 目录。不要在生产环境创建虚假成员进行测试。

线上回滚应保留新增的身份安全校验与移出标记，避免回滚旧登录实现后重新授予已移出成员权限。可以先撤下小程序入口，停止管理写入，再核对日志与身份；不自动批量恢复用户。

## 本地验证

```powershell
node --test cloudfunctions/users/ewaMembership.test.js cloudfunctions/users/memberManagement.test.js tests/member-management-frontend.test.js
```

测试使用内存数据，不连接云端。覆盖普通用户与组员拒绝管理访问、组长及管理员对所有在组人员的操作、字段白名单、超过100人的分页、EWA保留、幂等、事务回滚、交接检查、旧权限码、本人接口、部门冷却、本人降级或移出后的身份刷新、前端请求时序与草稿重试。测试不替代真实微信身份和云环境联调。

新页面WXML/WXSS已使用本机微信开发者工具附带的 `wcc.exe / wcsc.exe` 编译；仍需在模拟器和真机确认实际布局、键盘与头像显示。
