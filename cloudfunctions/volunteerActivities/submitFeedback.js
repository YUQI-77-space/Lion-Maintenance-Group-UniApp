const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 提交志愿活动反馈
 * @param {object} event - 云函数入参
 * @param {string} event.activityId - 活动ID
 * @param {string} event.feedback - 反馈内容
 * @param {object} context - 调用上下文
 * @returns {object} - 返回包含code、message和data的对象
 */
const submitFeedback = async (event, context) => {
  const wxContext = cloud.getWXContext();
  console.log('[submitFeedback] 函数开始执行');
  console.log('[submitFeedback] 接收到参数 event:', event);
  
  try {
    const { activityId, feedback } = event;
    const { OPENID } = wxContext;
    console.log(`[submitFeedback] OPENID: ${OPENID}, ActivityID: ${activityId}`);

    if (!activityId || !feedback) {
      console.error('[submitFeedback] 错误：参数不完整');
      return { code: 400, message: '参数不完整' };
    }

    // 获取用户信息
    console.log('[submitFeedback] 正在从 "users" 集合获取用户信息');
    const userRes = await db.collection('users').where({
      openid: OPENID
    }).field({
      nickName: true
    }).get();

    if (userRes.data.length === 0) {
      console.error(`[submitFeedback] 错误：在 "users" 集合中未找到 OPENID 为 ${OPENID} 的用户`);
      return { code: 404, message: '用户不存在' };
    }
    const userInfo = userRes.data[0];
    console.log('[submitFeedback] 成功获取用户信息:', userInfo);

    // 构造反馈对象
    const feedbackData = {
      feedbackId: `${activityId}_${OPENID}`, // 唯一ID（同一活动+同一用户唯一）
      openid: OPENID,
      nickName: userInfo.nickName,
      feedback: feedback,
      submitTime: new Date()
    };
    console.log('[submitFeedback] 构造的反馈数据:', feedbackData);

    console.log(`[submitFeedback] 查询 "voluntary_activities" 集合中 activityId 为 ${activityId} 的文档`);
    const activityRes = await db.collection('voluntary_activities').where({
      activityId: activityId
    }).get();

    if (!activityRes.data || activityRes.data.length === 0) {
      console.error('[submitFeedback] 错误：未找到对应的志愿活动');
      return { code: 404, message: '活动不存在' };
    }

    const activityDoc = activityRes.data[0];
    const feedbacks = Array.isArray(activityDoc.feedbacks) ? activityDoc.feedbacks.slice() : [];

    // 如果该用户已有反馈，则覆盖旧反馈；否则新增一条
    const existingIndex = feedbacks.findIndex(item => item.openid === OPENID);
    if (existingIndex >= 0) {
      console.log('[submitFeedback] 检测到已有反馈记录，执行覆盖更新');
      feedbacks[existingIndex] = feedbackData;
    } else {
      console.log('[submitFeedback] 未检测到历史反馈记录，执行新增');
      feedbacks.push(feedbackData);
    }

    console.log('[submitFeedback] 正在更新反馈数组（覆盖或新增）');
    const updateRes = await db.collection('voluntary_activities')
      .doc(activityDoc._id)
      .update({
        data: {
          feedbacks
        }
      });

    console.log('[submitFeedback] 数据库更新操作返回结果:', updateRes);

    if (updateRes.stats.updated > 0) {
      console.log('[submitFeedback] 反馈提交成功');
      return { code: 200, message: '提交成功' };
    } else {
      console.error('[submitFeedback] 错误：数据库更新失败，没有文档被更新');
      return { code: 500, message: '提交失败，未更新任何记录' };
    }
  } catch (error) {
    console.error('[submitFeedback] 函数执行时捕获到异常:', error);
    return { code: 500, message: '服务器内部错误', error: error.message };
  }
};

module.exports = submitFeedback; 