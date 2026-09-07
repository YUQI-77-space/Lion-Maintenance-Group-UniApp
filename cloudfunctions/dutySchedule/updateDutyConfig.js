// 更新值班配置
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 更新值班配置
 * @param {Object} event 事件参数
 * @param {String} event.configType 配置类型 (currentWeek, isEditingEnabled, startDate, isSystemLock, autoSwitch*)
 * @param {Any} event.value 配置值
 * @param {String} openid 用户openid
 * @returns {Object} 返回更新结果
 */
exports.updateDutyConfig = async (event, openid) => {
  try {
    console.log('[updateDutyConfig] 开始更新值班配置')
    console.log('[updateDutyConfig] 参数：', { configType: event.configType, value: event.value })

    // 验证必要参数
    if (!event.configType) {
      return {
        code: 400,
        data: null,
        message: '缺少配置类型参数 configType'
      }
    }

    if (event.value === undefined || event.value === null) {
      return {
        code: 400,
        data: null,
        message: '缺少配置值参数 value'
      }
    }

    // TODO: 这里应该添加权限检查，确保只有组长可以更新配置
    // const userResult = await checkLeaderPermission(openid)

    // 验证配置类型
    const allowedConfigTypes = [
      'currentWeek',
      'currentYear',
      'isEditingEnabled',
      'startDate',
      'isSystemLock',
      // 自动切周相关配置
      'autoSwitchEnabled',       // 是否开启自动切周
      'autoSwitchDayOfWeek',     // 每周哪一天自动切周（0=周日...6=周六）
      'autoSwitchTime',          // 当天几点自动切周，格式 HH:MM
      // 内部使用：记录最近一次自动切周
      'lastAutoSwitchWeek',
      'lastAutoSwitchAt'
    ]
    if (!allowedConfigTypes.includes(event.configType)) {
      return {
        code: 400,
        data: null,
        message: `不支持的配置类型: ${event.configType}`
      }
    }

    // 特殊验证
    if (event.configType === 'startDate' && event.value) {
      // 验证日期格式
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(event.value)) {
        return {
          code: 400,
          data: null,
          message: '日期格式错误，应为 YYYY-MM-DD'
        }
      }
      
      // 验证是否为周一
      const date = new Date(event.value)
      if (date.getDay() !== 1) {
        return {
          code: 400,
          data: null,
          message: '学期开始日期必须是周一'
        }
      }
    }

    // 构建更新数据
    const updateData = {
      [event.configType]: event.value,
      updateTime: new Date()
    }

    // 如果更新startDate，同时更新兼容字段和重置当前周
    if (event.configType === 'startDate') {
      updateData.semesterStartDate = event.value
      updateData.currentWeek = 1  // 设置初始日期时重置为第1周
      updateData.currentYear = new Date(event.value).getFullYear()  // 同时更新年份
    }

    console.log('[updateDutyConfig] 准备更新数据：', updateData)

    // 更新配置
    const updateResult = await db.collection('duty_config').doc('global').update({
      data: updateData
    })

    console.log('[updateDutyConfig] 更新结果：', updateResult)

    // 获取更新后的配置
    const configResult = await db.collection('duty_config').doc('global').get()

    console.log('[updateDutyConfig] 更新成功，新配置：', configResult.data)

    return {
      code: 200,
      data: configResult.data,
      message: `配置 ${event.configType} 更新成功`
    }

  } catch (err) {
    console.error('[updateDutyConfig] 错误：', err)
    return {
      code: 500,
      data: null,
      message: err.message || '更新值班配置失败'
    }
  }
} 