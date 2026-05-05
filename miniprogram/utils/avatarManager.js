/**
 * 头像管理工具
 * 专门处理用户头像的上传、缓存和展示
 * 作者：卢齐军
 * 创建时间：2026年
 */

class AvatarManager {
  constructor() {
    // 头像管理配置
    this.avatarConfig = {
      basePath: 'avatars/',
      defaultExtension: 'jpg',
      compression: {
        quality: 70,
        width: 300,
        height: 300
      },
      cache: {
        ttl: 60 * 60 * 1000 // 1小时缓存
      },
      retry: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 5000
      },
      fallbackImage: '/images/default/default-avatar.png'
    };

    // 头像URL缓存
    this.avatarUrlCache = new Map();
    this.pendingAvatarFetches = new Map();
  }

  /**
   * 检查网络状态
   * @returns {Promise<boolean>} 网络是否可用
   */
  checkNetworkStatus() {
    return new Promise((resolve) => {
      wx.getNetworkType({
        success: (res) => {
          const isConnected = res.networkType !== 'none';
          resolve(isConnected);
        },
        fail: () => {
          resolve(true);
        }
      });
    });
  }

  /**
   * 等待指定时间
   * @param {number} ms - 等待毫秒数
   * @returns {Promise} Promise对象
   */
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 判断是否为网络错误
   * @param {Error} error - 错误对象
   * @returns {boolean} 是否为网络错误
   */
  isNetworkError(error) {
    const errorMessage = error.message || error.errMsg || String(error);
    const networkErrorKeywords = [
      'ERR_NETWORK_CHANGED',
      'ERR_INTERNET_DISCONNECTED',
      'ERR_NAME_NOT_RESOLVED',
      'ERR_CONNECTION_TIMED_OUT',
      'fail upload fail',
      'network error',
      'timeout'
    ];

    return networkErrorKeywords.some(keyword =>
      errorMessage.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 压缩图片
   * @param {string} tempFilePath - 临时文件路径
   * @param {number} quality - 压缩质量
   * @param {number} width - 压缩宽度
   * @param {number} height - 压缩高度
   * @returns {Promise<string>} 压缩后的文件路径
   */
  compressImage(tempFilePath, quality, width, height) {
    const config = this.avatarConfig.compression;
    const safeQuality = quality || config.quality;
    const safeWidth = width || config.width;
    const safeHeight = height || config.height;

    return new Promise((resolve, reject) => {
      wx.compressImage({
        src: tempFilePath,
        quality: safeQuality,
        width: safeWidth,
        height: safeHeight,
        success: (res) => {
          resolve(res.tempFilePath);
        },
        fail: (error) => {
          console.error('图片压缩失败', error);
          resolve(tempFilePath);
        }
      });
    });
  }

  /**
   * 获取缓存的头像URL
   * @param {string} fileID - 云存储文件ID
   * @returns {string|null} 缓存的URL或null
   */
  getCachedAvatarUrl(fileID) {
    if (!fileID) return null;
    const cached = this.avatarUrlCache.get(fileID);
    if (!cached) return null;
    if (Date.now() < cached.expireAt && typeof cached.url === 'string' && cached.url.startsWith('http')) {
      return cached.url;
    }
    this.avatarUrlCache.delete(fileID);
    return null;
  }

  /**
   * 设置头像URL缓存
   * @param {string} fileID - 云存储文件ID
   * @param {string} url - 临时URL
   * @param {number} ttlMs - 缓存时间（毫秒）
   */
  setCachedAvatarUrl(fileID, url, ttlMs) {
    const safeTtl = ttlMs || this.avatarConfig.cache.ttl;
    if (!fileID || !url) return;
    this.avatarUrlCache.set(fileID, { url, expireAt: Date.now() + safeTtl });
  }

  /**
   * 带重试的云存储上传
   * @param {string} cloudPath - 云存储路径
   * @param {string} filePath - 本地文件路径
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<Object>} 上传结果
   */
  async uploadFileWithRetry(cloudPath, filePath, maxRetries) {
    const config = this.avatarConfig.retry;
    const safeMaxRetries = maxRetries || config.maxAttempts;
    let lastError = null;

    for (let attempt = 1; attempt <= safeMaxRetries; attempt++) {
      try {
        const isNetworkAvailable = await this.checkNetworkStatus();
        if (!isNetworkAvailable) {
          throw new Error('网络不可用，请检查网络连接');
        }

        const uploadResult = await wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: filePath
        });

        return uploadResult;

      } catch (error) {
        console.error(`第${attempt}次上传失败:`, error);
        lastError = error;

        if (!this.isNetworkError(error) || attempt === safeMaxRetries) {
          break;
        }

        const waitTime = Math.min(config.baseDelay * Math.pow(2, attempt - 1), config.maxDelay);

        wx.showLoading({
          title: `网络不稳定，正在重试(${attempt}/${safeMaxRetries})...`,
          mask: true
        });

        await this.wait(waitTime);
      }
    }

    throw lastError;
  }

  /**
   * 获取临时文件URL（带重试和缓存）
   * @param {string} fileID - 云存储文件ID
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<string>} 临时URL
   */
  async getTempFileURLWithRetry(fileID, maxRetries) {
    const cached = this.getCachedAvatarUrl(fileID);
    if (cached) return cached;

    if (this.pendingAvatarFetches.has(fileID)) {
      return this.pendingAvatarFetches.get(fileID);
    }

    const config = this.avatarConfig.retry;
    const safeMaxRetries = maxRetries || config.maxAttempts;
    let lastError = null;

    const fetchPromise = (async () => {
      for (let attempt = 1; attempt <= safeMaxRetries; attempt++) {
        try {
          const urlResult = await wx.cloud.getTempFileURL({
            fileList: [fileID]
          });

          if (!urlResult.fileList || urlResult.fileList.length === 0) {
            throw new Error('获取头像URL失败');
          }

          const url = urlResult.fileList[0].tempFileURL;
          this.setCachedAvatarUrl(fileID, url);
          return url;

        } catch (error) {
          console.error(`第${attempt}次获取URL失败:`, error);
          lastError = error;

          if (!this.isNetworkError(error) || attempt === safeMaxRetries) {
            break;
          }

          const waitTime = Math.min(500 * attempt, 2000);
          await this.wait(waitTime);
        }
      }
      throw lastError;
    })();

    this.pendingAvatarFetches.set(fileID, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.pendingAvatarFetches.delete(fileID);
    }
  }

  /**
   * 上传头像到云存储
   * @param {string} tempFilePath - 临时文件路径
   * @param {string} openid - 用户openid
   * @returns {Promise<Object>} 上传结果
   */
  async uploadAvatarToCloud(tempFilePath, openid) {
    try {
      const compressedPath = await this.compressImage(tempFilePath);

      const timestamp = Date.now();
      const cloudPath = `${this.avatarConfig.basePath}${openid}_${timestamp}.${this.avatarConfig.defaultExtension}`;

      const uploadResult = await this.uploadFileWithRetry(cloudPath, compressedPath);

      if (!uploadResult.fileID) {
        throw new Error('上传失败：未获取到fileID');
      }

      const avatarUrl = await this.getTempFileURLWithRetry(uploadResult.fileID);

      return {
        success: true,
        cloudPath,
        fileID: uploadResult.fileID,
        avatarUrl: avatarUrl,
        message: '头像上传成功'
      };

    } catch (error) {
      console.error('上传头像失败', error);

      let errorMessage = '头像上传失败，请重试';
      if (this.isNetworkError(error)) {
        errorMessage = '网络连接不稳定，请检查网络后重试';
      } else if (error.message && error.message.includes('fileID')) {
        errorMessage = '上传服务异常，请稍后重试';
      }

      return {
        success: false,
        error: error.message || '上传头像失败',
        message: errorMessage
      };
    }
  }

  /**
   * 删除云存储头像
   * @param {string} fileID - 云存储文件ID
   * @returns {Promise<boolean>} 删除是否成功
   */
  async deleteCloudAvatar(fileID) {
    try {
      if (!fileID) {
        return true;
      }

      await wx.cloud.deleteFile({
        fileList: [fileID]
      });

      // 清除缓存
      this.avatarUrlCache.delete(fileID);

      return true;

    } catch (error) {
      console.error('删除旧头像失败', error);
      return false;
    }
  }

  /**
   * 从本地存储获取头像URL（检查有效期）
   * @param {string} fileID - 云存储文件ID
   * @returns {string|null} 头像URL或null
   */
  getLocalStorageAvatarUrl(fileID) {
    try {
      const cacheKey = `avatar_cache_${fileID}`;
      const cached = wx.getStorageSync(cacheKey);

      if (!cached || !cached.url || !cached.expireAt) {
        return null;
      }

      // 检查是否过期（7天有效期）
      if (Date.now() < cached.expireAt) {
        return cached.url;
      }

      // 已过期，清除缓存
      wx.removeStorageSync(cacheKey);
      return null;
    } catch (error) {
      console.error('读取本地头像缓存失败', error);
      return null;
    }
  }

  /**
   * 获取过期的本地存储头像URL（作为降级方案）
   * @param {string} fileID - 云存储文件ID
   * @returns {string|null} 头像URL或null
   */
  getExpiredLocalStorageAvatarUrl(fileID) {
    try {
      const cacheKey = `avatar_cache_${fileID}`;
      const cached = wx.getStorageSync(cacheKey);

      if (cached && cached.url) {
        return cached.url;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 保存头像URL到本地存储
   * @param {string} fileID - 云存储文件ID
   * @param {string} url - 头像URL
   */
  saveAvatarUrlToLocalStorage(fileID, url) {
    try {
      const cacheKey = `avatar_cache_${fileID}`;
      // 设置7天有效期
      const ttl = 7 * 24 * 60 * 60 * 1000;

      wx.setStorageSync(cacheKey, {
        url: url,
        expireAt: Date.now() + ttl,
        savedAt: Date.now()
      });
    } catch (error) {
      console.error('保存头像缓存到本地存储失败', error);
    }
  }

  /**
   * 清除本地头像缓存（修改头像时调用）
   * @param {string} fileID - 云存储文件ID
   */
  clearLocalAvatarCache(fileID) {
    try {
      if (fileID) {
        const cacheKey = `avatar_cache_${fileID}`;
        wx.removeStorageSync(cacheKey);
        this.avatarUrlCache.delete(fileID);
      }
    } catch (error) {
      console.error('清除本地头像缓存失败', error);
    }
  }

  /**
   * 获取头像显示URL
   * @param {Object} userInfo - 用户信息
   * @param {string} openid - 用户openid
   * @param {boolean} forceRefresh - 是否强制刷新（修改头像时使用）
   * @returns {Promise<string>} 头像显示URL
   */
  async getAvatarDisplayUrl(userInfo, openid, forceRefresh = false) {
    try {
      const app = getApp();

      // 如果是本地路径（选择器选择的临时路径），直接返回
      if (openid === app.globalData.openid && userInfo.avatarUrl && !userInfo.avatarUrl.startsWith('http')) {
        return userInfo.avatarUrl;
      }

      // 如果有云存储文件ID
      if (userInfo.cloudAvatarFileID) {
        // 1. 检查本地持久化缓存（除非强制刷新）
        if (!forceRefresh) {
          const localCachedUrl = this.getLocalStorageAvatarUrl(userInfo.cloudAvatarFileID);
          if (localCachedUrl) {
            // 本地缓存有效，同时更新内存缓存
            this.setCachedAvatarUrl(userInfo.cloudAvatarFileID, localCachedUrl);
            return localCachedUrl;
          }
        }

        // 2. 检查内存缓存（除非强制刷新）
        if (!forceRefresh) {
          const cachedUrl = this.getCachedAvatarUrl(userInfo.cloudAvatarFileID);
          if (cachedUrl) {
            return cachedUrl;
          }
        }

        // 3. 从云存储获取临时URL
        try {
          const avatarUrl = await this.getTempFileURLWithRetry(userInfo.cloudAvatarFileID, 2);
          // 保存到本地存储和内存缓存
          this.saveAvatarUrlToLocalStorage(userInfo.cloudAvatarFileID, avatarUrl);
          this.setCachedAvatarUrl(userInfo.cloudAvatarFileID, avatarUrl);
          return avatarUrl;
        } catch (error) {
          console.error('获取云存储头像URL失败', error);
          // 如果获取失败，尝试使用过期的本地缓存
          const expiredCache = this.getExpiredLocalStorageAvatarUrl(userInfo.cloudAvatarFileID);
          if (expiredCache) {
            console.log('使用过期的本地缓存头像');
            return expiredCache;
          }
        }
      }

      // 如果有http URL，直接返回
      if (userInfo.avatarUrl && userInfo.avatarUrl.startsWith('http')) {
        return userInfo.avatarUrl;
      }

      // 如果有cloudAvatarUrl，使用它
      if (userInfo.cloudAvatarUrl && userInfo.cloudAvatarFileID) {
        this.setCachedAvatarUrl(userInfo.cloudAvatarFileID, userInfo.cloudAvatarUrl);
        this.saveAvatarUrlToLocalStorage(userInfo.cloudAvatarFileID, userInfo.cloudAvatarUrl);
        return userInfo.cloudAvatarUrl;
      }

      return this.avatarConfig.fallbackImage;

    } catch (error) {
      console.error('获取头像显示URL失败', error);
      return this.avatarConfig.fallbackImage;
    }
  }

  /**
   * 头像上传完整流程
   * @param {string} tempFilePath - 临时文件路径
   * @param {string} openid - 用户openid
   * @param {string} oldFileID - 旧文件ID（用于删除）
   * @returns {Promise<Object>} 上传结果
   */
  async handleAvatarUpload(tempFilePath, openid, oldFileID) {
    try {
      wx.showLoading({
        title: '正在上传头像...',
        mask: true
      });

      const isNetworkAvailable = await this.checkNetworkStatus();
      if (!isNetworkAvailable) {
        wx.hideLoading();
        wx.showModal({
          title: '网络连接异常',
          content: '当前网络不可用，请检查网络连接后重试',
          showCancel: false,
          confirmText: '知道了'
        });
        return {
          success: false,
          error: '网络不可用'
        };
      }

      const uploadResult = await this.uploadAvatarToCloud(tempFilePath, openid);

      if (!uploadResult.success) {
        wx.hideLoading();

        if (this.isNetworkError({ message: uploadResult.error })) {
          const res = await new Promise(resolve => {
            wx.showModal({
              title: '上传失败',
              content: '网络连接不稳定导致上传失败，是否重试？',
              confirmText: '重试',
              cancelText: '稍后再试',
              success: resolve
            });
          });

          if (res.confirm) {
            return await this.handleAvatarUpload(tempFilePath, openid, oldFileID);
          }
        } else {
          wx.showToast({
            title: uploadResult.message,
            icon: 'none',
            duration: 3000
          });
        }

        return uploadResult;
      }

      // 清除旧头像的缓存
      if (oldFileID) {
        this.clearLocalAvatarCache(oldFileID);
        this.deleteCloudAvatar(oldFileID).catch(err => {
          console.error('删除旧头像失败，但不影响主流程', err);
        });
      }

      // 保存新头像到缓存
      if (uploadResult.fileID && uploadResult.avatarUrl) {
        this.setCachedAvatarUrl(uploadResult.fileID, uploadResult.avatarUrl);
        this.saveAvatarUrlToLocalStorage(uploadResult.fileID, uploadResult.avatarUrl);
      }

      wx.hideLoading();
      wx.showToast({
        title: '头像上传成功',
        icon: 'success'
      });

      return {
        success: true,
        localAvatarUrl: tempFilePath,
        cloudAvatarUrl: uploadResult.avatarUrl,
        cloudAvatarFileID: uploadResult.fileID,
        message: '头像上传成功'
      };

    } catch (error) {
      wx.hideLoading();
      console.error('处理头像上传失败', error);

      const errorMessage = this.isNetworkError(error)
        ? '网络连接异常，请检查网络后重试'
        : '头像上传失败，请重试';

      wx.showToast({
        title: errorMessage,
        icon: 'none',
        duration: 3000
      });

      return {
        success: false,
        error: error.message || '头像上传失败'
      };
    }
  }
}

// 导出单例
const avatarManager = new AvatarManager();
module.exports = avatarManager;
