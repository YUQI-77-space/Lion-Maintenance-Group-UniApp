/**
 * 图标管理器
 * 
 * 提供统一的图标获取接口，支持：
 * - 按名称获取图标路径（语义化命名）
 * - 动态切换图标集（一键换肤）
 * - 默认值保护（图标不存在时使用默认图）
 * - 结果缓存（提升性能）
 * 
 * 使用示例：
 *   const icon = iconManager.get('home_repair');
 *   const tabIcon = iconManager.getTab('home');
 *   iconManager.switchSet('christmas');
 */

const iconConfig = require('../config/icons');

class IconManager {
  constructor() {
    this._currentSet = iconConfig.currentSet;
    this._cache = new Map();
    this._initialized = false;
  }

  /**
   * 获取当前使用的图标集名称
   * @returns {string}
   */
  getCurrentSet() {
    return this._currentSet;
  }

  /**
   * 切换图标集
   * @param {string} setName 图标集名称
   * @param {boolean} [persist=false] 是否持久化到本地存储
   */
  switchSet(setName, persist = false) {
    if (!iconConfig.sets[setName]) {
      console.warn(`[IconManager] 图标集 "${setName}" 不存在，使用默认图标集`);
      setName = 'default';
    }

    if (this._currentSet === setName) {
      return;
    }

    this._currentSet = setName;
    this._cache.clear();

    if (persist) {
      try {
        wx.setStorageSync('iconSet', setName);
      } catch (e) {
        console.error('[IconManager] 保存图标集设置失败:', e);
      }
    }

    console.log(`[IconManager] 已切换到图标集: ${setName}`);
  }

  /**
   * 从本地存储恢复图标集设置
   */
  restoreSet() {
    try {
      const savedSet = wx.getStorageSync('iconSet');
      if (savedSet && iconConfig.sets[savedSet]) {
        this._currentSet = savedSet;
        console.log(`[IconManager] 已恢复图标集: ${savedSet}`);
      }
    } catch (e) {
      console.warn('[IconManager] 恢复图标集设置失败:', e);
    }
  }

  /**
   * 获取所有可用的图标集名称
   * @returns {string[]}
   */
  getAvailableSets() {
    return Object.keys(iconConfig.sets);
  }

  /**
   * 获取图标的完整路径
   * @param {string} name 图标名称（对应 config/icons.js 中的 key）
   * @param {Object} [options] 可选参数
   * @param {string} [options.type] 图标类型：'icon' | 'tab' | 'startup'
   * @returns {string} 图标的完整路径
   */
  getIcon(name, options = {}) {
    const type = options.type || 'icon';
    const cacheKey = `${this._currentSet}:${name}:${type}`;

    // 检查缓存
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const set = iconConfig.sets[this._currentSet];
    if (!set) {
      console.warn(`[IconManager] 图标集 "${this._currentSet}" 不存在，使用默认图标集`);
      return this._getDefaultPath(name, type);
    }

    const iconName = set.icons[name];
    if (!iconName) {
      console.warn(`[IconManager] 图标 "${name}" 在图标集 "${this._currentSet}" 中不存在`);
      return this._getDefaultPath(name, type);
    }

    // 根据类型确定基础路径
    let basePath;
    switch (type) {
      case 'tab':
        basePath = set.tabsPath;
        break;
      case 'startup':
        basePath = set.startupPath;
        break;
      default:
        basePath = set.basePath;
    }

    const fullPath = basePath + iconName;

    // 缓存结果
    this._cache.set(cacheKey, fullPath);

    return fullPath;
  }

  /**
   * 获取默认图标的完整路径
   * @private
   */
  _getDefaultPath(name, type) {
    // 先尝试从 default 图标集获取
    const defaultSet = iconConfig.sets['default'];
    if (defaultSet) {
      const iconName = defaultSet.icons[name];
      if (iconName) {
        let basePath;
        switch (type) {
          case 'tab':
            basePath = defaultSet.tabsPath;
            break;
          case 'startup':
            basePath = defaultSet.startupPath;
            break;
          default:
            basePath = defaultSet.basePath;
        }
        return basePath + iconName;
      }
    }

    // 最后使用全局默认值
    if (type === 'tab') {
      return iconConfig.defaults.icon;
    }
    return iconConfig.defaults.icon;
  }

  /**
   * 获取功能图标（快捷方法）
   * @param {string} name 图标名称
   * @returns {string} 图标路径
   */
  get(name) {
    return this.getIcon(name, { type: 'icon' });
  }

  /**
   * 获取 TabBar 图标（快捷方法）
   * @param {string} name 图标名称
   * @returns {string} 图标路径
   */
  getTab(name) {
    return this.getIcon(name, { type: 'tab' });
  }

  /**
   * 获取启动页图片（快捷方法）
   * @param {string} name 图片名称
   * @returns {string} 图片路径
   */
  getStartup(name) {
    return this.getIcon(name, { type: 'startup' });
  }

  /**
   * 批量获取图标
   * @param {string[]} names 图标名称数组
   * @param {Object} [options] 可选参数
   * @param {string} [options.type] 图标类型
   * @returns {Object} 名称到路径的映射
   * 
   * @example
   * const icons = iconManager.getMultiple(['home_repair', 'home_duty', 'search']);
   * // => { home_repair: '/images/default/icons/home_1.png', home_duty: '/images/default/icons/home_2.png', search: '/images/default/icons/search.png' }
   */
  getMultiple(names, options = {}) {
    const result = {};
    names.forEach(name => {
      result[name] = this.getIcon(name, options);
    });
    return result;
  }

  /**
   * 批量获取功能图标
   * @param {string[]} names 图标名称数组
   * @returns {Object} 名称到路径的映射
   */
  getIcons(names) {
    return this.getMultiple(names, { type: 'icon' });
  }

  /**
   * 批量获取 TabBar 图标
   * @param {string[]} names 图标名称数组
   * @returns {Object} 名称到路径的映射
   */
  getTabs(names) {
    return this.getMultiple(names, { type: 'tab' });
  }

  /**
   * 获取配置中定义的所有图标（用于调试）
   * @returns {Object}
   */
  getAllIcons() {
    const set = iconConfig.sets[this._currentSet];
    return set ? { ...set.icons } : {};
  }

  /**
   * 检查图标是否存在
   * @param {string} name 图标名称
   * @returns {boolean}
   */
  hasIcon(name) {
    const set = iconConfig.sets[this._currentSet];
    return !!(set && set.icons[name]);
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._cache.clear();
  }

  /**
   * 重置为默认图标集
   * @param {boolean} [persist=false] 是否清除本地存储的设置
   */
  resetToDefault(persist = false) {
    this._currentSet = 'default';
    this._cache.clear();

    if (persist) {
      try {
        wx.removeStorageSync('iconSet');
      } catch (e) {
        console.error('[IconManager] 清除图标集设置失败:', e);
      }
    }

    console.log('[IconManager] 已重置为默认图标集');
  }

  /**
   * 获取默认图片配置
   * @returns {Object} 默认图片配置
   */
  getDefault() {
    return iconConfig.defaults;
  }
}

// ==================== 导出单例 ====================
const iconManager = new IconManager();
module.exports = iconManager;

// 同时导出类，便于扩展或自定义实例
module.exports.IconManager = IconManager;
