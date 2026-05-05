/**
 * 志愿活动状态管理工具
 * 提供前端状态同步、本地缓存和实时更新功能
 */

const time = require('./time');

/**
 * 状态映射配置
 */
const STATUS_CONFIG = {
  pending: {
    text: '待发布',
    color: '#fa8c16',
    bgColor: '#fff7e6',
    borderColor: '#ffd591'
  },
  inPreparation: {
    text: '筹备中',
    color: '#1890ff',
    bgColor: '#e6f7ff',
    borderColor: '#91d5ff'
  },
  inProgress: {
    text: '进行中', 
    color: '#52c41a',
    bgColor: '#f6ffed',
    borderColor: '#b7eb8f'
  },
  ended: {
    text: '已结束',
    color: '#8c8c8c',
    bgColor: '#f5f5f5', 
    borderColor: '#d9d9d9'
  }
};

/**
 * 时间处理工具 - 前端版本
 */
class TimeUtils {
  
  /**
   * 获取东八区当前时间
   * @returns {Date} 当前时间
   */
  static getChinaTime() {
    return new Date();
  }
  
  /**
   * 根据开始时间和结束时间计算活动状态
   * @param {string|Date} startTime 开始时间
   * @param {string|Date} endTime 结束时间  
   * @returns {string} 活动状态
   */
  static calculateActivityStatus(startTime, endTime) {
    try {
      const now = this.getChinaTime();
      // iOS 兼容：使用 time.toDate
      const start = time.toDate(startTime);
      const end = time.toDate(endTime);
      if (!start || !end) return 'inPreparation';
      
      const currentTimestamp = now.getTime();
      const startTimestamp = start.getTime();
      const endTimestamp = end.getTime();
      
      if (currentTimestamp < startTimestamp) {
        return 'inPreparation';
      } else if (currentTimestamp >= startTimestamp && currentTimestamp <= endTimestamp) {
        return 'inProgress';
      } else {
        return 'ended';
      }
    } catch (error) {
      console.error('[前端状态计算错误]', error);
      return 'inPreparation';
    }
  }
  
  /**
   * 格式化时间显示
   * @param {string|Date} dateTime 时间
   * @returns {string} 格式化的时间字符串
   */
  static formatDateTime(dateTime) {
    // iOS 兼容：使用 time.toDate
    const date = time.toDate(dateTime);
    if (!date) return '';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
}

/**
 * 活动状态管理器
 */
class ActivityStatusManager {
  
  /**
   * 获取状态显示配置
   * @param {string} status 状态值
   * @returns {Object} 状态配置对象
   */
  static getStatusConfig(status) {
    return STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  }
  
  /**
   * 处理活动列表的状态显示
   * @param {Array} activities 活动列表
   * @returns {Array} 处理后的活动列表
   */
  static processActivitiesForDisplay(activities) {
    if (!activities || !Array.isArray(activities)) {
      return [];
    }
    
    return activities.map(activity => {
      // 计算实时状态（用于前端显示，后端数据为准）
      const frontendCalculatedStatus = TimeUtils.calculateActivityStatus(
        activity.startTime, 
        activity.endTime
      );
      
      // 使用后端返回的状态，但记录前端计算的状态用于比较
      const displayStatus = activity.activityStatus || frontendCalculatedStatus;
      const statusConfig = this.getStatusConfig(displayStatus);
      
      return {
        ...activity,
        displayStatus,
        statusText: statusConfig.text,
        statusColor: statusConfig.color,
        statusBgColor: statusConfig.bgColor,
        statusBorderColor: statusConfig.borderColor,
        formattedStartTime: TimeUtils.formatDateTime(activity.startTime),
        formattedEndTime: TimeUtils.formatDateTime(activity.endTime),
        // 标记状态是否可能不同步（前端计算与后端不一致）
        statusMightBeOutdated: frontendCalculatedStatus !== displayStatus
      };
    });
  }
  
  /**
   * 更新单个活动状态（改为适配器）
   * @param {string} activityId 活动ID
   * @returns {Promise<Object>} 更新结果
   */
  static async updateSingleActivityStatus(activityId) {
    try {
      const api = require('./apiAdapter');
      const result = await api.call('volunteerActivities', {
        action: 'updateActivityStatus',
        params: { activityId }
      });
      
      if (result.success) {
        return { success: true, data: result.data, message: result.message };
      } else {
        return { success: false, message: result.message };
      }
    } catch (error) {
      console.error('[前端状态更新] 更新活动状态异常:', error);
      return { success: false, message: '状态更新失败' };
    }
  }
  
  /**
   * 检查并更新页面中可能过期的活动状态
   * @param {Array} activities 活动列表
   * @returns {Promise<Array>} 更新后的活动列表
   */
  static async checkAndUpdateOutdatedStatus(activities) {
    if (!activities || !Array.isArray(activities)) {
      return activities;
    }
    
    const outdatedActivities = activities.filter(activity => 
      activity.statusMightBeOutdated && 
      activity.activityStatus !== 'ended' // 已结束的活动不需要频繁检查
    );
    
    if (outdatedActivities.length === 0) {
      return activities;
    }

    
    // 批量更新过期状态（但不要影响用户体验，异步处理）
    this.batchUpdateOutdatedStatus(outdatedActivities);
    
    return activities;
  }
  
  /**
   * 批量更新过期状态（异步执行）
   * @param {Array} outdatedActivities 过期的活动列表
   */
  static async batchUpdateOutdatedStatus(outdatedActivities) {
    try {
      const updatePromises = outdatedActivities.map(activity => 
        this.updateSingleActivityStatus(activity.activityId)
      );
      
      await Promise.allSettled(updatePromises);
      
    } catch (error) {
      console.error('[批量状态同步] 失败:', error);
    }
  }
  
  /**
   * 获取状态筛选条件的统计信息
   * @param {Array} activities 活动列表
   * @returns {Object} 统计信息
   */
  static getStatusStatistics(activities) {
    if (!activities || !Array.isArray(activities)) {
      return {
        total: 0,
        inPreparation: 0,
        inProgress: 0,
        ended: 0
      };
    }
    
    const stats = {
      total: activities.length,
      inPreparation: 0,
      inProgress: 0,
      ended: 0
    };
    
    activities.forEach(activity => {
      const status = activity.activityStatus || activity.displayStatus;
      if (stats.hasOwnProperty(status)) {
        stats[status]++;
      }
    });
    
    return stats;
  }
  
  /**
   * 根据状态筛选活动列表
   * @param {Array} activities 活动列表
   * @param {string} statusFilter 状态筛选条件
   * @returns {Array} 筛选后的活动列表
   */
  static filterActivitiesByStatus(activities, statusFilter) {
    if (!activities || !Array.isArray(activities) || !statusFilter || statusFilter === 'all') {
      return activities;
    }
    
    return activities.filter(activity => {
      const status = activity.activityStatus || activity.displayStatus;
      return status === statusFilter;
    });
  }
}

/**
 * 页面级别的状态管理混入
 * 可以在页面中使用 Object.assign(this, ActivityStatusMixin) 来混入功能
 */
const ActivityStatusMixin = {
  
  /**
   * 初始化状态管理
   */
  initActivityStatusManager() {
    // 设置状态更新定时器（每30秒检查一次）
    this.statusCheckInterval = setInterval(() => {
      this.checkActivityStatusUpdates();
    }, 30000);
  },
  
  /**
   * 清理状态管理资源
   */
  cleanupActivityStatusManager() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }
  },
  
  /**
   * 检查活动状态更新
   */
  async checkActivityStatusUpdates() {
    if (this.data.activities && this.data.activities.length > 0) {
      const updatedActivities = await ActivityStatusManager.checkAndUpdateOutdatedStatus(
        this.data.activities
      );
      
      // 如果有状态变化，重新获取数据
      const hasStatusChange = updatedActivities.some(activity => activity.statusMightBeOutdated);
      if (hasStatusChange) {
        // 可以调用页面的刷新方法，如 this.refreshData()
      }
    }
  }
};

module.exports = {
  ActivityStatusManager,
  ActivityStatusMixin,
  TimeUtils,
  STATUS_CONFIG
}; 