// 反馈模态窗组件
const SubscriptionAuth = require('../../utils/subscriptionAuth.js')
const api = require('../../utils/apiAdapter')

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: ''
    },
    details: {
      type: String,
      value: ''
    },
    messageId: {
      type: String,
      value: ''
    },
    messageType: {
      type: String,
      value: ''
    },
    activityId: {
      type: String,
      value: ''
    }
  },

  data: {
    isConfirming: false,
    formattedDetails: ''
  },

  observers: {
    'details': function(details) {
      this.setData({ formattedDetails: details || '' });
    }
  },

  methods: {
    preventTouchMove() {
      return false;
    },

    preventTap() {
      return false;
    },

    onModalContentTap() {},

    async onConfirm() {
      if (this.data.isConfirming) {
        return;
      }

      this.setData({
        isConfirming: true
      });

      try {
        if (this.properties.messageType === 'volunteer_invitation' && this.properties.activityId) {
          await this.handleVolunteerInvitationAuth();
        }

        await this.markMessageAsRead();
        this.triggerEvent('confirm', {
          messageId: this.properties.messageId,
          success: true
        });
        
      } catch (error) {
        console.error('处理待反馈消息确认失败:', error);
        wx.showToast({
          title: '操作失败，请重试',
          icon: 'none'
        });
        
        this.triggerEvent('confirm', {
          messageId: this.properties.messageId,
          success: false,
          error: error.message
        });
      } finally {
        this.setData({
          isConfirming: false
        });
      }
    },

    resetConfirmState() {
      this.setData({
        isConfirming: false
      });
    },

    async markMessageAsRead() {
      const res = await api.call('pendingFeedbackMessages', {
        action: 'markFeedbackMessageAsRead',
        params: { messageId: this.properties.messageId }
      })
      if (!res || !res.success) {
        throw new Error(res?.message || '标记消息为已读失败')
      }
      return res
    },

    async handleVolunteerInvitationAuth() {
      try {
        const authResult = await SubscriptionAuth.requestSubscribeMessage(
          [SubscriptionAuth.TEMPLATES.ACTIVITY_REMINDER], 
          SubscriptionAuth.SCENES.VOLUNTEER_INVITATION_FEEDBACK,
          {
            showTip: false,
            allowPartialSuccess: true
          }
        );
        
        if (authResult.success && authResult.authResult && 
            authResult.authResult[SubscriptionAuth.TEMPLATES.ACTIVITY_REMINDER] === 'accept') {
          
          const scheduleResult = await this.callSchedulerFunction();
          
          if (!scheduleResult.success) {
            console.warn('志愿活动提醒调度设置失败:', scheduleResult.message);
          }
        }
        
      } catch (error) {
        console.error('处理志愿活动邀请订阅授权失败:', error);
      }
    },

    async callSchedulerFunction() {
      try {
        const res = await api.call('volunteerActivities', {
          action: 'scheduleInvitedVolunteerReminder',
          params: {
            activityId: this.properties.activityId,
            miniprogramState: 'formal'
          }
        })
        return res || { success: false, message: '返回为空' }
      } catch (err) {
        console.error('调用提醒调度云函数失败:', err)
        return { success: false, message: err?.message || '调用失败' }
      }
    }
  }
});
