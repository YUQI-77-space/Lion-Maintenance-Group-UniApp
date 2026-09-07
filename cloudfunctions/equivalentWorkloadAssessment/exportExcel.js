// 导出等效工作量数据为Excel文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const xlsx = require('node-xlsx')

/**
 * 导出等效工作量数据为Excel文件
 * @param {Object} params - 参数对象
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回Excel文件信息
 */
exports.exportExcel = async (params, OPENID) => {
  try {
    // 检查用户权限（只有组长可以导出数据）
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length === 0) {
      return { code: 403, data: null, message: '未找到用户信息' }
    }
    
    const user = userResult.data[0]
    if (user.role !== 'leader') {
      return { code: 403, data: null, message: '只有组长才能导出工作量数据' }
    }
    
    // 获取所有等效工作量数据（分页拉取，避免默认20条限制）
    const PAGE_SIZE = 100
    const countRes = await db.collection('ewaSummary').count()
    const total = countRes.total
    let fetched = 0
    let allRows = []

    while (fetched < total) {
      const pageRes = await db.collection('ewaSummary')
        .orderBy('totalEW', 'desc')
        .skip(fetched)
        .limit(PAGE_SIZE)
        .get()
      allRows = allRows.concat(pageRes.data || [])
      fetched += PAGE_SIZE
    }

    if (allRows.length === 0) {
      return { code: 404, data: null, message: '没有找到工作量数据' }
    }
    
    // 获取所有用户的详细信息，包括学号
    const userIds = allRows.map(item => item.ewaUserId).filter(id => id)
    const usersResult = await db.collection('users').where({
      openid: db.command.in(userIds)
    }).field({
      openid: true,
      nickName: true,
      studentId: true
    }).get()
    
    // 创建用户信息映射
    const userMap = {}
    usersResult.data.forEach(user => {
      userMap[user.openid] = user
    })
    
    // 准备Excel数据
    const excelData = []
    // 表头
    excelData.push(['序号', '学号', '姓名', '维修任务EW', '值班任务EW', '志愿活动EW', '个人EW总值'])
    
    // 格式化EW数值：整数不补零，有小数则最多保留2位
    const formatEW = (value) => {
      const num = Number(value || 0)
      if (num % 1 === 0) {
        return num.toString()
      }
      return Number(num.toFixed(2)).toString()
    }

    // 数据行 - 使用用户详细信息，智能格式化数值
    allRows.forEach((item, index) => {
      const user = userMap[item.ewaUserId]
      excelData.push([
        index + 1,
        user?.studentId || '未填',
        user?.nickName || item.ewaUserName || '未知用户',
        formatEW(item.maintenanceEW),
        formatEW(item.dutyEW),
        formatEW(item.volunteerEW),
        formatEW(item.totalEW)
      ])
    })
    
    // 生成Excel文件
    const buffer = xlsx.build([{ name: '等效工作量汇总表', data: excelData }])
    
    // 生成唯一文件名（包含时分秒与随机串，避免同日缓存命中）
    const now = new Date()
    const dateStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`
    const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`
    const rand = Math.random().toString(36).slice(2, 6)
    const fileName = `维修组等效工作量汇总表_${dateStr}_${timeStr}_${rand}.xlsx`
    const cloudPath = `ew_exports/${dateStr}/${fileName}`
    
    // 上传到云存储
    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    })
    
    // 获取临时下载链接（加入时间戳参数可再次规避客户端缓存）
    const fileResult = await cloud.getTempFileURL({ fileList: [uploadResult.fileID] })
    const rawUrl = fileResult.fileList[0].tempFileURL
    const fileUrl = `${rawUrl}?t=${Date.now()}`
    
    // 记录导出日志
    console.log(`[exportExcel] 组长${user.nickName}(${OPENID})导出了工作量数据，文件ID: ${uploadResult.fileID}, 总数: ${allRows.length}`)
    
    return {
      code: 200,
      data: { fileID: uploadResult.fileID, fileName, fileUrl, total: allRows.length },
      message: '导出工作量数据成功'
    }
  } catch (err) {
    console.error('[exportExcel] 导出工作量数据失败', err)
    return { code: 500, data: null, message: err.message || '导出工作量数据失败' }
  }
} 