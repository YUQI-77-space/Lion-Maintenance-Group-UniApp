// 获取志愿活动列表
const cloud = require('wx-server-sdk')
const { StatusUpdateManager } = require('./statusUpdateManager')
const timeUtils = require('./timeUtils')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

/**
 * 获取志愿活动列表
 * @param {Object} event - 请求参数
 * @param {number} event.page - 页码，从1开始
 * @param {number} event.pageSize - 每页数量，默认10
 * @param {string} event.status - 筛选状态
 * @param {boolean} event.countOnly - 是否只返回统计数据
 * @param {boolean} event.includePending - 是否包含pending状态（管理界面使用）
 * @returns {Object} 包含活动列表和分页信息的对象
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { status, keyword, page = 1, pageSize = 10, countOnly = false, includePending = false } = event;

  try {
    // ========== 统计数据查询 ==========
    if (countOnly) {
      const statsResult = await db.collection('voluntary_activities')
        .aggregate()
        .group({
          _id: '$activityStatus',
          count: $.sum(1)
        })
        .end()

      const stats = {
        total: 0,
        pending: 0,
        inPreparation: 0,
        inProgress: 0,
        ended: 0
      }

      if (statsResult && Array.isArray(statsResult.data)) {
        statsResult.data.forEach(item => {
          stats.total += item.count
          if (item._id === 'pending') {
            stats.pending = item.count
          } else if (item._id === 'inPreparation') {
            stats.inPreparation = item.count
          } else if (item._id === 'inProgress') {
            stats.inProgress = item.count
          } else if (item._id === 'ended') {
            stats.ended = item.count
          }
        })
      }

      // 非管理界面，从总数中排除pending
      if (!includePending) {
        stats.total -= stats.pending
      }

      return {
        code: 200,
        data: { stats },
        message: '获取统计数据成功'
      }
    }

    // ========== 列表数据查询 ==========

    // 构建查询条件
    let whereCondition = {}

    // 状态筛选
    if (!includePending) {
      // 普通界面：排除pending状态，且按用户选择的status过滤
      if (status === 'pending') {
        return {
          code: 200,
          data: { activities: [], total: 0, hasMore: false },
          message: '获取成功'
        }
      }
      // 先排除pending
      whereCondition.activityStatus = _.neq('pending')
      // 如果用户选择了具体状态（不是all），则进一步过滤
      if (status && status !== 'all') {
        whereCondition.activityStatus = status
      }
    } else if (status && status !== 'all') {
      // 管理界面且指定状态
      whereCondition.activityStatus = status
    }

    // 关键词搜索
    if (keyword) {
      whereCondition.title = db.RegExp({
        regexp: '.*' + keyword + '.*',
        options: 'i',
      })
    }

    // 分页参数
    const pageNum = Math.max(1, Number(page) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, Number(pageSize) || 10))
    const skip = (pageNum - 1) * pageSizeNum

    // 并行执行数据查询和总数查询
    let aggregateQuery = db.collection('voluntary_activities').aggregate()

    // 1. 匹配条件
    aggregateQuery = aggregateQuery.match(whereCondition)

    // 2. 添加置顶字段（仅管理界面）
    if (includePending) {
      aggregateQuery = aggregateQuery.addFields({
        _pinned: {
          $cond: {
            if: {
              $and: [
                { $eq: ['$activityStatus', 'pending'] },
                { $eq: ['$scheduledPublish', true] }
              ]
            },
            then: 1,
            else: 0
          }
        }
      })
    }

    // 3. 排序
    if (includePending) {
      aggregateQuery = aggregateQuery.sort({ _pinned: -1, createTime: -1 })
    } else {
      aggregateQuery = aggregateQuery.sort({ createTime: -1 })
    }

    // 4. 分页
    aggregateQuery = aggregateQuery.skip(skip).limit(pageSizeNum)

    const [dataResult, countResult] = await Promise.all([
      aggregateQuery.end(),
      db.collection('voluntary_activities')
        .where(whereCondition)
        .count()
    ])

    // 处理返回结果
    let activities = (dataResult.list || []).map(item => {
      const { _pinned, ...rest } = item
      return rest
    })

    const total = countResult.total || 0
    const hasMore = skip + activities.length < total

    // 实时更新活动状态
    activities = await StatusUpdateManager.updateActivitiesStatusInList(activities)

    // 非管理界面：再次过滤pending状态
    if (!includePending) {
      activities = activities.filter(activity => {
        if (activity.activityStatus === 'pending') {
          return false
        }
        if (activity.scheduledPublish && activity.publishTime) {
          const now = timeUtils.getChinaTime()
          const publish = timeUtils.parseChinaTime(activity.publishTime)
          if (now.getTime() < publish.getTime()) {
            return false
          }
        }
        return true
      })
    }

    // 标记当前用户是否已报名
    try {
      const ids = activities.map(a => a.activityId)
      if (ids.length > 0) {
        const participation = await db.collection('voluntary_activities')
          .where({
            activityId: _.in(ids),
            participantsIDList: OPENID
          })
          .field({ activityId: true })
          .get()
        const joinedSet = new Set((participation.data || []).map(x => x.activityId))
        activities = activities.map(a => ({
          ...a,
          isRegistered: joinedSet.has(a.activityId)
        }))
      }
    } catch (markErr) {
      console.error('[getVolunteerActivitiesList] isRegistered计算失败：', markErr)
    }

    return {
      code: 200,
      data: {
        activities,
        total,
        hasMore,
        page: pageNum,
        pageSize: pageSizeNum
      },
      message: '获取成功'
    }

  } catch (error) {
    console.error('[getVolunteerActivitiesList] 获取活动列表失败:', {
      error: { message: error.message, stack: error.stack },
      params: { status, keyword, page, pageSize, countOnly, includePending }
    })
    return {
      code: 500,
      message: '获取活动列表失败: ' + error.message,
      debug: {
        timestamp: new Date().toISOString(),
        errorType: error.name
      }
    }
  }
}
