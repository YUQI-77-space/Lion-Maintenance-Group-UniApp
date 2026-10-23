// 切换到指定周
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })
const { getActualWeek, getWeekCalendar } = require('./weekCalendar')

/**
 * 判断时间段是否可用
 * 根据星期和时间段索引判断该时间段是否开放值班
 * @param {Number} dayOfWeek 星期几 (0=周日, 1=周一, ..., 6=周六)
 * @param {Number} slotIndex 时间段索引 (0-4)
 * @returns {Boolean} 是否可用
 */
function isSlotAvailable(dayOfWeek, slotIndex) {
  // 时间段对应关系：
  // 0: 上午 07:30-09:30
  // 1: 上午 09:30-11:30  
  // 2: 下午 13:30-15:30
  // 3: 下午 15:30-17:30
  // 4: 晚上 18:30-20:30

  if (dayOfWeek === 0) {
    // 周日：休假，所有时间段不可用
    return false
  } else if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // 工作日(周一~周五): 15:30-17:30, 18:30-20:30
    return slotIndex === 3 || slotIndex === 4
  } else if (dayOfWeek === 6) {
    // 周六: 13:30-15:30, 15:30-17:30
    return slotIndex === 2 || slotIndex === 3
  }
  
  return false
}

/**
 * 创建指定周的有序值班数据
 * @param {Number} weekNumber 周次
 * @param {Number} year 年份
 * @param {Date} semesterStartDate 学期开始日期
 * @returns {Array} 生成的有序值班时间段数组
 */
async function createWeekData(weekNumber, year, semesterStartDate) {
  console.log(`[switchToWeek] 开始创建第${weekNumber}周的有序数据`)

  // 定义时间段配置
  const timeSlotConfigs = [
    { name: '上午', start: '07:30', end: '09:30' },
    { name: '上午', start: '09:30', end: '11:30' },
    { name: '下午', start: '13:30', end: '15:30' },
    { name: '下午', start: '15:30', end: '17:30' },
    { name: '晚上', start: '18:30', end: '20:30' }
  ]

  let generatedSlots = []
  
  // 为了确保与其他周的sortOrder连续，需要计算基础sortOrder
  // 假设每周有35个时间段（7天 × 5时间段）
  const slotsPerWeek = 35
  const baseSortOrder = (weekNumber - 1) * slotsPerWeek + 1
  let sortOrderCounter = baseSortOrder

  // 计算该周的起始日期
  const weekStartDate = new Date(semesterStartDate)
  weekStartDate.setUTCDate(semesterStartDate.getUTCDate() + (weekNumber - 1) * 7)

  // 按天循环（周一到周日的顺序：1,2,3,4,5,6,0）
  const dayOrder = [1, 2, 3, 4, 5, 6, 0] // 周一到周日
  
  for (let dayIndex = 0; dayIndex < dayOrder.length; dayIndex++) {
    const targetDayOfWeek = dayOrder[dayIndex]
    
    // 计算实际日期
    const currentDate = new Date(weekStartDate)
    currentDate.setUTCDate(weekStartDate.getUTCDate() + dayIndex)
    
    // 验证日期计算是否正确
    const actualDayOfWeek = currentDate.getUTCDay()
    if (actualDayOfWeek !== targetDayOfWeek) {
      console.warn(`[switchToWeek] 日期计算警告：期望${targetDayOfWeek}，实际${actualDayOfWeek}`)
    }
    
    const dateStr = currentDate.toISOString().split('T')[0] // YYYY-MM-DD

    // 按时间段循环（从早到晚：0,1,2,3,4）
    for (let slotIndex = 0; slotIndex < timeSlotConfigs.length; slotIndex++) {
      const slotConfig = timeSlotConfigs[slotIndex]
      const slotId = `${currentDate.getUTCFullYear()}${String(currentDate.getUTCMonth() + 1).padStart(2, '0')}${String(currentDate.getUTCDate()).padStart(2, '0')}${slotIndex + 1}`

      // 根据星期和时间段确定是否可用
      const isAvailable = isSlotAvailable(targetDayOfWeek, slotIndex)

      const dutySlot = {
        dutySlotId: slotId,
        weekNumber: weekNumber,
        year: year,
        dayOfWeek: targetDayOfWeek,
        date: dateStr,
        timeSlot: slotConfig.name,
        startTime: slotConfig.start,
        endTime: slotConfig.end,
        ew: 2,
        dutyHolderId: '',
        dutyHolderName: '',
        isAvailable: isAvailable,
        sortOrder: sortOrderCounter++, // 添加排序字段
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }

      generatedSlots.push(dutySlot)
    }
  }

  console.log(`[switchToWeek] 第${weekNumber}周生成了${generatedSlots.length}条有序记录`)
  
  // 验证排序是否正确
  const firstSlot = generatedSlots[0]
  const lastSlot = generatedSlots[generatedSlots.length - 1]
  console.log(`[switchToWeek] 排序验证：第一条 ${firstSlot?.date} ${firstSlot?.startTime} (sortOrder: ${firstSlot?.sortOrder})，最后一条 ${lastSlot?.date} ${lastSlot?.startTime} (sortOrder: ${lastSlot?.sortOrder})`)
  
  return generatedSlots
}

// 只信任微信上下文传入的 openid，系统调用由模块内部第三参数控制。
async function requireLeader(openid) {
  if (!openid) throw new Error('只有组长或管理员可以维护值班周次')
  const users = await db.collection('users').where({ openid }).get()
  if (!users.data.some(user => ['leader', 'admin'].includes(user.role))) {
    throw new Error('只有组长或管理员可以维护值班周次')
  }
}

function matchesConfig(config, expected) {
  return expected && ['startDate', 'currentWeek', 'currentYear'].every(key => config[key] === expected[key])
}

exports.calibrateCurrentWeek = async (event, openid) => {
  try {
    await requireLeader(openid)
    if (event.preview !== false) {
      const { data: config } = await db.collection('duty_config').doc('global').get()
      if (!config) throw new Error('值班配置不存在')
      const target = getActualWeek(config.startDate)
      return { code: 200, data: {
        ...target,
        expected: { startDate: config.startDate, currentWeek: config.currentWeek, currentYear: config.currentYear }
      }, message: '校准预览成功' }
    }
    if (!event.expected || !Number.isInteger(event.targetWeek)) throw new Error('请先预览校准日期')
    return await exports.switchToWeek(event, openid, { calibrate: true })
  } catch (err) {
    return { code: 400, data: null, message: err.message }
  }
}

exports.switchToWeek = async (event, openid, options = {}) => {
  try {
    if (!options.automatic) await requireLeader(openid)
    const { data: initial } = await db.collection('duty_config').doc('global').get()
    if (!initial) throw new Error('值班配置不存在')
    const expected = options.calibrate ? event.expected : initial
    let result
    // 显式回滚兼容项目现有 SDK；冲突时返回失败，由调用方刷新重试。
    const transaction = await db.startTransaction()
    try {
      await (async () => {
        const configRef = transaction.collection('duty_config').doc('global')
        const { data: config } = await configRef.get()
        if (!config) throw new Error('值班配置不存在')
        if (!options.automatic && !matchesConfig(config, expected)) throw new Error('配置已变化，请刷新后重新预览或切换')
        if (options.automatic && config.autoSwitchEnabled === false) {
          result = { code: 200, data: { skipped: true }, message: '自动切周已关闭' }
          return
        }
        const target = options.automatic || options.calibrate
          ? getActualWeek(config.startDate)
          : getWeekCalendar(config.startDate, Number(event.weekNumber))
        // 保留原有周一 10:30 的生效时刻，提前唤醒不切周。
        const scheduledMs = Date.parse(`${target.startDate}T10:30:00+08:00`)
        if (options.automatic && Date.now() < scheduledMs) {
          result = { code: 200, data: { skipped: true }, message: '尚未到周一 10:30' }
          return
        }
        if (options.calibrate && target.weekNumber !== event.targetWeek) throw new Error('日期已跨周，请重新预览校准')
        // 自动任务只追赶落后的周次；超前配置交由组长预览后回调。
        if (options.automatic && Number(config.currentWeek) >= target.weekNumber) {
          result = { code: 200, data: { skipped: true, ...target }, message: '当前周无需自动前进，超前时请手动校准' }
          return
        }
        const slots = await createWeekData(target.weekNumber, target.year, new Date(`${config.startDate}T00:00:00Z`))
        let createdCount = 0
        for (const slot of slots) {
          const ref = transaction.collection('duty_slots').doc(slot.dutySlotId)
          const { data: existing } = await ref.get()
          if (existing) {
            // 不覆盖排班；发现旧学期/异常日期占用了同一 ID 时中止。
            if (existing.date !== slot.date || Number(existing.weekNumber) !== target.weekNumber || Number(existing.year) !== target.year) {
              throw new Error('目标日期存在不匹配的旧数据，请先人工核查，校准未执行')
            }
          } else {
            await ref.set({ data: slot })
            createdCount++
          }
        }
        const update = {
          currentWeek: target.weekNumber,
          currentYear: target.year,
          updateTime: db.serverDate()
        }
        if (options.automatic) {
          update.lastAutoSwitchWeek = target.weekNumber
          update.lastAutoSwitchAt = db.serverDate()
        }
        if (options.calibrate) {
          update.lastCalibration = {
            fromWeek: config.currentWeek, toWeek: target.weekNumber,
            operator: openid, at: db.serverDate()
          }
        }
        await configRef.update({ data: update })
        result = { code: 200, data: { ...target, createdCount }, message: `已切换到第${target.weekNumber}周，保留已有排班` }
      })()
      await transaction.commit()
    } catch (err) {
      await transaction.rollback().catch(rollbackErr => console.error('[switchToWeek] 回滚失败：', rollbackErr))
      throw err
    }
    return result
  } catch (err) {
    console.error('[switchToWeek] 切周未完成：', err)
    return { code: 400, data: null, message: err.message || '切换失败，请刷新后重试' }
  }
}

exports.requireLeader = requireLeader
