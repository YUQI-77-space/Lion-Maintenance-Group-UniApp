// 预选与确认共用服务端校验；兼容 SDK 2.6.3 的文档事务 API。
const cloud = require('wx-server-sdk')
const { createHash } = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })

function reject(code, message) { throw Object.assign(new Error(message), { businessCode: code }) }
const owns = (slot, openid) => [slot.assignedUser, slot.dutyHolderId].filter(Boolean).every(id => id === openid)

exports.changeSelection = async (event = {}, openid, mode = 'select') => {
  const confirm = mode === 'confirm', cancel = mode === 'cancel'
  let transaction
  try {
    if (!openid) reject(401, '请先登录')
    if (!event || typeof event !== 'object') reject(400, '选择参数格式错误')
    const specified = event.selectedSlots !== undefined
    if (specified && (!Array.isArray(event.selectedSlots) || !event.selectedSlots.length ||
        event.selectedSlots.length > 3 || event.selectedSlots.some(id => typeof id !== 'string' || !id.trim()) ||
        new Set(event.selectedSlots).size !== event.selectedSlots.length)) reject(400, '请选择1至3个不同的值班时段')
    if (!specified && !confirm) reject(400, '请提供选择时间段数组')
    const users = await db.collection('users').where({ openid }).limit(2).get()
    if (users.data.length !== 1) reject(403, '用户身份异常，请重新登录')
    const initialUser = users.data[0]
    const { data: initial } = await db.collection('duty_config').doc('global').get()
    if (!initial) reject(404, '值班配置不存在')
    // 一周通常35段；完整分页，不依赖默认100条上限。
    const candidates = []
    let cursor = ''
    while (true) {
      const where = { weekNumber: initial.currentWeek, year: initial.currentYear }
      if (cursor) where._id = db.command.gt(cursor)
      const page = await db.collection('duty_slots').where(where).orderBy('_id', 'asc').limit(100).get()
      candidates.push(...page.data)
      if (page.data.length < 100) break
      cursor = page.data[page.data.length - 1]._id
    }
    const requested = specified ? event.selectedSlots : candidates.filter(slot =>
      (slot.assignedUser === openid || slot.dutyHolderId === openid) && !slot.dutyHolderName).map(slot => slot.dutySlotId)
    if (!requested.length || requested.length > 3) reject(400, '没有可确认的预选或已超过每周配额')
    const selected = requested.map(id => {
      const matches = candidates.filter(slot => slot.dutySlotId === id)
      if (matches.length !== 1) reject(409, '时段不存在、周次已变化或数据重复，请刷新')
      return matches[0]
    })
    // 兼容历史随机待办ID，只补缺失记录，不覆盖历史状态。
    const todos = new Map()
    if (confirm || cancel) for (const slot of selected) {
      const found = await db.collection('duty_toDo_list').where({ dutySlotId: slot.dutySlotId, toDoListUserId: openid }).limit(2).get()
      if (found.data.length > 1) reject(409, '该时段存在重复待办，请联系管理员核查')
      todos.set(slot.dutySlotId, found.data[0])
    }
    transaction = await db.startTransaction()
    const configRef = transaction.collection('duty_config').doc('global')
    const { data: config } = await configRef.get()
    const { data: user } = await transaction.collection('users').doc(initialUser._id).get()
    if (!user || user.openid !== openid || !['member', 'leader', 'admin'].includes(user.role)) reject(403, '只有当前维修组成员可以选择值班')
    if (!config || config.currentWeek !== initial.currentWeek || config.currentYear !== initial.currentYear ||
        config.startDate !== initial.startDate) reject(409, '周次已变化，请刷新后重新选择')
    if (!config.isEditingEnabled || config.isSystemLock) reject(403, '当前周编辑已关闭或系统已锁定')
    const slots = []
    for (const candidate of candidates) {
      const { data: slot } = await transaction.collection('duty_slots').doc(candidate._id).get()
      if (!slot || slot.dutySlotId !== candidate.dutySlotId || slot.weekNumber !== config.currentWeek || slot.year !== config.currentYear) {
        reject(409, '排班已变化，请刷新')
      }
      slots.push({ ...slot, _id: candidate._id })
    }
    const targets = selected.map(candidate => slots.find(slot => slot._id === candidate._id))
    const quota = new Set(slots.filter(slot => slot.assignedUser === openid || slot.dutyHolderId === openid).map(slot => slot.dutySlotId))
    requested.forEach(id => quota.add(id))
    if (!cancel && quota.size > 3) reject(400, '每周最多选择3个值班时段（含预选和已确认）')
    const now = Date.now()
    let changed = false
    for (const slot of targets) {
      if (cancel) {
        if (!owns(slot, openid) || (slot.assignedUser !== openid && slot.dutyHolderId !== openid)) reject(403, '不能取消他人的预选')
        if (slot.dutyHolderName) reject(403, '已确认的值班不能自行取消，请联系组长处理')
        if (slot.lockStatus === 'locked' && slot.lockUserId !== openid) reject(409, '锁归属已变化，请刷新')
        const old = todos.get(slot.dutySlotId)
        if (old) {
          const ref = transaction.collection('duty_toDo_list').doc(old._id)
          const { data: todo } = await ref.get()
          if (!todo || todo.dutySlotId !== slot.dutySlotId || todo.toDoListUserId !== openid || todo.status !== 'pending') {
            reject(409, '待办已变化，取消未执行')
          }
          await ref.remove()
        }
        await transaction.collection('duty_slots').doc(slot._id).update({ data: {
          assignedUser: null, dutyHolderId: null, dutyHolderName: null,
          lockStatus: 'unlocked', lockUserId: '', lockTime: null, lockExpireTime: null, updateTime: db.serverDate() } })
        changed = true
        continue
      }
      if (!slot.isAvailable || !owns(slot, openid)) reject(409, '时段已不可用或已被他人选择')
      if (slot.dutyHolderName) {
        if (slot.dutyHolderId !== openid) reject(409, '时段已被他人确认')
        continue // 重放不改排班、待办和EW。
      }
      const start = Date.parse(`${slot.date}T${slot.startTime}:00+08:00`)
      if (!Number.isFinite(start) || start <= now) reject(409, '时段已开始或时间异常，请重新选择')
      if (slot.lockStatus === 'locked') {
        const expires = new Date(slot.lockExpireTime).getTime()
        if (!slot.lockExpireTime || !Number.isFinite(expires)) reject(409, '锁信息异常，请联系管理员核查')
        if (expires > now && slot.lockUserId !== openid) reject(409, '时段正在被他人操作，请稍后刷新')
      }
      const data = { assignedUser: openid, dutyHolderId: openid, updateTime: db.serverDate() }
      if (confirm) {
        Object.assign(data, { dutyHolderName: user.nickName || '未知用户', dutyStatus: 'pending',
          lockStatus: 'unlocked', lockUserId: '', lockTime: null, lockExpireTime: null })
        const old = todos.get(slot.dutySlotId)
        const todoId = old ? old._id : 'duty_' + createHash('sha256').update(JSON.stringify([openid, slot.dutySlotId])).digest('hex')
        const todoRef = transaction.collection('duty_toDo_list').doc(todoId)
        const { data: todo } = await todoRef.get()
        if (todo) {
          if (todo.dutySlotId !== slot.dutySlotId || todo.toDoListUserId !== openid) reject(409, '待办归属异常，确认未执行')
        } else {
          await todoRef.set({ data: { toDoListUserId: openid, taskId: slot.dutySlotId, dutySlotId: slot.dutySlotId,
            title: `值班任务：${slot.date} ${slot.timeSlot}`, date: slot.date, weekNumber: slot.weekNumber,
            dayOfWeek: slot.dayOfWeek, timeSlot: slot.timeSlot, startTime: slot.startTime, endTime: slot.endTime,
            status: 'pending', createTime: db.serverDate(), updateTime: db.serverDate() } })
        }
      } else {
        Object.assign(data, { lockStatus: 'locked', lockUserId: openid,
          lockTime: new Date(now), lockExpireTime: new Date(now + 5 * 60 * 1000) })
      }
      await transaction.collection('duty_slots').doc(slot._id).update({ data })
      changed = true
    }
    // ponytail: 全局配置文档串行化每周通常35段的选择；高并发再改为每人每周配额锁。
    // 与切周共享冲突边界，事务冲突不自动盲重试。
    if (changed) await configRef.update({ data: { updateTime: db.serverDate() } })
    await transaction.commit()
    transaction = null
    const details = targets.map(({ dutySlotId, date, dayOfWeek, timeSlot, startTime, endTime, weekNumber, year }) =>
      ({ dutySlotId, date, dayOfWeek, timeSlot, startTime, endTime, weekNumber, year, ...(cancel ? { wasConfirmed: false } : {}) }))
    return { code: 200, data: { [cancel ? 'cancelledSlots' : confirm ? 'confirmedSlots' : 'selectedSlots']: details,
      [cancel ? 'totalCancelled' : confirm ? 'totalConfirmed' : 'totalSelected']: targets.length,
      ...(cancel ? { confirmedCancelled: 0, preSelectedCancelled: targets.length } : {}),
      weekNumber: config.currentWeek, year: config.currentYear, userName: user.nickName || '未知用户' },
    message: cancel ? '预选已取消' : confirm ? '值班时段已确认' : '值班时段已预选' }
  } catch (error) {
    if (transaction) await transaction.rollback().catch(() => {})
    console.error('[dutySelection] 选择未提交：', error.message)
    return { code: error.businessCode || 409, data: null, message: error.businessCode ? error.message : '排班更新失败或发生冲突，请刷新核对后重试' }
  }
}
