// 获取等效工作量排行榜
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 获取等效工作量排行榜
 * @param {Object} params - 参数对象
 * @param {number} [params.page=1] - 页码，从1开始
 * @param {number} [params.pageSize=20] - 每页数量
 * @param {string} [params.sortField='totalEW'] - 排序字段，可选值：'totalEW', 'maintenanceEW', 'dutyEW', 'volunteerEW'
 * @param {string} [params.sortOrder='desc'] - 排序方式，可选值：'asc', 'desc'
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回排行榜数据
 */
exports.getRanking = async (params, OPENID) => {
  try {
    // 设置默认参数
    const {
      page = 1,
      pageSize = 20,
      sortField = 'totalEW',
      sortOrder = 'desc',
      includeUserRanking = true,
      search = ''
    } = params
    
    // 验证排序字段
    const validSortFields = ['totalEW', 'maintenanceEW', 'dutyEW', 'volunteerEW']
    if (!validSortFields.includes(sortField)) {
      return {
        code: 400,
        data: null,
        message: '无效的排序字段'
      }
    }
    
    // 验证排序方式
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
      return {
        code: 400,
        data: null,
        message: '无效的排序方式'
      }
    }
    
    // 检查用户权限（所有维修组成员都可以查看排行榜）
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '未找到用户信息'
      }
    }
    
    const user = userResult.data[0]
    
    if (user.role !== 'member' && user.role !== 'leader') {
      return {
        code: 403,
        data: null,
        message: '只有维修组成员才能查看排行榜'
      }
    }
    
    // 计算分页参数
    const skip = (page - 1) * pageSize
    
    // 仅查询含有有效 ewaUserId 的记录，避免历史脏数据；支持按用户昵称/学号搜索
    const whereCondition = {
      ewaUserId: _.exists(true)
    }

    const searchText = (search || '').trim()
    if (searchText) {
      // 优先在 proUsers 中匹配（已建立 nickName 索引），回退到 users
      let matchedOpenids = []
      try {
        const proUsersMatchRes = await db.collection('proUsers')
          .where(
            _.or([
              { nickName: db.RegExp({ regexp: searchText, options: 'i' }) },
              { studentId: db.RegExp({ regexp: searchText, options: 'i' }) }
            ])
          )
          .field({ openid: true })
          .get()
        matchedOpenids = (proUsersMatchRes.data || []).map(u => u.openid)
      } catch (e) {
        // ignore
      }

      if (!matchedOpenids.length) {
        const usersMatchRes = await db.collection('users')
          .where(
            _.or([
              { nickName: db.RegExp({ regexp: searchText, options: 'i' }) },
              { studentId: db.RegExp({ regexp: searchText, options: 'i' }) }
            ])
          )
          .field({ openid: true })
          .get()
        matchedOpenids = (usersMatchRes.data || []).map(u => u.openid)
      }

      if (!matchedOpenids.length) {
        return {
          code: 200,
          data: { list: [], total: 0, page, pageSize, userRanking: null },
          message: '获取排行榜成功'
        }
      }

      whereCondition.ewaUserId = _.in(matchedOpenids)
    }

    const baseQuery = db.collection('ewaSummary').where(whereCondition)
    
    // 获取排行榜数据
    const rankingResult = await baseQuery
      .orderBy(sortField, sortOrder)
      .skip(skip)
      .limit(pageSize)
      .field({
        ewaUserId: true,
        ewaUserName: true,
        maintenanceEW: true,
        dutyEW: true,
        volunteerEW: true,
        totalEW: true
      })
      .get()
    
    // 获取总数
    const countResult = await baseQuery.count()
    const total = countResult.total
    
    // 批量获取用户信息（包含头像）
    const userIds = rankingResult.data.map(item => item.ewaUserId).filter(Boolean)
    const usersResult = await db.collection('users')
      .where({
        openid: db.command.in(userIds)
      })
      .field({
        openid: true,
        avatarUrl: true,
        cloudAvatarUrl: true,
        cloudAvatarFileID: true,
        nickName: true,
        studentId: true
      })
      .get()
    
    // 创建用户信息映射
    const userMap = {}
    usersResult.data.forEach(user => {
      userMap[user.openid] = {
        avatarUrl: user.avatarUrl,
        cloudAvatarUrl: user.cloudAvatarUrl,
        cloudAvatarFileID: user.cloudAvatarFileID,
        nickName: user.nickName,
        studentId: user.studentId
      }
    })
    
    // 获取当前用户的排名信息
    let userRanking = null
    if (includeUserRanking && (user.role === 'member' || user.role === 'leader')) {
      // 查询当前用户的EW记录
      const userEWResult = await db.collection('ewaSummary')
        .where({
          ewaUserId: OPENID
        })
        .get()
      
      if (userEWResult.data && userEWResult.data.length > 0) {
        const userEW = userEWResult.data[0]
        
        // 计算当前用户的排名
        const higherRankCountResult = await db.collection('ewaSummary')
          .where({
            [sortField]: db.command.gt(userEW[sortField] || 0)
          })
          .count()
        
        const userRank = higherRankCountResult.total + 1
        
        userRanking = {
          rank: userRank,
          ...userEW,
          avatarUrl: userMap[OPENID]?.avatarUrl,
          cloudAvatarUrl: userMap[OPENID]?.cloudAvatarUrl,
          cloudAvatarFileID: userMap[OPENID]?.cloudAvatarFileID,
          nickName: userMap[OPENID]?.nickName,
          studentId: userMap[OPENID]?.studentId
        }
      }
    }
    
    // 为每个记录添加排名和用户信息
    const rankingList = rankingResult.data.map((item, index) => {
      const userInfo = userMap[item.ewaUserId] || {}
      return {
        rank: skip + index + 1,
        ...item,
        avatarUrl: userInfo.avatarUrl,
        cloudAvatarUrl: userInfo.cloudAvatarUrl,
        cloudAvatarFileID: userInfo.cloudAvatarFileID,
        // 优先使用 users.nickName，回退到 ewaSummary.ewaUserName
        nickName: userInfo.nickName || item.ewaUserName,
        studentId: userInfo.studentId
      }
    })
    
    return {
      code: 200,
      data: {
        list: rankingList,
        total,
        page,
        pageSize,
        userRanking
      },
      message: '获取排行榜成功'
    }
  } catch (err) {
    console.error('获取排行榜失败', err)
    return {
      code: 500,
      data: null,
      message: err.message || '获取排行榜失败'
    }
  }
} 