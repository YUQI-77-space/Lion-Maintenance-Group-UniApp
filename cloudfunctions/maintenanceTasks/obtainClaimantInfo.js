// 获取认领人信息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取认领人信息
 * @param {Object} params - 参数对象
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回认领人信息
 */
exports.obtainClaimantInfo = async (params, OPENID) => {
  try {
    // 根据openid查询用户信息（从 proUsers 集合，更高效）
    const userResult = await db.collection('proUsers').where({
      openid: OPENID
    }).get()
    
    // 检查用户是否存在
    if (userResult.data.length === 0) {
      return {
        code: 403,
        data: null,
        message: '未找到用户信息或您不是维修组成员'
      }
    }
    
    const user = userResult.data[0]
    // proUsers 集合中的用户都是维修组成员，无需额外验证角色
    
    // 检查是否有必要的个人信息
    if (!user.qqId) {
      return {
        code: 400,
        data: null,
        message: '请先完善个人信息'
      }
    }
    
    // 返回用户基本信息供认领使用
    return {
      code: 200,
      data: {
        assigneeId: user.openid,
        assigneeName: user.nickName,
        assigneeStudentId: user.studentId || '', // 添加学号字段
        assigneeQqId: user.qqId || '' // 添加QQ号字段
      },
      message: '获取认领人信息成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '获取认领人信息失败'
    }
  }
} 