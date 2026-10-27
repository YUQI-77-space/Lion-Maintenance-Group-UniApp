# 组员管理

## 范围与状态

组员管理仅对在职组长和管理员开放，管理现有 member / leader / admin 用户。角色与在职状态独立：`employmentStatus=active/retired`，缺失字段默认在职。`users` 是身份来源，`proUsers` 同步状态。

退休始终保留账号、原角色、成员投影、部门、业务记录、待办、历史工作量及手动调整。重新设为在职只改状态，不恢复旧快照、不重新创建成员、不重算 EWA。此功能不负责找回历史已被硬删除的数据。

- 资料支持昵称、学号、QQ、部门、应急联系人；头像由本人维护，部门切换保留一小时冷却。
- 角色仅允许 member 与 leader 互换；不允许降为 user，管理员角色不可在此调整。
- 在职组长及管理员可管理本人和其他内部成员，包含退休人员；本人退休或降权后刷新身份并退出管理页面。
- 降权或退休前必须保留至少一名可正常鉴权的在职组长／管理员；退休身份和重复 openid 不计作接任者。先任命接任者后才允许最后一名管理者退出。
- 退休身份保留历史读取，停止接单、报名、值班及组内管理写入；个人账号资料维护和消息阅读不受此标签限制。
- EWA 只面向在职成员：排行、搜索、本人排名、管理候选和导出排除退休人员，数据库中的原汇总与工作量保留。

## 页面与接口

名单页面 `pages/team/members/manage/index`，详情与编辑 `pages/team/members/detail/index`。名单支持昵称／完整学号搜索、部门、角色及在职状态筛选。在职状态为在职／退休／全部，默认在职，重置恢复默认。

详情提供编辑资料、调整角色、编辑在职状态；后者使用原生下拉选择和保存，说明退休影响，提交中锁定，失败保留选择与请求标识。相关维修、志愿、值班与待办人员展示按当前状态补充“已退休”标签，不覆盖历史姓名和记录。

| users action | 参数 | 结果 |
| --- | --- | --- |
| getManagedMembers | keyword / department / role / employmentStatus / page / pageSize | items / total / page / pageSize / hasMore |
| getManagedMemberDetail | userId | 资料、employmentStatus、version、permissions |
| updateManagedMember | userId / version / fields / _requestId | 新版本 |
| changeMemberRole | userId / version / role / _requestId | 新版本、最终 role 与在职状态 |
| changeMemberEmploymentStatus | userId / version / employmentStatus / _requestId | 新版本及状态 |
| removeTeamMember（已停用） | 任意 | 410，要求更新客户端使用在职状态 |

错误码：400 参数无效，401/403 权限不足，404 无对应成员，409 版本冲突、冷却或未完成事项，503 日志集合未初始化，500 操作失败。名单默认每页20人，列表不返回 QQ；当前小型团队使用完整分页读取后筛选，规模到数千人时再改数据库检索。

## 退休前的完成检查

以下事项未完成时阻止退休，返回具体列表；先私下沟通并推进完成，不新增交接流程、不自动取消、不强行结算：

- pending / inProgress 维修任务中的申请人、主受理人、协助受理人。
- 未来或尚未结束的已占用值班，包括预选；无法解析日期的记录也需人工核对。
- pending / inPreparation / inProgress 志愿活动的创建者或参与者。

接单、增加受理人、活动创建／报名／导入、值班选择以及内部成员报修与退休事务共写目标 users 文档，使用 membershipWriteTime 产生写冲突，避免检查后同时新增责任。事务冲突须刷新后重试，不跳过检查。恢复在职无此完成检查。

## 数据与幂等

不批量迁移旧成员；缺失 version 视为0。状态、双集合投影、版本和审计日志在同一个事务提交，任一步失败回滚。变更资料只同步 EWA 当前姓名，绝不覆盖工作量。

管理写入共写操作者身份；管理者降权／退休时共写剩余可用管理者身份，避免并发退出导致无人可管理。维修代分配、代建、受理人增删、EW 设置，以及活动创建／导入在其业务事务中复查当前管理角色，不能仅使用事务外读取的身份。

`member_management_logs` 是所需新增集合，客户端禁止读写；日志仅保存实际变更字段前后值。日志 ID 由微信上下文操作者和请求标识生成，相同请求返回原结果，不同内容占用同一标识报冲突；本人退休或降权后的原成功请求仍可安全重放。

登录与本人资料写入保留状态和管理角色，不能用旧权限码自行解除退休。退休的应急联系人不参与报修联系人展示，也不收到新维修任务的部门招募通知。

身份变更独立发布 `identityChanged`，不依赖 tab 路径变化；当前团队页立即重算入口，已失去权限的当前管理页面退出。401／403 通过 apiAdapter 刷新身份；晚到的旧版本本人资料不能恢复已撤销的角色。本人降权使用成功响应先更新本地身份，刷新失败也不继续保留组长权限。前台持续停留且没有请求时不承诺实时收到其他设备的身份变更。

维修任务通用更新 action `updateMaintenanceTasks` 仅供在职组长／管理员设置数值型 EW（0—300），不接收状态、受理人或任意其他字段；这些字段由专用 action 维护。值班清空、重新生成、强制释放锁必须校验当前在职管理身份，`forceDelete` 不能绕过。

## 初始化与部署

部署云函数本身不会自动执行入口。使用 [初始化部署脚本](../scripts/deploy-init-database.ps1) 可以在部署前自动补建日志集合、设置禁止客户端读写、备份并部署 initDataBase；或在云端以在职组长身份调用 `initMemberManagement`（默认 dryRun=true，实际创建传 false），再核对安全规则。

状态改造涉及 users、login、maintenanceTasks、volunteerActivities、dutySchedule、userToDoList、equivalentWorkloadAssessment、initDataBase。先备份并部署业务保护和登录消费者，确认 Active 后最后部署 users 状态变更入口，再编译／发布小程序。不要先启用状态切换却保留旧业务写入口。

回滚时保留退休写保护和角色限制，先关闭管理入口再核对日志。不得用旧登录逻辑或旧快照自动恢复状态。生产验收不使用真实成员试验退休，不创建虚假成员。

## 验证记录

测试范围与执行结果见开发库本次实施记录；测试使用内存边界或拦截实际 SDK 网络请求，不能替代真实微信身份、真机布局与云端写入联调。
