// 值班管理云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { getDutyConfig } = require('./getDutyConfig')
const { updateDutyConfig } = require('./updateDutyConfig')
const { regenerateDutySlots } = require('./regenerateDutySlots')
const { clearAllDutySlots } = require('./clearAllDutySlots')
const { checkWeekExists } = require('./checkWeekExists')
const { switchToWeek } = require('./switchToWeek')
const { resetCurrentWeekData } = require('./resetCurrentWeekData')
const { getDutySlots } = require('./getDutySlots')
const { selectDutySlots } = require('./selectDutySlots')
const { confirmDutySelection } = require('./confirmDutySelection')
const { removeDutySelection } = require('./removeDutySelection')
const { removeDutyAssignment } = require('./removeDutyAssignment')
const { getUserDutySlots } = require('./getUserDutySlots')
const { cleanupExpiredLocks, forceReleaseUserLocks, getLockStatus } = require('./cleanupExpiredLocks')
const { batchUpdateDutyStatus, scheduledStatusUpdate } = require('./dutyStatusManager')
const { scheduleDutyReminder } = require('./scheduleDutyReminder')
const autoWeekSwitcher = require('./autoWeekSwitcher')
const dutyReminderScheduler = require('./dutyReminderScheduler')

exports.main = async (event, context) => {
  // 检查是否为定时触发器调用（对大小写保持宽容，并记录上下文便于排查）
  const triggerNameRaw = (context && context.TriggerName) || event?.TriggerName
  const triggerName = triggerNameRaw ? String(triggerNameRaw).toLowerCase() : ''
  console.log('[dutySchedule] TriggerName:', triggerNameRaw, 'event:', event)
  if (triggerName === 'autoweekswitchertimer' || triggerName.includes('autoweekswitcher')) {
    console.log('[dutySchedule] 命中自动切周触发器，开始执行 autoWeekSwitcher')
    return await autoWeekSwitcher.main(event, context)
  }
  if (triggerName.includes('dutyreminder')) {
    console.log('[dutySchedule] 命中值班提醒触发器，开始执行 dutyReminderScheduler')
    return await dutyReminderScheduler.main(event, context)
  }
  
  const { OPENID } = cloud.getWXContext()
  
  try {
    let processedEvent = { ...event }
    if (event.params) {
      processedEvent = { ...processedEvent, ...event.params }
    }
    
    const { action } = processedEvent

    

    switch (action) {
      case 'getDutyConfig':
        return await getDutyConfig(processedEvent, OPENID)
        
      case 'updateDutyConfig':
        return await updateDutyConfig(processedEvent, OPENID)
        
      case 'regenerateDutySlots':
        return await regenerateDutySlots(processedEvent, OPENID)
        
      case 'clearAllDutySlots':
        return await clearAllDutySlots(processedEvent, OPENID)
        
      case 'checkWeekExists':
        return await checkWeekExists(processedEvent, OPENID)
        
      case 'switchToWeek':
        return await switchToWeek(processedEvent, OPENID)
        
      case 'resetCurrentWeekData':
        return await resetCurrentWeekData(processedEvent, OPENID)
        
      case 'getDutySlots':
        return await getDutySlots(processedEvent, OPENID)
        
      case 'selectDutySlots':
        return await selectDutySlots(processedEvent, OPENID)
        
      case 'confirmDutySelection':
        return await confirmDutySelection(processedEvent, OPENID)
        
      case 'removeDutySelection':
        return await removeDutySelection(processedEvent, OPENID)
        
      case 'removeDutyAssignment':
        return await removeDutyAssignment(processedEvent, OPENID)
        
      case 'getUserDutySlots':
        return await getUserDutySlots(processedEvent, OPENID)
        
      case 'cleanupExpiredLocks':
        return await cleanupExpiredLocks(processedEvent, OPENID)
        
      case 'forceReleaseUserLocks':
        return await forceReleaseUserLocks(processedEvent, OPENID)
        
      case 'getLockStatus':
        return await getLockStatus(processedEvent, OPENID)
        
      case 'batchUpdateDutyStatus':
        return await batchUpdateDutyStatus(processedEvent.dutySlots)
        
      case 'scheduledStatusUpdate':
        return await scheduledStatusUpdate()
        
      case 'scheduleDutyReminder':
        return await scheduleDutyReminder(processedEvent, OPENID)
        
      default:
        return {
          code: 400,
          data: null,
          message: `未知的操作类型: ${action}`
        }
    }
  } catch (err) {
    console.error('[dutySchedule] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '值班管理操作失败'
    }
  }
} 