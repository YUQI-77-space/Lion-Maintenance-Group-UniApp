// 微信订阅消息授权工具类

class SubscriptionAuth {
  
  // 消息模板ID配置
  static TEMPLATES = {
    TASK_CLAIMED: '5r55o8dpEttQ8H-u38ThmVuhFlr-n97x1ey67_QT4ok',
    TASK_COMPLETED: '5r55o8dpEttQ8H-u38ThmQf4Q2LzLOvS28nVHf3o-9w',
    TASK_CANCELLED: '9hekOFjhrV1wQI1RH6JdgSTZAs5oNtOcY1nqjT3TM3s',
    ACTIVITY_REMINDER: 'c3FUaYA_pBn0vSMO_m7pF4W3-6kgEW2lvhbRuHHN3Lo',
    DUTY_REMINDER: 'C9L9-CkGs0vn1Xen9CF2t9ktVe_ZWEqFZki5k5BDzx8'
  };

  // 授权场景枚举
  static SCENES = {
    REPAIR_SUBMIT: 'repair_submit',
    LEADER_CREATE: 'leader_create',
    TASK_CLAIM: 'task_claim',
    TASK_CANCEL: 'task_cancel',
    VOLUNTEER_REGISTER: 'volunteer_register',
    VOLUNTEER_INVITATION_FEEDBACK: 'volunteer_invitation_feedback',
    DUTY_SELECTION: 'duty_selection'
  };

  // 批量请求订阅消息授权
  static async requestSubscribeMessage(templateIds, scene, options = {}) {
    const { showTip = true, allowPartialSuccess = true } = options;

    if (showTip) {
      const tipMessage = this.getAuthTipMessage(scene);
      return new Promise((resolve) => {
        wx.showModal({
          title: '消息通知授权',
          content: tipMessage || '为确保您能及时接收相关通知，请授权订阅消息。',
          confirmText: '授权',
          cancelText: '跳过',
          success: async (modalRes) => {
            if (!modalRes.confirm) {
              resolve(this._rejectAuth(templateIds, scene));
              return;
            }
            const result = await this._doSubscribeRequest(templateIds, scene, allowPartialSuccess);
            resolve(result);
          }
        });
      });
    }

    return this._doSubscribeRequest(templateIds, scene, allowPartialSuccess);
  }

  // 执行订阅请求
  static async _doSubscribeRequest(templateIds, scene, allowPartialSuccess) {
    try {
      const res = await wx.requestSubscribeMessage({ tmplIds: templateIds });
      this.saveAuthResult(templateIds, res, scene);
      const authAnalysis = this.analyzeAuthResult(templateIds, res);
      if (!allowPartialSuccess && authAnalysis.rejectedCount > 0) {
        wx.showToast({
          title: '部分消息授权被拒绝，可能无法及时收到通知',
          icon: 'none',
          duration: 3000
        });
      }
      return { success: true, authResult: res, analysis: authAnalysis };
    } catch (error) {
      if (error.errMsg && error.errMsg.includes('requestSubscribeMessage:fail cancel')) {
        wx.showToast({ title: '您取消了消息授权，将无法收到相关通知', icon: 'none', duration: 2500 });
      }
      return { success: false, error, authResult: null };
    }
  }

  // 生成拒绝授权结果
  static _rejectAuth(templateIds, scene) {
    const simulated = {};
    templateIds.forEach(t => { simulated[t] = 'reject'; });
    this.saveAuthResult(templateIds, simulated, scene);
    const analysis = this.analyzeAuthResult(templateIds, simulated);
    return { success: false, authResult: simulated, analysis };
  }

  // 获取场景对应的授权说明
  static getAuthTipMessage(scene) {
    const messages = {
      [this.SCENES.REPAIR_SUBMIT]: '为了及时通知您任务处理进度，请允许接收维修相关消息推送',
      [this.SCENES.LEADER_CREATE]: '为了及时通知相关人员任务状态变化，请允许接收维修相关消息推送',
      [this.SCENES.TASK_CLAIM]: '为了及时通知您任务完成与取消等进展，请允许接收维修相关消息推送',
      [this.SCENES.TASK_CANCEL]: '为了及时通知相关人员任务取消情况，请允许接收任务取消消息推送',
      [this.SCENES.VOLUNTEER_REGISTER]: '为了在活动开始前及时提醒您，请允许接收志愿活动提醒消息',
      [this.SCENES.VOLUNTEER_INVITATION_FEEDBACK]: '您已被邀请参加志愿活动，为了在活动开始前及时提醒您，请允许接收志愿活动提醒消息',
      [this.SCENES.DUTY_SELECTION]: '为了在值班开始前及时提醒您，请允许接收值班安排提醒消息'
    };
    
    return messages[scene] || '';
  }

  // 显示授权说明弹窗
  static async showAuthTip(message) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '消息通知授权',
        content: message,
        confirmText: '授权',
        cancelText: '跳过',
        success: (res) => {
          resolve(res.confirm);
        }
      });
    });
  }

  // 分析授权结果统计
  static analyzeAuthResult(templateIds, authResult) {
    let acceptedCount = 0;
    let rejectedCount = 0;
    const details = [];
    
    templateIds.forEach(templateId => {
      const status = authResult[templateId] || 'reject';
      if (status === 'accept') {
        acceptedCount++;
      } else {
        rejectedCount++;
      }
      
      details.push({
        templateId,
        status,
        templateName: this.getTemplateName(templateId)
      });
    });
    
    return {
      total: templateIds.length,
      acceptedCount,
      rejectedCount,
      successRate: (acceptedCount / templateIds.length * 100).toFixed(1),
      details
    };
  }

  // 模板名称映射
  static getTemplateName(templateId) {
    const names = {
      [this.TEMPLATES.TASK_CLAIMED]: '任务认领通知',
      [this.TEMPLATES.TASK_COMPLETED]: '任务完成通知',
      [this.TEMPLATES.TASK_CANCELLED]: '任务取消通知',
      [this.TEMPLATES.ACTIVITY_REMINDER]: '志愿活动提醒',
      [this.TEMPLATES.DUTY_REMINDER]: '值班提醒'
    };
    
    return names[templateId] || '未知模板';
  }

  // 保存授权结果到本地存储
  static saveAuthResult(templateIds, result, scene) {
    try {
      const authData = wx.getStorageSync('subscription_auth') || {};
      const timestamp = Date.now();
      
      templateIds.forEach(templateId => {
        authData[templateId] = {
          status: result[templateId] || 'reject',
          scene: scene,
          timestamp: timestamp,
          templateName: this.getTemplateName(templateId)
        };
      });
      
      wx.setStorageSync('subscription_auth', authData);
      this.saveAuthHistory(templateIds, result, scene, timestamp);
      
    } catch (error) {
    }
  }

  // 保存授权历史记录
  static saveAuthHistory(templateIds, result, scene, timestamp) {
    try {
      const history = wx.getStorageSync('subscription_auth_history') || [];
      
      const record = {
        timestamp,
        scene,
        templateIds,
        result,
        summary: this.analyzeAuthResult(templateIds, result)
      };
      
      history.unshift(record);
      if (history.length > 50) {
        history.splice(50);
      }
      
      wx.setStorageSync('subscription_auth_history', history);
    } catch (error) {
    }
  }

  // 获取模板授权状态
  static getAuthStatus(templateId) {
    try {
      const authData = wx.getStorageSync('subscription_auth') || {};
      const templateAuth = authData[templateId];
      
      if (!templateAuth) {
        return {
          hasAuth: false,
          status: 'unknown',
          isExpired: true
        };
      }
      
      const now = Date.now();
      const authTime = templateAuth.timestamp;
      const isExpired = (now - authTime) > (7 * 24 * 60 * 60 * 1000);
      
      return {
        hasAuth: templateAuth.status === 'accept',
        status: templateAuth.status,
        isExpired: isExpired,
        scene: templateAuth.scene,
        timestamp: authTime
      };
    } catch (error) {
      return {
        hasAuth: false,
        status: 'error',
        isExpired: true
      };
    }
  }

  // 清理过期的授权记录
  static cleanExpiredAuth() {
    try {
      const authData = wx.getStorageSync('subscription_auth') || {};
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      
      let hasChanges = false;
      
      Object.keys(authData).forEach(templateId => {
        const auth = authData[templateId];
        if (auth && (now - auth.timestamp) > sevenDays) {
          delete authData[templateId];
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        wx.setStorageSync('subscription_auth', authData);
      }
    } catch (error) {
    }
  }

  // 预设授权方案
  static async requestApplicantAuth(scene = this.SCENES.REPAIR_SUBMIT, options = {}) {
    const templateIds = [
      this.TEMPLATES.TASK_CLAIMED,
      this.TEMPLATES.TASK_CANCELLED
    ];
    
    return this.requestSubscribeMessage(templateIds, scene, options);
  }

  static async requestAssigneeAuth(options = {}) {
    const templateIds = [
      this.TEMPLATES.TASK_COMPLETED,
      this.TEMPLATES.TASK_CANCELLED
    ];
    
    return this.requestSubscribeMessage(templateIds, this.SCENES.TASK_CLAIM, options);
  }

  static async requestVolunteerAuth(options = {}) {
    const templateIds = [
      this.TEMPLATES.ACTIVITY_REMINDER
    ];
    
    return this.requestSubscribeMessage(templateIds, this.SCENES.VOLUNTEER_REGISTER, options);
  }

  // 获取授权统计信息
  static getAuthStatistics() {
    try {
      const history = wx.getStorageSync('subscription_auth_history') || [];
      const authData = wx.getStorageSync('subscription_auth') || {};
      
      let totalRequests = 0;
      let totalAccepted = 0;
      const sceneStats = {};
      
      history.forEach(record => {
        totalRequests += record.templateIds.length;
        totalAccepted += record.summary.acceptedCount;
        
        if (!sceneStats[record.scene]) {
          sceneStats[record.scene] = {
            requests: 0,
            accepted: 0,
            rejected: 0
          };
        }
        
        sceneStats[record.scene].requests += record.templateIds.length;
        sceneStats[record.scene].accepted += record.summary.acceptedCount;
        sceneStats[record.scene].rejected += record.summary.rejectedCount;
      });
      
      return {
        totalRequests,
        totalAccepted,
        totalRejected: totalRequests - totalAccepted,
        acceptanceRate: totalRequests > 0 ? (totalAccepted / totalRequests * 100).toFixed(1) : 0,
        currentActiveAuth: Object.keys(authData).length,
        sceneStats,
        lastRequestTime: history.length > 0 ? history[0].timestamp : null
      };
    } catch (error) {
      return {
        totalRequests: 0,
        totalAccepted: 0,
        totalRejected: 0,
        acceptanceRate: 0,
        currentActiveAuth: 0,
        sceneStats: {},
        lastRequestTime: null
      };
    }
  }
}

module.exports = SubscriptionAuth;
