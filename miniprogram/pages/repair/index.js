const api = require('../../utils/apiAdapter');
const SubscriptionAuth = require('../../utils/subscriptionAuth');
const repairCategories = require('../../utils/repairCategories');
const iconManager = require('../../utils/iconManager');
const time = require('../../utils/time');

Page({
  data: {
    // 导航栏高度
    statusBarHeight: 0,
    navBarHeight: 0,

    // 图标资源
    iconLogo: iconManager.get('common_logo'),
    iconSearch: iconManager.get('common_search'),
    iconArrowRight: iconManager.get('common_arrow_right'),
    iconCheck: iconManager.get('common_check'),
    iconSchedule: iconManager.get('status_schedule'),

    currentStep: 0,
    
    // 问题分类数据
    categories: repairCategories,
    subcategories: [],
    types: [],

    // 搜索相关
    searchKeyword: '',
    searchResults: [],
    showSearchResult: false,
    showQuickKeywords: false,
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
    appointmentDate: '',
    appointmentTime: '',
    startDate: '',
    endDate: '',
    isUrgent: false,
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
    
    // 用户信息
    userInfo: {},
    

    
    // 临时状态，用于在步骤间传递数据
    tempState: {},

    _touchStartX: 0,
    _touchStartY: 0,
    // 动画相关
    pageAnimation: {},
    isAnimating: false,
    themeClass: ''
  },

  onLoad: function (options) {
    // 获取系统信息，设置状态栏高度
    const windowInfo = wx.getWindowInfo();
    const statusBarHeight = windowInfo.statusBarHeight || 20;
    const navBarHeight = statusBarHeight + 44; // 状态栏高度 + 导航栏内容高度(44px)
    
    this.setData({
      statusBarHeight: statusBarHeight,
      navBarHeight: navBarHeight
    });
    
    this.initAnimation();
    this.initAppointmentDate();
    this.loadUserInfo();
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

    // 如果是从维修分类地图返回，并且带有快速定位信息，则直接跳转到对应问题的填写详情页
    try {
      const app = getApp && getApp();
      const quick = app && app.globalData && app.globalData.repairQuickSelect;
      if (quick && quick.categoryId && quick.subcategoryId && quick.typeId) {
        const category = repairCategories.find(c => c.id === quick.categoryId);
        const sub = category && (category.subcategories || []).find(s => s.id === quick.subcategoryId);
        const type = sub && (sub.types || []).find(t => t.id === quick.typeId);
        if (category && sub && type) {
          const requiredFields = this.getRequiredFieldsById(type.id);
          this.setData({
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
            currentStep: 3
          });

          // 笔记本清灰（id: 111）需要温馨提醒
          if (type.id === 111) {
            wx.showModal({
              title: '温馨提醒',
              content: '笔记本清灰需收费30元人工费',
              showCancel: false,
              confirmText: '我知道了',
              confirmColor: '#4A90E2',
              success: () => {
                wx.showToast({
                  title: '已根据地图定位到该问题',
                  icon: 'none',
                  duration: 1000
                });
              }
            });
          } else {
            wx.showToast({
              title: '已根据地图定位到该问题',
              icon: 'none',
              duration: 1000
            });
          }
        }
        // 只使用一次
        app.globalData.repairQuickSelect = null;
      }
    } catch (e) {
      // 任何异常不影响正常流程
    }
  },

  onUnload() {},

  // 页面动画
  initAnimation: function () {
    try {
      const animation = wx.createAnimation({ duration: 0 });
      animation.opacity(1).translateX(0).step();
      this.setData({ pageAnimation: animation.export(), isAnimating: false });
    } catch (e) {}
  },

  animateAndSwitch: function (direction, url) {
    if (this.data.isAnimating) return;
    this.setData({ isAnimating: true });
    try {
      const animation = wx.createAnimation({ duration: 220, timingFunction: 'ease-in-out' });
      const offset = direction === 'left' ? -40 : 40;
      animation.translateX(offset).opacity(0.0).step();
      this.setData({ pageAnimation: animation.export() });
      setTimeout(() => { wx.switchTab({ url }); }, 230);
    } catch (e) { wx.switchTab({ url }); }
  },

  initAppointmentDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = (`0${now.getMonth() + 1}`).slice(-2);
    const day = (`0${now.getDate()}`).slice(-2);
    
    const future = new Date();
    future.setDate(now.getDate() + 30);
    const futureYear = future.getFullYear();
    const futureMonth = (`0${future.getMonth() + 1}`).slice(-2);
    const futureDay = (`0${future.getDate()}`).slice(-2);
    
    // 计算最早可预约的时间
    const earliestTime = this.getEarliestAppointmentTime();
    
    this.setData({
      appointmentDate: earliestTime.date,
      startDate: `${year}-${month}-${day}`,
      endDate: `${futureYear}-${futureMonth}-${futureDay}`,
      appointmentTime: earliestTime.time,
    });
  },

  // 获取最早可预约时间
  getEarliestAppointmentTime() {
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
  },
  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo });
    } else {
      wx.showToast({ title: '请先登录', icon: 'none' });
    }
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
      this.setData({ searchResults: [], showSearchResult: false });
      return;
    }
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
      showQuickKeywords: true
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
    // 失焦后保留输入内容，但收起所有浮层
    this.setData({
      showQuickKeywords: false,
      showSearchResult: false,
      searchResults: []
    });
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
    const requiredFields = this.getRequiredFieldsById(type.id);

    this.setData({
      selectedCategory: cat,
      selectedSubcategory: sub,
      selectedType: type,
      selectedTypeId: type.id,
      types: sub.types || [],
      subcategories: cat.subcategories || [],
      requiredFields,
      tempState: {
        selectedType: type,
        selectedTypeId: type.id
      },
      currentStep: 3,
      // 清空搜索相关状态
      searchKeyword: '',
      searchResults: [],
      showSearchResult: false,
      showQuickKeywords: false
    });

    // 笔记本清灰（id: 111）需要温馨提醒
    if (type.id === 111) {
      wx.showModal({
        title: '温馨提醒',
        content: '笔记本清灰需收费30元人工费',
        showCancel: false,
        confirmText: '我知道了',
        confirmColor: '#4A90E2',
        success: () => {
          wx.showToast({
            title: '已为您定位到该问题',
            icon: 'none',
            duration: 1000
          });
        }
      });
    } else {
      wx.showToast({
        title: '已为您定位到该问题',
        icon: 'none',
        duration: 1000
      });
    }
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
              fullPath: `${cat.name} > ${sub.name} > ${name}`,
              hint: '点击直接跳转到“填写报修详情”'
            });
          }
        });
      });
    });

    if (!results.length) {
      wx.showToast({ title: '未找到相关问题', icon: 'none' });
    }

    this.setData({
      searchResults: results,
      showSearchResult: !!results.length
    });
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

    const requiredFields = this.getRequiredFieldsById(type.id);

    this.setData({
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
      currentStep: 3,
      // 清空搜索相关状态
      searchKeyword: '',
      searchResults: [],
      showSearchResult: false,
      showQuickKeywords: false
    });

    // 笔记本清灰（id: 111）需要温馨提醒
    if (type.id === 111) {
      wx.showModal({
        title: '温馨提醒',
        content: '笔记本清灰需收费30元人工费',
        showCancel: false,
        confirmText: '我知道了',
        confirmColor: '#4A90E2',
        success: () => {
          wx.showToast({
            title: '已为您定位到该问题',
            icon: 'none',
            duration: 1000
          });
        }
      });
    } else {
      wx.showToast({
        title: '已为您定位到该问题',
        icon: 'none',
        duration: 1000
      });
    }
  },
  
  // 步骤控制
  nextStep() {
    let { currentStep, selectedType, selectedTypeId, tempState } = this.data;

    if (currentStep === 2) {
      tempState = { selectedType, selectedTypeId };
      this.setData({
        laptopModel: '',
        phoneModel: '',
        laptopSystem: '',
        softwareInfo: '',
        systemVersion: '',
        deviceModel: '',
        mouseModel: '',
        keyboardModel: '',
        fanModel: ''
      });
    }
    
    // 验证必填字段
    if (currentStep === 3) {
      const requiredFields = this.getRequiredFields();
      for (const field of requiredFields) {
        if (field.required) {
          const value = this.data[field.key];
          if (!value || value.trim() === '') {
            wx.showToast({ title: `请填写${field.label}`, icon: 'none' });
            return;
          }
        }
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
    
    this.setData({
      currentStep: currentStep + 1,
      tempState,
      selectedType,
      selectedTypeId
    });
  },
  
  prevStep() {
    const { currentStep } = this.data;
    let updateData = {
      currentStep: currentStep - 1
    };

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
      updateData.laptopModel = '';
      updateData.phoneModel = '';
      updateData.laptopSystem = '';
      updateData.softwareInfo = '';
      updateData.systemVersion = '';
      updateData.deviceModel = '';
      updateData.mouseModel = '';
      updateData.keyboardModel = '';
      updateData.fanModel = '';
    }

    this.setData(updateData);
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
      requiredFields: this.getRequiredFieldsById(id)
    });

    // 笔记本清灰（id: 111）需要温馨提醒
    if (id === 111) {
      wx.showModal({
        title: '温馨提醒',
        content: '笔记本清灰需收费30元人工费',
        showCancel: false,
        confirmText: '我知道了',
        confirmColor: '#4A90E2'
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
  onUrgentChange(e) {
    this.setData({ isUrgent: e.detail.value });
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
    this.setData({ systemVersion: systemOptions[selectedIndex] });
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
    const value = e.detail.value;
    this.setData({
      [field]: value
    });
  },
  
  // 获取当前选择的问题类型需要的特殊输入字段
  getRequiredFields() {
    return this.getRequiredFieldsById(this.data.selectedTypeId);
  },
  
  // 根据类型ID获取需要的特殊输入字段
  getRequiredFieldsById(typeId) {
    const fields = [];
    
    // 笔记本清灰、电池更换、加装固态、故障检修、卡顿掉帧需要型号
    if ([111, 112, 113, 117, 118].includes(typeId)) {
      fields.push({ key: 'laptopModel', label: '笔记本型号', placeholder: '请填写具体的机型（如拯救者r9000p 2025）', required: true });
    }
    
    // 笔记本C盘清理等需要系统信息
    if ([114].includes(typeId)) {
      fields.push({ key: 'laptopSystem', label: '笔记本系统', placeholder: '请填写笔记本的系统', required: true });
    }
    
    // 笔记本软件安装需要软件信息
    if ([115].includes(typeId)) {
      fields.push({ key: 'softwareInfo', label: '软件信息', placeholder: '请填写想要安装的软件以及版本', required: true });
    }
    
    // 笔记本系统重装需要系统版本（下拉选择）
    if ([116].includes(typeId)) {
      fields.push({ key: 'systemVersion', label: '系统版本', type: 'select', options: ['WIN7', 'WIN10', 'WIN11', 'MAC'], required: true });
    }
    
    // 手机类所有问题需要手机型号
    if ([121, 122, 124].includes(typeId)) {
      fields.push({ key: 'phoneModel', label: '手机型号', placeholder: '请填写手机型号', required: true });
    }
    
    // 鼠标类需要鼠标型号
    if ([131].includes(typeId)) {
      fields.push({ key: 'mouseModel', label: '鼠标型号', placeholder: '请填写鼠标型号', required: true });
    }
    
    // 键盘类需要键盘型号
    if ([141].includes(typeId)) {
      fields.push({ key: 'keyboardModel', label: '键盘型号', placeholder: '请填写键盘型号', required: true });
    }
    
    // 电路机械类需要对应物件型号
    if ([211].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '吹风机型号', placeholder: '请填写吹风机型号', required: true });
    } else if ([221].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '热水壶型号', placeholder: '请填写热水壶型号', required: true });
    } else if ([231, 232].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '自行车型号', placeholder: '请填写自行车型号', required: true });
    } else if ([241].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '收音机型号', placeholder: '请填写收音机型号', required: true });
    } else if ([251].includes(typeId)) {
      fields.push({ key: 'fanModel', label: '电风扇型号', placeholder: '请填写电风扇型号', required: true });
    } else if ([261].includes(typeId)) {
      fields.push({ key: 'deviceModel', label: '设备型号', placeholder: '请填写设备型号', required: true });
    }
    
    return fields;
  },


  
  async submitRepair() {
    // 验证必填的特殊字段
    const requiredFields = this.getRequiredFields();
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

    // 低侵入性注册校验（短超时，不阻塞UI过久）
    try {
      const app = getApp();
      const quickCheck = app && typeof app.verifyUserAccountRemotely === 'function'
        ? await app.verifyUserAccountRemotely(1200)
        : false;
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
        appointmentDate, appointmentTime, isUrgent, otherDescription,
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
      
      // 构建特殊字段信息
      let specialInfo = '';
      if (laptopModel) specialInfo += `笔记本型号：${laptopModel}\n`;
      if (phoneModel) specialInfo += `手机型号：${phoneModel}\n`;
      if (laptopSystem) specialInfo += `笔记本系统：${laptopSystem}\n`;
      if (softwareInfo) specialInfo += `软件信息：${softwareInfo}\n`;
      if (systemVersion) specialInfo += `系统版本：${systemVersion}\n`;
      if (deviceModel) specialInfo += `设备型号：${deviceModel}\n`;
      if (mouseModel) specialInfo += `鼠标型号：${mouseModel}\n`;
      if (keyboardModel) specialInfo += `键盘型号：${keyboardModel}\n`;
      if (fanModel) specialInfo += `电风扇型号：${fanModel}\n`;
      
      const finalDescription = specialInfo + (otherDescription ? `\n其他描述：${otherDescription}` : '');
      
      const res = await api.call('maintenanceTasks', {
        action: 'createMaintenanceTask',
        params: {
          level1: selectedCategory.name,
          level2: selectedSubcategory.name,
          level3: selectedType.name,
          appointmentTime: `${appointmentDate} ${appointmentTime}`,
          isUrgent: isUrgent ? 1 : 0,
          otherDescription: otherDescription,
          // 特殊字段信息
          specialFields: {
            laptopModel: laptopModel || '',
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
        this.setData({ currentStep: this.data.currentStep + 1 });
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
    this.setData({
      currentStep: 0,
      selectedCategory: null,
      selectedSubcategory: null,
      selectedType: null,
      selectedTypeId: null,
      isUrgent: false,
      otherDescription: '',
      tempState: {},
      // 清理特殊字段
      laptopModel: '',
      phoneModel: '',
      laptopSystem: '',
      softwareInfo: '',
      systemVersion: '',
      deviceModel: '',
      mouseModel: '',
      keyboardModel: '',
      fanModel: '',
      requiredFields: []
    });
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