// pages/team/maintenance/create/index.js
const app = getApp();
const network = require('../../../../utils/network');
const outbox = require('../../../../utils/outbox');
const api = require('../../../../utils/apiAdapter');
const SubscriptionAuth = require('../../../../utils/subscriptionAuth');
const iconManager = require('../../../../utils/iconManager');
const time = require('../../../../utils/time');

Page({
	/**
	 * 页面的初始数据
	 */
	data: {
		userRole: '',
		userInfo: {},
		// 图标资源
		iconTools: iconManager.get('biz_tools'),
		iconCalendar: iconManager.get('team_calendar'),
		iconUrgent: iconManager.get('biz_urgent'),
		iconEdit: iconManager.get('common_edit'),
		
		// 3级分类数据
		categoryData: {
			'电子数码类': {
				'笔记本类': [
					'笔记本清灰',
					'笔记本电池更换',
					'笔记本加装固态',
					'笔记本C盘清理/磁盘空间管理',
					'笔记本软件安装',
					'笔记本系统重装',
					'笔记本故障检修',
					'笔记本卡顿掉帧',
					'其他（详细描述维修类别）'
				],
				'手机类': [
					'手机屏幕清洁',
					'手机贴膜换膜',
					'其他（详细描述维修类别）'
				],
				'鼠标类': [
					'鼠标故障检修'
				],
				'键盘类': [
					'键盘故障检修'
				],
				'其他': [
					'具体内容'
				]
			},
			'电路机械类': {
				'吹风机类': [
					'吹风机故障维修'
				],
				'热水壶类': [
					'热水壶故障维修'
				],
				'自行车类': [
					'自行车保养维修',
					'自行车故障检修'
				],
				'收音机': [
					'收音机故障检修'
				],
				'电风扇类': [
					'电风扇故障检修'
				],
				'其他': [
					'具体内容'
				]
			},
			'工具借用类': {
				'螺丝刀': [
					'螺丝刀借用'
				],
				'扳手': [
					'扳手借用'
				],
				'打气筒': [
					'打气筒借用'
				],
				'老虎钳': [
					'老虎钳借用'
				],
				'电烙铁': [
					'电烙铁借用'
				],
				'其他': [
					'具体内容'
				]
			}
		},
		
		// 分类选择
		level1Array: [],
		level2Array: [],
		level3Array: [],
		level1Index: 0,
		level2Index: 0,
		level3Index: 0,
		selectedLevel1: '',
		selectedLevel2: '',
		selectedLevel3: '',
		
		// 表单数据
		formData: {
			appointmentDate: '',
			appointmentTime: '', // 将由 initDateRange 动态设置
			isUrgent: 0,
			description: ''
		},
		
		// 日期选择器的起止日期
		startDate: '',
		endDate: '',
		
		// UI状态
		isSubmitting: false
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad(options) {
		// 检查用户角色
		const userRole = app.globalData.role || '';
		const userInfo = app.globalData.userInfo || {};
		
		if (userRole !== 'leader') {
			wx.showToast({
				title: '权限不足',
				icon: 'none'
			});
			setTimeout(() => {
				wx.navigateBack();
			}, 1500);
			return;
		}
		
		// 如果用户信息不完整，尝试重新获取
		if (!userInfo.qqId) {
			this.getUserInfo();
		}

		// 初始化分类数据
		this.initCategoryData();
		
		// 初始化日期范围
		this.initDateRange();
		
		this.setData({
			userRole: userRole,
			userInfo: userInfo
		});
	},

	/**
	 * 初始化日期选择范围
	 */
	initDateRange() {
		const today = new Date();
		const startDate = this.formatDate(today);
		
		// 设置结束日期为30天后
		const endDate = new Date();
		endDate.setDate(today.getDate() + 30);
		const endDateStr = this.formatDate(endDate);
		
		// 计算最早可预约的时间
		const earliestTime = this.getEarliestAppointmentTime();
		
		this.setData({
			startDate: startDate,
			endDate: endDateStr,
			'formData.appointmentDate': earliestTime.date,
			'formData.appointmentTime': earliestTime.time
		});
	},

	/**
	 * 获取最早可预约的时间
	 * 规则：当前时间往后取整到下一个小时
	 */
	getEarliestAppointmentTime() {
		const now = new Date();
		const nextHour = new Date(now);
		
		// 如果当前分钟数不为0，则向上取整到下一个小时
		if (now.getMinutes() > 0 || now.getSeconds() > 0) {
			nextHour.setHours(now.getHours() + 1);
		}
		nextHour.setMinutes(0);
		nextHour.setSeconds(0);
		nextHour.setMilliseconds(0);
		
		// 格式化日期
		const year = nextHour.getFullYear();
		const month = String(nextHour.getMonth() + 1).padStart(2, '0');
		const day = String(nextHour.getDate()).padStart(2, '0');
		const hour = String(nextHour.getHours()).padStart(2, '0');
		
		return {
			date: `${year}-${month}-${day}`,
			time: `${hour}:00`
		};
	},

	/**
	 * 格式化日期为 YYYY-MM-DD
	 */
	formatDate(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	},

	/**
	 * 获取用户信息
	 */
	getUserInfo: async function() {
		try {
			const res = await api.call('users', {
				action: 'getUserInfo'
			});
			
			if (res.success) {
				const userInfo = res.data;
				app.globalData.userInfo = userInfo;
				this.setData({
					userInfo: userInfo
				});
			}
		} catch (error) {
			console.error('获取用户信息失败:', error);
		}
	},

	/**
	 * 初始化分类数据
	 */
	initCategoryData() {
		const categoryData = this.data.categoryData;
		const level1Array = Object.keys(categoryData);
		
		this.setData({
			level1Array: level1Array,
			selectedLevel1: level1Array[0]
		});
		
		// 初始化二级分类
		this.onLevel1Change({
			detail: { value: 0 }
		});
	},

	/**
	 * 一级分类变化
	 */
	onLevel1Change(e) {
		const index = e.detail.value;
		const level1 = this.data.level1Array[index];
		const level2Array = Object.keys(this.data.categoryData[level1]);
		
		this.setData({
			level1Index: index,
			selectedLevel1: level1,
			level2Array: level2Array,
			level2Index: 0,
			selectedLevel2: level2Array[0]
		});
		
		// 初始化三级分类
		this.onLevel2Change({
			detail: { value: 0 }
		});
	},

	/**
	 * 二级分类变化
	 */
	onLevel2Change(e) {
		const index = e.detail.value;
		const level2 = this.data.level2Array[index];
		const level3Array = this.data.categoryData[this.data.selectedLevel1][level2];
		
		this.setData({
			level2Index: index,
			selectedLevel2: level2,
			level3Array: level3Array,
			level3Index: 0,
			selectedLevel3: level3Array[0]
		});
	},

	/**
	 * 三级分类变化
	 */
	onLevel3Change(e) {
		const index = e.detail.value;
		const level3 = this.data.level3Array[index];
		
		this.setData({
			level3Index: index,
			selectedLevel3: level3
		});
	},

	/**
	 * 日期选择确认
	 */
	onDatePickerConfirm(e) {
		const selectedDate = e.detail.value;
		this.setData({
			'formData.appointmentDate': selectedDate
		});
		
		// 验证选择的日期时间是否合法
		this.validateSelectedDateTime(selectedDate, this.data.formData.appointmentTime);
	},

	/**
	 * 时间选择确认
	 */
	onTimePickerConfirm(e) {
		const selectedTime = e.detail.value;
		this.setData({
			'formData.appointmentTime': selectedTime
		});
		
		// 验证选择的时间是否合法
		this.validateSelectedDateTime(this.data.formData.appointmentDate, selectedTime);
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
				'formData.appointmentDate': earliestTime.date,
				'formData.appointmentTime': earliestTime.time
			});
			
			wx.showToast({
				title: '预约时间不能早于当前时间，已自动调整',
				icon: 'none',
				duration: 2000
			});
		}
	},

	/**
	 * 输入框内容变化
	 */
	onInputChange(e) {
		const field = e.currentTarget.dataset.field;
		const value = e.detail.value;
		
		this.setData({
			[`formData.${field}`]: value
		});
	},

	/**
	 * 紧急程度切换
	 */
	onUrgentToggle() {
		this.setData({
			'formData.isUrgent': this.data.formData.isUrgent === 1 ? 0 : 1
		});
	},

	/**
	 * 表单验证
	 */
	validateForm() {
		const { selectedLevel1, selectedLevel2, selectedLevel3, formData } = this.data;
		
		if (!selectedLevel1 || !selectedLevel2 || !selectedLevel3) {
			wx.showToast({
				title: '请选择完整的维修分类',
				icon: 'none'
			});
			return false;
		}
		
		if (!formData.appointmentDate) {
			wx.showToast({
				title: '请选择预约日期',
				icon: 'none'
			});
			return false;
		}
		
		if (!formData.appointmentTime) {
			wx.showToast({
				title: '请选择预约时间',
				icon: 'none'
			});
			return false;
		}
		

		
		return true;
	},



	/**
	 * 提交任务
	 */
	async submitTask() {
		if (!this.validateForm()) return;
		
		if (this.data.isSubmitting) return;
		
		// 请求订阅消息授权
		try {
			const authResult = await SubscriptionAuth.requestApplicantAuth(
				SubscriptionAuth.SCENES.LEADER_CREATE,
				{ showTip: true, allowPartialSuccess: true }
			);
			
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

		this.setData({ isSubmitting: true });
		wx.showLoading({ title: '提交中...' });
		
		try {
			const { selectedLevel1, selectedLevel2, selectedLevel3, formData, userInfo } = this.data;
			
			if (!userInfo || !userInfo.nickName) {
				wx.showToast({
					title: '用户信息不完整，请重新登录',
					icon: 'none'
				});
				this.setData({ isSubmitting: false });
				wx.hideLoading();
				return;
			}
			
			const fullAppointmentTime = `${formData.appointmentDate} ${formData.appointmentTime}`;
			
			const taskData = {
				level1: selectedLevel1,
				level2: selectedLevel2,
				level3: selectedLevel3,
				appointmentTime: fullAppointmentTime,
				isUrgent: formData.isUrgent,
				description: formData.description,
				applicantInfo: {
					nickName: userInfo.nickName || '维修组组长',
					studentId: userInfo.studentId || '',
					qqId: userInfo.qqId || ''
				},
				isManagementCreated: true
			};

			// 离线处理逻辑保持不变
			if (!network.isOnline()) {
				outbox.add('maintenanceTasks', 'createMaintenanceTask', taskData);
				wx.showToast({
					title: '网络不稳，已加入队列',
					icon: 'none',
					duration: 2500
				});
				this.setData({ isSubmitting: false });
				wx.hideLoading();
				return;
			}

			const res = await api.call('maintenanceTasks', {
				action: 'createMaintenanceTask',
				params: taskData
			});

			if (res.success) {
				wx.showToast({
					title: '任务创建成功',
					icon: 'success'
				});

				setTimeout(() => {
					wx.navigateBack();
				}, 1500);
			} else {
				throw new Error(res.message || '创建失败');
			}
			
		} catch (error) {
			console.error('创建任务失败:', error);
			wx.showToast({
				title: error.message || '创建失败，请重试',
				icon: 'none',
				duration: 3000
			});
		} finally {
			wx.hideLoading();
			this.setData({ isSubmitting: false });
		}
	}
}); 