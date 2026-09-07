// 初始化值班系统相关集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化值班配置集合
 * @returns {Object} 返回初始化结果
 */
const initDutyConfigCollection = async () => {
  try {
    // 判断集合是否存在
    try {
      await db.createCollection('duty_config')
    } catch (err) {
      // 集合已存在，不需处理
    }

    // 插入默认配置数据
    try {
      await db.collection('duty_config').doc('global').set({
        currentWeek: 1,                   // 当前周次
        currentYear: new Date().getFullYear(), // 当前年份
        isCanEdit: false,                 // 兼容字段：是否可编辑
        isEditingEnabled: false,          // 编辑权限启用状态
        isSystemLock: false,              // 系统锁定状态
        startDate: '',                    // 学期开始日期（YYYY-MM-DD）
        semesterStartDate: '',            // 兼容字段
        createTime: new Date(),
        updateTime: new Date()
      })
      console.log('[initDutyConfigCollection] 默认配置数据插入成功')
    } catch (err) {
      // 记录已存在，不需处理
      console.log('[initDutyConfigCollection] 默认配置数据已存在，跳过插入')
    }

    return {
      code: 200,
      data: null,
      message: '初始化duty_config集合成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '初始化duty_config集合失败'
    }
  }
}

/**
 * 初始化值班时间段集合
 * @returns {Object} 返回初始化结果
 */
const initDutySlotsCollection = async () => {
  try {
    // 判断集合是否存在
    try {
      await db.createCollection('duty_slots')
      console.log('[initDutySlotsCollection] duty_slots集合创建成功')
    } catch (err) {
      // 集合已存在，不需处理
      console.log('[initDutySlotsCollection] duty_slots集合已存在')
    }

    return {
      code: 200,
      data: null,
      message: '初始化duty_slots集合成功'
    }
  } catch (err) {
    console.error('[initDutySlotsCollection] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '初始化duty_slots集合失败'
    }
  }
}

/**
 * 初始化值班待办集合
 * @returns {Object} 返回初始化结果
 */
const initDutyToDoListCollection = async () => {
  try {
    // 判断集合是否存在
    try {
      await db.createCollection('duty_toDo_list')
      console.log('[initDutyToDoListCollection] duty_toDo_list集合创建成功')
    } catch (err) {
      // 集合已存在，不需处理
      console.log('[initDutyToDoListCollection] duty_toDo_list集合已存在')
    }

    return {
      code: 200,
      data: null,
      message: '初始化duty_toDo_list集合成功'
    }
  } catch (err) {
    console.error('[initDutyToDoListCollection] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '初始化duty_toDo_list集合失败'
    }
  }
}

/**
 * 初始化所有值班相关集合
 * @returns {Object} 返回初始化结果
 */
exports.initDutyRosterCollection = async () => {
  try {
    console.log('[initDutyRosterCollection] 开始初始化值班系统集合')

    const configResult = await initDutyConfigCollection()
    console.log('[initDutyRosterCollection] 配置集合结果：', configResult)

    const slotsResult = await initDutySlotsCollection()
    console.log('[initDutyRosterCollection] 时间段集合结果：', slotsResult)

    const todoResult = await initDutyToDoListCollection()
    console.log('[initDutyRosterCollection] 待办集合结果：', todoResult)

    console.log('[initDutyRosterCollection] 值班系统集合初始化完成')

    return {
      code: 200,
      data: {
        duty_config: configResult,
        duty_slots: slotsResult,
        duty_toDo_list: todoResult
      },
      message: '初始化值班系统集合成功'
    }
  } catch (err) {
    console.error('[initDutyRosterCollection] 初始化失败：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '初始化值班系统集合失败'
    }
  }
}

// 导出单独的初始化方法
exports.initDutyConfigCollection = initDutyConfigCollection
exports.initDutySlotsCollection = initDutySlotsCollection
exports.initDutyToDoListCollection = initDutyToDoListCollection 