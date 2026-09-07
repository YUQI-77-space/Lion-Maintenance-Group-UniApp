// 创建维修任务
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const CATEGORY_DEPARTMENT_MAP = {
  '电子数码类': '电子技术部',
  '电子数码大类': '电子技术部',
  '电路机械类': '机电维修部',
  '机械电子大类': '机电维修部'
}

/**
 * 根据任务大类给对应部门成员推送站内消息
 * @param {Object} taskData - 维修任务详情
 */
async function notifyDepartmentMembers(taskData) {
  const targetDepartment = CATEGORY_DEPARTMENT_MAP[taskData.level1]
  if (!targetDepartment) {
    console.log('任务大类未匹配对应部门，跳过组员通知', taskData.level1)
    return
  }

  const MAX_LIMIT = 100
  let members = []
  let fetched = 0

  try {
    while (true) {
      const batch = await db.collection('proUsers')
        .where({
          role: 'member', // 只通知组员
          department: targetDepartment
        })
        .field({ openid: true, nickName: true })
        .skip(fetched)
        .limit(MAX_LIMIT)
        .get()

      members = members.concat(batch.data || [])
      fetched += batch.data.length

      if (!batch.data || batch.data.length < MAX_LIMIT) {
        break
      }
    }

    if (members.length === 0) {
      console.log(`部门 ${targetDepartment} 暂无需要通知的组员`)
      return
    }

    const title = `【${targetDepartment}】新维修任务提醒`
    const applicantInfo = taskData.applicantName ? `申请人：${taskData.applicantName}` : '申请人信息暂缺'
    const content = [
      `${taskData.level1}任务编号：${taskData.maintenanceTaskId}`,
      applicantInfo,
      `预约时间：${taskData.appointmentTime || '未填写'}`,
      '请及时关注并认领。'
    ].join('\n')

    const notifyPromises = members.map(member => {
      return cloud.callFunction({
        name: 'messages',
        data: {
          action: 'createMessage',
          params: {
            messageUserId: member.openid,
            title,
            content,
            messageType: 'maintenance'
          }
        }
      }).catch(err => {
        console.error(`通知成员 ${member.openid} 失败:`, err)
      })
    })

    await Promise.allSettled(notifyPromises)
    console.log(`已向 ${targetDepartment} 的 ${members.length} 名组员发送任务提醒`)
  } catch (err) {
    console.error('推送部门任务提醒失败:', err)
  }
}

/**
 * 生成维修任务编号
 * 格式: 年月序号，如202507001
 */
async function generateMaintenanceTaskId() {
  // 获取当前日期
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  
  // 构建日期前缀
  const prefix = `${year}${month}`
  
  // 查询当月的任务数量
  const countResult = await db.collection('maintenance_tasks')
    .where({
      maintenanceTaskId: new RegExp(`^${prefix}`)
    })
    .count()
  
  // 生成序号 (最多两位数，最多接受99个任务/月)
  const sequence = String(countResult.total + 1).padStart(2, '0')
  
  // 拼接成最终ID
  return `${prefix}${sequence}`
}

/**
 * 格式化日期时间为中国时区的可读格式
 * @param {Date} date - 日期对象
 * @returns {string} 格式化后的日期时间字符串 (YYYY-MM-DD HH:MM:SS)
 */
function formatDateTimeCN(date) {
  // 云函数中new Date()返回UTC时间，需要转换为东八区时间字符串
  const cnTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  
  const year = cnTime.getUTCFullYear();
  const month = String(cnTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cnTime.getUTCDate()).padStart(2, '0');
  const hours = String(cnTime.getUTCHours()).padStart(2, '0');
  const minutes = String(cnTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(cnTime.getUTCSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 创建维修任务
 * @param {Object} params - 参数对象
 * @param {string} params.level1 - 问题类别一级
 * @param {string} params.level2 - 问题类别二级
 * @param {string} params.level3 - 问题类别三级
 * @param {string} params.otherDescription - 其他描述
 * @param {string} params.appointmentTime - 预约时间
 * @param {string} params.comments - 备注信息
 * @param {string} params.applicantId - 申请人openid
 * @param {string} params.applicantName - 申请人姓名
 * @param {string} params.applicantQqId - 申请人QQ号
 * @param {string} OPENID - 用户openid
 * @returns {Object} 返回创建结果
 */
exports.createMaintenanceTask = async (params, OPENID) => {
  try {
    console.log('接收到的参数:', params);
    console.log('用户OPENID:', OPENID);
    const requestId = params && params._requestId ? String(params._requestId) : '';
    
    // 检查参数
    if (!params.level1 || !params.level2 || !params.level3 || !params.appointmentTime) {
      console.log('参数验证失败:', {
        level1: params.level1,
        level2: params.level2,
        level3: params.level3,
        appointmentTime: params.appointmentTime
      });
      return {
        code: 400,
        data: null,
        message: '缺少必要参数'
      }
    }

    // 幂等防重：若同一请求已写入则直接返回已有记录，避免客户端重试造成重复任务
    if (requestId) {
      const existedTaskRes = await db.collection('maintenance_tasks').where({ requestId }).get();
      if (existedTaskRes.data && existedTaskRes.data.length > 0) {
        const existedTask = existedTaskRes.data[0];
        // 确保待办同步存在
        const existedTodo = await db.collection('maintenance_toDo_list').where({
          requestId,
          taskId: existedTask.maintenanceTaskId
        }).get();
        if (!existedTodo.data || existedTodo.data.length === 0) {
          try {
            await db.collection('maintenance_toDo_list').add({
              data: {
                requestId,
                toDoListUserId: existedTask.applicantId,
                taskId: existedTask.maintenanceTaskId,
                taskStatus: existedTask.taskStatus || 'pending',
                title: `维修任务：${existedTask.level1} > ${existedTask.level2} > ${existedTask.level3}`,
                otherDescription: existedTask.otherDescription || '',
                specialFields: existedTask.specialFields || {},
                appointmentTime: existedTask.appointmentTime,
                completeTime: existedTask.completeTime || '',
                applicantId: existedTask.applicantId,
                applicantName: existedTask.applicantName || '',
                applicantStudentId: existedTask.applicantStudentId || '',
                applicantQqId: existedTask.applicantQqId || '',
                applicantTime: existedTask.applicantTime || '',
                assigneeId: existedTask.assigneeId || '',
                assigneeName: existedTask.assigneeName || '',
                assigneeStudentId: existedTask.assigneeStudentId || '',
                assigneeQqId: existedTask.assigneeQqId || '',
                assigneeTime: existedTask.assigneeTime || null,
                isManagementCreated: existedTask.isManagementCreated || false,
                createTime: existedTask.createTime || new Date(),
                updateTime: existedTask.updateTime || new Date()
              }
            })
          } catch (todoErr) {
            console.warn('补写待办失败（已存在任务）:', todoErr)
          }
        }
        return {
          code: 200,
          data: {
            maintenanceTaskId: existedTask.maintenanceTaskId,
            dedup: true
          },
          message: '重复提交，已返回已有维修任务'
        }
      }
    }
    
    // 新增：强制校验申请人必须为已注册用户
    const applicantOpenid = (params && params.applicantId) || OPENID;
    try {
      const userDoc = await db.collection('users').where({ openid: applicantOpenid }).get();
      if (!userDoc.data || userDoc.data.length === 0) {
        return {
          code: 401,
          data: null,
          message: '用户未注册，无法创建维修任务'
        };
      }
    } catch (checkErr) {
      // 数据库异常也不应放过潜在未注册
      console.error('验证用户注册状态失败:', checkErr);
      return {
        code: 401,
        data: null,
        message: '验证用户状态失败，请先完成注册'
      };
    }

    // 生成维修任务编号
    const maintenanceTaskId = await generateMaintenanceTaskId()
    
    // 当前时间
    const now = new Date()
    const formattedNow = formatDateTimeCN(now)
    
    // 处理申请人信息 - 针对组长创建任务的特殊处理
    let finalApplicantId = params.applicantId || OPENID
    let finalApplicantName = params.applicantName || ''
    let finalApplicantStudentId = params.applicantStudentId || ''
    let finalApplicantQqId = params.applicantQqId || ''
    
    // 如果不是管理员创建，尝试从用户信息中获取学号
    if (!params.isManagementCreated) {
      try {
        const userResult = await db.collection('users').where({
          openid: finalApplicantId
        }).field({
          nickName: true,
          studentId: true,
          qqId: true
        }).get()
        if (userResult.data.length > 0) {
          const u = userResult.data[0]
          if (!finalApplicantName) finalApplicantName = u.nickName || ''
          if (!finalApplicantStudentId) finalApplicantStudentId = u.studentId || ''
          if (!finalApplicantQqId) finalApplicantQqId = u.qqId || ''
        }
      } catch (err) {
        console.warn('补全申请人信息失败:', err)
      }
    }
    
    // 如果是管理员创建且提供了申请人信息，尝试匹配真实用户
    if (params.isManagementCreated && params.applicantInfo) {
      const applicantInfo = params.applicantInfo
      finalApplicantName = applicantInfo.nickName || '维修组组长'
      finalApplicantStudentId = applicantInfo.studentId || ''
      finalApplicantQqId = applicantInfo.qqId || ''
    }
    
    // 构建任务数据
    const taskData = {
      maintenanceTaskId,
      requestId,
      level1: params.level1,
      level2: params.level2,
      level3: params.level3,
      otherDescription: params.otherDescription || params.description || '',
      // 特殊字段信息
      specialFields: {
        laptopModel: (params.specialFields && params.specialFields.laptopModel) || '',
        laptopSystem: (params.specialFields && params.specialFields.laptopSystem) || '',
        softwareInfo: (params.specialFields && params.specialFields.softwareInfo) || '',
        systemVersion: (params.specialFields && params.specialFields.systemVersion) || '',
        deviceModel: (params.specialFields && params.specialFields.deviceModel) || ''
      },
      cost: 0, // 初始费用为0
      ew: 0, // 初始等效工作量为0
      appointmentTime: params.appointmentTime,
      completeTime: '', // 初始完成时间为空
      comments: params.comments || '',
      taskStatus: 'pending', // 初始状态为待受理
      cancelReason: '', // 初始取消原因为空
      createTime: now,
      updateTime: now,
      // 新增：标记是否为管理通道创建
      isManagementCreated: params.isManagementCreated || false,

      // 申请人信息 - 使用处理后的信息
      applicantId: finalApplicantId,
      applicantName: finalApplicantName,
      applicantStudentId: finalApplicantStudentId || '', // 添加申请人学号字段
      applicantQqId: finalApplicantQqId,
      applicantTime: formattedNow,
      // 受理人信息（初始为空）
      assigneeId: '',
      assigneeName: '',
      assigneeStudentId: '', // 添加受理人学号字段
      assigneeQqId: '', // 添加受理人QQ号字段
      assigneeTime: null,
      // 协助受理人信息（初始为空数组）
      additionalAssignees: []
    }
    
    console.log('准备插入数据库的任务数据:', taskData);
    
    // 添加维修任务
    const addResult = await db.collection('maintenance_tasks').add({
      data: taskData
    })
    
    console.log('数据库插入结果:', addResult);
    
    // 添加到申请人的待办事项
    await db.collection('maintenance_toDo_list').add({
      data: {
        requestId,
        toDoListUserId: finalApplicantId, // 使用处理后的申请人ID
        taskId: maintenanceTaskId,
        taskStatus: 'pending',
        title: `维修任务：${params.level1} > ${params.level2} > ${params.level3}`,
        otherDescription: params.otherDescription || params.description || '',
        // 特殊字段信息
        specialFields: {
          laptopModel: (params.specialFields && params.specialFields.laptopModel) || '',
          laptopSystem: (params.specialFields && params.specialFields.laptopSystem) || '',
          softwareInfo: (params.specialFields && params.specialFields.softwareInfo) || '',
          systemVersion: (params.specialFields && params.specialFields.systemVersion) || '',
          deviceModel: (params.specialFields && params.specialFields.deviceModel) || ''
        },
        appointmentTime: params.appointmentTime,
        completeTime: '',
        applicantId: finalApplicantId,
        applicantName: finalApplicantName,
        applicantStudentId: finalApplicantStudentId || '', // 添加申请人学号字段
        applicantQqId: finalApplicantQqId,
        applicantTime: formattedNow,
        assigneeId: '',
        assigneeName: '',
        assigneeStudentId: '', // 添加受理人学号字段
        assigneeQqId: '',
        assigneeTime: null,
        isManagementCreated: params.isManagementCreated || false,
        createTime: now,
        updateTime: now
      }
    })
    
    // 发送消息 - 修改为直接调用云函数
    try {
      await cloud.callFunction({
        name: 'messages',
        data: {
          action: 'createMessage',
          params: {
            messageUserId: finalApplicantId, // 使用处理后的申请人ID
            title: '维修申请已提交',
            content: `您的维修申请已提交成功，任务编号: ${maintenanceTaskId}`,
            messagetype: 'maintenance'
          }
        }
      });
    } catch (messageErr) {
      console.error('发送消息失败', messageErr);
      // 消息发送失败不影响主流程
    }

    // 根据任务类型给对应部门的组员推送站内提醒
    await notifyDepartmentMembers({
      maintenanceTaskId,
      level1: params.level1,
      applicantName: finalApplicantName,
      appointmentTime: params.appointmentTime
    })
    
    return {
      code: 200,
      data: {
        maintenanceTaskId
      },
      message: '创建维修任务成功'
    }
    
  } catch (err) {
    console.error('创建维修任务时发生错误:', err);
    return {
      code: 500,
      data: null,
      message: err.message || '创建维修任务失败'
    }
  }
}
