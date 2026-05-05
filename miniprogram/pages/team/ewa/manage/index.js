// pages/team/ewa/manage/index.js
const api = require('../../../../utils/apiAdapter');
const iconManager = require('../../../../utils/iconManager');

Page({

  /**
   * 页面的初始数据
   */
  data: {
    hasPermission: false,
    loading: true,
    searchText: '',
    users: [],
    filteredUsers: [],
    // 图标资源
    iconLock: iconManager.get('status_lock'),
    iconSearch: iconManager.get('common_search'),
    iconClose: iconManager.get('common_close'),
    iconRanking: iconManager.get('status_ranking'),
    iconEdit: iconManager.get('common_edit'),
    iconEmpty: iconManager.get('common_empty'),
    summaryData: {
      totalUsers: 0,
      totalEW: 0,
      totalMaintenanceEW: 0,
      totalDutyEW: 0,
      totalVolunteerEW: 0
    },
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
   * 格式化EW数值为最多2位小数（智能显示：整数不补零，超过2位小数则截断）
   */
  formatEW(value) {
    if (value === null || value === undefined || isNaN(value)) {
      return '0'
    }
    const num = Number(value)
    // 如果是整数，直接返回整数
    if (num % 1 === 0) {
      return num.toString()
    }
    // 如果有小数，最多保留2位，去除尾随零
    return Number(num.toFixed(2)).toString()
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.checkUserPermission()
    // 先尝试读取缓存，提升首屏速度
    try {
      const cached = wx.getStorageSync(this.data._cacheKey)
      if (cached && cached.users && Array.isArray(cached.users)) {
        this.setData({
          users: cached.users,
          filteredUsers: cached.users,
          summaryData: cached.summaryData || this.data.summaryData,
          _lastLoadedAt: cached.timestamp || 0,
          loading: false
        })
      }
    } catch (e) { /* ignore */ }
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

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

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 检查用户权限
   */
  checkUserPermission() {
    // 修复权限验证逻辑：role和userInfo是分别存储的
    const app = getApp()
    const role = app.globalData.role || wx.getStorageSync('role') || 'user'
    
    
    if (role === 'leader') {
      this.setData({ hasPermission: true, loading: false })
      
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
    const search = typeof opts.search === 'string' ? opts.search.trim() : ''
    const append = !!opts.append
    if (this.data._isFetching) return
    this.setData({ _isFetching: true, loading: !append, loadingMore: append });
    try {
      const result = await api.call('equivalentWorkloadAssessment', {
        action: 'getRanking',
        params: {
          page,
          pageSize,
          sortField: 'totalEW',
          sortOrder: 'desc',
          includeUserRanking: false,
          search
        }
      });
      if (result.success) {
        const { list = [], total = 0 } = result.data || {};
        const merged = append ? (this.data.users || []).concat(list) : list
        // 汇总基于当前已加载的数据
        let totalEW = 0;
        let totalMaintenanceEW = 0;
        let totalDutyEW = 0;
        let totalVolunteerEW = 0;
        merged.forEach(item => {
          totalEW += item.totalEW || 0;
          totalMaintenanceEW += item.maintenanceEW || 0;
          totalDutyEW += item.dutyEW || 0;
          totalVolunteerEW += item.volunteerEW || 0;
        });
        this.setData({
          users: merged,
          filteredUsers: merged,
          summaryData: {
            totalUsers: merged.length,
            totalEW,
            totalMaintenanceEW,
            totalDutyEW,
            totalVolunteerEW
          },
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
            summaryData: this.data.summaryData,
            timestamp: Date.now()
          })
        } catch (e) { /* ignore */ }
      } else {
        wx.showToast({ title: result.message || '获取用户列表失败', icon: 'none' });
      }
    } catch (err) {
      console.error('获取用户列表失败', err);
      wx.showToast({ title: '获取用户列表失败', icon: 'none' });
    } finally {
      this.setData({ loading: false, loadingMore: false, _isFetching: false });
      wx.stopPullDownRefresh();
    }
  },

  /**
   * 搜索输入事件
   */
  onSearchInput(e) {
    const searchText = e.detail.value.trim()
    this.setData({ searchText })
    // 简单防抖处理
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
    }
    this._searchTimer = setTimeout(() => {
      if (!searchText) {
        // 清空搜索，回到默认列表
        const pageSize = this.data.showAllRankings ? 100 : 30
        this.setData({ page: 1, pageSize, hasMore: true })
        this.fetchUsers({ page: 1, pageSize, append: false })
      } else {
        // 服务端搜索，减少前端处理与数据量
        const pageSize = this.data.showAllRankings ? 100 : 30
        this.setData({ page: 1, pageSize, hasMore: true })
        this.fetchUsers({ page: 1, pageSize, search: searchText, append: false })
      }
      this._searchTimer = null
    }, 200)
  },

  /**
   * 清除搜索
   */
  clearSearch() {
    this.setData({
      searchText: '',
      filteredUsers: this.data.users
    })
    const pageSize = this.data.showAllRankings ? 100 : 30
    this.setData({ page: 1, pageSize, hasMore: true })
    this.fetchUsers({ page: 1, pageSize, append: false })
  },

  /**
   * 过滤用户
   */
  filterUsers(text) {
    if (!text) {
      this.setData({ filteredUsers: this.data.users })
      return
    }
    
    const filtered = this.data.users.filter(user => {
      return (
        (user.nickName && user.nickName.includes(text)) ||
        (user.ewaUserName && user.ewaUserName.includes(text))
      )
    })
    
    // 保持按工作量排序
    filtered.sort((a, b) => (b.totalEW || 0) - (a.totalEW || 0))
    
    this.setData({ filteredUsers: filtered })
  },

  /**
   * 编辑用户工作量
   */
  editUserEW(e) {
    const userId = e.currentTarget.dataset.userId
    const user = this.data.users.find(u => u.ewaUserId === userId)
    
    if (user) {
      this.setData({
        editUser: {
          ewaUserId: user.ewaUserId,
          ewaUserName: user.ewaUserName,
          maintenanceEW: user.maintenanceEW || 0,
          dutyEW: user.dutyEW || 0,
          volunteerEW: user.volunteerEW || 0,
          totalEW: user.totalEW || 0
        },
        showEditModal: true
      })
    }
  },

  /**
   * 隐藏编辑弹窗
   */
  hideEditModal() {
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
    let value = parseInt(input)
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
    let value = parseInt(input)
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
    let value = parseInt(input)
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
  saveUserEW: async function() {
    const { ewaUserId } = this.data.editUser;
    let maintenanceEW = parseInt(this.data.editUser.maintenanceEW);
    let dutyEW = parseInt(this.data.editUser.dutyEW);
    let volunteerEW = parseInt(this.data.editUser.volunteerEW);
    maintenanceEW = isNaN(maintenanceEW) ? 0 : maintenanceEW;
    dutyEW = isNaN(dutyEW) ? 0 : dutyEW;
    volunteerEW = isNaN(volunteerEW) ? 0 : volunteerEW;
    
    // 只做基本的单项上限验证，具体的总EW计算和验证交给后端
    if (maintenanceEW > 300 || dutyEW > 300 || volunteerEW > 300) {
      wx.showToast({ title: '单项上限为300', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    try {
      const res = await api.call('equivalentWorkloadAssessment', {
        action: 'updateUserEW',
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
        this.hideEditModal();
        await this.fetchUsers();
      } else {
        wx.showToast({ title: res.message || '保存失败', icon: 'none' });
      }
    } catch (err) {
      console.error('保存失败', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
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
          wx.showLoading({ title: '更新中...' });
          
          try {
            // 更新工作量数据
            const ewResult = await api.call('equivalentWorkloadAssessment', {
              action: 'updateSummary',
              params: {}
            });
            
            if (!ewResult.success) {
              throw new Error(ewResult.message || '更新工作量失败');
            }
            
            wx.showToast({
              title: '更新成功',
              icon: 'success'
            });
            this.fetchUsers();
            
          } catch (err) {
            console.error('更新失败', err);
            wx.showToast({
              title: err.message || '更新失败',
              icon: 'none'
            });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  /**
   * 导出工作量数据
   */
  exportEWData: async function() {
    wx.showLoading({ title: '准备导出...' });
    
    try {
      const res = await api.call('equivalentWorkloadAssessment', {
        action: 'exportExcel',
        params: {}
      });

      if (res.success) {
        const { fileUrl, fileName } = res.data;
        
        wx.showLoading({ title: '正在下载...' });
        
        wx.downloadFile({
          url: fileUrl,
          success: (downloadRes) => {
            wx.hideLoading();
            
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
            wx.hideLoading();
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
        wx.hideLoading();
        wx.showToast({
          title: res.message || '导出失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('导出失败', err);
      wx.hideLoading();
      wx.showToast({
        title: '导出失败',
        icon: 'none'
      });
    }
  },

  /**
   * 跳转到数据汇总页
   */
  goToSummary() {
    wx.navigateTo({ url: '/pages/team/ewa/summary/index' })
  },

  /**
   * 切换排名展开/收起
   */
  toggleRankings() {
    const target = !this.data.showAllRankings
    this.setData({ showAllRankings: target })
    // 展开时尽量加载更多数据
    if (target) {
      const pageSize = 100
      this.setData({ page: 1, pageSize, hasMore: true })
      this.fetchUsers({ page: 1, pageSize, search: this.data.searchText, append: false })
    } else {
      const pageSize = 30
      this.setData({ page: 1, pageSize, hasMore: true })
      this.fetchUsers({ page: 1, pageSize, search: this.data.searchText, append: false })
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    if (!this.data.hasPermission) {
      wx.stopPullDownRefresh()
      return
    }

    // 下拉刷新时：先让云端重新计算所有成员EW，再拉取最新排行榜
    api.call('equivalentWorkloadAssessment', {
      action: 'updateSummary',
      params: {}
    })
      .catch((err) => {
        console.error('[ewa-manage] 下拉刷新触发 updateSummary 失败:', err)
        wx.showToast({ title: '重算EW失败，请稍后重试', icon: 'none' })
      })
      .finally(() => {
        this.setData({ page: 1, hasMore: true })
        this.fetchUsers({
          page: 1,
          pageSize: this.data.pageSize,
          search: this.data.searchText,
          append: false
        })
      })
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (!this.data.hasPermission) return
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
      search: this.data.searchText,
      append: true
    })
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})