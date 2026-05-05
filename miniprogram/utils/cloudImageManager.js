/**
 * 云存储图片资源管理工具
 * 统一管理项目中的所有云存储图片资源（通用图片，不含头像）
 * 作者：维修组
 * 创建时间：2025年
 */

class CloudImageManager {
  constructor() {
    // 云存储基础路径配置
    this.cloudStorageBase = 'cloud://maintenance-group-2e9wxm620047ff.6d61-maintenance-group-2e9wxm620047ff/';
    
    // 各类图片资源路径配置
    this.imagePaths = {
      // 轮播图
      swiperImages: this.cloudStorageBase + 'swiper-images/',
      // 特色活动
      specialEvents: this.cloudStorageBase + 'special_events/',
      // 团队风采
      teamSpirit: this.cloudStorageBase + 'team_spirit/',
      // 团队荣誉 (已统一到主存储桶)
      teamHonors: this.cloudStorageBase + 'team_honors/',
      // 通用插画资源
      illustrations: this.cloudStorageBase + 'illustrations/'
    };

    // 首页图片资源配置
    this.homeImageConfig = {
      swiper: {
        basePath: this.imagePaths.swiperImages,
        total: 5,
        defaultExtension: 'jpg'
      },
      specialEvents: {
        basePath: this.imagePaths.specialEvents,
        total: 4,
        defaultExtension: 'jpg'
      },
      teamSpirit: {
        basePath: this.imagePaths.teamSpirit,
        total: 4,
        defaultExtension: 'jpg'
      },
      teamHonors: {
        basePath: this.imagePaths.teamHonors,
        total: 39,
        defaultExtension: 'jpg',
        specialExtensions: { 37: 'png' },
        initialLoadCount: 10,
        batchSize: 7
      }
    };

    // 详情页面图片资源配置
    this.detailPageImageConfig = {
      specialEvents: {
        basePath: this.imagePaths.specialEvents,
        total: 14,
        defaultExtension: 'jpg',
        pageSize: 12
      },
      teamSpirit: {
        basePath: this.imagePaths.teamSpirit,
        total: 34,
        defaultExtension: 'jpg',
        pageSize: 12
      }
    };

    // 通用临时URL缓存
    this.tempUrlCache = new Map();
    this.tempUrlCacheTTL = 30 * 60 * 1000; // 30分钟
  }

  /**
   * 获取插画资源URL
   * @param {string} fileName - 文件名 (包含扩展名)
   * @param {string} category - 分类 ('illustrations')
   * @returns {string} 完整的云存储URL
   */
  getIllustrationUrl(fileName, category = 'illustrations') {
    if (!this.imagePaths[category]) {
      console.warn(`未知的插画分类: ${category}`);
      return '';
    }
    return this.imagePaths[category] + fileName;
  }

  /**
   * 批量获取插画资源URL
   * @param {Array<string>} fileNames - 文件名数组
   * @param {string} category - 分类
   * @returns {Array<Object>} 包含id和url的对象数组
   */
  getIllustrationUrls(fileNames, category = 'illustrations') {
    return fileNames.map((fileName, index) => ({
      id: index + 1,
      fileName: fileName,
      url: this.getIllustrationUrl(fileName, category)
    }));
  }

  /**
   * 通用插画资源获取
   * @param {string} sceneName - 场景名称
   * @returns {string} 插画URL
   */
  getGeneralIllustration(sceneName) {
    const generalIllustrations = {
      // 加载中
      loading: this.getIllustrationUrl('loading.png', 'illustrations'),
      // 网络错误
      networkError: this.getIllustrationUrl('network-error.png', 'illustrations'),
      // 数据为空
      noData: this.getIllustrationUrl('no-data.png', 'illustrations'),
      // 权限不足
      noPermission: this.getIllustrationUrl('no-permission.png', 'illustrations'),
      // 操作成功
      success: this.getIllustrationUrl('success.png', 'illustrations')
    };

    return generalIllustrations[sceneName] || '';
  }

  /**
   * 云存储文件ID转临时URL
   * @param {Array<Object>} images - 包含url字段的图片对象数组
   * @returns {Promise<Array<Object>>} 转换后的图片数组
   */
  async convertCloudFileIdsToTempUrls(images) {
    if (!Array.isArray(images) || images.length === 0) {
      return images;
    }

    const fileList = images
      .map(img => img && img.url)
      .filter(url => !!url);

    const cloudFileIds = Array.from(new Set(
      fileList.filter(u => typeof u === 'string' && u.indexOf('cloud://') === 0)
    ));

    if (cloudFileIds.length === 0) {
      return images;
    }

    if (!wx.cloud || !wx.cloud.getTempFileURL) {
      return images;
    }

    const now = Date.now();
    const mapping = {};
    const invalidFileIds = [];

    cloudFileIds.forEach(fileID => {
      // 先查内存缓存
      const cached = this.tempUrlCache.get(fileID);
      if (cached && cached.expireAt > now && cached.url) {
        mapping[fileID] = cached.url;
        return;
      }
      // 再查本地持久化缓存
      const local = this.getLocalStorageTempUrl(fileID);
      if (local && local.url && local.expireAt && local.expireAt > now) {
        mapping[fileID] = local.url;
        // 回填内存缓存，保持一致
        this.tempUrlCache.set(fileID, { url: local.url, expireAt: local.expireAt });
        return;
      }
      // 待拉取
      invalidFileIds.push(fileID);
    });

    if (invalidFileIds.length > 0) {
      try {
        const res = await wx.cloud.getTempFileURL({
          fileList: invalidFileIds
        });

        (res && res.fileList || []).forEach(item => {
          if (item && item.fileID && item.tempFileURL) {
            const expireAt = now + this.tempUrlCacheTTL;
            mapping[item.fileID] = item.tempFileURL;
            this.tempUrlCache.set(item.fileID, { url: item.tempFileURL, expireAt });
            // 持久化到本地存储，便于下次冷启动复用
            this.saveTempUrlToLocalStorage(item.fileID, item.tempFileURL, expireAt);
          }
        });
      } catch (error) {
        console.error('获取云文件临时URL失败', error);
      }
    }

    return images.map(img => {
      if (!img || !img.url) {
        return img;
      }

      const cachedUrl = mapping[img.url];
      if (cachedUrl) {
        return { ...img, url: cachedUrl };
      }

      return img;
    });
  }

  /**
   * 预加载图片
   * @param {Array<Object>} images - 图片数组
   * @param {Function} onProgress - 进度回调 (current, total)
   * @param {Function} onComplete - 完成回调
   */
  preloadImages(images, onProgress, onComplete) {
    let loadedCount = 0;
    const totalCount = images.length;

    if (totalCount === 0) {
      onComplete && onComplete();
      return;
    }

    images.forEach((image, index) => {
      const url = image && image.url;
      if (!url) {
        loadedCount++;
        onProgress && onProgress(loadedCount, totalCount);
        if (loadedCount === totalCount) {
          onComplete && onComplete();
        }
        return;
      }

      wx.getImageInfo({
        src: url,
        success: () => {
          loadedCount++;
          onProgress && onProgress(loadedCount, totalCount);
          if (loadedCount === totalCount) {
            onComplete && onComplete();
          }
        },
        fail: (err) => {
          console.warn(`预加载图片失败: ${url}`, err);
          loadedCount++;
          onProgress && onProgress(loadedCount, totalCount);
          if (loadedCount === totalCount) {
            onComplete && onComplete();
          }
        }
      });
    });
  }

  /**
   * 获取默认占位图片
   * @param {string} type - 占位图类型 ('loading', 'error', 'empty')
   * @returns {string} 占位图片路径
   */
  getPlaceholderImage(type = 'loading') {
    const placeholders = {
      loading: '/images/placeholders/loading.png',
      error: '/images/placeholders/error.png',
      empty: '/images/placeholders/empty.png'
    };
    return placeholders[type] || placeholders.loading;
  }

  /**
   * 构建顺序图片列表
   * @param {string} basePath - 图片基础路径
   * @param {number} startIndex - 开始序号
   * @param {number} endIndex - 结束序号
   * @param {string} defaultExtension - 默认扩展名
   * @param {Object} specialExtensions - 特殊扩展名配置
   * @returns {Array<Object>} 图片对象数组
   * @private
   */
  _buildSequentialImageList(basePath, startIndex, endIndex, defaultExtension = 'jpg', specialExtensions = {}) {
    if (!basePath || typeof basePath !== 'string') {
      return [];
    }

    const safeStart = Math.max(parseInt(startIndex, 10) || 1, 1);
    const safeEnd = Math.max(parseInt(endIndex, 10) || 0, 0);

    if (safeEnd < safeStart) {
      return [];
    }

    const items = [];
    for (let i = safeStart; i <= safeEnd; i++) {
      const extension = (specialExtensions && specialExtensions[i]) || defaultExtension || 'jpg';
      items.push({
        id: i,
        url: `${basePath}${i}.${extension}`
      });
    }
    return items;
  }

  /**
   * 获取首页轮播图配置
   * @returns {Array<Object>} 轮播图图片列表
   */
  getHomeSwiperImages() {
    const config = this.homeImageConfig.swiper;
    return this._buildSequentialImageList(
      config.basePath,
      1,
      config.total,
      config.defaultExtension
    );
  }

  /**
   * 获取首页特色活动图片
   * @returns {Array<Object>} 特色活动图片列表
   */
  getHomeSpecialEvents() {
    const config = this.homeImageConfig.specialEvents;
    return this._buildSequentialImageList(
      config.basePath,
      1,
      config.total,
      config.defaultExtension
    );
  }

  /**
   * 获取首页团队风采图片
   * @returns {Array<Object>} 团队风采图片列表
   */
  getHomeTeamSpirit() {
    const config = this.homeImageConfig.teamSpirit;
    return this._buildSequentialImageList(
      config.basePath,
      1,
      config.total,
      config.defaultExtension
    );
  }

  /**
   * 获取首页团队荣誉配置
   * @returns {{total: number, batchSize: number, initialLoadCount: number}} 配置对象
   */
  getHomeTeamHonorsConfig() {
    const config = this.homeImageConfig.teamHonors;
    return {
      total: config.total,
      batchSize: config.batchSize,
      initialLoadCount: config.initialLoadCount
    };
  }

  /**
   * 获取首页团队荣誉指定范围的图片
   * @param {number} startIndex - 开始序号
   * @param {number} endIndex - 结束序号
   * @returns {Array<Object>} 图片列表
   */
  getHomeTeamHonorsRange(startIndex, endIndex) {
    const config = this.homeImageConfig.teamHonors;
    const clampedStart = Math.max(parseInt(startIndex, 10) || 1, 1);
    const clampedEnd = Math.min(parseInt(endIndex, 10) || config.total, config.total);

    if (clampedEnd < clampedStart) {
      return [];
    }

    return this._buildSequentialImageList(
      config.basePath,
      clampedStart,
      clampedEnd,
      config.defaultExtension,
      config.specialExtensions
    );
  }

  /**
   * 获取首页团队荣誉初始加载图片
   * @param {number} count - 加载数量
   * @returns {Array<Object>} 图片列表
   */
  getHomeTeamHonorsInitial(count) {
    const config = this.homeImageConfig.teamHonors;
    const safeCount = Math.min(parseInt(count, 10) || config.initialLoadCount, config.total);
    return this.getHomeTeamHonorsRange(1, safeCount);
  }

  /**
   * 获取首页团队荣誉分批加载图片
   * @param {number} startIndex - 起始序号
   * @param {number} batchSize - 批次大小
   * @returns {Array<Object>} 图片列表
   */
  getHomeTeamHonorsBatch(startIndex, batchSize) {
    const config = this.homeImageConfig.teamHonors;
    const safeBatchSize = Math.max(parseInt(batchSize, 10) || config.batchSize, 1);
    const start = Math.max(parseInt(startIndex, 10) || 1, 1);
    const end = start + safeBatchSize - 1;
    return this.getHomeTeamHonorsRange(start, end);
  }

  /**
   * 获取详情页面图片配置
   * @param {string} pageType - 页面类型 ('specialEvents' 或 'teamSpirit')
   * @returns {{total: number, pageSize: number}} 配置对象
   */
  getDetailPageImageConfig(pageType) {
    const config = this.detailPageImageConfig[pageType];
    if (!config) {
      console.warn(`未知的详情页面类型: ${pageType}`);
      return { total: 0, pageSize: 12 };
    }
    return {
      total: config.total,
      pageSize: config.pageSize
    };
  }

  /**
   * 获取详情页面全部图片列表
   * @param {string} pageType - 页面类型 ('specialEvents' 或 'teamSpirit')
   * @returns {Array<Object>} 图片列表
   */
  getDetailPageAllImages(pageType) {
    const config = this.detailPageImageConfig[pageType];
    if (!config) {
      console.warn(`未知的详情页面类型: ${pageType}`);
      return [];
    }
    return this._buildSequentialImageList(
      config.basePath,
      1,
      config.total,
      config.defaultExtension
    );
  }

  /**
   * 获取详情页面分页图片列表
   * @param {string} pageType - 页面类型 ('specialEvents' 或 'teamSpirit')
   * @param {number} currentPage - 当前页码（从1开始）
   * @param {number} pageSize - 页面大小（可选，默认使用配置的pageSize）
   * @returns {{images: Array<Object>, hasMore: boolean, totalPages: number}} 分页结果
   */
  getDetailPageImages(pageType, currentPage = 1, pageSize) {
    const config = this.detailPageImageConfig[pageType];
    if (!config) {
      console.warn(`未知的详情页面类型: ${pageType}`);
      return { images: [], hasMore: false, totalPages: 0 };
    }

    const safePageSize = Math.max(parseInt(pageSize, 10) || config.pageSize, 1);
    const safeCurrentPage = Math.max(parseInt(currentPage, 10) || 1, 1);
    const totalPages = Math.ceil(config.total / safePageSize);

    if (safeCurrentPage > totalPages) {
      return { images: [], hasMore: false, totalPages };
    }

    const startIndex = (safeCurrentPage - 1) * safePageSize + 1;
    const endIndex = Math.min(startIndex + safePageSize - 1, config.total);

    const images = this._buildSequentialImageList(
      config.basePath,
      startIndex,
      endIndex,
      config.defaultExtension
    );

    return {
      images,
      hasMore: safeCurrentPage < totalPages,
      totalPages
    };
  }

  /**
   * 获取特色活动详情页面图片
   * @param {number} currentPage - 当前页码
   * @param {number} pageSize - 页面大小（可选）
   * @returns {{images: Array<Object>, hasMore: boolean, totalPages: number}} 分页结果
   */
  getSpecialEventsDetailImages(currentPage = 1, pageSize) {
    return this.getDetailPageImages('specialEvents', currentPage, pageSize);
  }

  /**
   * 获取团队风采详情页面图片
   * @param {number} currentPage - 当前页码
   * @param {number} pageSize - 页面大小（可选）
   * @returns {{images: Array<Object>, hasMore: boolean, totalPages: number}} 分页结果
   */
  getTeamSpiritDetailImages(currentPage = 1, pageSize) {
    return this.getDetailPageImages('teamSpirit', currentPage, pageSize);
  }

  // ==================== 通用临时URL本地缓存 ====================

  /**
   * 从本地获取通用图片的临时URL缓存
   * @param {string} fileID
   * @returns {{url:string, expireAt:number}|null}
   */
  getLocalStorageTempUrl(fileID) {
    try {
      if (!fileID) return null;
      const key = `temp_url_cache_${fileID}`;
      const cached = wx.getStorageSync(key);
      if (!cached || !cached.url || !cached.expireAt) return null;
      if (Date.now() < cached.expireAt) return cached;
      // 过期清理
      wx.removeStorageSync(key);
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 保存通用图片临时URL到本地
   * @param {string} fileID
   * @param {string} url
   * @param {number} expireAt 绝对过期时间戳
   */
  saveTempUrlToLocalStorage(fileID, url, expireAt) {
    try {
      if (!fileID || !url || !expireAt) return;
      const key = `temp_url_cache_${fileID}`;
      wx.setStorageSync(key, { url, expireAt, savedAt: Date.now() });
    } catch (e) {}
  }

  /**
   * 预取首页需要的云文件临时URL，减少首页首屏转换开销
   * @param {{includeHonors?:boolean, honorsCount?:number}} options
   */
  async prefetchHomeTempUrls(options = {}) {
    const includeHonors = !!options.includeHonors;
    const honorsCount = Math.max(parseInt(options.honorsCount, 10) || 0, 0);

    const lists = [
      this.getHomeSwiperImages(),
      this.getHomeSpecialEvents(),
      this.getHomeTeamSpirit(),
    ];
    if (includeHonors && honorsCount > 0) {
      lists.push(this.getHomeTeamHonorsInitial(honorsCount));
    }

    const all = lists.flat();
    const fileIds = Array.from(new Set(
      all.map(i => i && i.url).filter(u => typeof u === 'string' && u.indexOf('cloud://') === 0)
    ));

    if (fileIds.length === 0 || !wx.cloud || !wx.cloud.getTempFileURL) return;

    const now = Date.now();
    const toFetch = [];
    for (const fid of fileIds) {
      const cached = this.tempUrlCache.get(fid);
      if (cached && cached.expireAt > now) continue;
      const local = this.getLocalStorageTempUrl(fid);
      if (local && local.url && local.expireAt > now) {
        this.tempUrlCache.set(fid, { url: local.url, expireAt: local.expireAt });
        continue;
      }
      toFetch.push(fid);
    }

    if (toFetch.length === 0) return;

    try {
      const res = await wx.cloud.getTempFileURL({ fileList: toFetch });
      const list = (res && res.fileList) || [];
      for (const item of list) {
        if (!item || !item.fileID || !item.tempFileURL) continue;
        const expireAt = now + this.tempUrlCacheTTL;
        this.tempUrlCache.set(item.fileID, { url: item.tempFileURL, expireAt });
        this.saveTempUrlToLocalStorage(item.fileID, item.tempFileURL, expireAt);
      }
    } catch (e) {
      console.error('首页资源临时URL预取失败', e);
    }
  }
}

// 导出单例
const cloudImageManager = new CloudImageManager();
module.exports = cloudImageManager;
