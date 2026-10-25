const loadingFeedback = require('../../../../utils/loading');
// pages/team/ewa/manage/index.js
const api = require('../../../../utils/apiAdapter');
const router = require('../../../../utils/router');

Page({
  behaviors: [require('../../../../utils/pageRefresh')],

  /**
   * 页面的初始数据
   */
  data: {
    hasPermission: false,
    loading: true,
    loadError: '',
    exporting: false,
    updatingEW: false,
    savingEW: false,
    showDataMenu: false,
    focusField: '',
    users: [],
    showEditModal: false,
    editUser: {
      ewaUserId: '',
      ewaUserName: '',
      maintenanceEW: 0,
      dutyEW: 0,
      volunteerEW: 0,
      totalEW: 0
    },
    showAllRankings: false,  // 是否展开显示全部排名
    _cacheKey: 'ewa_manage_cache_v1',
    _lastLoadedAt: 0,
    // 分页与加载控制
    page: 1,
    pageSize: 30,
    totalCount: 0,
    hasMore: true,
    loadingMore: false,
    _isFetching: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.setData({ _cacheKey: `ewa_manage_cache_v3:${getApp().globalData.openid || ''}:${getApp().globalData.role || 'user'}` });
    this.checkUserPermission()
    if (!this.data.hasPermission) return;
    // 先尝试读取缓存，提升首屏速度
    try {
      const cached = wx.getStorageSync(this.data._cacheKey)
      if (cached && cached.users && Array.isArray(cached.users)) {
        this.setData({
          users: cached.users,
          totalCount: typeof cached.totalCount === 'number' ? cached.totalCount : cached.users.length,
          hasMore: cached.users.length < cached.totalCount,
          page: cached.page || 1,
          pageSize: cached.pageSize || 30,
          _lastLoadedAt: cached.timestamp || 0,
          loading: false
        })
      }
    } catch (e) { /* ignore */ }
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    if (this.data.hasPermission) {
      // 避免频繁刷新：1分钟内复用缓存
      const now = Date.now()
      if (!this.data._lastLoadedAt || (now - this.data._lastLoadedAt > 60 * 1000)) {
        this.setData({ page: 1, hasMore: true })
        this.fetchUsers({ page: 1, pageSize: this.data.pageSize })
      }
    }
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    this.closeDataMenu();
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    this._unloaded = true;
    this._pendingFetch = null;
  },

  preventMove() {},

  /** 无权限时回到上一页 */
  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  /** 数据操作菜单：选择后先收起，再进入既有业务流程。 */
  toggleDataMenu() {
    if (!this.data.hasPermission || this.data.updatingEW || this.data.exporting) return;
    this.setData({ showDataMenu: !this.data.showDataMenu });
  },

  closeDataMenu() {
    this.setData({ showDataMenu: false });
  },

  onDataMenuAction(e) {
    this.closeDataMenu();
    if (!this.data.hasPermission || this.data.updatingEW || this.data.exporting) return;
    const action = e.currentTarget.dataset.action;
    if (action === 'refresh') this.updateAllEW();
    if (action === 'export') this.exportEWData();
  },

  /** 调整抽屉的焦点外观 */
  onFieldFocus(e) {
    this.setData({ focusField: (e.currentTarget.dataset || {}).field || '' })
  },

  onFieldBlur() {
    this.setData({ focusField: '' })
  },

  /**
   * 检查用户权限
   */
  checkUserPermission() {
    // 修复权限验证逻辑：role和userInfo是分别存储的
    const app = getApp()
    const role = app.globalData.role || wx.getStorageSync('role') || 'user'
    
    
    if (role === 'leader') {
      this.setData({ hasPermission: true })
      
    } else {
      
      wx.showToast({
        title: '抱歉，只有组长才能访问该页面',
        icon: 'none',
        duration: 2000
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 2000)
    }
  },

  /**
   * 获取用户列表
   */
  fetchUsers: async function(opts = {}) {
    const page = typeof opts.page === 'number' ? opts.page : 1
    const pageSize = typeof opts.pageSize === 'number' ? opts.pageSize : this.data.pageSize
    const append = !!opts.append
    if (this.data._isFetching) {
      if (!append) this._pendingFetch = opts;
      return;
    }
    if (this._unloaded) return;
    this.setData({ _isFetching: true, loading: !append, loadingMore: append, loadError: '' });
    try {
      const result = await api.call('equivalentWorkloadAssessment', {
        action: 'getRanking',
        params: {
          page,
          pageSize,
          sortField: 'totalEW',
          sortOrder: 'desc',
          includeUserRanking: false
        }
      });
      if (this._unloaded || this._pendingFetch) return;
      if (result.success && result.data && Array.isArray(result.data.list)) {
        const { list = [], total = 0 } = result.data;
        const merged = append ? (this.data.users || []).concat(list) : list
        this.setData({
          users: merged,
          totalCount: total,
          page: page,
          pageSize: pageSize,
          hasMore: merged.length < total,
          _lastLoadedAt: Date.now()
        });
        // 写入缓存
        try {
          wx.setStorageSync(this.data._cacheKey, {
            users: merged,
            totalCount: total, page, pageSize,
            timestamp: Date.now()
          })
        } catch (e) { /* ignore */ }
      } else {
        this.setData({ loadError: result.message || '获取成员排名失败，请重试' });
      }
    } catch (err) {
      console.error('获取用户列表失败', err);
      if (!this._unloaded) this.setData({ loadError: '获取成员排名失败，请重试' });
    } finally {
      if (!this._unloaded) {
        this.setData({ loading: false, loadingMore: false, _isFetching: false });
        this.setData({ unifiedRefreshing: false });
        const pending = this._pendingFetch;
        this._pendingFetch = null;
        if (pending) this.fetchUsers(pending);
      }
    }
  },

  /**
   * 编辑用户工作量
   */
  editUserEW(e) {
    const userId = e.currentTarget.dataset.userId
    const user = this.data.users.find(u => u.ewaUserId === userId)
    
    if (user) {
      this.setData({
        editOriginal: { ...user },
        editUser: {
          ewaUserId: user.ewaUserId,
          ewaUserName: user.nickName || user.ewaUserName || '未命名成员',
          maintenanceEW: user.maintenanceEW === null || user.maintenanceEW === undefined ? '' : user.maintenanceEW,
          dutyEW: user.dutyEW === null || user.dutyEW === undefined ? '' : user.dutyEW,
          volunteerEW: user.volunteerEW === null || user.volunteerEW === undefined ? '' : user.volunteerEW,
          totalEW: user.totalEW === null || user.totalEW === undefined ? '' : user.totalEW
        },
        showEditModal: true
      })
    }
  },

  /**
   * 隐藏编辑弹窗
   */
  hideEditModal() {
    if (this.data.savingEW) return;
    this.setData({ showEditModal: false })
  },

  /**
   * 维修工作量输入
   */
  onMaintenanceEWInput(e) {
    const input = e.detail.value
    if (input === '') {
      this.setData({ 'editUser.maintenanceEW': '' })
      return
    }
    let value = Number(input)
    if (isNaN(value) || value < 0) value = 0
    if (value > 300) {
      value = 300
      wx.showToast({ title: '单项上限为300', icon: 'none' })
    }
    this.setData({ 'editUser.maintenanceEW': value })
  },
  
  /**
   * 值班工作量输入
   */
  onDutyEWInput(e) {
    const input = e.detail.value
    if (input === '') {
      this.setData({ 'editUser.dutyEW': '' })
      return
    }
    let value = Number(input)
    if (isNaN(value) || value < 0) value = 0
    if (value > 300) {
      value = 300
      wx.showToast({ title: '单项上限为300', icon: 'none' })
    }
    this.setData({ 'editUser.dutyEW': value })
  },
  
  /**
   * 志愿工作量输入
   */
  onVolunteerEWInput(e) {
    const input = e.detail.value
    if (input === '') {
      this.setData({ 'editUser.volunteerEW': '' })
      return
    }
    let value = Number(input)
    if (isNaN(value) || value < 0) value = 0
    if (value > 300) {
      value = 300
      wx.showToast({ title: '单项上限为300', icon: 'none' })
    }
    this.setData({ 'editUser.volunteerEW': value })
  },
  
  /**
   * 保存用户工作量
   */
  async saveUserEW() {
    if (this.data.savingEW) return;
    this.setData({ savingEW: true });
    try { return await this._performSaveUserEW(); }
    finally { this.setData({ savingEW: false }); }
  },
  async _performSaveUserEW() {
    const { ewaUserId } = this.data.editUser;
    let maintenanceEW = require('../../../../utils/ewaDisplay').number(this.data.editUser.maintenanceEW);
    let dutyEW = require('../../../../utils/ewaDisplay').number(this.data.editUser.dutyEW);
    let volunteerEW = require('../../../../utils/ewaDisplay').number(this.data.editUser.volunteerEW);
    
    // 只做基本的单项上限验证，具体的总EW计算和验证交给后端
    if ([maintenanceEW, dutyEW, volunteerEW].some(value => !Number.isFinite(value) || value < 0 || value > 300)) {
      wx.showToast({ title: '请完整填写三科数值，范围0至300', icon: 'none' });
      return;
    }
    
    const old = this.data.editOriginal || {};
    const format = require('../../../../utils/ewaDisplay').format;
    const confirmation = await wx.showModal({ title: '核对工作量调整',
      content: `${this.data.editUser.ewaUserName}\n维修 ${format(old.maintenanceEW)} → ${maintenanceEW}\n志愿 ${format(old.volunteerEW)} → ${volunteerEW}\n值班 ${format(old.dutyEW)} → ${dutyEW}\n总分保存后由服务端重新计算。`, confirmText: '保存调整', cancelText: '返回修改' });
    if (!confirmation.confirm) return;
    loadingFeedback.show({ title: '保存中...' });
    
    try {
      const res = await api.call('equivalentWorkloadAssessment', {
        action: 'updateUserEW',
        config: { retries: 0 },
        params: {
          userId: ewaUserId,
          maintenanceEW,
          dutyEW,
          volunteerEW
        }
      });
      if (res.success) {
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        // 保存成功后，重新从后端获取最新的计算结果
        this.setData({ showEditModal: false });
        await this.fetchUsers({ page: 1, pageSize: this.data.pageSize });
      } else {
        wx.showToast({ title: res.message || '保存失败', icon: 'none' });
      }
    } catch (err) {
      console.error('保存失败', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      loadingFeedback.hide();
    }
  },

  /**
   * 更新所有用户工作量数据
   */
  updateAllEW() {
    wx.showModal({
      title: '更新数据',
      content: '确定要更新所有用户的工作量数据吗？',
      success: async (res) => {
        if (res.confirm) {
          if (this.data.updatingEW) return;
          this.setData({ updatingEW: true });
          loadingFeedback.show({ title: '更新中...' });
          
          try {
            // 更新工作量数据
            const ewResult = await api.call('equivalentWorkloadAssessment', {
              action: 'updateSummary', config: { retries: 0 },
              params: {}
            });
            
            if (!ewResult.success) {
              throw new Error(ewResult.message || '更新工作量失败');
            }
            
            wx.showToast({
              title: '更新成功',
              icon: 'success'
            });
            this.fetchUsers({ page: 1, pageSize: this.data.pageSize });
            this.setData({ unifiedScrollTop: 1 }, () => this.setData({ unifiedScrollTop: 0 }));
          } catch (err) {
            console.error('更新失败', err);
            wx.showToast({
              title: err.message || '更新失败',
              icon: 'none'
            });
          } finally {
            this.setData({ updatingEW: false });
            loadingFeedback.hide();
          }
        }
      }
    });
  },

  /**
   * 导出工作量数据
   */
  exportEWData: async function() {
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    loadingFeedback.show({ title: '准备导出...' });
    
    try {
      const res = await api.call('equivalentWorkloadAssessment', {
        action: 'exportExcel',
        params: {}
      });

      if (res.success) {
        const { fileUrl, fileName } = res.data || {};
        if (!fileUrl) throw new Error('导出结果缺少文件链接');
        
        loadingFeedback.show({ title: '正在下载...' });
        
        wx.downloadFile({
          url: fileUrl,
          complete: () => this.setData({ exporting: false }),
          success: (downloadRes) => {
            loadingFeedback.hide();
            
            wx.openDocument({
              filePath: downloadRes.tempFilePath,
              showMenu: true,
              fileType: 'xlsx',
              fail: (openErr) => {
                console.error('打开文件失败', openErr);
                wx.showModal({
                  title: '文件已下载',
                  content: '文件已下载，但无法自动打开。是否复制下载链接？',
                  confirmText: '复制链接',
                  success: (modalRes) => {
                    if (modalRes.confirm) {
                      wx.setClipboardData({
                        data: fileUrl,
                        success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
                      });
                    }
                  }
                });
              }
            });
          },
          fail: (downloadErr) => {
            loadingFeedback.hide();
            console.error('下载文件失败', downloadErr);
            wx.showModal({
              title: '下载失败',
              content: '无法直接下载文件，是否复制下载链接？',
              success: (res) => {
                if (res.confirm) {
                  wx.setClipboardData({
                    data: fileUrl,
                    success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
                  });
                }
              }
            });
          }
        });
      } else {
        this.setData({ exporting: false });
        loadingFeedback.hide();
        wx.showToast({
          title: res.message || '导出失败',
          icon: 'none'
        });
      }
    } catch (err) {
      this.setData({ exporting: false });
      console.error('导出失败', err);
      loadingFeedback.hide();
      wx.showToast({
        title: '导出失败',
        icon: 'none'
      });
    }
  },

  /**
   * 切换排名展开/收起
   */
  toggleRankings() {
    const target = !this.data.showAllRankings
    this.setData({ showAllRankings: target })
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.closeDataMenu();
    if (!this.data.hasPermission) { this.setData({ unifiedRefreshing: false }); return; }
    return this.fetchUsers({ page: 1, pageSize: this.data.pageSize, append: false });
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (!this.data.hasPermission) return
    if (!this.data.showAllRankings) return
    if (!this.data.hasMore) return
    if (this.data._isFetching || this.data.loadingMore) return
    const nextPage = (this.data.page || 1) + 1
    const currentCount = (this.data.users || []).length
    if (typeof this.data.totalCount === 'number' && currentCount >= this.data.totalCount) {
      this.setData({ hasMore: false })
      return
    }
    this.fetchUsers({
      page: nextPage,
      pageSize: this.data.pageSize,
      append: true
    })
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})