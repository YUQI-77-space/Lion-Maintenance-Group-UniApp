const members = require('./api');
const PROFILE_FIELDS = ['nickName', 'studentId', 'qqId', 'department', 'isEmergencyContact'];

// 详情页内完成编辑，保留版本校验和幂等提交。
module.exports = () => ({
  data: { member: null, form: {}, departments: members.departments, departmentIndex: -1,
    editing: false, removeVisible: false, removeStep: 'reason', roleName: '', loading: true, saving: false, error: '', blockers: [], removeReason: '', reasonValid: false },
  onLoad(options) { this._userId = options.userId; },
  edit() {
    if (this.data.loading || this.data.saving || !this.data.member || !this.data.member.permissions.canEdit) return;
    const form = {};
    PROFILE_FIELDS.forEach(key => { form[key] = this.data.member[key]; });
    this.setData({ editing: true, form, departmentIndex: members.departments.indexOf(form.department), error: '' });
  },
  async closeEdit() {
    if (this.data.saving) return;
    if (PROFILE_FIELDS.some(key => this.data.form[key] !== this.data.member[key])) {
      const result = await wx.showModal({ title: '放弃修改？', content: '当前修改尚未保存，关闭后将丢弃这些修改。', confirmText: '放弃修改', cancelText: '继续编辑' });
      if (!result.confirm || this.data.saving) return;
    }
    this.setData({ editing: false, error: '' });
    this.updateLeaveAlert();
  },
  retry() { this.load(true); },
  onShow() { if (members.checkPermission()) this.load(true); },
  async load(preserveDraft = false) {
    if (!members.checkPermission()) return;
    this.setData({ loading: true, error: '' });
    const result = await members.call('getManagedMemberDetail', { userId: this._userId });
    if (result.success && result.data) {
      const row = result.data;
      const keepDraft = preserveDraft === true && this.data.member && row.version === this.data.member.version && row.permissions.canEdit;
      const form = keepDraft ? this.data.form : { nickName: row.nickName, studentId: row.studentId, qqId: row.qqId,
        department: row.department, isEmergencyContact: row.isEmergencyContact };
      this.setData({ member: row, roleName: members.roles[row.role], departmentIndex: members.departments.indexOf(form.department), form,
        editing: this.data.editing && row.permissions.canEdit,
        removeVisible: this.data.removeVisible && row.permissions.canRemove });
      if (!keepDraft) this._pending = null;
      this.updateLeaveAlert();
    } else if ([401, 403, 404].includes(result.code)) {
      this.setData({ member: null, form: {}, editing: false, removeVisible: false, removeReason: '', reasonValid: false, error: result.message || '无法查看此组员' });
      this.updateLeaveAlert();
    } else this.setData({ error: result.message || '加载失败' });
    this.setData({ loading: false });
  },
  onField(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
    this.updateLeaveAlert();
  },
  onDepartment(e) {
    const index = Number(e.detail.value);
    this.setData({ departmentIndex: index, 'form.department': members.departments[index] });
    this.updateLeaveAlert();
  },
  onEmergency(e) { this.setData({ 'form.isEmergencyContact': e.detail.value }); this.updateLeaveAlert(); },
  updateLeaveAlert() {
    const dirty = this.data.editing && this.data.member && PROFILE_FIELDS.some(key => this.data.form[key] !== this.data.member[key]);
    if (dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '资料尚未保存，确定离开？' });
    else if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },
  onReason(e) { this.setData({ removeReason: e.detail.value, reasonValid: !!e.detail.value.trim(), error: '' }); },
  openRemove() {
    if (this.data.loading || this.data.saving || !this.data.member || !this.data.member.permissions.canRemove) return;
    this.setData({ removeVisible: true, removeStep: 'reason', error: '', blockers: [] });
  },
  closeRemove() {
    if (this.data.saving) return;
    if (this.data.removeStep === 'confirm') this.setData({ removeStep: 'reason' });
    else this.setData({ removeVisible: false, error: '', blockers: [] });
  },
  async save() {
    if (this.data.saving || this.data.loading || !this.data.member || !this.data.member.permissions.canEdit) return;
    const fields = {};
    for (const key of PROFILE_FIELDS) {
      const raw = this.data.form[key];
      const value = typeof raw === 'string' ? raw.trim() : raw;
      if (value !== this.data.member[key]) {
        fields[key] = value;
      }
    }
    if (!Object.keys(fields).length) return wx.showToast({ title: '没有需要保存的变更', icon: 'none' });
    if ('nickName' in fields && !fields.nickName) return wx.showToast({ title: '请填写昵称', icon: 'none' });
    if ('studentId' in fields && !/^[a-zA-Z0-9]{1,32}$/.test(fields.studentId)) return wx.showToast({ title: '学号须为1至32位字母或数字', icon: 'none' });
    if ('qqId' in fields && !/^[0-9]{5,11}$/.test(fields.qqId)) return wx.showToast({ title: 'QQ号须为5至11位数字', icon: 'none' });
    if (this.data.form.isEmergencyContact && !String(this.data.form.qqId || '').trim()) return wx.showToast({ title: '应急联系人需要填写QQ号', icon: 'none' });
    await this.submit('updateManagedMember', { fields });
  },
  async changeRole() {
    if (this.data.loading || this.data.saving || !this.data.member || !this.data.member.permissions.canChangeRole) return;
    const role = this.data.member.role === 'member' ? 'leader' : 'member';
    const confirm = await wx.showModal({ title: '确认调整角色',
      content: `将 ${this.data.member.nickName} 从${this.data.roleName}调整为${members.roles[role]}？`, confirmText: '确认调整' });
    if (confirm.confirm) this.submit('changeMemberRole', { role });
  },
  async remove() {
    if (this.data.loading || this.data.saving || !this.data.member || !this.data.member.permissions.canRemove) return;
    const reason = this.data.removeReason.trim();
    if (!reason) return wx.showToast({ title: '请填写移出原因', icon: 'none' });
    if (this.data.removeStep === 'reason') {
      this.setData({ removeStep: 'confirm', error: '', blockers: [] });
      return;
    }
    await this.submit('removeTeamMember', { reason });
  },
  async submit(action, values) {
    if (this.data.saving || !this.data.member || !members.checkPermission()) return;
    const payload = { userId: this._userId, version: this.data.member.version, ...values };
    const signature = JSON.stringify({ action, payload });
    // 同一份提交在超时后的手动重试沿用请求标识，后端返回已提交结果。
    if (!this._pending || this._pending.signature !== signature) {
      this._pending = { signature, requestId: members.generateRequestId() };
    }
    this.setData({ saving: true, error: '', blockers: [] });
    const result = await members.call(action, { ...payload, _requestId: this._pending.requestId });
    this.setData({ saving: false });
    if (!result.success || !result.data) {
      this.setData({ error: result.message || '保存失败，请重试', blockers: (result.data && result.data.blockers) || [] });
      if (result.code === 409 && !(result.data && result.data.blockers)) {
        const confirm = await wx.showModal({ title: '需要刷新资料', content: result.message + '。刷新会丢弃当前未保存内容。', confirmText: '刷新资料' });
        if (confirm.confirm) { this.setData({ removeVisible: false }); await this.load(); }
      }
      return;
    }
    getApp().publish('membersChanged', { userId: this._userId });
    wx.showToast({ title: result.message || '操作成功', icon: 'success' });
    if (result.data.removed) {
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      wx.navigateBack();
    }
    else {
      if (action === 'updateManagedMember') {
        this.setData({ editing: false });
        this.updateLeaveAlert();
      }
      await this.load();
    }
  }
});
