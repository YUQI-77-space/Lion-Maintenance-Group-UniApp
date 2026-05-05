// 头像显示组件
const avatarManager = require('../../utils/avatarManager');

Component({
  properties: {
    userInfo: {
      type: Object,
      value: {},
      observer: 'onUserInfoChanged'
    },
    openid: {
      type: String,
      value: '',
      observer: 'onUserInfoChanged'
    },
    size: {
      type: String,
      value: 'medium'
    },
    customClass: {
      type: String,
      value: ''
    },
    showBorder: {
      type: Boolean,
      value: true
    },
    clickable: {
      type: Boolean,
      value: false
    }
  },

  data: {
    displayAvatarUrl: '/images/default/default-avatar.png',
    loading: false,
    _cache: {
      cloudFileId: '',
      httpUrl: ''
    }
  },

  lifetimes: {
    attached() {
      this.updateAvatarDisplay();
    }
  },

  methods: {
    onUserInfoChanged() {
      const userInfo = this.properties.userInfo || {};
      const nextCloudId = userInfo && userInfo.cloudAvatarFileID ? String(userInfo.cloudAvatarFileID) : '';
      const nextHttpUrl = userInfo && userInfo.avatarUrl && userInfo.avatarUrl.startsWith('http') ? String(userInfo.avatarUrl) : '';
      const cache = this.data._cache;

      if (nextCloudId && nextCloudId === cache.cloudFileId) {
        return;
      }
      if (!nextCloudId && nextHttpUrl && nextHttpUrl === cache.httpUrl) {
        return;
      }

      this.updateAvatarDisplay();
    },

    async updateAvatarDisplay() {
      const userInfo = this.properties.userInfo || {};
      const openid = this.properties.openid || '';
      
      if (!userInfo || Object.keys(userInfo).length === 0) {
        this.setData({
          displayAvatarUrl: '/images/default/default-avatar.png'
        });
        return;
      }

      try {
        this.setData({ loading: true });
        
        // 检查是否需要强制刷新（修改头像后）
        const app = getApp();
        const forceRefresh = app && app.globalData && app.globalData.needRefreshAvatar || false;
        
        const displayUrl = await avatarManager.getAvatarDisplayUrl(userInfo, openid, forceRefresh);
        
        this.setData({
          displayAvatarUrl: displayUrl,
          loading: false,
          '_cache.cloudFileId': userInfo.cloudAvatarFileID || '',
          '_cache.httpUrl': userInfo.avatarUrl && userInfo.avatarUrl.startsWith('http') ? userInfo.avatarUrl : ''
        });
        
      } catch (error) {
        console.error('更新头像显示失败', error);
        this.setData({
          displayAvatarUrl: '/images/default/default-avatar.png',
          loading: false
        });
      }
    },

    onAvatarClick() {
      if (this.properties.clickable) {
        this.triggerEvent('avatarclick', {
          userInfo: this.properties.userInfo,
          avatarUrl: this.data.displayAvatarUrl
        });
      }
    },

    onImageError() {
      this.setData({
        displayAvatarUrl: '/images/default/default-avatar.png'
      });
    }
  }
}); 