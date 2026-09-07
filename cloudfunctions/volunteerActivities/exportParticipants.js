const cloud = require('wx-server-sdk');
const ExcelJS = require('exceljs');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 导出参与者信息为Excel文件
 * @param {Object} event - 请求参数
 * @param {string} event.activityId - 活动ID
 * @returns {Object} 包含Excel文件ID的对象
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  

  try {
    const { activityId } = event;
    const { OPENID } = wxContext;

    if (!activityId) {
      console.error('[exportParticipants] 错误: 缺少 activityId');
      return { code: 400, message: '缺少活动ID' };
    }

    // 验证用户权限
    const userRes = await db.collection('users').where({ openid: OPENID }).get();
    if (userRes.data.length === 0 || userRes.data[0].role !== 'leader') {
      console.error('[exportParticipants] 错误: 用户权限不足');
      return { code: 403, message: '权限不足' };
    }
    

    // 获取活动信息，包括反馈
    const activityRes = await db.collection('voluntary_activities').where({ activityId }).get();
    if (activityRes.data.length === 0) {
      console.error(`[exportParticipants] 错误: 未找到活动ID为 ${activityId} 的活动`);
      return { code: 404, message: '活动不存在' };
    }
    const activity = activityRes.data[0];
    const participantsIDList = activity.participantsIDList || [];
    

    if (participantsIDList.length === 0) {
      return { code: 200, message: '没有参与者可导出' };
    }

    // 获取所有参与者的信息
    const participantsRes = await db.collection('users').where({
      openid: _.in(participantsIDList)
    }).field({
      openid: true,
      nickName: true,
      studentId: true
    }).get();
    const participantsData = participantsRes.data;
    

    // 创建一个 openid -> feedback 的映射
    const feedbackMap = new Map();
    if (activity.feedbacks && activity.feedbacks.length > 0) {
      activity.feedbacks.forEach(fb => {
        feedbackMap.set(fb.openid, fb.feedback);
      });
    }
    

    // 创建Excel工作簿
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('参与者列表');

    // 设置表头
    worksheet.columns = [
      { header: '序号', key: 'index', width: 10 },
      { header: '学号', key: 'studentId', width: 20 },
      { header: '昵称', key: 'nickName', width: 20 },
      { header: '分工信息', key: 'feedback', width: 40 },
      { header: '志愿时长(小时)', key: 'volunteerHours', width: 18 }
    ];
    

    // 添加数据行
    const volunteerHoursValue = (activity.volunteerHours || activity.duration || 0);
    participantsData.forEach((p, i) => {
      worksheet.addRow({
        index: i + 1,
        studentId: p.studentId || '未填',
        nickName: p.nickName || '未填写',
        feedback: feedbackMap.get(p.openid) || '未填写',
        volunteerHours: volunteerHoursValue
      });
    });
    

    // 生成Excel文件Buffer
    const buffer = await workbook.xlsx.writeBuffer();
    

    // 上传到云存储
    const fileName = `participants-${activityId}-${Number(Date.now())}.xlsx`;
    const uploadRes = await cloud.uploadFile({
      cloudPath: `exported_participants/${fileName}`,
      fileContent: buffer,
    });
    

    if (!uploadRes.fileID) {
      throw new Error('文件上传失败，未获取到FileID');
    }

    // 返回文件ID
    return {
      code: 200,
      message: '导出成功',
      data: {
        fileID: uploadRes.fileID
      }
    };

  } catch (error) {
    console.error('[exportParticipants] 函数执行异常:', error);
    return { code: 500, message: '服务器内部错误', error: error.message };
  }
}; 