const avatarManager = require('./utils/avatarManager');
const network = require('./utils/network');
const outbox = require('./utils/outbox');
const api = require('./utils/apiAdapter');

App({
	onLaunch: function () {
		// 版本更新检查（静默下载 + 弹窗引导重启）
		this.checkForUpdate();

		if (!wx.cloud) {
			console.error('请使用 2.2.3 或以上的基础库以使用云能力');
		} else {
			wx.cloud.init({
				env: 'maintenance-group-2e9wxm620047ff',
				traceUser: true,
			});
		}

		this.globalData.theme = 'light';
		this.configureLogging();
		network.initNetworkListener();
		this.handleGlobalErrors();
		this._events = {};

		// 内部状态：单航班与TTL缓存（性能优化，不改变业务行为）
		this._verifyUserPromise = null;
		this._verifyCacheUntil = 0;
		this._unreadPromise = null;
		this._lastUnreadAt = 0;
		this._lastUnreadVal = 0;
		this._todoPromise = null;
		this._lastTodoAt = 0;
		this._lastTodoVal = 0;
		this._startupBgPrefetched = false;

		// 使用本地缓存进行非阻塞的自动登录检查，真正的路由判断交由启动页处理
		this.autoCheckLoginStatus();

		try { outbox.startAuto && outbox.startAuto(); } catch (e) {}
	},

	// 预取启动页背景图（云存储 → 临时URL → 预热缓存），不阻塞主流程
	prefetchStartupBackground: function() {
		if (this._startupBgPrefetched) return;
		this._startupBgPrefetched = true;
		try {
				const cloudPath = 'cloud://maintenance-group-2e9wxm620047ff.6d61-maintenance-group-2e9wxm620047ff-1361944291/startup/1.png';
				if (!wx.cloud || !wx.cloud.getTempFileURL) return;

				wx.cloud.getTempFileURL({
					fileList: [cloudPath],
					success: (res) => {
						const file = (res && res.fileList && res.fileList[0]) || {};
						const url = file.tempFileURL || '';
						if (!url) return;

						// 预热图片缓存，避免首屏显示延迟
						wx.getImageInfo({
							src: url,
							success: () => {
								this.globalData.startupBgUrl = url;
								try { this.publish('startupBgReady', url); } catch (e) {}
							},
							fail: () => {
								// 即便失败，也设置 URL 以便页面直接加载
								this.globalData.startupBgUrl = url;
								try { this.publish('startupBgReady', url); } catch (e) {}
							}
						});
					},
					fail: (err) => {
						console.warn('获取启动页背景临时链接失败:', err && err.errMsg);
					}
				});
			} catch (e) {
				console.warn('prefetchStartupBackground 异常:', e && e.message);
			}
		},

	// 小程序显示（从后台进入前台）
	onShow: function(options) {
		console.log('小程序进入前台');
		// 🎵 小程序回到前台时，不自动恢复播放
		// 让用户在音乐播放器页面手动控制播放
	},

	// 版本更新检查
	checkForUpdate: function() {
		if (!wx.canIUse('getUpdateManager')) return;

		const updateManager = wx.getUpdateManager();

		updateManager.onCheckForUpdate(function(res) {
			if (res.hasUpdate) {
				console.log('发现新版本，等待下载...');
			}
		});

		updateManager.onUpdateReady(function() {
			wx.showModal({
				title: '更新提示',
				content: '小维已经有了新的版本，吃个蛋挞然后赶紧更新吧！',
				showCancel: false,
				confirmText: '知道了',
				success: function() {
					updateManager.applyUpdate();
				}
			});
		});

		updateManager.onUpdateFailed(function() {
			var self = this;
			wx.showModal({
				title: '更新失败',
				content: '新版本下载失败，请检查网络后重试',
				confirmText: '重试',
				cancelText: '取消',
				success: function(res) {
					if (res.confirm) {
						self.checkForUpdate();
					}
				}
			});
		});
	},

	// 小程序隐藏（从前台进入后台）
	onHide: function() {
		console.log('小程序进入后台');
		// 注意：此时不再主动调用 pause，避免后台权限导致的 access denied 报错。
		// 未开启后台音频能力时，系统会自动暂停前台音频；回到前台后由用户手动恢复。
	},

	// 页面不存在处理
	onPageNotFound: function(res) {
		console.error('页面不存在:', res.path);
		
		if (!res.path || res.path === '' || res.path === '/') {
			wx.reLaunch({
				url: '/pages/home/index',
				fail: (err) => {
					console.error('重定向到首页失败:', err);
					wx.reLaunch({ url: '/pages/login/index' });
				}
			});
			return;
		}
		
		wx.showToast({
			title: `页面 ${res.path} 不存在，即将返回首页`,
			icon: 'none',
			duration: 3000
		});
		
		setTimeout(() => {
			wx.reLaunch({ url: '/pages/home/index' });
		}, 3000);
	},

	// 角色更新（去重与变更检测）
	updateUserRole: function(newRole) {
		if (!newRole) return;
		const prevRole = this.globalData.role;
		const tabsInitialized = Array.isArray(this.globalData.currentTabs) && this.globalData.currentTabs.length > 0;
		if (newRole === prevRole && tabsInitialized) {
			return;
		}

		this.globalData.role = newRole;
		try {
			wx.setStorageSync('role', newRole);
		} catch (e) {
			console.error('[App] 保存角色失败:', e);
		}

		try {
			const { computeTabsByRole } = require('./utils/router');
			const tabs = computeTabsByRole(newRole) || [];
			const prev = this.globalData.currentTabs || [];
			const same = prev.length === tabs.length && prev.every((t, i) => t && tabs[i] && t.pagePath === tabs[i].pagePath);
			if (!same) {
				this.globalData.currentTabs = tabs;
				this.publish('tabsChanged', tabs);
			} else if (!tabsInitialized) {
				// 首次初始化但内容一致，也应确保赋值
				this.globalData.currentTabs = tabs;
			}
		} catch (e) {
			console.error('[App] 计算或发布 tabs 失败:', e);
		}
	},

	// 登录检查和导航
	checkLoginAndNavigate: async function() {
		try {
			const registered = await this.verifyUserAccountRemotely(2000);
			if (registered) {
				console.log('账号验证通过，允许进入系统');
				return;
			}
			console.log('未检测到注册账号，跳转注册/登录页');
			wx.reLaunch({
				url: '/pages/login/index',
				fail: (err) => {
					console.error('跳转登录页失败:', err);
				}
			});
		} catch (e) {
			console.error('检查登录状态出错:', e);
			wx.reLaunch({ url: '/pages/login/index' });
		}
	},

	// 远程验证是否存在注册账号（单航班 + 短TTL，不改变业务行为）
	verifyUserAccountRemotely: async function(timeoutMs) {
		try {
			const now = Date.now();
			if (this.globalData.isLogin && this.globalData.openid && now < (this._verifyCacheUntil || 0)) {
				return true;
			}
			if (this._verifyUserPromise) {
				return this._verifyUserPromise;
			}
			this._verifyUserPromise = (async () => {
				try {
					const res = await api.call('users', { action: 'getUserByOpenId', timeout: typeof timeoutMs === 'number' ? timeoutMs : 2000, config: { retries: 0 } });
					const ok = !!(res && res.success && res.data);
					if (ok) {
						const updatedUserInfo = res.data;
						this.globalData.userInfo = updatedUserInfo;
						this.globalData.openid = updatedUserInfo.openid;
						this.globalData.isLogin = true;
						this.updateUserRole(updatedUserInfo.role || 'user');
						this.prefetchUserDepartment(updatedUserInfo.openid).catch(() => {});
						try {
							wx.setStorageSync('userInfo', updatedUserInfo);
							wx.setStorageSync('openid', updatedUserInfo.openid);
							wx.setStorageSync('role', updatedUserInfo.role || 'user');
							wx.setStorageSync('isLogin', true);
							wx.setStorageSync('lastUserVerifyTime', Date.now());
						} catch (e) {}
						this._verifyCacheUntil = Date.now() + 60 * 1000; // 60s 短缓存
					}
					return ok;
				} catch (err) {
					console.warn('远程验证账号失败:', err && err.message);
					return false;
				} finally {
					this._verifyUserPromise = null;
				}
			})();
			return this._verifyUserPromise;
		} catch (e) {
			console.warn('verifyUserAccountRemotely 异常:', e && e.message);
			return false;
		}
	},

	// 自动登录检查
	autoCheckLoginStatus: async function() {
		try {
			const userInfo = wx.getStorageSync('userInfo');
			const openid = wx.getStorageSync('openid');
			const role = wx.getStorageSync('role');
			const isLogin = wx.getStorageSync('isLogin');
			
			if (!userInfo || !openid || !isLogin) {
				console.log('本地无完整登录信息');
				this.clearLoginInfo();
				this.updateUserRole('user');
				return false;
			}
			
			this.globalData.userInfo = userInfo;
			this.globalData.openid = openid;
			this.globalData.isLogin = true;
			this.updateUserRole(role || 'user');
			this.prefetchUserDepartment(openid).catch(() => {});
			
			const lastVerifyTime = wx.getStorageSync('lastUserVerifyTime') || 0;
			const now = Date.now();
			const verifyInterval = 30 * 60 * 1000;
			
			if (now - lastVerifyTime > verifyInterval) {
				console.log('后台验证用户信息');
				this.asyncVerifyAndRefreshUserInfo(openid, now).catch(err => {
					console.warn('后台验证失败:', err.message);
				});
			} else {
				console.log('验证在有效期内');
			}
			
			console.log('自动登录成功');
			return true;
			
		} catch (e) {
			console.error('自动登录检查失败', e);
			this.clearLoginInfo();
			this.updateUserRole('user');
			return false;
		}
	},

	// 异步验证用户信息
	asyncVerifyAndRefreshUserInfo: async function(openid, verifyTime) {
		try {
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error('验证超时')), 5000);
			});
			
			const verifyPromise = api.call('users', {
				action: 'getUserByOpenId',
				params: { openid: openid }
			});
			
			const res = await Promise.race([verifyPromise, timeoutPromise]);
			
			if (res.success && res.data) {
				const updatedUserInfo = res.data;
				
				this.globalData.userInfo = updatedUserInfo;
				wx.setStorageSync('userInfo', updatedUserInfo);
				wx.setStorageSync('isLogin', true);
				
				if (updatedUserInfo.role) {
					this.updateUserRole(updatedUserInfo.role);
				}

				this.prefetchUserDepartment(openid).catch(() => {});
				
				wx.setStorageSync('lastUserVerifyTime', verifyTime);
				console.log('用户信息验证成功');
				
				this.syncUserDataIfNeeded().catch(err => {
					console.warn('数据同步失败:', err.message);
				});
				
				return true;
			} else {
				console.log('未找到用户信息');
				return false;
			}
		} catch (err) {
			if (err.message === '验证超时') {
				console.warn('验证超时，使用本地缓存');
			} else {
				console.warn('验证失败，使用本地缓存:', err.message);
			}
			return true;
		}
	},
	
	// 已废弃旧方法，移除以减少冗余
	
	// 刷新用户信息
	refreshUserInfo: async function() {
		try {
			const res = await api.call('users', {
				action: 'getUserByOpenId',
				params: { openid: this.globalData.openid }
			});

			if (res.success && res.data) {
				const updatedUserInfo = res.data;
				this.globalData.userInfo = updatedUserInfo;
				wx.setStorageSync('userInfo', updatedUserInfo);
				wx.setStorageSync('isLogin', true);
				this.updateUserRole(updatedUserInfo.role || 'user');
				this.prefetchUserDepartment(updatedUserInfo.openid || this.globalData.openid).catch(() => {});
				this.syncUserDataIfNeeded();
			} else {
				console.error('刷新用户信息失败:', res.message);
			}
		} catch (err) {
			console.error('刷新用户信息异常', err);
		}
	},

	// 同步用户数据
	syncUserDataIfNeeded: async function() {
		try {
			await api.call('users', {
				action: 'syncUserDataAcrossCollections',
				params: { openid: this.globalData.openid }
			});
		} catch (err) {
			console.error('数据同步异常:', err);
		}
	},
	
	// 清除登录信息
	clearLoginInfo: function() {
		this.globalData.userInfo = null;
		this.globalData.openid = '';
		this.globalData.role = 'user';
		this.globalData.isLogin = false;
		this.globalData.userDepartment = '';
		this.globalData.userDepartmentLastChange = null;
		this.globalData.unreadMessageCount = 0;
		
		try {
			wx.removeStorageSync('userInfo');
			wx.removeStorageSync('openid');
			wx.removeStorageSync('role');
			wx.removeStorageSync('isLogin');
			wx.removeStorageSync('sessionKey');
			wx.removeStorageSync('authToken');
		} catch (e) {
			console.error('清除登录信息失败:', e);
		}
	},

	// 权限检查
	checkPermission: function(requiredRole) {
		const currentRole = this.globalData.role;
		if (requiredRole === 'leader') {
			return currentRole === 'leader' || currentRole === 'admin';
		} else if (requiredRole === 'member') {
			return currentRole === 'leader' || currentRole === 'member' || currentRole === 'admin';
		} else {
			return true;
		}
	},

	// 全局错误处理
	handleGlobalErrors: function() {
		const originalError = console.error;
		console.error = function() {
			const errorMsg = Array.from(arguments).join(' ');
			if (errorMsg.includes('no such file or directory') && 
				(errorMsg.includes('wxfile://usr/miniprogramlog') || 
					errorMsg.includes('interstitialAdExtInfo.txt') || 
					errorMsg.includes('scopeState.txt') || 
					errorMsg.includes('wxfile://usr/miniprogramLog/log1'))) {
				return;
			}
			if (errorMsg.includes('backgroundfetch privacy fail') || 
				errorMsg.includes('private_getBackgroundFetchData:fail')) {
				return;
			}
			return originalError.apply(console, arguments);
		};
	},

	getEnvVersion: function() {
		try {
			const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
			return (info && info.miniProgram && info.miniProgram.envVersion) || 'release';
		} catch (e) {
			return 'release';
		}
	},

	getEffectiveRole: function() {
		try {
			return this.globalData.role || 'user';
		} catch (e) {
			return 'user';
		}
	},

	// 日志配置
	configureLogging: function() {
		const envVersion = this.getEnvVersion();
		if (envVersion === 'release') {
			const noop = function() {};
			console.log = noop;
			console.info = noop;
			console.debug = noop;
		}
	},

	// 获取未读消息数（TTL + 单航班 + 仅变化时更新）
	getUnreadMessageCount: async function() {
		const openid = this.globalData.openid;
		if (!openid) return;
		const now = Date.now();
		const TTL = 10 * 1000;
		if (this._unreadPromise) return;
		if ((this._lastUnreadAt || 0) && now - this._lastUnreadAt < TTL) return;
		this._unreadPromise = (async () => {
			try {
				const res = await api.call('messages', {
					action: 'getMessage',
					params: { messageUserId: openid }
				});
				if (res.success && res.data) {
					const { messages = [] } = res.data || {};
					const unreadCount = messages.filter(msg => !msg.isRead).length;
					this._lastUnreadAt = Date.now();
					if (unreadCount !== (this._lastUnreadVal || 0)) {
						this._lastUnreadVal = unreadCount;
						this.globalData.unreadMessageCount = unreadCount;
						if (this.globalData.messageUpdateCallback) {
							this.globalData.messageUpdateCallback(unreadCount);
						}
					}
				} else {
					console.error('获取消息失败:', res && res.message);
				}
			} catch (err) {
				console.error('获取消息异常', err);
			} finally {
				this._unreadPromise = null;
			}
		})();
		return this._unreadPromise;
	},

	// 获取待办总数（TTL + 单航班 + 仅变化时更新）
	getTodoTotalCount: async function() {
		const openid = this.globalData.openid;
		if (!openid) return;
		const now = Date.now();
		const TTL = 10 * 1000;
		if (this._todoPromise) return;
		if ((this._lastTodoAt || 0) && now - this._lastTodoAt < TTL) return;
		this._todoPromise = (async () => {
			try {
				const res = await api.call('userToDoList', {
					action: 'getTodoCount',
					params: { type: 'all' }
				});
				if (res.success && res.data) {
					const total = typeof res.data.total === 'number' ? res.data.total : 0;
					this._lastTodoAt = Date.now();
					if (total !== (this._lastTodoVal || 0)) {
						this._lastTodoVal = total;
						this.globalData.todoTotalCount = total;
						try { wx.setStorageSync('todoTotalCount', total); } catch (e) {}
						if (this.globalData.todoCountUpdateCallback) {
							this.globalData.todoCountUpdateCallback(total);
						}
					}
				} else {
					console.error('获取待办总数失败:', res && res.message);
				}
			} catch (err) {
				console.error('获取待办总数异常', err);
			} finally {
				this._todoPromise = null;
			}
		})();
		return this._todoPromise;
	},

	/**
	 * 预取维修组成员的部门信息（组员/组长可用）
	 * @param {string} openid
	 * @param {Object} [options]
	 * @param {boolean} [options.force=false]
	 * @returns {Promise<{department: string, lastDepartmentChangeTime: any} | null>}
	 */
	prefetchUserDepartment: function(openid, options = {}) {
		if (!openid) return Promise.resolve(null);
		const force = !!(options && options.force);
		if (!force && this.globalData.userDepartment && this.globalData.openid === openid) {
			return Promise.resolve({
				department: this.globalData.userDepartment,
				lastDepartmentChangeTime: this.globalData.userDepartmentLastChange
			});
		}
		if (this._deptPromise && this._deptPromiseOpenid === openid) {
			return this._deptPromise;
		}

		this._deptPromiseOpenid = openid;
		this._deptPromise = api.call('users', {
			action: 'getProUserByOpenId',
			params: { openid }
		})
		.then((res) => {
			if (res && res.success && res.data) {
				return this._applyDepartmentInfo(res.data);
			}
			return this._applyDepartmentInfo(null);
		})
		.catch((err) => {
			console.warn('获取用户部门失败:', err && err.message);
			return null;
		})
		.finally(() => {
			this._deptPromise = null;
			this._deptPromiseOpenid = null;
		});

		return this._deptPromise;
	},

	_applyDepartmentInfo: function(proUserDoc) {
		const department = (proUserDoc && proUserDoc.department) || '';
		const lastChange = proUserDoc && proUserDoc.lastDepartmentChangeTime ? proUserDoc.lastDepartmentChangeTime : null;

		this.globalData.userDepartment = department;
		this.globalData.userDepartmentLastChange = lastChange;

		if (this.globalData.userInfo) {
			this.globalData.userInfo.department = department;
			this.globalData.userInfo.lastDepartmentChangeTime = lastChange;
			try {
				wx.setStorageSync('userInfo', this.globalData.userInfo);
			} catch (e) {}
		}

		try {
			this.publish('userDepartmentReady', { department, lastDepartmentChangeTime: lastChange });
		} catch (e) {}

		return { department, lastDepartmentChangeTime: lastChange };
	},

	// 事件总线
	subscribe: function(eventName, handler) {
		if (!eventName || typeof handler !== 'function') return () => {};
		const map = this._events || (this._events = {});
		map[eventName] = map[eventName] || [];
		map[eventName].push(handler);
		return () => this.unsubscribe(eventName, handler);
	},
	unsubscribe: function(eventName, handler) {
		const map = this._events || {};
		const list = map[eventName] || [];
		const idx = list.indexOf(handler);
		if (idx >= 0) list.splice(idx, 1);
	},
	publish: function(eventName, payload) {
		const list = (this._events && this._events[eventName]) || [];
		for (const fn of list) {
			try { fn(payload); } catch (e) { console.error(`[App] 事件处理异常 ${eventName}:`, e); }
		}
	},



	globalData: {
		userInfo: null,
		openid: null,
		role: 'user',
		isLogin: false,
		userDepartment: '',
		userDepartmentLastChange: null,
		unreadMessageCount: 0,
		messageUpdateCallback: null,
		todoTotalCount: 0,
		todoCountUpdateCallback: null,
		theme: 'light',
		currentTabs: []
	}
}) 