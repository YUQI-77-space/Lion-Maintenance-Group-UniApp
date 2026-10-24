// 本人切换部门也更新 users 和版本，避免管理端与个人端互相覆盖。
async function updateMemberDepartment(db, openid, department) {
  try {
    if (!openid) return { success: false, code: 401, message: '请先登录' }
    if (!['运营管理部', '电子技术部', '机电维修部'].includes(department)) {
      return { success: false, code: 400, message: '请选择有效部门' }
    }
    return await db.runTransaction(async tx => {
      const users = await tx.collection('users').where({ openid }).limit(2).get()
      const projections = await tx.collection('proUsers').where({ openid }).limit(2).get()
      const user = users.data[0], pro = projections.data[0]
      if (users.data.length !== 1 || projections.data.length !== 1 ||
          !['member', 'leader', 'admin'].includes(user.role) || user.membershipStatus === 'removed') {
        return { success: false, code: 403, message: '只有在组成员才能设置部门' }
      }
      const lastChange = pro.lastDepartmentChangeTime || 0
      if (pro.department === department) return { success: true, data: { department, lastDepartmentChangeTime: lastChange } }
      const remainingTime = 3600000 - (Date.now() - lastChange)
      if (lastChange && remainingTime > 0) return { success: false, code: 409,
        message: `切换部门过于频繁，请等待 ${Math.ceil(remainingTime / 60000)} 分钟后再试`, remainingTime, canChange: false }
      const lastDepartmentChangeTime = Date.now()
      await tx.collection('users').doc(user._id).update({ data: {
        department, version: (user.version || 0) + 1, updateTime: db.serverDate()
      } })
      await tx.collection('proUsers').doc(pro._id).update({ data: {
        department, lastDepartmentChangeTime, updateTime: db.serverDate()
      } })
      return { success: true, message: '部门更新成功', data: { department, lastDepartmentChangeTime } }
    })
  } catch (error) {
    console.error('更新部门失败', error.message)
    return { success: false, code: 500, message: '部门更新失败，请重试' }
  }
}
module.exports = { updateMemberDepartment }
