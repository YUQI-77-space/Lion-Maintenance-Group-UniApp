const repairCategories = require('../../../utils/repairCategories');

Page({
  data: {
    categories: [],
    expandedCategories: {},
    expandedSubcategories: {}
  },

  onLoad() {
    const categories = repairCategories || [];
    const expandedCategories = {};
    const expandedSubcategories = {};
    // 默认全部展开，便于浏览
    categories.forEach(cat => {
      expandedCategories[cat.id] = true;
      (cat.subcategories || []).forEach(sub => {
        expandedSubcategories[sub.id] = true;
      });
    });
    this.setData({ categories, expandedCategories, expandedSubcategories });
  },

  toggleCategory(e) {
    const id = e.currentTarget.dataset.id;
    const expanded = this.data.expandedCategories;
    expanded[id] = !expanded[id];
    this.setData({ expandedCategories: expanded });
  },

  toggleSubcategory(e) {
    const id = e.currentTarget.dataset.id;
    const expanded = this.data.expandedSubcategories;
    expanded[id] = !expanded[id];
    this.setData({ expandedSubcategories: expanded });
  },

  // 地图中点击具体三级问题，跳转到报修页并带上三级信息
  onTypeTap(e) {
    const catId = e.currentTarget.dataset.catId;
    const subId = e.currentTarget.dataset.subId;
    const typeId = e.currentTarget.dataset.typeId;

    const category = this.data.categories.find(c => c.id === catId);
    if (!category) return;
    const sub = (category.subcategories || []).find(s => s.id === subId);
    if (!sub) return;
    const type = (sub.types || []).find(t => t.id === typeId);
    if (!type) return;

    // 将选择的信息暂存到全局，供报修页读取
    const app = getApp && getApp();
    if (app) {
      app.globalData = app.globalData || {};
      app.globalData.repairQuickSelect = {
        categoryId: catId,
        subcategoryId: subId,
        typeId
      };
    }

    wx.navigateBack({
      delta: 1
    });
  }
});


