// 状态、待办和EW在同一事务中提交；只使用数据库里的时段实体。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })
const { adjustDutyEW, findDutySummaryId } = require('./dutyEWManager')

function calculateDutyStatus(date, startTime, endTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return null
  const start = Date.parse(`${date}T${startTime}:00+08:00`)
  const end = Date.parse(`${date}T${endTime}:00+08:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      new Date(start + 8 * 3600000).toISOString().slice(0, 10) !== date) return null
  const now = Date.now() // 起止时间已经带时区，当前绝对时间不能再加8小时。
  return now < start ? 'pending' : now <= end ? 'inProgress' : 'ended'
}

async function readAll(name, where) {
  const rows = []
  let cursor = ''
  while (true) {
    const condition = { ...where }
    if (cursor) condition._id = db.command.gt(cursor)
    const page = await db.collection(name).where(condition).orderBy('_id', 'asc').limit(100).get()
    rows.push(...page.data)
    if (page.data.length < 100) return rows
    cursor = page.data[page.data.length - 1]._id
  }
}

exports.updateDutySlotStatus = async input => {
  let transaction
  try {
    const slotId = typeof input === 'string' ? input : input && input.dutySlotId
    if (typeof slotId !== 'string' || !slotId) throw new Error('缺少值班时段ID')
    const found = await db.collection('duty_slots').where({ dutySlotId: slotId }).limit(2).get()
    if (found.data.length !== 1) throw new Error('时段不存在或存在重复数据')
    const candidate = found.data[0]
    if (!candidate.dutyHolderId || !candidate.dutyHolderName) return { success: true, statusChanged: false, message: '时段未确认' }
    const summaryId = await findDutySummaryId(candidate.dutyHolderId)
    const todos = await readAll('duty_toDo_list', { dutySlotId: slotId, toDoListUserId: candidate.dutyHolderId })
    transaction = await db.startTransaction()
    const slotRef = transaction.collection('duty_slots').doc(candidate._id)
    const { data: slot } = await slotRef.get()
    if (!slot || slot.dutySlotId !== slotId || slot.dutyHolderId !== candidate.dutyHolderId || !slot.dutyHolderName ||
        (slot.assignedUser && slot.assignedUser !== slot.dutyHolderId)) throw new Error('时段分配已变化，请重试')
    const newStatus = calculateDutyStatus(slot.date, slot.startTime, slot.endTime)
    const oldStatus = slot.dutyStatus || 'pending'
    if (!newStatus || !['pending', 'inProgress', 'ended'].includes(oldStatus)) throw new Error('时段时间或历史状态异常，未自动结算')
    // 历史ended按已结算处理，避免部署后重算造成重复发放；不自动回退历史账目。
    if (oldStatus === 'ended' || newStatus === oldStatus) {
      await transaction.commit()
      transaction = null
      return { success: true, statusChanged: false, currentStatus: oldStatus,
        requiresReview: oldStatus === 'ended' && newStatus !== 'ended', message: '状态未变化' }
    }
    let ewAmount = 0
    if (newStatus === 'ended') ewAmount = await adjustDutyEW(transaction, summaryId, slot.dutyHolderId, 2, slot.dutyHolderName)
    await slotRef.update({ data: { dutyStatus: newStatus, updateTime: db.serverDate() } })
    for (const candidateTodo of todos) {
      const ref = transaction.collection('duty_toDo_list').doc(candidateTodo._id)
      const { data: todo } = await ref.get()
      if (!todo || todo.dutySlotId !== slotId || todo.toDoListUserId !== slot.dutyHolderId) throw new Error('待办已变化，结算未提交')
      await ref.update({ data: { status: newStatus, updateTime: db.serverDate() } })
    }
    await transaction.commit()
    transaction = null
    return { success: true, statusChanged: true, oldStatus, newStatus, ewAdded: newStatus === 'ended', ewAmount, message: '值班状态已更新' }
  } catch (error) {
    if (transaction) await transaction.rollback().catch(() => {})
    console.error('[updateDutySlotStatus] 未提交：', error.message)
    return { success: false, message: error.message || '值班状态更新失败，请重试' }
  }
}

exports.batchUpdateDutyStatus = async (inputs = null) => {
  try {
    const candidates = inputs === null ? await readAll('duty_slots', { dutyHolderId: db.command.neq('') }) : inputs
    if (!Array.isArray(candidates)) throw new Error('时段列表格式错误')
    const ids = [...new Set(candidates.map(slot => typeof slot === 'string' ? slot : slot && slot.dutySlotId))]
    const details = []
    for (const dutySlotId of ids) details.push({ dutySlotId, result: await exports.updateDutySlotStatus(dutySlotId) })
    const statusChangedCount = details.filter(row => row.result.statusChanged).length
    const ewAddedCount = details.filter(row => row.result.ewAdded).length
    return { success: details.every(row => row.result.success), totalChecked: ids.length, statusChangedCount,
      ewAddedCount, totalEwAdded: details.reduce((sum, row) => sum + (row.result.ewAmount || 0), 0), details,
      message: `批量更新完成：${statusChangedCount}个状态变更，${ewAddedCount}个任务结算` }
  } catch (error) { return { success: false, message: error.message || '批量更新失败' } }
}

exports.scheduledStatusUpdate = async () => ({ executionTime: new Date(), ...await exports.batchUpdateDutyStatus() })
exports.sendDutyReminder = async slot => !slot || !slot.dutyHolderId
  ? { code: 400, message: '缺少值班人信息' } : { code: 200, message: '提醒发送成功' }
exports.calculateDutyStatus = calculateDutyStatus
