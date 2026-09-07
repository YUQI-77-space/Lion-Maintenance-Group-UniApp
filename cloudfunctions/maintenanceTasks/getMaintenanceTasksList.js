// 获取维修任务列表
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 获取维修任务列表（支持真正的数据库分页 + 分类过滤）
 * @param {Object} params - 参数对象
 * @param {number} params.page - 页码，从1开始，默认1
 * @param {number} params.pageSize - 每页条数，默认12
 * @param {string} params.category - 分类筛选: 'all'|'electronic'|'mechanical'|'tools'
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回任务列表及分页信息
 */
exports.getMaintenanceTasksList = async (params, OPENID) => {
  try {
    const { page = 1, pageSize = 12, category = 'all' } = params || {}
    const pageNum = Math.max(1, Number(page) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, Number(pageSize) || 12))

    // 分类映射
    const categoryMap = {
      electronic: '电子数码类',
      mechanical: '电路机械类',
      tools: '工具借用类'
    }

    // 首先尝试从 proUsers 集合获取用户角色（维修组成员）
    const proUserResult = await db.collection('proUsers').where({
      openid: OPENID
    }).get()

    let userRole = 'user'

    if (proUserResult.data.length > 0) {
      userRole = proUserResult.data[0].role
    } else {
      const userResult = await db.collection('users').where({
        openid: OPENID
      }).get()

      if (userResult.data.length === 0) {
        return {
          code: 403,
          data: null,
          message: '未找到用户信息，无法获取任务列表'
        }
      }
    }

    // 构建基础查询条件
    let baseQuery = {}

    if (userRole === 'leader') {
      baseQuery = {}
    } else if (userRole === 'member') {
      baseQuery = _.or([
        { taskStatus: 'pending' },
        { assigneeId: OPENID }
      ])
    } else {
      baseQuery = { applicantId: OPENID }
    }

    // 追加分类筛选条件
    if (category && category !== 'all' && categoryMap[category]) {
      const level1Value = categoryMap[category]
      if (userRole === 'member') {
        baseQuery = _.and([
          _.or([
            { taskStatus: 'pending' },
            { assigneeId: OPENID }
          ]),
          { level1: level1Value }
        ])
      } else if (userRole === 'leader') {
        baseQuery = { level1: level1Value }
      } else {
        baseQuery = { applicantId: OPENID, level1: level1Value }
      }
    }

    const aggregateQuery = baseQuery && Object.keys(baseQuery).length > 0 ? baseQuery : {}

    // 并行执行：数据聚合查询 + 总数查询
    const skip = (pageNum - 1) * pageSizeNum

    const [dataResult, countResult] = await Promise.all([
      db.collection('maintenance_tasks')
        .aggregate()
        .match(aggregateQuery)
        .sort({ createTime: -1 })
        .skip(skip)
        .limit(pageSizeNum)
        .end(),
      db.collection('maintenance_tasks')
        .where(baseQuery)
        .count()
    ])

    const tasks = (dataResult.list || []).map(task => {
      const { isUrgent, ...rest } = task
      return rest
    })
    const total = countResult.total || 0
    const hasMore = skip + tasks.length < total

    return {
      code: 200,
      data: {
        tasks,
        total,
        hasMore,
        page: pageNum,
        pageSize: pageSizeNum
      },
      message: '获取维修任务列表成功'
    }

  } catch (err) {
    console.error('[getMaintenanceTasksList] 获取维修任务列表失败:', err)
    return {
      code: 500,
      data: null,
      message: err.message || '获取维修任务列表失败'
    }
  }
}
