// 高级Excel导出功能 - 生成包含4个工作表的详细EW分析Excel文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const xlsx = require('node-xlsx')

/**
 * 导出高级EW分析Excel文件
 * @param {Object} params - 参数对象
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回Excel文件信息
 */
exports.exportAdvancedExcel = async (params, OPENID) => {
  try {
    console.log('[exportAdvancedExcel] 开始导出高级EW分析数据')

    // 1. 权限验证 - 检查用户是否为组长
    const user = await validatePermission(OPENID)
    if (!user) {
      return { code: 403, data: null, message: '只有组长才能导出工作量数据' }
    }

    // 2. 并行获取数据
    console.log('[exportAdvancedExcel] 开始获取各类数据')
    const [users, dutyData, volunteerData, maintenanceData, summaryData] = 
      await Promise.all([
        getUsersData(),
        getDutyData(),
        getVolunteerData(), 
        getMaintenanceData(),
        getEWASummaryData()
      ])

    // 3. 数据处理
    console.log('[exportAdvancedExcel] 开始处理数据')
    const processedData = await processAllData(users, dutyData, volunteerData, maintenanceData, summaryData)

    // 4. 生成Excel
    console.log('[exportAdvancedExcel] 开始生成Excel文件')
    const buffer = await generateAdvancedExcel(processedData)

    // 5. 上传文件
    console.log('[exportAdvancedExcel] 开始上传文件')
    const result = await uploadExcelFile(buffer, user)

    console.log('[exportAdvancedExcel] 导出完成')
    return { 
      code: 200, 
      data: result, 
      message: '详细EW分析表导出成功' 
    }

  } catch (error) {
    console.error('[exportAdvancedExcel] 错误:', error)
    return { 
      code: 500, 
      data: null, 
      message: error.message || '导出详细EW分析表失败' 
    }
  }
}

/**
 * 验证用户权限
 * @param {string} OPENID - 用户openid
 * @returns {Object|null} 用户信息或null
 */
async function validatePermission(OPENID) {
  const userResult = await db.collection('users').where({
    openid: OPENID
  }).get()
  
  if (userResult.data.length === 0) {
    console.log('[validatePermission] 未找到用户信息')
    return null
  }
  
  const user = userResult.data[0]
  if (user.role !== 'leader') {
    console.log('[validatePermission] 用户非组长，权限不足')
    return null
  }
  
  return user
}

/**
 * 获取所有维修组成员数据
 * @returns {Array} 用户数据数组
 */
async function getUsersData() {
  console.log('[getUsersData] 获取维修组成员数据')
  const result = await db.collection('proUsers')
    .field({
      openid: true,
      nickName: true,
      studentId: true,
      role: true
    })
    .orderBy('studentId', 'asc')
    .get()
  
  console.log(`[getUsersData] 获取到 ${result.data.length} 名成员`)
  result.data.forEach((user, index) => {
    if (index < 3) { // 只显示前3个用户的详细信息
      console.log(`[getUsersData] 用户${index + 1}: openid=${user.openid}, 姓名=${user.nickName}, 学号=${user.studentId}`)
    }
  })
  return result.data
}

/**
 * 获取值班数据
 * @returns {Array} 值班数据数组
 */
async function getDutyData() {
  console.log('[getDutyData] 获取值班数据')
  
  // 分页获取状态为'ended'的值班数据
  const PAGE_SIZE = 100
  const countRes = await db.collection('duty_toDo_list')
    .where({ status: 'ended' })
    .count()
  const total = countRes.total
  let fetched = 0
  let allDutyData = []

  while (fetched < total) {
    const pageRes = await db.collection('duty_toDo_list')
      .where({ status: 'ended' })
      .field({
        toDoListUserId: true,
        weekNumber: true,
        status: true,
        timeSlot: true,
        dutySlotId: true
      })
      .skip(fetched)
      .limit(PAGE_SIZE)
      .get()
    
    allDutyData = allDutyData.concat(pageRes.data || [])
    fetched += PAGE_SIZE
  }

  console.log(`[getDutyData] 获取到 ${allDutyData.length} 条值班数据`)
  
  // 显示前几条数据作为调试信息
  allDutyData.slice(0, 3).forEach((duty, index) => {
    console.log(`[getDutyData] 值班数据${index + 1}: 用户=${duty.toDoListUserId}, 状态=${duty.status}, 周次=${duty.weekNumber}, 时段=${duty.timeSlot}`)
  })
  
  // 统计状态分布
  const statusCount = {}
  allDutyData.forEach(duty => {
    statusCount[duty.status] = (statusCount[duty.status] || 0) + 1
  })
  console.log('[getDutyData] 状态分布:', statusCount)
  
  return allDutyData
}

/**
 * 获取志愿活动数据
 * @returns {Array} 志愿活动数据数组
 */
async function getVolunteerData() {
  console.log('[getVolunteerData] 获取志愿活动数据')
  
  // 分页获取已结束的志愿活动
  const PAGE_SIZE = 100
  const countRes = await db.collection('voluntary_activities')
    .where({ activityStatus: 'ended' })
    .count()
  const total = countRes.total
  let fetched = 0
  let allVolunteerData = []

  while (fetched < total) {
    const pageRes = await db.collection('voluntary_activities')
      .where({ activityStatus: 'ended' })
      .field({
        activityId: true,
        title: true,
        startTime: true,
        participantEWMap: true
      })
      .orderBy('startTime', 'asc')
      .skip(fetched)
      .limit(PAGE_SIZE)
      .get()
    
    allVolunteerData = allVolunteerData.concat(pageRes.data || [])
    fetched += PAGE_SIZE
  }

  console.log(`[getVolunteerData] 获取到 ${allVolunteerData.length} 个志愿活动`)
  return allVolunteerData
}

/**
 * 获取维修任务数据
 * @returns {Array} 维修任务数据数组
 */
async function getMaintenanceData() {
  console.log('[getMaintenanceData] 获取维修任务数据')
  
  // 分页获取已完成的维修任务
  const PAGE_SIZE = 100
  const countRes = await db.collection('maintenance_tasks')
    .where({ taskStatus: 'completed' })
    .count()
  const total = countRes.total
  let fetched = 0
  let allMaintenanceData = []

  while (fetched < total) {
    const pageRes = await db.collection('maintenance_tasks')
      .where({ taskStatus: 'completed' })
      .field({
        maintenanceTaskId: true,
        level3: true,
        completeTime: true,
        assigneeName: true,
        additionalAssignees: true,
        ew: true
      })
      .orderBy('completeTime', 'asc')
      .skip(fetched)
      .limit(PAGE_SIZE)
      .get()
    
    allMaintenanceData = allMaintenanceData.concat(pageRes.data || [])
    fetched += PAGE_SIZE
  }

  console.log(`[getMaintenanceData] 获取到 ${allMaintenanceData.length} 个维修任务`)
  return allMaintenanceData
}

/**
 * 获取EW汇总数据
 * @returns {Array} EW汇总数据数组
 */
async function getEWASummaryData() {
  console.log('[getEWASummaryData] 获取EW汇总数据')
  
  // 分页获取EW汇总数据
  const PAGE_SIZE = 100
  const countRes = await db.collection('ewaSummary').count()
  const total = countRes.total
  let fetched = 0
  let allSummaryData = []

  while (fetched < total) {
    const pageRes = await db.collection('ewaSummary')
      .orderBy('totalEW', 'desc')
      .skip(fetched)
      .limit(PAGE_SIZE)
      .get()
    
    allSummaryData = allSummaryData.concat(pageRes.data || [])
    fetched += PAGE_SIZE
  }

  console.log(`[getEWASummaryData] 获取到 ${allSummaryData.length} 条汇总数据`)
  return allSummaryData
}

/**
 * 处理所有数据，创建各类数据矩阵
 * @param {Array} users - 用户数据
 * @param {Array} dutyData - 值班数据
 * @param {Array} volunteerData - 志愿活动数据
 * @param {Array} maintenanceData - 维修任务数据
 * @param {Array} summaryData - 汇总数据
 * @returns {Object} 处理后的数据结构
 */
async function processAllData(users, dutyData, volunteerData, maintenanceData, summaryData) {
  console.log('[processAllData] 开始处理数据')
  
  // 创建用户映射
  const userMap = new Map()
  users.forEach(user => {
    userMap.set(user.openid, user)
  })

  const result = {
    users: users,
    userMap: userMap,
    dutyMatrix: createDutyMatrix(users, dutyData),
    volunteerMatrix: createVolunteerMatrix(users, volunteerData),
    maintenanceMatrix: createMaintenanceMatrix(users, maintenanceData),
    summaryMatrix: createSummaryMatrix(users, summaryData)
  }
  
  console.log('[processAllData] 数据处理完成')
  return result
}

/**
 * 创建值班数据矩阵
 * @param {Array} users - 用户数据
 * @param {Array} dutyData - 值班数据
 * @returns {Object} 值班数据矩阵
 */
function createDutyMatrix(users, dutyData) {
  console.log('[createDutyMatrix] 创建值班数据矩阵')
  
  // 计算EW的函数
  const calculateDutyEW = (timeSlot) => {
    if (!timeSlot) return 0
    // 每个值班时间段固定为2EW，无论是上午、下午还是晚上
    if (timeSlot.includes('上午') || timeSlot.includes('下午') || timeSlot.includes('晚上')) {
      return 2
    }
    return 0
  }

  // 创建用户EW映射：userId -> weekNumber -> EW
  const userEWMap = new Map()
  
  // 初始化所有用户的所有周次为0
  users.forEach(user => {
    const weekMap = new Map()
    for (let week = 1; week <= 20; week++) {
      weekMap.set(week, 0)
    }
    userEWMap.set(user.openid, weekMap)
  })

  // 填充实际的值班 EW数据（只处理状态为'ended'的记录）
  let processedCount = 0
  let validDataCount = 0
  
  dutyData.forEach(duty => {
    if (duty.status === 'ended' && duty.weekNumber && duty.toDoListUserId) {
      const ew = calculateDutyEW(duty.timeSlot)
      const userWeekMap = userEWMap.get(duty.toDoListUserId)
      
      console.log(`[createDutyMatrix] 处理值班数据：用户${duty.toDoListUserId}，第${duty.weekNumber}周，时段${duty.timeSlot}，EW=${ew}`)
      
      if (userWeekMap && duty.weekNumber >= 1 && duty.weekNumber <= 20) {
        const currentEW = userWeekMap.get(duty.weekNumber) || 0
        userWeekMap.set(duty.weekNumber, currentEW + ew)
        validDataCount++
        console.log(`[createDutyMatrix] 成功记录EW：用户${duty.toDoListUserId}，第${duty.weekNumber}周，原EW=${currentEW}，新增=${ew}，总计=${currentEW + ew}`)
      } else {
        console.log(`[createDutyMatrix] 跳过数据：用户映射${!!userWeekMap}，周次范围${duty.weekNumber >= 1 && duty.weekNumber <= 20}`)
      }
      processedCount++
    }
  })
  
  console.log(`[createDutyMatrix] 值班数据处理完成：总数据${dutyData.length}条，有效状态${processedCount}条，成功记录${validDataCount}条`)

  return {
    weeks: Array.from({length: 20}, (_, i) => i + 1),
    userEWMap: userEWMap
  }
}

/**
 * 创建志愿活动数据矩阵
 * @param {Array} users - 用户数据
 * @param {Array} volunteerData - 志愿活动数据
 * @returns {Object} 志愿活动数据矩阵
 */
function createVolunteerMatrix(users, volunteerData) {
  console.log('[createVolunteerMatrix] 创建志愿活动数据矩阵')
  
  // 格式化活动信息
  const activities = volunteerData.map(activity => ({
    activityId: activity.activityId,
    title: activity.title,
    startTime: activity.startTime,
    participantEWMap: activity.participantEWMap || {}
  }))

  // 创建用户EW映射：userId -> activityId -> EW
  const userEWMap = new Map()
  
  users.forEach(user => {
    const activityMap = new Map()
    activities.forEach(activity => {
      const ew = activity.participantEWMap[user.openid] || 0
      activityMap.set(activity.activityId, ew)
    })
    userEWMap.set(user.openid, activityMap)
  })

  return {
    activities: activities,
    userEWMap: userEWMap
  }
}

/**
 * 创建维修任务数据矩阵
 * @param {Array} users - 用户数据
 * @param {Array} maintenanceData - 维修任务数据
 * @returns {Object} 维修任务数据矩阵
 */
function createMaintenanceMatrix(users, maintenanceData) {
  console.log('[createMaintenanceMatrix] 创建维修任务数据矩阵')
  
  // 格式化任务信息
  const tasks = maintenanceData.map(task => ({
    maintenanceTaskId: task.maintenanceTaskId,
    level3: task.level3,
    completeTime: task.completeTime,
    assigneeName: task.assigneeName,
    additionalAssignees: task.additionalAssignees || [],
    ew: task.ew || 0
  }))

  // 创建用户EW映射：userId -> taskId -> EW
  const userEWMap = new Map()
  
  users.forEach(user => {
    const taskMap = new Map()
    tasks.forEach(task => {
      let ew = 0
      
      // 检查是否为主受理人或协助受理人
      const isMainAssignee = task.assigneeName === user.nickName
      const isAdditionalAssignee = task.additionalAssignees.some(
        assignee => assignee.assigneeName === user.nickName
      )
      
      if (isMainAssignee || isAdditionalAssignee) {
        ew = task.ew
      }
      
      taskMap.set(task.maintenanceTaskId, ew)
    })
    userEWMap.set(user.openid, taskMap)
  })

  return {
    tasks: tasks,
    userEWMap: userEWMap
  }
}

/**
 * 创建汇总数据矩阵
 * @param {Array} users - 用户数据
 * @param {Array} summaryData - 汇总数据
 * @returns {Object} 汇总数据矩阵
 */
function createSummaryMatrix(users, summaryData) {
  console.log('[createSummaryMatrix] 创建汇总数据矩阵')
  
  // 创建汇总数据映射
  const summaryMap = new Map()
  summaryData.forEach(summary => {
    summaryMap.set(summary.ewaUserId, {
      dutyEW: summary.dutyEW || 0,
      volunteerEW: summary.volunteerEW || 0,
      maintenanceEW: summary.maintenanceEW || 0,
      totalEW: summary.totalEW || 0
    })
  })

  return {
    summaryMap: summaryMap
  }
}

/**
 * 生成高级Excel文件
 * @param {Object} data - 处理后的数据
 * @returns {Buffer} Excel文件缓冲区
 */
async function generateAdvancedExcel(data) {
  console.log('[generateAdvancedExcel] 开始生成Excel文件')
  
  // 创建四个工作表的数据
  const worksheets = [
    {
      name: '值班任务',
      data: createDutyWorksheetData(data)
    },
    {
      name: '志愿活动', 
      data: createVolunteerWorksheetData(data)
    },
    {
      name: '维修任务',
      data: createMaintenanceWorksheetData(data)
    },
    {
      name: '总值',
      data: createSummaryWorksheetData(data)
    }
  ]
  
  // 生成Excel缓冲区
  const buffer = xlsx.build(worksheets)
  
  console.log('[generateAdvancedExcel] Excel文件生成完成')
  return buffer
}

/**
 * 创建值班任务工作表数据
 * @param {Object} data - 数据
 * @returns {Array} 工作表数据数组
 */
function createDutyWorksheetData(data) {
  console.log('[createDutyWorksheetData] 创建值班任务工作表数据')
  
  const worksheetData = []
  
  // 创建表头
  const headerRow = ['学号', '姓名']
  
  // 第1-20周列标题
  for (let week = 1; week <= 20; week++) {
    headerRow.push(`第${week}周`)
  }
  headerRow.push('值班任务EW')
  
  worksheetData.push(headerRow)
  
  // 填充数据行
  data.users.forEach(user => {
    const row = []
    
    // 基本信息
    row.push(user.studentId || '未填')
    row.push(user.nickName || '未知')
    
    // 各周EW值
    let totalEW = 0
    const userWeekMap = data.dutyMatrix.userEWMap.get(user.openid)
    
    for (let week = 1; week <= 20; week++) {
      const ew = userWeekMap ? userWeekMap.get(week) || 0 : 0
      row.push(ew > 0 ? ew : '')
      totalEW += ew
    }
    
    // 总EW（总是显示数值，包括0）
    row.push(totalEW)
    
    worksheetData.push(row)
  })
  
  console.log('[createDutyWorksheetData] 值班任务工作表数据创建完成')
  return worksheetData
}

/**
 * 创建志愿活动工作表数据
 * @param {Object} data - 数据
 * @returns {Array} 工作表数据数组
 */
function createVolunteerWorksheetData(data) {
  console.log('[createVolunteerWorksheetData] 创建志愿活动工作表数据')
  
  const worksheetData = []
  const activities = data.volunteerMatrix.activities
  
  // 创建第一行表头 - 基本信息和活动列
  const headerRow1 = ['学号', '姓名']
  activities.forEach((activity, index) => {
    headerRow1.push(`志愿活动${index + 1}`)
  })
  headerRow1.push('志愿活动EW总值')
  worksheetData.push(headerRow1)
  
  // 创建第二行表头 - 活动时间
  const headerRow2 = ['', '']
  activities.forEach((activity) => {
    const startTime = activity.startTime ? new Date(activity.startTime).toLocaleDateString() : '未知时间'
    headerRow2.push(startTime)
  })
  headerRow2.push('')
  worksheetData.push(headerRow2)
  
  // 创建第三行表头 - 活动名称
  const headerRow3 = ['', '']
  activities.forEach((activity) => {
    headerRow3.push(activity.title || '未知活动')
  })
  headerRow3.push('')
  worksheetData.push(headerRow3)
  
  // 填充数据行
  data.users.forEach(user => {
    const row = []
    
    // 基本信息
    row.push(user.studentId || '未填')
    row.push(user.nickName || '未知')
    
    // 各活动EW值
    let totalEW = 0
    const userActivityMap = data.volunteerMatrix.userEWMap.get(user.openid)
    
    activities.forEach((activity) => {
      const ew = userActivityMap ? userActivityMap.get(activity.activityId) || 0 : 0
      row.push(ew > 0 ? ew : '')
      totalEW += ew
    })
    
    // 总EW（总是显示数值，包括0）
    row.push(totalEW)
    
    worksheetData.push(row)
  })
  
  console.log('[createVolunteerWorksheetData] 志愿活动工作表数据创建完成')
  return worksheetData
}

/**
 * 创建维修任务工作表数据
 * @param {Object} data - 数据
 * @returns {Array} 工作表数据数组
 */
function createMaintenanceWorksheetData(data) {
  console.log('[createMaintenanceWorksheetData] 创建维修任务工作表数据')
  
  const worksheetData = []
  const tasks = data.maintenanceMatrix.tasks
  
  // 创建第一行表头 - 基本信息和任务列
  const headerRow1 = ['学号', '姓名']
  tasks.forEach((task, index) => {
    headerRow1.push(`维修任务${index + 1}`)
  })
  headerRow1.push('维修任务EW总值')
  worksheetData.push(headerRow1)
  
  // 创建第二行表头 - 任务ID
  const headerRow2 = ['', '']
  tasks.forEach((task) => {
    headerRow2.push(task.maintenanceTaskId || '未知ID')
  })
  headerRow2.push('')
  worksheetData.push(headerRow2)
  
  // 创建第三行表头 - 任务标题
  const headerRow3 = ['', '']
  tasks.forEach((task) => {
    headerRow3.push(task.level3 || '未知问题')
  })
  headerRow3.push('')
  worksheetData.push(headerRow3)
  
  // 填充数据行
  data.users.forEach(user => {
    const row = []
    
    // 基本信息
    row.push(user.studentId || '未填')
    row.push(user.nickName || '未知')
    
    // 各任务EW值
    let totalEW = 0
    const userTaskMap = data.maintenanceMatrix.userEWMap.get(user.openid)
    
    tasks.forEach((task) => {
      const ew = userTaskMap ? userTaskMap.get(task.maintenanceTaskId) || 0 : 0
      row.push(ew > 0 ? ew : '')
      totalEW += ew
    })
    
    // 总EW（总是显示数值，包括0）
    row.push(totalEW)
    
    worksheetData.push(row)
  })
  
  console.log('[createMaintenanceWorksheetData] 维修任务工作表数据创建完成')
  return worksheetData
}

/**
 * 创建总值工作表数据
 * @param {Object} data - 数据
 * @returns {Array} 工作表数据数组
 */
function createSummaryWorksheetData(data) {
  console.log('[createSummaryWorksheetData] 创建总值工作表数据')
  
  const worksheetData = []
  
  // 创建表头
  const headerRow = ['学号', '姓名', '值班任务EW', '志愿活动EW', '维修任务EW', '总值']
  worksheetData.push(headerRow)
  
  // 填充数据行
  data.users.forEach(user => {
    const row = []
    
    // 基本信息
    row.push(user.studentId || '未填')
    row.push(user.nickName || '未知')
    
    // 从汇总数据获取EW值
    const summary = data.summaryMatrix.summaryMap.get(user.openid) || {
      dutyEW: 0,
      volunteerEW: 0,
      maintenanceEW: 0,
      totalEW: 0
    }
    
    // 所有EW值都显示数值，包括0
    row.push(summary.dutyEW)
    row.push(summary.volunteerEW)
    row.push(summary.maintenanceEW)
    row.push(summary.totalEW)
    
    worksheetData.push(row)
  })
  
  console.log('[createSummaryWorksheetData] 总值工作表数据创建完成')
  return worksheetData
}

/**
 * 上传Excel文件到云存储
 * @param {Buffer} buffer - Excel文件缓冲区
 * @param {Object} user - 用户信息
 * @returns {Object} 上传结果
 */
async function uploadExcelFile(buffer, user) {
  console.log('[uploadExcelFile] 开始上传Excel文件')
  
  // 生成日期字符串
  const now = new Date()
  const dateStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`
  
  // 获取当天导出次数来生成序号
  const sequenceNumber = await getNextSequenceNumber(dateStr)
  
  // 生成新格式文件名：年月日+序号+物科院维修组等效工作量考核表
  const fileName = `${dateStr}${sequenceNumber}物科院维修组等效工作量考核表.xlsx`
  const cloudPath = `ew_exports/${dateStr}/${fileName}`
  
  console.log(`[uploadExcelFile] 生成文件名: ${fileName}`)
  
  // 上传到云存储
  const uploadResult = await cloud.uploadFile({
    cloudPath,
    fileContent: buffer
  })
  
  // 获取临时下载链接
  const fileResult = await cloud.getTempFileURL({ fileList: [uploadResult.fileID] })
  const rawUrl = fileResult.fileList[0].tempFileURL
  const fileUrl = `${rawUrl}?t=${Date.now()}`
  
  // 记录导出日志
  console.log(`[uploadExcelFile] 组长${user.nickName}导出了详细EW分析数据，文件名: ${fileName}，文件ID: ${uploadResult.fileID}`)
  
  return {
    fileID: uploadResult.fileID,
    fileName: fileName,
    fileUrl: fileUrl,
    uploadTime: now.toISOString()
  }
}

/**
 * 获取下一个序号（01-99）
 * @param {string} dateStr - 日期字符串（YYYYMMDD格式）
 * @returns {string} 序号字符串（01-99）
 */
async function getNextSequenceNumber(dateStr) {
  try {
    console.log(`[getNextSequenceNumber] 查询日期 ${dateStr} 的导出记录`)
    
    // 查询当天所有导出记录，通过文件路径前缀匹配
    const fileList = await cloud.listFiles({
      prefix: `ew_exports/${dateStr}/`,
      maxKeys: 100
    })
    
    console.log(`[getNextSequenceNumber] 找到 ${fileList.fileList.length} 个文件`)
    
    // 提取已使用的序号
    const usedNumbers = new Set()
    fileList.fileList.forEach(file => {
      // 从文件名中提取序号：文件名格式为 "年月日序号物科院维修组等效工作量考核表.xlsx"
      const fileName = file.cloudPath.split('/').pop() // 获取文件名部分
      const match = fileName.match(new RegExp(`^${dateStr}(\\d{2})物科院维修组等效工作量考核表\\.xlsx$`))
      if (match) {
        const number = parseInt(match[1], 10)
        usedNumbers.add(number)
        console.log(`[getNextSequenceNumber] 发现已使用序号: ${match[1]}`)
      }
    })
    
    // 寻找下一个可用序号（01-99）
    for (let i = 1; i <= 99; i++) {
      if (!usedNumbers.has(i)) {
        const sequenceStr = i.toString().padStart(2, '0')
        console.log(`[getNextSequenceNumber] 分配序号: ${sequenceStr}`)
        return sequenceStr
      }
    }
    
    // 如果所有序号都用完了，返回99（理论上不应该发生）
    console.log('[getNextSequenceNumber] 警告：当天导出次数已达到99次上限，使用99作为序号')
    return '99'
    
  } catch (error) {
    console.error('[getNextSequenceNumber] 获取序号时出错:', error)
    // 出错时默认返回01
    console.log('[getNextSequenceNumber] 出错时默认使用序号: 01')
    return '01'
  }
}

