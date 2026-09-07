// 用户管理云函数
const cloud = require('wx-server-sdk')
const sensitiveWordFilter = require('./sensitiveWordFilter')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const usersCollection = db.collection('users')
const proUsersCollection = db.collection('proUsers')
const PERMISSION_CODES = {
  MEMBER: 'uychEQvNdHmcdSD3TErvkBBHU5aV', // 组员权限码
  LEADER: 'KMJpKVpRPt5VFtxsXrYUj4zjt38U'  // 组长权限码
}

// 验证权限码
function validatePermissionCode(permissionCode) {
  if (!permissionCode || permissionCode.trim() === '') {
    return 'user'; // 空权限码默认为普通用户
  }
  
  const code = permissionCode.trim();
  
  if (code === PERMISSION_CODES.LEADER) {
    return 'leader'; // 组长权限
  } else if (code === PERMISSION_CODES.MEMBER) {
    return 'member'; // 组员权限
  } else {
    return 'user'; // 无效权限码默认为普通用户
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  let processedEvent = { ...event }
  if (event.params) {
    processedEvent = { ...processedEvent, ...event.params }
  }
  switch (event.action) {
    case 'saveUserInfo':
      return await saveUserInfo(processedEvent.userInfo, wxContext)
    case 'updateUserInfo':
      return await updateUserInfo(processedEvent.userInfo, wxContext)
    case 'syncUserDataAcrossCollections':
      return await syncUserDataAcrossCollections(processedEvent.openid, wxContext)
    case 'getUserByOpenId':
      return await getUserByOpenId(processedEvent.openid || wxContext.OPENID)
    case 'getProUsers':
      return await getProUsers()
    case 'getProUserByOpenId':
      return await getProUserByOpenId(processedEvent.openid || wxContext.OPENID)
    case 'getEmergencyContacts':
      return await getEmergencyContacts()
    case 'updateDepartment':
      return await updateDepartment(processedEvent.department, wxContext)
    default:
      return {
        success: false,
        message: '未知的操作类型'
      }
  }
}

// 获取维修组成员信息
async function getProUsers() {
  try {
    const result = await proUsersCollection
      .orderBy('nickName', 'asc')
      .get()
    
    if (!result.data || result.data.length === 0) {
      return {
        success: true,
        data: [],
        message: '暂无维修组成员'
      }
    }
    
    const users = result.data.map(user => {
      return {
        openid: user.openid,
        nickName: user.nickName,
        studentId: user.studentId,
        qqId: user.qqId,
        role: user.role,
        avatarUrl: user.avatarUrl,
        cloudAvatarUrl: user.cloudAvatarUrl,
        cloudAvatarFileID: user.cloudAvatarFileID,
        department: user.department || null,
        isEmergencyContact: user.isEmergencyContact === true
      }
    })
    
    return {
      success: true,
      data: users,
      message: '获取维修组成员成功'
    }
  } catch (error) {
    console.error('获取维修组成员出错', error)
    return {
      success: false,
      message: '获取维修组成员失败',
      error: error.message
    }
  }
}

// 获取紧急联系人（报修页“紧急联系人信息”板块展示昵称和QQ号）
async function getEmergencyContacts() {
  try {
    const result = await proUsersCollection
      .where({ isEmergencyContact: true })
      .orderBy('nickName', 'asc')
      .get()

    const users = (result.data || [])
      .filter(user => user && user.nickName && user.qqId)
      .map(user => {
        return {
          openid: user.openid,
          nickName: user.nickName,
          qqId: user.qqId,
          role: user.role || 'member'
        }
      })

    return {
      success: true,
      data: users,
      message: '获取紧急联系人成功'
    }
  } catch (error) {
    console.error('获取紧急联系人出错', error)
    return {
      success: false,
      message: '获取紧急联系人失败',
      error: error.message
    }
  }
}

async function saveUserInfo(userInfo, wxContext) {
  try {
    if (!userInfo) {
      return {
        success: false,
        message: '用户信息不能为空'
      }
    }
    
    if (userInfo.nickName) {
      const nicknameValidation = sensitiveWordFilter.validateNickname(userInfo.nickName);
      if (!nicknameValidation.valid) {
        return {
          success: false,
          message: nicknameValidation.message
        }
      }
    }
    
    if (userInfo.qqId && !/^[0-9]{5,11}$/.test(userInfo.qqId)) {
      return {
        success: false,
        message: '请输入正确的QQ号（5-11位数字）'
      }
    }
    
    const openid = userInfo.openid || wxContext.OPENID
    
    // 查询用户是否已存在
    const userResult = await usersCollection.where({
      openid: openid
    }).get()
    
    const now = db.serverDate()
    
    // 如果用户已存在，则更新用户信息
    if (userResult.data && userResult.data.length > 0) {
      const userId = userResult.data[0]._id
      
      await usersCollection.doc(userId).update({
        data: {
          ...userInfo,
          openid: openid,
          updateTime: now
        }
      })

      // 如果角色为 member/leader，同步 proUsers
      const role = userInfo.role || userResult.data[0].role || 'user'
      await syncProUsers(openid, { ...userResult.data[0], ...userInfo, role })
      
      return {
        success: true,
        message: '用户信息更新成功',
        data: { updated: true, _id: userId }
      }
    }
    
    // 如果用户不存在，则创建新用户
    const result = await usersCollection.add({
      data: {
        ...userInfo,
        openid: openid,
        role: 'user', // 默认角色为普通用户
        createTime: now,
        updateTime: now
      }
    })

    // 新用户默认 role=user，无需写入 proUsers
    
    return {
      success: true,
      message: '用户信息保存成功',
      data: { created: true, _id: result._id }
    }
  } catch (error) {
    console.error('保存用户信息出错', error)
    return {
      success: false,
      message: '保存用户信息出错',
      error: error
    }
  }
}

// 更新用户信息
async function updateUserInfo(userInfo, wxContext) {
  try {
    if (!userInfo) {
      return {
        success: false,
        message: '用户信息不能为空'
      }
    }
    
    if (userInfo.nickName) {
      const nicknameValidation = sensitiveWordFilter.validateNickname(userInfo.nickName);
      if (!nicknameValidation.valid) {
        return {
          success: false,
          message: nicknameValidation.message
        }
      }
    }
    
    if (userInfo.qqId && !/^[0-9]{5,11}$/.test(userInfo.qqId)) {
      return {
        success: false,
        message: '请输入正确的QQ号（5-11位数字）'
      }
    }
    
    const openid = userInfo.openid || wxContext.OPENID
    
    // 查询用户是否存在
    const userResult = await usersCollection.where({
      openid: openid
    }).get()
    
    if (!userResult.data || userResult.data.length === 0) {
      return {
        success: false,
        message: '用户不存在'
      }
    }
    
    const userId = userResult.data[0]._id
    const oldUserInfo = userResult.data[0] // 保存旧的用户信息用于比较
    
    // 权限码验证和角色确定
    let newRole = oldUserInfo.role || 'user'; // 默认保持原有角色
    
    // 如果包含权限码，进行权限验证
    if (userInfo.hasOwnProperty('permissionCode')) {
      const permissionCode = userInfo.permissionCode?.trim() || '';
      newRole = validatePermissionCode(permissionCode);
    }
    
    // 准备更新数据，保留role字段
    const updateData = {
      nickName: userInfo.nickName,
      avatarUrl: userInfo.avatarUrl,
      studentId: userInfo.studentId, // 添加学号字段
      qqId: userInfo.qqId, // 添加QQ号字段
      cloudAvatarUrl: userInfo.cloudAvatarUrl, // 云存储头像URL
      cloudAvatarFileID: userInfo.cloudAvatarFileID, // 云存储头像文件ID
      role: newRole, // 设置角色
      updateTime: db.serverDate()
    };
    
    // 如果传入了权限码，也保存权限码字段
    if (userInfo.hasOwnProperty('permissionCode')) {
      updateData.permissionCode = userInfo.permissionCode?.trim() || '';
    }
    
    // 更新用户信息
    await usersCollection.doc(userId).update({
      data: updateData
    })

    // 同步 proUsers（基于最终 role 与最新资料）
    await syncProUsers(openid, { ...oldUserInfo, ...updateData })

    // 检查是否有信息变更需要同步
    const fieldsToCheck = ['nickName', 'studentId', 'qqId', 'cloudAvatarUrl', 'cloudAvatarFileID', 'role'];
    let needSync = false;
    
    for (const field of fieldsToCheck) {
      if (oldUserInfo[field] !== updateData[field]) {
        needSync = true;
        break;
      }
    }

    // 执行数据同步
    let syncResult = null;
    if (needSync) {
      console.log('检测到用户关键信息变更，开始同步相关集合数据');
      try {
        syncResult = await syncUserDataAcrossCollections(openid, oldUserInfo.role, updateData.role);
      } catch (err) {
        console.error('同步用户数据失败:', err);
        syncResult = { success: false, error: err.message };
      }
    }
    
    return {
      success: true,
      message: '用户信息更新成功',
      data: { 
        syncTriggered: needSync,
        syncResult: syncResult,
        roleChanged: oldUserInfo.role !== updateData.role
      }
    }
  } catch (error) {
    console.error('更新用户信息出错', error)
    return {
      success: false,
      message: '更新用户信息出错',
      error: error
    }
  }
}

// 同步proUsers
async function syncProUsers(openid, user) {
  try {
    if (!openid) return;
    const role = (user && user.role) || 'user'
    const existing = await proUsersCollection.where({ openid }).get()

    if (role === 'member' || role === 'leader') {
      const upsertData = {
        openid,
        role,
        nickName: user.nickName || '',
        avatarUrl: user.avatarUrl || '',
        cloudAvatarUrl: user.cloudAvatarUrl || null,
        cloudAvatarFileID: user.cloudAvatarFileID || null,
        studentId: user.studentId || '',
        qqId: user.qqId || '',
        department: user.department || null,
        updateTime: db.serverDate(),
        createTime: user.createTime || db.serverDate()
      }
      const existingData = existing.data && existing.data[0]
      // isEmergencyContact 只维护在 proUsers：新建成员默认 false，更新时沿用原值，避免被资料同步覆盖
      upsertData.isEmergencyContact = existingData && typeof existingData.isEmergencyContact === 'boolean'
        ? existingData.isEmergencyContact
        : false
      if (existingData) {
        // 更新时保留原有的department字段（如果新数据中没有）
        if (!upsertData.department && existingData.department) {
          upsertData.department = existingData.department;
        }
        await proUsersCollection.doc(existingData._id).update({ data: upsertData })
      } else {
        await proUsersCollection.add({ data: upsertData })
      }
    } else {
      if (existing.data && existing.data.length > 0) {
        await proUsersCollection.doc(existing.data[0]._id).remove()
      }
    }
  } catch (err) {
    console.error('同步 proUsers 失败', err)
  }
}

/**
 * 根据用户角色智能同步用户数据到相关集合
 * @param {string} openid - 用户openid
 * @param {string} oldRole - 更新前的角色
 * @param {string} newRole - 更新后的角色
 * @returns {Object} 同步结果
 */
async function syncUserDataAcrossCollections(openid, oldRole = 'user', newRole = 'user') {
  try {
    console.log(`开始智能同步用户数据 - openid: ${openid}, 角色变化: ${oldRole} -> ${newRole}`);
    
    // 获取最新的用户信息
    const userResult = await usersCollection.where({ openid }).get();
    
    if (!userResult.data || userResult.data.length === 0) {
      return {
        success: false,
        message: '用户不存在，无法同步数据'
      };
    }
    
    const userInfo = userResult.data[0];
    console.log('获取到用户信息:', {
      nickName: userInfo.nickName,
      studentId: userInfo.studentId,
      qqId: userInfo.qqId,
      role: userInfo.role
    });
    
    // 定义需要同步的集合配置
    const syncConfigs = getSyncConfigs(oldRole, newRole);
    const syncResults = [];
    let totalUpdated = 0;
    
    // 并发执行同步任务
    for (const config of syncConfigs) {
      try {
        const result = await syncCollection(config, userInfo, openid);
        syncResults.push(result);
        if (result.success) {
          totalUpdated += result.count;
        }
      } catch (error) {
        console.error(`同步集合 ${config.collection} 失败:`, error);
        syncResults.push({
          collection: config.collection,
          count: 0,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log(`数据同步完成 - 总计更新 ${totalUpdated} 条记录`);
    
    return {
      success: true,
      message: '用户数据智能同步完成',
      syncResults: syncResults,
      totalUpdated: totalUpdated,
      roleChanged: oldRole !== newRole
    };
    
  } catch (error) {
    console.error('同步用户数据失败:', error);
    return {
      success: false,
      message: '同步用户数据失败',
      error: error.message
    };
  }
}

/**
 * 根据用户角色获取需要同步的集合配置
 * @param {string} oldRole - 原角色
 * @param {string} newRole - 新角色
 * @returns {Array} 同步配置列表
 */
function getSyncConfigs(oldRole, newRole) {
  const allRoles = [oldRole, newRole];
  const hasPrivilegedRole = allRoles.includes('member') || allRoles.includes('leader');
  
  const configs = [
    // 基础集合 - 所有用户都可能涉及
    {
      collection: 'maintenance_tasks',
      type: 'applicant',
      query: { applicantId: '$openid' },
      updateFields: {
        applicantName: '$nickName',
        applicantStudentId: '$studentId',
        applicantQqId: '$qqId',
        updateTime: '$serverDate'
      }
    },
    {
      collection: 'maintenance_toDo_list',
      type: 'applicant',
      query: { applicantId: '$openid' },
      updateFields: {
        applicantName: '$nickName',
        applicantStudentId: '$studentId',
        applicantQqId: '$qqId',
        updateTime: '$serverDate'
      }
    }
  ];
  
  // 如果涉及特权角色，添加更多集合
  if (hasPrivilegedRole) {
    configs.push(
      // 维修任务受理人
      {
        collection: 'maintenance_tasks',
        type: 'assignee',
        query: { assigneeId: '$openid' },
        updateFields: {
          assigneeName: '$nickName',
          assigneeStudentId: '$studentId',
          assigneeQqId: '$qqId',
          updateTime: '$serverDate'
        }
      },
      {
        collection: 'maintenance_toDo_list',
        type: 'assignee',
        query: { assigneeId: '$openid' },
        updateFields: {
          assigneeName: '$nickName',
          assigneeStudentId: '$studentId',
          assigneeQqId: '$qqId',
          updateTime: '$serverDate'
        }
      },
      // 值班相关
      {
        collection: 'duty_slots',
        type: 'holder',
        query: { dutyHolderId: '$openid' },
        updateFields: {
          dutyHolderName: '$nickName',
          updateTime: '$serverDate'
        }
      },
      {
        collection: 'duty_toDo_list',
        type: 'holder',
        query: { dutyHolderId: '$openid' },
        updateFields: {
          dutyHolderName: '$nickName',
          updateTime: '$serverDate'
        }
      },
      // 等价工作量
      {
        collection: 'ewaSummary',
        type: 'user',
        query: { ewaUserId: '$openid' },
        updateFields: {
          ewaUserName: '$nickName',
          updateTime: '$serverDate'
        }
      },
      // 志愿活动
      {
        collection: 'voluntary_activities',
        type: 'creator',
        query: { creatorId: '$openid' },
        updateFields: {
          creatorName: '$nickName',
          updateTime: '$serverDate'
        }
      },
      {
        collection: 'voluntary_activities',
        type: 'participant',
        query: { 'participants.openid': '$openid' },
        updateFields: {
          'participants.$.nickName': '$nickName',
          'participants.$.studentId': '$studentId',
          'participants.$.qqId': '$qqId',
          updateTime: '$serverDate'
        }
      },
      {
        collection: 'volunteer_toDo_list',
        type: 'assignee',
        query: { assigneeId: '$openid' },
        updateFields: {
          assigneeName: '$nickName',
          updateTime: '$serverDate'
        }
      }
    );
  }
  
  return configs;
}

/**
 * 同步单个集合的数据
 * @param {Object} config - 同步配置
 * @param {Object} userInfo - 用户信息
 * @param {string} openid - 用户openid
 * @returns {Object} 同步结果
 */
async function syncCollection(config, userInfo, openid) {
  try {
    // 构建查询条件
    const query = {};
    for (const [key, value] of Object.entries(config.query)) {
      if (typeof value === 'string') {
        query[key] = value.replace('$openid', openid);
      } else {
        query[key] = value;
      }
    }
    
    // 查询需要更新的记录
    const queryResult = await db.collection(config.collection).where(query).get();
    
    if (!queryResult.data || queryResult.data.length === 0) {
      return {
        collection: `${config.collection} (${config.type})`,
        count: 0,
        success: true,
        message: '没有需要同步的记录'
      };
    }
    
    console.log(`找到 ${queryResult.data.length} 条 ${config.collection} (${config.type}) 记录需要同步`);
    
    // 构建更新数据
    const updateData = {};
    for (const [key, value] of Object.entries(config.updateFields)) {
      if (value === '$serverDate') {
        updateData[key] = db.serverDate();
      } else if (value === '$nickName') {
        updateData[key] = userInfo.nickName || '';
      } else if (value === '$studentId') {
        updateData[key] = userInfo.studentId || '';
      } else if (value === '$qqId') {
        updateData[key] = userInfo.qqId || '';
      } else {
        updateData[key] = value;
      }
    }
    
    // 批量更新记录
    for (const record of queryResult.data) {
      await db.collection(config.collection).doc(record._id).update({
        data: updateData
      });
    }
    
    return {
      collection: `${config.collection} (${config.type})`,
      count: queryResult.data.length,
      success: true,
      message: '同步成功'
    };
    
  } catch (error) {
    console.error(`同步集合 ${config.collection} (${config.type}) 失败:`, error);
    return {
      collection: `${config.collection} (${config.type})`,
      count: 0,
      success: false,
      error: error.message
    };
  }
}

// 根据openid获取用户信息
async function getUserByOpenId(openid) {
  try {
    console.log('根据openid获取用户信息:', openid);
    
    if (!openid) {
      console.error('获取用户信息失败: openid为空');
      return {
        code: 400,
        success: false,
        message: 'openid不能为空'
      }
    }
    
    // 首先在users集合中查找
    const result = await usersCollection.where({
      openid: openid
    }).get()
    
    if (result.data && result.data.length > 0) {
      console.log('在users集合中找到用户');
      return {
        code: 200,
        success: true,
        data: result.data[0],
        message: '获取用户信息成功'
      }
    }
    
    // 用户在users集合中不存在
    
    // 尝试获取微信上下文，确认openid是否有效
    try {
      const wxContext = cloud.getWXContext();
      if (wxContext.OPENID === openid) {
        console.log('openid有效，但用户信息不存在，可能需要注册');
        return {
          code: 404,
          success: false,
          valid_openid: true,
          message: 'openid有效，但用户信息不存在，需要注册'
        }
      }
    } catch (wxError) {
      console.error('获取微信上下文失败', wxError);
    }
    
    console.log('用户不存在');
    return {
      code: 404,
      success: false,
      message: '用户不存在'
    }
  } catch (error) {
    console.error('获取用户信息出错', error);
    return {
      code: 500,
      success: false,
      message: '获取用户信息出错',
      error: error.message || '未知错误'
    }
  }
}

// 根据openid获取proUser信息
async function getProUserByOpenId(openid) {
  try {
    if (!openid) {
      return {
        success: false,
        message: 'openid不能为空'
      };
    }
    
    const result = await proUsersCollection.where({ openid }).get();
    
    if (!result.data || result.data.length === 0) {
      return {
        success: true,
        data: null,
        message: '用户不是维修组成员'
      };
    }
    
    const proUser = result.data[0];
    return {
      success: true,
      data: {
        openid: proUser.openid,
        nickName: proUser.nickName,
        studentId: proUser.studentId,
        qqId: proUser.qqId,
        role: proUser.role,
        avatarUrl: proUser.avatarUrl,
        cloudAvatarUrl: proUser.cloudAvatarUrl,
        cloudAvatarFileID: proUser.cloudAvatarFileID,
        department: proUser.department || null,
        lastDepartmentChangeTime: proUser.lastDepartmentChangeTime || null,
        isEmergencyContact: proUser.isEmergencyContact === true
      },
      message: '获取维修组成员信息成功'
    };
  } catch (error) {
    console.error('获取proUser信息出错', error);
    return {
      success: false,
      message: '获取维修组成员信息失败',
      error: error.message || '未知错误'
    };
  }
}

// 更新部门信息（仅限维修组成员）
async function updateDepartment(department, wxContext) {
  try {
    const openid = wxContext.OPENID;
    
    // 验证部门名称
    const validDepartments = ['运营管理部', '电子技术部', '机电维修部'];
    if (!department || !validDepartments.includes(department)) {
      return {
        success: false,
        message: '无效的部门名称，请选择：运营管理部、电子技术部或机电维修部'
      };
    }
    
    // 检查用户是否存在且为维修组成员
    const proUserResult = await proUsersCollection.where({ openid }).get();
    if (!proUserResult.data || proUserResult.data.length === 0) {
      return {
        success: false,
        message: '只有维修组成员才能设置部门'
      };
    }
    
    const proUser = proUserResult.data[0];
    if (proUser.role !== 'member' && proUser.role !== 'leader') {
      return {
        success: false,
        message: '只有维修组成员才能设置部门'
      };
    }
    
    // 检查CD（1小时 = 3600000毫秒）
    const now = Date.now();
    const lastDepartmentChangeTime = proUser.lastDepartmentChangeTime || 0;
    const cdTime = 3600000; // 1小时
    const timeSinceLastChange = now - lastDepartmentChangeTime;
    
    if (timeSinceLastChange < cdTime && lastDepartmentChangeTime > 0) {
      const remainingSeconds = Math.ceil((cdTime - timeSinceLastChange) / 1000);
      const remainingMinutes = Math.floor(remainingSeconds / 60);
      const remainingSecs = remainingSeconds % 60;
      return {
        success: false,
        message: `切换部门过于频繁，请等待 ${remainingMinutes}分${remainingSecs}秒 后再试`,
        remainingTime: cdTime - timeSinceLastChange,
        canChange: false
      };
    }
    
    // 如果部门没有变化，直接返回成功
    if (proUser.department === department) {
      return {
        success: true,
        message: '部门未发生变化',
        data: {
          department: department,
          lastDepartmentChangeTime: now
        }
      };
    }
    
    // 更新部门信息
    await proUsersCollection.doc(proUser._id).update({
      data: {
        department: department,
        lastDepartmentChangeTime: now,
        updateTime: db.serverDate()
      }
    });
    
    return {
      success: true,
      message: '部门更新成功',
      data: {
        department: department,
        lastDepartmentChangeTime: now
      }
    };
  } catch (error) {
    console.error('更新部门出错', error);
    return {
      success: false,
      message: '更新部门失败',
      error: error.message || '未知错误'
    };
  }
} 
