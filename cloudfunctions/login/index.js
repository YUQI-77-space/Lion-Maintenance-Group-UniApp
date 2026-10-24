// 登录认证云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const usersCollection = db.collection('users')
const AUTH_CODE_LIST = {
  // 组长权限身份码
  'KMJpKVpRPt5VFtxsXrYUj4zjt38U': 'leader',
  // 组员权限身份码
  'uychEQvNdHmcdSD3TErvkBBHU5aV': 'member'
}

// 根据权限码获取用户角色
function getUserRoleByAuthCode(authCode) {
  if (!authCode || authCode.trim() === '') {
    console.log('身份权限码为空，返回默认user权限');
    return 'user';
  }
  
  const role = AUTH_CODE_LIST[authCode.trim()];
  if (role) {
    console.log(`身份权限码匹配到权限: ${role}`);
    return role;
  }
  
  console.log(`身份权限码未匹配到特殊权限，返回user权限`);
  return 'user';
}

// 同步proUsers集合
async function syncProUsersByUserDoc(userDoc) {
  if (userDoc && userDoc.openid) return require('./syncMemberProjection').syncMemberProjection(db, userDoc.openid)
}

// 更新用户权限
async function updateUserRole(userId, proposedRole) {
  const role = await db.runTransaction(async tx => {
    const { data: user } = await tx.collection('users').doc(userId).get()
    // 已移出身份不能凭旧权限码恢复；在组或管理者任命的身份以数据库为准。
    const finalRole = user.membershipStatus === 'removed' ? 'user' :
      (user.roleManaged || ['member', 'leader', 'admin'].includes(user.role) ? user.role : proposedRole)
    await tx.collection('users').doc(userId).update({ data: {
      role: finalRole, version: (user.version || 0) + 1, updateTime: db.serverDate()
    } })
    return finalRole
  })
  const { data: userDoc } = await usersCollection.doc(userId).get()
  await syncProUsersByUserDoc(userDoc)
  return role
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  let processedEvent = { ...event }
  if (event.params) {
    processedEvent = { ...processedEvent, ...event.params }
  }
  switch (event.action) {
    case 'userInfoAcquisition':
      return await userInfoAcquisition(wxContext)
    case 'userPermissionAuthentication':
      return await userPermissionAuthentication(openid, processedEvent.authCode)
    case 'verifySession':
      return await verifySession(openid)
    case 'revalidatePermissions':
      return await revalidatePermissions(openid, processedEvent.authCode)
    default:
      return {
        success: false,
        message: '未知的操作类型'
      }
  }
}

async function userInfoAcquisition(wxContext) {
  const { OPENID, APPID } = wxContext
  
  return {
    success: true,
    message: '获取用户标识成功',
    data: {
      openid: OPENID,
      appid: APPID
    }
  }
}

async function verifySession(openid) {
  try {
    console.log('开始验证会话有效性，openid:', openid);
    
    if (!openid) {
      console.error('验证会话失败：OpenID为空');
      return {
        valid: false,
        message: 'OpenID不能为空'
      };
    }
    
    const userResult = await usersCollection.where({
      openid: openid
    }).get();
    
    console.log('用户查询结果:', userResult.data ? userResult.data.length : 0);
    
    if (userResult.data && userResult.data.length > 0) {
      const user = userResult.data[0];
      console.log('找到用户，当前角色:', user.role || 'user');
      
      const currentRole = user.role || 'user';
      
      await syncProUsersByUserDoc(user, currentRole);
      
      return {
        valid: true,
        user: {
          openid: user.openid,
          role: currentRole,
          nickName: user.nickName,
          avatarUrl: user.avatarUrl,
          qqId: user.qqId // QQ号字段
        },
        message: '用户会话有效'
      };
    } else {
      try {
        const wxContext = cloud.getWXContext();
        const currentOpenid = wxContext.OPENID;
        
        console.log('当前微信上下文openid:', currentOpenid);
        console.log('验证的openid:', openid);
        
        if (currentOpenid && currentOpenid === openid) {
          console.log('通过微信上下文验证成功');
          return {
            valid: true,
            user: {
              openid: openid,
              role: 'user' // 默认为普通用户
            },
            message: '通过微信上下文验证成功'
          };
        }
      } catch (wxContextError) {
        console.error('获取微信上下文出错', wxContextError);
      }
      
      console.log('会话验证失败，用户不存在');
      return {
        valid: false,
        message: '用户不存在，需要重新登录'
      };
    }
  } catch (error) {
    console.error('验证会话出错', error);
    return {
      valid: null,
      message: '验证会话出错，请保持当前登录状态',
      error: error.message || '未知错误'
    };
  }
}

async function userPermissionAuthentication(openid, authCode) {
  try {
    const userResult = await usersCollection.where({
      openid: openid
    }).get()
    
    if (!userResult.data || userResult.data.length === 0) {
      console.log('用户未注册，返回默认user权限');
      return {
        success: true,
        message: '用户未注册，默认为普通用户',
        data: { role: 'user' }
      }
    }
    
    const user = userResult.data[0]
    
    const role = await updateUserRole(user._id, getUserRoleByAuthCode(authCode));
    
    console.log(`权限认证完成，用户角色: ${role}`);
    
    return {
      success: true,
      message: role === 'user' ? '未匹配到高级权限，设置为普通用户' : `已匹配到${role}权限`,
      data: { role }
    }
  } catch (error) {
    console.error('权限认证出错', error)
    return {
      success: false,
      message: '权限认证出错，默认为普通用户',
      data: { role: 'user' },
      error: error.message || '未知错误'
    }
  }
}

// 重新验证用户权限
async function revalidatePermissions(openid, authCode) {
  try {
    console.log('开始重新验证用户权限，openid:', openid, 'authCode:', authCode ? '***已提供***' : '未提供');
    
    if (!openid) {
      return {
        success: false,
        message: 'OpenID不能为空'
      };
    }
    
    const userResult = await usersCollection.where({
      openid: openid
    }).get();
    
    if (!userResult.data || userResult.data.length === 0) {
      return {
        success: false,
        message: '用户不存在'
      };
    }
    
    const user = userResult.data[0];
    const currentRole = user.role || 'user';
    
    const newRole = await updateUserRole(user._id, getUserRoleByAuthCode(authCode));
    
    const roleChanged = currentRole !== newRole;
    
    console.log(`权限重新验证完成: ${currentRole} -> ${newRole}, 权限${roleChanged ? '已' : '未'}变化`);
    
    return {
      success: true,
      message: roleChanged ? `权限已从${currentRole}更新为${newRole}` : '权限未发生变化',
      data: {
        oldRole: currentRole,
        newRole: newRole,
        roleChanged: roleChanged,
        user: {
          openid: user.openid,
          role: newRole,
          nickName: user.nickName,
          avatarUrl: user.avatarUrl,
          qqId: user.qqId
        }
      }
    };
  } catch (error) {
    console.error('重新验证权限出错', error);
    return {
      success: false,
      message: '重新验证权限出错',
      error: error.message || '未知错误'
    };
  }
} 
