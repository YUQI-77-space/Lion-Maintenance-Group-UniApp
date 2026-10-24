# 维修组成员 EWA 初始化与历史补齐

## 新成员流程

`login` 与 `users` 的成员同步成功后均调用本部署单元中的 `ensureEwaSummary`。
只有 `member/leader` 会补建；已有记录不更新，保留分数、手动调整和时间。
补建采用固定 `_id` 的 `add`，不使用覆盖式 `set`；并发冲突后重新确认记录存在。
失败上抛，调用者返回失败，后续重试/会话同步可恢复。
两个云函数独立部署，帮助文件各自包含一份，测试确保一致。

## 部署和历史补齐

1. 部署 `login`、`users`，包含各自新增文件；部署 `equivalentWorkloadAssessment` 的成员分页修复。
2. 备份 `ewaSummary`。核对 `ewaUserId` 唯一索引；如不存在，先审查重复/缺失 ID，再建立初始化器中定义的唯一索引。
3. 以真实组长身份调用 `users / repairProUserEwa`，参数 `{ "dryRun": true, "cursor": "" }`。
4. 每批最多 50 条。继续传入返回的 `nextCursor`，直到 `hasMore: false`。汇总 `missing`、`skipped`、`failed`。
5. 从空 cursor 重新遍历，参数改为 `dryRun: false`。只补缺失记录为零，不重算业务工作量。
6. 再执行全量只读审查，确认 `missing: 0`，并核对备份中的原有 EW 与手动调整保持一致。

`skipped` 为无效 openid、非成员角色、在 users 中已退组或不存在的遗留记录，需人工核对，不会删除。
`failed` 非空时本批返回失败；停止推进 cursor，重试同一批次即可，不会覆盖已成功的记录。
云函数使用 `cloud.getWXContext().OPENID` 验证真实调用者，不接受前端指定组长身份；控制台测试若无微信身份，会被拒绝。

小程序调用沿用 `utils/apiAdapter`：

```js
const result = await api.call('users', {
  action: 'repairProUserEwa',
  params: { dryRun: true, cursor: '' }
})
```

全员重算与补齐记录用途不同：前者重算业务分数，后者只补记录；本次历史修复使用后者。

## 本地回归

```powershell
node --test cloudfunctions/users/ewaMembership.test.js
```

覆盖独立部署副本一致性、并发补建、保留历史分数、失败重试、两个同步入口、
默认只读、超过 100 人分页、调用者权限、无效历史成员与重算成员分页。

## 2026-10-23 线上历史补齐记录

- 全量导出核对：`proUsers` 56 人、原 `ewaSummary` 37 条，缺失 19 人，均为 2026 年创建的成员。
- 聚合关联 `users` 验证：42 名 member、14 名 leader，无孤立成员身份。
- 原有汇总无重复或缺失 ewaUserId；已通过控制台建立 `ewaUserId_index` 唯一索引。
- 通过控制台 Insert 模式仅新增缺失的 19 条零值记录，未执行全员重算。
- 补齐后全量导出验证：56 条、56 个唯一 ewaUserId，成员缺失 0；原 37 条记录逐字段一致。
- 小程序模拟器连接线上环境，EWA 管理精确搜索原先缺失成员，确认姓名、头像与零工作量正常显示。
- 已部署并在云函数列表确认成功：`login`（21:23）、`users`（21:24）、`equivalentWorkloadAssessment`（21:25），时间为北京时间。
- 原始导出、补齐文件与验证结果存放在本机被 Git 忽略的 `项目管理/EWA修复/2026-10-23/`，不提交成员个人资料。
