const api = require('../../utils/apiAdapter');
const SubscriptionAuth = require('../../utils/subscriptionAuth');
const repairCategories = require('../../utils/repairCategories');
const iconManager = require('../../utils/iconManager');
const time = require('../../utils/time');

// 首帧就同步取到导航栏高度，避免 onLoad 里再 setData 造成的内容空档/布局跳动
const WINDOW_INFO = (() => { try { return wx.getWindowInfo() || {}; } catch (e) { return {}; } })();
const STATUS_BAR_HEIGHT = WINDOW_INFO.statusBarHeight || 20;
const NAV_BAR_HEIGHT = STATUS_BAR_HEIGHT + 44;

// 步骤条高度（100rpx）与内容顶部留白：按屏幕宽度换算，避免 rpx/px 混算
const STEP_BAR_HEIGHT = Math.round(100 * (WINDOW_INFO.windowWidth || 375) / 750);
const CONTENT_TOP = NAV_BAR_HEIGHT + STEP_BAR_HEIGHT + 12;
const CONTENT_TOP_NO_BAR = NAV_BAR_HEIGHT + 12;

// 首帧直出：预约时间、日期区间、用户信息都能同步算出来，直接作为初始 data
function computeEarliestAppointmentTime() {
  const now = new Date();
  const nextHour = new Date(now);

  if (now.getMinutes() > 0 || now.getSeconds() > 0) {
    nextHour.setHours(now.getHours() + 1);
  }
  nextHour.setMinutes(0);
  nextHour.setSeconds(0);
  nextHour.setMilliseconds(0);

  const year = nextHour.getFullYear();
  const month = (`0${nextHour.getMonth() + 1}`).slice(-2);
  const day = (`0${nextHour.getDate()}`).slice(-2);
  const hour = (`0${nextHour.getHours()}`).slice(-2);

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:00`
  };
}

function computeAppointmentDateRange() {
  const now = new Date();
  const future = new Date();
  future.setDate(now.getDate() + 30);
  const pad = (n) => (`0${n}`).slice(-2);

  return {
    startDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    endDate: `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`
  };
}

const INITIAL_APPOINTMENT = (() => {
  const earliest = computeEarliestAppointmentTime();
  const range = computeAppointmentDateRange();
  return {
    date: earliest.date,
    time: earliest.time,
    startDate: range.startDate,
    endDate: range.endDate
  };
})();

const INITIAL_USER_INFO = (() => {
  try {
    return wx.getStorageSync('userInfo') || {};
  } catch (e) {
    return {};
  }
})();

Page({
  data: {
    // 导航栏高度
    statusBarHeight: STATUS_BAR_HEIGHT,
    navBarHeight: NAV_BAR_HEIGHT,
    stepBarHeight: STEP_BAR_HEIGHT,
    contentTop: CONTENT_TOP,
    contentTopNoBar: CONTENT_TOP_NO_BAR,

    // 图标资源
    iconLogo: iconManager.get('common_logo'),
    iconSearch: iconManager.get('common_search'),
    iconArrowRight: iconManager.get('common_arrow_right'),
    iconCheck: iconManager.get('common_check'),

    currentStep: 0,
    // 步骤条：0 选择类别 / 1 填写信息 / 2 确认提交
    progressStage: 0,
    progressLabels: ['选择类别', '填写信息', '确认提交'],
    
    // 问题分类数据
    categories: repairCategories,
    subcategories: [],
    types: [],

    // 搜索相关
    searchKeyword: '',
    searchResults: [],
    showSearchResult: false,
    showQuickKeywords: false,
    searchEmpty: false,
    quickKeywords: [
      { label: '笔记本清灰', value: '清灰' },
      { label: '系统重装', value: '重装' },
      { label: '电风扇维修', value: '电风扇' },
      { label: '手机屏幕', value: '屏幕' }
    ],

    // 用户选择
    selectedCategory: null,
    selectedSubcategory: null,
    selectedType: null,
    selectedTypeId: null,

    // 报修详情
    appointmentDate: INITIAL_APPOINTMENT.date,
    appointmentTime: INITIAL_APPOINTMENT.time,
    startDate: INITIAL_APPOINTMENT.startDate,
    endDate: INITIAL_APPOINTMENT.endDate,
    otherDescription: '',
    
    // 特殊输入字段
    laptopModel: '',        // 笔记本型号
    phoneModel: '',         // 手机型号
    laptopSystem: '',       // 笔记本系统
    softwareInfo: '',       // 软件信息
    systemVersion: '',      // 系统版本
    deviceModel: '',        // 其他设备型号
    mouseModel: '',         // 鼠标型号
    keyboardModel: '',      // 键盘型号
    fanModel: '',           // 电风扇型号
    requiredFields: [],     // 当前需要的特殊字段
    errorField: '',         // 校验未通过的字段 key，用于内联提示
    detailLines: [],        // 确认页展示的“设备信息”行
    
    // 用户信息
    userInfo: INITIAL_USER_INFO,
    
    // 紧急联系人信息
    emergencyContacts: [],

    // 临时状态，用于在步骤间传递数据
    tempState: {},

    _touchStartX: 0,
    _touchStartY: 0,
    // 动画相关
    isAnimating: false,
    themeClass: ''
  },

  onLoad: function (options) {
    this.initAnimation();
    this.initAppointmentDate();
    this.loadUserInfo();
    this.loadEmergencyContacts();
  },

  onTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    this.setData({ _touchStartX: e.touches[0].clientX, _touchStartY: e.touches[0].clientY });
  },
  onTouchEnd(e) {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - this.data._touchStartX;
    const dy = endY - this.data._touchStartY;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx < 60 || absDy > 40) return;

    const { getTabOrder } = require('../../utils/router');
    const tabOrder = getTabOrder();
    const pages = getCurrentPages();
    const route = '/' + pages[pages.length - 1].route;
    const idx = tabOrder.indexOf(route);
    if (idx === -1) return;

    const nextIdx = dx < 0 ? (idx + 1) % tabOrder.length : (idx - 1 + tabOrder.length) % tabOrder.length;
    const direction = dx < 0 ? 'left' : 'right';
    this.animateAndSwitch(direction, tabOrder[nextIdx]);
  },

  onShow() {
    this.initAnimation();
    const tab = this.getTabBar && this.getTabBar();
    tab && tab.setSelectedByRoute && tab.setSelectedByRoute();

    // 若此前加载失败导致列表为空，重新尝试获取紧急联系人
    if (!this.data.emergencyContacts.length) {
      this.loadEmergencyContacts();
    }

    // 如果是从维修分类地图返回，并且带有快速定位信息，则直接跳转到对应问题的填写详情页
    try {
      const app = getApp && getApp();
      const quick = app && app.globalData && app.globalData.repairQuickSelect;
      if (quick && quick.categoryId && quick.subcategoryId && quick.typeId) {
        const category = repairCategories.find(c => c.id === quick.categoryId);
        const sub = category && (category.subcategories || []).find(s => s.id === quick.subcategoryId);
        const type = sub && (sub.types || []).find(t => t.id === quick.typeId);
        if (category && sub && type) {
          this.applyTypeSelection(category, sub, type, { toastText: '已根据地图定位到该问题' });
        }
        // 只使用一次
        app.globalData.repairQuickSelect = null;
      }
    } catch (e) {
      // 任何异常不影响正常流程
    }
  },

  onUnload() {},

  /**
   * 步骤对应的进度阶段：0 选择类别 / 1 填写信息 / 2 确认提交
   */
  stageOf(step) {
    if (step <= 2) return 0;
    return step === 3 ? 1 : 2;
  },

  /**
   * 切换步骤：同步进度条、必要时重建确认页数据，并把页面滚回顶部
   */
  goToStep(step, extraData) {
    const patch = Object.assign({}, extraData || {}, {
      currentStep: step,
      progressStage: this.stageOf(step)
    });
    if (step === 4) {
      patch.detailLines = this.buildDetailLines();
    }
    this.setData(patch);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  /**
   * 构建确认页的“设备信息”行；标签取当前类型的字段定义，避免出现“设备型号”这类泛化名称
   * 笔记本型号为选填，未填写时统一显示“未知”，保证信息单上始终呈现该栏目
   */
  buildDetailLines() {
    const fields = this.data.requiredFields || [];

    return fields
      .map(field => {
        const raw = this.data[field.key];
        const filled = raw && String(raw).trim() ? raw : '';
        return {
          label: field.label,
          value: filled || (field.key === 'laptopModel' ? '未知' : '')
        };
      })
      .filter(item => item.value);
  },

  /**
   * 清空特殊字段（切换问题类型 / 重新报修时调用）
   */
  specialFieldResetPatch() {
    return {
      laptopModel: '',
      phoneModel: '',
      laptopSystem: '',
      softwareInfo: '',
      systemVersion: '',
      deviceModel: '',
      mouseModel: '',
      keyboardModel: '',
      fanModel: '',
      errorField: ''
    };
  },

  // 页面动画
  // 仅复位滑动切换的防抖标记：页面根节点不再挂 animation，避免整页合成层与切换瞬间的空白帧
  initAnimation: function () {
    if (this.data.isAnimating) {
      this.setData({ isAnimating: false });
    }
  },

  // 滑动切换 Tab：直接切换，不再先把整页淡出
  animateAndSwitch: function (direction, url) {
    if (this.data.isAnimating || !url) return;
    this.setData({ isAnimating: true });
    wx.switchTab({ url });
    // 兜底复位，避免切换失败后标记卡死
    setTimeout(() => {
      if (this.data.isAnimating) {
        this.setData({ isAnimating: false });
      }
    }, 400);
  },

  initAppointmentDate() {
    const earliestTime = computeEarliestAppointmentTime();
    const range = computeAppointmentDateRange();

    this.setData({
      appointmentDate: earliestTime.date,
      startDate: range.startDate,
      endDate: range.endDate,
      appointmentTime: earliestTime.time,
    });
  },

  // 获取最早可预约时间
  getEarliestAppointmentTime() {
    return computeEarliestAppointmentTime();
  },

  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    // 首帧已用同一份缓存直出，避免这里再触发一次多余渲染
    if (this.data.userInfo && this.data.userInfo.openid) return;
    this.setData({ userInfo });
  },

  // 加载紧急联系人信息（来自 proUsers 中 isEmergencyContact 为 true 的成员）
  loadEmergencyContacts() {
    if (this._emergencyLoading) return;
    this._emergencyLoading = true;

    api.call('users', {
      action: 'getEmergencyContacts',
      timeout: 5000,
      config: { retries: 1 }
    }).then((res) => {
      const list = (res && res.success && Array.isArray(res.data)) ? res.data : [];
      this.setData({
        emergencyContacts: list.filter(item => item && item.nickName && item.qqId)
      });
      this._emergencyLoading = false;
    }).catch(() => {
      // 拉取失败不阻塞报修流程，保持列表为空
      this._emergencyLoading = false;
    });
  },

  // 单击复制紧急联系人QQ号
  onCopyEmergencyQQ(e) {
    const qq = e.currentTarget.dataset.qq;
    const name = e.currentTarget.dataset.name || '';
    if (!qq) return;

    wx.setClipboardData({
      data: String(qq),
      success: () => {
        wx.showToast({
          title: name ? `${name}的QQ号已复制` : 'QQ号已复制',
          icon: 'success',
          duration: 2000
        });
      },
      fail: () => {
        wx.showToast({
          title: '复制失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  // 搜索输入
  onSearchInput(e) {
    const raw = e.detail.value || '';
    const keyword = raw.trim();
    this.setData({
      searchKeyword: raw,
      showQuickKeywords: !keyword
    });
    if (!keyword) {
      this.setData({ searchResults: [], showSearchResult: false, searchEmpty: false });
      return;
    }
    // 输入过程中静默搜索，命中与否都只在面板内反馈
    this.runSearch(keyword);
  },

  onSearchConfirm() {
    const keyword = (this.data.searchKeyword || '').trim();
    if (!keyword) {
      wx.showToast({ title: '请输入关键字', icon: 'none' });
      return;
    }
    this.runSearch(keyword);
  },

  onSearchClear() {
    this.setData({
      searchKeyword: '',
      searchResults: [],
      showSearchResult: false,
      showQuickKeywords: true,
      searchEmpty: false
    });
  },

  onSearchFocus() {
    if (!this.data.searchKeyword) {
      this.setData({
        showQuickKeywords: true
      });
    }
  },

  onSearchBlur() {
    // 延迟收起，保证面板内的点击（选结果/点快捷词）能先被响应
    clearTimeout(this._searchBlurTimer);
    this._searchBlurTimer = setTimeout(() => {
      this.setData({
        showQuickKeywords: false,
        showSearchResult: false,
        searchResults: [],
        searchEmpty: false
      });
    }, 250);
  },

  onQuickKeywordTap(e) {
    const value = e.currentTarget.dataset.value || '';
    if (!value) return;

    // 直接根据该关键词查找第一个匹配的三级问题并跳转
    const lower = value.toLowerCase();
    let found = null;
    repairCategories.some(cat => {
      return (cat.subcategories || []).some(sub => {
        return (sub.types || []).some(t => {
          const name = t.name || '';
          if (name.toLowerCase().indexOf(lower) !== -1) {
            found = { cat, sub, type: t };
            return true;
          }
          return false;
        });
      });
    });

    if (!found) {
      wx.showToast({ title: '未找到相关问题', icon: 'none' });
      return;
    }

    const { cat, sub, type } = found;
    this.applyTypeSelection(cat, sub, type);
  },

  runSearch(keyword) {
    const lower = keyword.toLowerCase();
    const results = [];

    repairCategories.forEach(cat => {
      (cat.subcategories || []).forEach(sub => {
        (sub.types || []).forEach(t => {
          const name = t.name || '';
          // 简单关键词匹配（可根据需要扩展）
          if (name.toLowerCase().indexOf(lower) !== -1) {
            results.push({
              id: `${cat.id}-${sub.id}-${t.id}`,
              categoryId: cat.id,
              subcategoryId: sub.id,
              typeId: t.id,
              fullPath: `${cat.name} › ${sub.name} › ${name}`,
              hint: '点击直接进入填写'
            });
          }
        });
      });
    });

    // 无结果时用面板内的空状态提示，不再弹 toast 打断输入
    this.setData({
      searchResults: results,
      showSearchResult: !!results.length,
      searchEmpty: !results.length
    });
  },

  /**
   * 选定三级问题并直接进入“填写报修详情”
   * 搜索结果、快捷关键词、分类地图三处入口共用
   */
  applyTypeSelection(category, sub, type, options) {
    const opts = options || {};
    const requiredFields = this.getRequiredFieldsById(type.id);

    this.goToStep(3, Object.assign({
      selectedCategory: category,
      selectedSubcategory: sub,
      selectedType: type,
      selectedTypeId: type.id,
      types: sub.types || [],
      subcategories: category.subcategories || [],
      requiredFields,
      tempState: {
        selectedType: type,
        selectedTypeId: type.id
      },
      // 清空搜索相关状态
      searchKeyword: '',
      searchResults: [],
      showSearchResult: false,
      showQuickKeywords: false,
      searchEmpty: false
    }, this.specialFieldResetPatch()));

    const toastText = opts.toastText || '已为您定位到该问题';

    // 笔记本清灰（id: 111）需要温馨提醒
    if (type.id === 111) {
      wx.showModal({
        title: '温馨提醒',
        content: '笔记本清灰需收费30元人工费\n提醒：务必带上充电器哦！',
        showCancel: false,
        confirmText: '我知道了',
        confirmColor: '#0000CD',
        success: () => {
          wx.showToast({ title: toastText, icon: 'none', duration: 1000 });
        }
      });
    } else {
      wx.showToast({ title: toastText, icon: 'none', duration: 1000 });
    }
  },

  // 点击搜索结果：直接完成前面三级选择并跳到填写详情步骤
  onSearchResultTap(e) {
    const { catId, subId, typeId } = e.currentTarget.dataset;

    const category = repairCategories.find(c => c.id === catId);
    if (!category) return;

    const sub = (category.subcategories || []).find(s => s.id === subId);
    if (!sub) return;

    const type = (sub.types || []).find(t => t.id === typeId);
    if (!type) return;

    this.applyTypeSelection(category, sub, type);
  },
  
  // 步骤控制
  nextStep() {
    let { currentStep, selectedType, selectedTypeId, tempState } = this.data;
    const extra = {};

    // 步骤 2 → 3：必须先选中问题类型，同时清空上一次填写过的特殊字段
    if (currentStep === 2) {
      if (!selectedType) {
        wx.showToast({ title: '请选择问题类型', icon: 'none' });
        return;
      }
      tempState = { selectedType, selectedTypeId };
      Object.assign(extra, this.specialFieldResetPatch());
    }

    // 步骤 3 → 4：校验必填项，未通过时在对应字段下方内联提示
    if (currentStep === 3) {
      const requiredFields = this.getRequiredFields();
      const missing = requiredFields.find(field => {
        if (!field.required) return false;
        const value = this.data[field.key];
        return !value || String(value).trim() === '';
      });

      if (missing) {
        this.setData({ errorField: missing.key });
        wx.showToast({ title: `请填写${missing.label}`, icon: 'none' });
        return;
      }

      if (!this.data.appointmentDate) {
        wx.showToast({ title: '请选择预约日期', icon: 'none' });
        return;
      }

      if (!this.data.appointmentTime) {
        wx.showToast({ title: '请选择预约时间', icon: 'none' });
        return;
      }

      selectedType = tempState.selectedType;
      selectedTypeId = tempState.selectedTypeId;
    }

    this.goToStep(currentStep + 1, Object.assign(extra, { tempState, selectedType, selectedTypeId }));
  },
  
  prevStep() {
    const { currentStep } = this.data;
    const updateData = {};

    // 清理状态
    if (currentStep === 1) {
      updateData.selectedCategory = null;
      updateData.subcategories = [];
    } else if (currentStep === 2) {
      updateData.selectedSubcategory = null;
      updateData.types = [];
      updateData.selectedType = null;
      updateData.selectedTypeId = null;
      updateData.requiredFields = [];
      Object.assign(updateData, this.specialFieldResetPatch());
    }

    this.goToStep(currentStep - 1, updateData);
  },
  
  onCategorySelect(e) {
    const { id } = e.currentTarget.dataset;
    const selected = this.data.categories.find(cat => cat.id === id);
    this.setData({
      selectedCategory: selected,
      subcategories: selected.subcategories,
      // 清理后续选择
      selectedSubcategory: null,
      selectedType: null,
      selectedTypeId: null,
      types: [],
      requiredFields: []
    });
    this.nextStep();
  },

  onSubcategorySelect(e) {
    const { id } = e.currentTarget.dataset;
    const selected = this.data.subcategories.find(sub => sub.id === id);
    this.setData({
      selectedSubcategory: selected,
      types: selected.types,
      // 清理后续选择
      selectedType: null,
      selectedTypeId: null,
      requiredFields: []
    });
    this.nextStep();
  },
  onTypeSelect(e) {
    const { id } = e.currentTarget.dataset;
    const selected = this.data.types.find(t => t.id === id);
    this.setData({
      selectedTypeId: id,
      selectedType: selected,
      requiredFields: this.getRequiredFieldsById(id),
      errorField: ''
    });

    // 笔记本清灰（id: 111）需要温馨提醒
    if (id === 111) {
      wx.showModal({
        title: '温馨提醒',
        content: '笔记本清灰需收费30元人工费\n提醒：务必带上充电器哦！',
        showCancel: false,
        confirmText: '我知道了',
        confirmColor: '#0000CD'
      });
    }
  },
  
  onDateChange(e) {
    const selectedDate = e.detail.value;
    this.setData({ appointmentDate: selectedDate });
    
    // 如果选择的是今天，需要验证时间是否合法
    this.validateSelectedDateTime(selectedDate, this.data.appointmentTime);
  },
  onTimeChange(e) {
    const selectedTime = e.detail.value;
    this.setData({ appointmentTime: selectedTime });
    
    // 验证选择的时间是否合法
    this.validateSelectedDateTime(this.data.appointmentDate, selectedTime);
  },

  /**
   * 验证选择的日期时间是否合法
   */
  validateSelectedDateTime(date, time) {
    if (!date || !time) return;
    
    // 使用 time.js 的 toDate 确保 iOS 兼容
    const selectedDateTime = time.toDate(`${date} ${time}`);
    const now = new Date();
    
    // 如果选择的时间早于当前时间，自动调整到最早可预约时间
    if (selectedDateTime <= now) {
      const earliestTime = this.getEarliestAppointmentTime();
      this.setData({
        appointmentDate: earliestTime.date,
        appointmentTime: earliestTime.time
      });
      
      wx.showToast({
        title: '预约时间不能早于当前时间，已自动调整',
        icon: 'none',
        duration: 2000
      });
    }
  },
  onDescriptionInput(e) {
    this.setData({ otherDescription: e.detail.value });
  },
  
  // 特殊输入字段的处理方法
  onLaptopModelInput(e) {
    this.setData({ laptopModel: e.detail.value });
  },
  
  onPhoneModelInput(e) {
    this.setData({ phoneModel: e.detail.value });
  },
  
  onLaptopSystemInput(e) {
    this.setData({ laptopSystem: e.detail.value });
  },
  
  onSoftwareInfoInput(e) {
    this.setData({ softwareInfo: e.detail.value });
  },
  
  onSystemVersionChange(e) {
    const systemOptions = ['WIN7', 'WIN10', 'WIN11', 'MAC'];
    const selectedIndex = e.detail.value;
    this.applyFieldValue('systemVersion', systemOptions[selectedIndex]);
  },
  
  onDeviceModelInput(e) {
    this.setData({ deviceModel: e.detail.value });
  },

  onMouseModelInput(e) {
    this.setData({ mouseModel: e.detail.value });
  },

  onKeyboardModelInput(e) {
    this.setData({ keyboardModel: e.detail.value });
  },

  onFanModelInput(e) {
    this.setData({ fanModel: e.detail.value });
  },
  
  // 通用的字段输入处理函数
  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.applyFieldValue(field, e.detail.value);
  },

  /**
   * 写入字段值：同步清理该字段的校验提示，并回写到 requiredFields，
   * 保证从确认页返回修改时输入框内容不丢失
   */
  applyFieldValue(field, value) {
    const patch = {
      [field]: value,
      errorField: this.data.errorField === field ? '' : this.data.errorField
    };

    const index = (this.data.requiredFields || []).findIndex(item => item.key === field);
    if (index !== -1) {
      patch[`requiredFields[${index}].value`] = value;
    }

    this.setData(patch);
  },
  
  // 获取当前选择的问题类型需要的特殊输入字段
  getRequiredFields() {
    return this.getRequiredFieldsById(this.data.selectedTypeId);
  },
  
  // 根据类型ID获取需要的特殊输入字段
  getRequiredFieldsById(typeId) {
    const fields = [];
    
    // 所有需要填写型号的字段均为选填（报修人可先提交，具体型号后续补充说明）
    if ([111, 112, 113, 117, 118].includes(typeId)) {
      fields.push({ key: 'laptopModel', label: '笔记本型号', placeholder: '请填写具体的机型（如拯救者r9000p 2025）', required: false });
    }
    
    // 笔记本C盘清理等需要系统信息（非型号，仍为必填）
    if ([114].includes(typeId)) {
      fields.push({ key: 'laptopSystem', label: '笔记本系统', placeholder: '请填写笔记本的系统', required: true });
    }
    
    // 笔记本软件安装需要软件信息（非型号，仍为必填）
    if ([115].includes(typeId)) {
      fields.push({ key: 'softwareInfo', label: '软件信息', placeholder: '请填写想要安装的软件以及版本', required: true });
    }
    
    // 笔记本系统重装需要系统版本（非型号，仍为必填）
    if ([116].includes(typeId)) {
      fields.push({ key: 'systemVersion', label: '系统版本', type: 'select', options: ['WIN7', 'WIN10', 'WIN11', 'MAC'], required: true });
    }
    
    // 手机型号选填
    if ([121, 122, 124].includes(typeId)) {
      fields.push({ key: 'phoneModel', label: '手机型号', placeholder: '请填写手机型号', required: false });
    }
    
    // 鼠标型号选填
    if ([131].includes(typeId)) {
      fields.push({ key: 'mouseModel', label: '鼠标型号', placeholder: '请填写鼠标型号', required: false });
    }
    
    // 键盘型号选填
    if ([141].includes(typeId)) {
      fields.push({ key: 'keyboardModel', label: '键盘型号', placeholder: '请填写键盘型号', required: false });
    }
    
    // 电路机械类对应物件型号均选填
    if ([211].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '吹风机型号', placeholder: '请填写吹风机型号', required: false });
    } else if ([221].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '热水壶型号', placeholder: '请填写热水壶型号', required: false });
    } else if ([231, 232].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '自行车型号', placeholder: '请填写自行车型号', required: false });
    } else if ([241].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '收音机型号', placeholder: '请填写收音机型号', required: false });
    } else if ([251].includes(typeId)) {
      fields.push({ key: 'fanModel', label: '电风扇型号', placeholder: '请填写电风扇型号', required: false });
    } else if ([261].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '设备型号', placeholder: '请填写设备型号', required: false });
    }
    
    // value 供输入框展示；每次重新构建字段时都从空开始，避免残留上一次的选择
    return fields.map(field => ({ ...field, value: '' }));
  },


  
  async submitRepair() {
    // 验证必填的特殊字段
    const requiredFields = this.getRequiredFields();
    // 当前问题类型是否需要“笔记本型号”：该栏目选填，但最终信息单必须呈现，未填时提交“未知”
    const needsLaptopModel = requiredFields.some(field => field.key === 'laptopModel');
    for (const field of requiredFields) {
      if (field.required) {
        const value = this.data[field.key];
        if (!value || value.trim() === '') {
          wx.showToast({
            title: `请填写${field.label}`,
            icon: 'none'
          });
          return;
        }
      }
    }

    // 低侵入性注册校验（短超时，不阻塞UI过久）
    // 提前发起校验，与下方订阅消息授权弹窗并行执行，减少提交时串行等待
    const app = getApp();
    const verifyPromise = app && typeof app.verifyUserAccountRemotely === 'function'
      ? app.verifyUserAccountRemotely(1200).catch(() => false)
      : Promise.resolve(false);

    // 请求订阅消息授权
    try {
      const authResult = await SubscriptionAuth.requestApplicantAuth(
        SubscriptionAuth.SCENES.REPAIR_SUBMIT,
        { showTip: true, allowPartialSuccess: true }
      );
      
      console.log('报修页面订阅授权结果:', authResult);
      
      // 即使授权失败也继续提交，不阻断核心业务流程
      if (authResult.success && authResult.analysis.acceptedCount > 0) {
        wx.showToast({
          title: `已授权${authResult.analysis.acceptedCount}个消息通知`,
          icon: 'success',
          duration: 1500
        });
      }
    } catch (error) {
      console.error('订阅授权异常:', error);
      // 授权异常不影响提交流程
    }

    // 等待注册校验结果（该校验已在订阅授权弹窗期间开始执行）
    try {
      const quickCheck = await verifyPromise;
      if (!quickCheck) {
        // 再看本地缓存是否完整
        const localUser = wx.getStorageSync('userInfo');
        const localOpenid = wx.getStorageSync('openid');
        const localIsLogin = wx.getStorageSync('isLogin');
        const hasLocal = !!(localUser && localOpenid && localIsLogin);
        if (!hasLocal) {
          wx.showToast({ title: '请先完成注册', icon: 'none' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/login/index' });
          }, 650);
          return;
        }
      }
    } catch (e) {
      // 校验异常不阻断，但实际未注册仍会被后端拒绝
    }

    wx.showLoading({ title: '正在提交...' });

    try {
      const { 
        selectedCategory, selectedSubcategory,
        appointmentDate, appointmentTime, otherDescription,
        userInfo, tempState,
        laptopModel, phoneModel, laptopSystem, softwareInfo, systemVersion, deviceModel,
        mouseModel, keyboardModel, fanModel
      } = this.data;
      
      const selectedType = tempState.selectedType;

      if (!selectedType) {
        wx.hideLoading();
        wx.showToast({
          title: '类型数据丢失,请重试',
          icon: 'none'
        });
        return;
      }
      
      const res = await api.call('maintenanceTasks', {
        action: 'createMaintenanceTask',
        params: {
          level1: selectedCategory.name,
          level2: selectedSubcategory.name,
          level3: selectedType.name,
          appointmentTime: `${appointmentDate} ${appointmentTime}`,
          otherDescription: otherDescription,
          // 特殊字段信息
          specialFields: {
            // 笔记本型号为选填，未填写时统一提交“未知”，保证信息单上始终有该栏目
            laptopModel: needsLaptopModel ? (String(laptopModel || '').trim() || '未知') : '',
            phoneModel: phoneModel || '',
            laptopSystem: laptopSystem || '',
            softwareInfo: softwareInfo || '',
            systemVersion: systemVersion || '',
            deviceModel: deviceModel || '',
            mouseModel: mouseModel || '',
            keyboardModel: keyboardModel || '',
            fanModel: fanModel || ''
          },
          applicantId: userInfo && userInfo.openid,
          applicantName: userInfo && userInfo.nickName,
          applicantStudentId: (userInfo && userInfo.studentId) || '',
          applicantQqId: (userInfo && userInfo.qqId) || ''
        }
      });

      wx.hideLoading();

      if (res.success) {
        this.goToStep(5);
      } else {
        if (res.code === 401 || /未注册|未找到用户|not registered/i.test(res.message || '')) {
          wx.showToast({ title: '请先注册后再提交', icon: 'none' });
          setTimeout(() => { wx.reLaunch({ url: '/pages/login/index' }); }, 700);
          return;
        }
        wx.showToast({
          title: res.message || '提交失败',
          icon: 'none'
        });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({
        title: '提交异常，请稍后重试',
        icon: 'none'
      });
      console.error('submitRepair error:', err);
    }
  },
  
  goToTodo() {
    wx.navigateTo({
      url: '/pages/user/todo/index'
    });
  },
  
  goToRepair() {
    this.goToStep(0, Object.assign({
      selectedCategory: null,
      selectedSubcategory: null,
      selectedType: null,
      selectedTypeId: null,
      types: [],
      subcategories: [],
      otherDescription: '',
      requiredFields: [],
      detailLines: [],
      tempState: {}
    }, this.specialFieldResetPatch()));
    this.initAppointmentDate();
  },

  goToHome() {
    wx.switchTab({
      url: '/pages/user/profile/index' // 跳转到"我的"页面
    });
  },

  goToCategoryMap() {
    wx.navigateTo({
      url: '/pages/repair/map/index'
    });
  }
});
