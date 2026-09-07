// 初始化/维护 proUsers 的紧急联系人标记（isEmergencyContact）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 当前紧急联系人名单（后续有新增成员时，往此数组中追加 openid 后重新调用即可）
const DEFAULT_EMERGENCY_OPENIDS = [
  // 卢余悦（运营管理部），QQ：154604839
  'oXzcE7nDLd8eWvrthyBqwM3FpI6A'
]

/**
 * 将紧急联系人名单同步到 proUsers 集合，并对全体记录补齐 isEmergencyContact 字段
 * 名单内成员写入 true；其余成员显式写入 false，保证集合字段对齐
 * @param {Array<string>} [openids] 可选：通过参数传入紧急联系人 openid 列表
 * @returns {Object} 初始化结果
 */
exports.initEmergencyContacts = async (openids) => {
  try {
    const emergencyOpenids = Array.isArray(openids) && openids.length
      ? openids
      : DEFAULT_EMERGENCY_OPENIDS

    if (!emergencyOpenids.length) {
      return {
        code: 400,
        data: null,
        message: '紧急联系人 openid 列表为空'
      }
    }

    const emergencySet = new Set(emergencyOpenids)

    // 读取全体 proUsers，逐条对齐字段（维修组成员规模有限，limit 1000 足够）
    const allResult = await db.collection('proUsers')
      .limit(1000)
      .get()

    const updatedContacts = []
    const notFound = emergencyOpenids.slice()
    let totalCount = 0
    let setFalseCount = 0
    let setTrueCount = 0

    for (const proUser of (allResult.data || [])) {
      totalCount += 1
      const targetOpenid = proUser.openid
      const targetValue = emergencySet.has(targetOpenid)
      const hasField = Object.prototype.hasOwnProperty.call(proUser, 'isEmergencyContact')

      // 字段缺失，或当前值与目标不一致时，才需要写入
      if (!hasField || proUser.isEmergencyContact !== targetValue) {
        await db.collection('proUsers').doc(proUser._id).update({
          data: {
            isEmergencyContact: targetValue,
            updateTime: db.serverDate()
          }
        })
        if (targetValue) {
          setTrueCount += 1
        } else {
          setFalseCount += 1
        }
      }

      if (targetValue) {
        const idx = notFound.indexOf(targetOpenid)
        if (idx > -1) notFound.splice(idx, 1)
        updatedContacts.push({
          openid: targetOpenid,
          nickName: proUser.nickName || '',
          qqId: proUser.qqId || '',
          isEmergencyContact: true
        })
      }
    }

    const message = notFound.length
      ? `已完成 ${totalCount} 条记录字段对齐：紧急联系人共 ${updatedContacts.length} 人，本次写 true ${setTrueCount} 条、写 false ${setFalseCount} 条；${notFound.length} 个 openid 未在 proUsers 中找到`
      : `已完成 ${totalCount} 条记录字段对齐：紧急联系人共 ${updatedContacts.length} 人，本次写 true ${setTrueCount} 条、写 false ${setFalseCount} 条`

    return {
      code: 200,
      data: {
        totalCount,
        emergencyContactCount: updatedContacts.length,
        setTrueCount,
        setFalseCount,
        updatedContacts,
        notFound
      },
      message
    }
  } catch (err) {
    console.error('[initEmergencyContacts] 设置紧急联系人失败', err)
    return {
      code: 500,
      data: null,
      message: err.message || '设置紧急联系人失败'
    }
  }
}
