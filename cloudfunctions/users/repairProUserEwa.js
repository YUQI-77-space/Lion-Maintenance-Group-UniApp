const { ensureEwaSummary } = require('./ensureEwaSummary')

// 分批审查/补齐历史成员；默认只读，不重算任何已有 EW。
exports.repairProUserEwa = async (db, params, OPENID) => {
  try {
    const caller = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    if (!caller.data.length || caller.data[0].role !== 'leader') {
      return { success: false, message: '只有组长才能审查和补齐 EWA', data: null }
    }
    const { cursor = '', dryRun = true } = params
    if (typeof cursor !== 'string' || cursor.length > 128 || typeof dryRun !== 'boolean') {
      return { success: false, message: 'cursor 或 dryRun 参数无效', data: null }
    }
    const result = await db.collection('proUsers')
      .where(cursor ? { _id: db.command.gt(cursor) } : {})
      .orderBy('_id', 'asc').limit(50).get()
    const data = {
      dryRun, scanned: result.data.length, existing: 0, missing: 0, created: 0,
      skipped: [], failed: [], affected: [],
      nextCursor: result.data.length ? result.data[result.data.length - 1]._id : cursor,
      hasMore: result.data.length === 50
    }
    for (const member of result.data) {
      const info = { id: member._id, openid: member.openid || '', nickName: member.nickName || '' }
      if (typeof member.openid !== 'string' || !member.openid.trim() ||
          (member.role !== 'member' && member.role !== 'leader')) {
        data.skipped.push({ ...info, reason: 'openid 缺失或角色不是内部成员，需人工核对' })
        continue
      }
      try {
        // users 是当前身份来源，遗留的孤立/已退组 proUsers 记录留给人工处理。
        const user = await db.collection('users').where({ openid: member.openid }).limit(1).get()
        if (!user.data.length || !['member', 'leader'].includes(user.data[0].role)) {
          data.skipped.push({ ...info, reason: 'users 中不存在有效成员身份，需人工核对' })
          continue
        }
        const status = await ensureEwaSummary(db, member, dryRun)
        data[status]++
        if (status !== 'existing') data.affected.push(info)
      } catch (err) {
        data.failed.push({ ...info, message: err.message || '补齐失败' })
      }
    }
    return {
      success: data.failed.length === 0,
      message: data.failed.length ? '部分成员处理失败，请重试本批次' : (dryRun ? '本批审查完成' : '本批补齐完成'),
      data
    }
  } catch (err) {
    return { success: false, message: err.message || '审查或补齐 EWA 失败', data: null }
  }
}
