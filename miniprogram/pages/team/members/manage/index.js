const members = require('../api');
const router = require('../../../../utils/router');
Page({
  data: { keyword: '', departments: ['全部部门', ...members.departments], departmentIndex: 0,
    roles: ['全部角色', '组员', '组长', '管理员'], roleIndex: 0,
    items: [], total: 0, page: 1, pageSize: 20, hasMore: true, loading: false,
    loadingMore: false, refresherTriggered: false, error: '' },
  onShow() { if (members.checkPermission()) this.load(true); },
  onUnload() { clearTimeout(this._searchTimer); this._generation = (this._generation || 0) + 1; },
  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    clearTimeout(this._searchTimer);
    // 输入即废弃旧请求，避免旧结果覆盖新搜索。
    this._generation = (this._generation || 0) + 1;
    this._searchTimer = setTimeout(() => this.load(true), 350);
  },
  onDepartment(e) { this.setData({ departmentIndex: Number(e.detail.value) }); this.load(true); },
  onRole(e) { this.setData({ roleIndex: Number(e.detail.value) }); this.load(true); },
  onSearchConfirm() { clearTimeout(this._searchTimer); this.load(true); },
  clearSearch() { clearTimeout(this._searchTimer); this.setData({ keyword: '' }); this.load(true); },
  resetFilters() { clearTimeout(this._searchTimer); this.setData({ departmentIndex: 0, roleIndex: 0 }); this.load(true); },
  resetSearch() { clearTimeout(this._searchTimer); this.setData({ keyword: '', departmentIndex: 0, roleIndex: 0 }); this.load(true); },
  onRefresherRefresh() { this.load(true); },
  onLoadMore() { if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) this.load(false); },
  async load(reset = true) {
    if (!members.checkPermission()) return;
    const generation = this._generation = (this._generation || 0) + 1;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: reset, loadingMore: !reset, error: '', ...(reset ? { items: [], total: 0 } : {}) });
    const result = await members.call('getManagedMembers', { keyword: this.data.keyword.trim(),
      department: this.data.departmentIndex ? members.departments[this.data.departmentIndex - 1] : '',
      role: ['', 'member', 'leader', 'admin'][this.data.roleIndex], page, pageSize: this.data.pageSize });
    if (generation !== this._generation) return;
    if (result.success && result.data) {
      const items = result.data.items.map(row => ({ ...row, roleName: members.roles[row.role] }));
      this.setData({ items: reset ? items : [...this.data.items, ...items], total: result.data.total,
        page, hasMore: result.data.hasMore });
    } else this.setData({ error: result.message || '加载失败，请重试',
      ...([401, 403].includes(result.code) ? { items: [], total: 0 } : {}) });
    this.setData({ loading: false, loadingMore: false, refresherTriggered: false });
  },
  retry() { this.load(this.data.page === 1 || !this.data.items.length); },
  openDetail(e) { router.teamRouter.toMemberDetail(e.currentTarget.dataset.id); }
});
