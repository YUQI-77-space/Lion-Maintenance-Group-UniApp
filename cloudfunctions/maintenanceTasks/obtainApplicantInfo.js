// 获取申请人信息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取申请人信息
 * @param {Object} params - 参数对象
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回申请人信息
 */
exports.obtainApplicantInfo = async (params, OPENID) => {
  try {
    // 根据openid查询用户信息
    const userResult = await db.collection('users').where({
      openid: OPENID
    }).get()
    
    // 检查用户是否存在
    if (userResult.data.length === 0) {
      return {
        code: 404,
        data: null,
        message: '未找到用户信息，请先完善个人资料'
      }
    }
    
    const user = userResult.data[0]
    
    // 检查是否有必要的个人信息
    if (!user.qqId) {
      return {
        code: 400,
        data: null,
        message: '请先完善个人信息'
      }
    }
    
    // 返回用户基本信息供申请使用
    return {
      code: 200,
      data: {
        applicantId: user.openid,
        applicantName: user.nickName,
        applicantStudentId: user.studentId || '', // 添加学号字段
        applicantQqId: user.qqId || '' // 添加QQ号字段
      },
      message: '获取申请人信息成功'
    }
  } catch (err) {
    return {
      code: 500,
      data: null,
      message: err.message || '获取申请人信息失败'
    }
  }
} 