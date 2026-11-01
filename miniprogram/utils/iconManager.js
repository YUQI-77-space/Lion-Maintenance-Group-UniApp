/**
 * 图标管理器
 * 
 * 提供统一的图标获取接口，支持：
 * - 按名称获取图标路径（语义化命名）
 * - 默认值保护（图标不存在时使用默认图）
 * - 结果缓存（提升性能）
 * 
 * 使用示例：
 *   const icon = iconManager.get('home_repair');
 *   const tabIcon = iconManager.getTab('home');
 */

const iconConfig = require('../config/icons');

// 全项目沿用原有语义名，统一使用随代码发布的手绘 SVG。
const TEAM_ICONS = {
  team_calendar: 'duty',
  team_maintenance: 'maintenance',
  team_volunteer: 'volunteer',
  team_manual: 'manual',
  manage_duty: 'duty-manage',
  manage_maintenance: 'maintenance-manage',
  manage_volunteer: 'volunteer-manage',
  manage_ewa: 'ewa-manage',
  manage_members: 'members-manage'
};

class IconManager {
  constructor() {
    this._currentSet = iconConfig.currentSet;
    this._cache = new Map();
  }

  /**
   * 获取图标的完整路径
   * @param {string} name 图标名称（对应 config/icons.js 中的 key）
   * @param {Object} [options] 可选参数
   * @param {string} [options.type] 图标类型：'icon' | 'tab' | 'startup'
   * @returns {string} 图标的完整路径
   */
  getIcon(name, options = {}) {
    if (Object.prototype.hasOwnProperty.call(TEAM_ICONS, name)) return `/assets/icons/team/${TEAM_ICONS[name]}.svg`;
    if (name === 'common_logout') return '/assets/icons/logout.svg';
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
