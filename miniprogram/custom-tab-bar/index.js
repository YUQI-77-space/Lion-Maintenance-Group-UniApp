const { getLayout } = require('../utils/layout');
const router = require('../utils/router');
Component({
	data: {
		tabs: [],
		safeBottom: getLayout().safeBottom,
		selected: -1,
		isInitialized: false,
		interactionLocked: false
	},

	lifetimes: {
		attached() {
			try {
				const app = getApp();
				const initTabs = (app && app.globalData && Array.isArray(app.globalData.currentTabs))
					? app.globalData.currentTabs : [];
				this.setSelectedByRoute(null, initTabs);
				this._unsubscribe = app && app.subscribe && app.subscribe('tabsChanged', (tabs) => {
					if (!Array.isArray(tabs)) return;
					this.setSelectedByRoute(null, tabs);
				});
			} catch (e) {
				console.error('[TabBar] attached init error:', e);
			}
		},
		detached() {
			if (this._unsubscribe) {
				try { this._unsubscribe(); } catch (e) {}
				this._unsubscribe = null;
			}
		}
	},

	pageLifetimes: {
		show() {
			try {
				if (this.data.isInitialized) {
					this.setSelectedByRoute();
					return;
				}
				const app = getApp();
				const tabs = (app && app.globalData && Array.isArray(app.globalData.currentTabs))
					? app.globalData.currentTabs : [];
				this.setSelectedByRoute(null, tabs);
			} catch (e) {}
		},
		hide() {
			// 旧实例已隐藏，恢复它自己的选中项，避免下次显示先闪过上次目标。
			this.setSelectedByRoute();
		}
	},

	methods: {
		setSelectedByRoute(route, tabs) {
			try {
				const pages = getCurrentPages();
				// 每个 Tab 页面都有独立组件，隐藏实例不能跟随栈顶页面误选。
				const owner = pages && pages.find(page => page.getTabBar && page.getTabBar() === this);
				this._pageRoute = route || (owner && owner.route) || this._pageRoute || '';
				const list = tabs || this.data.tabs;
				const index = list.findIndex(t => t.pagePath === this._pageRoute);
				// 列表与选中项一次提交，避免角色切换或首次显示时闪过错误按钮。
				if (tabs) {
					this.setData({ tabs, selected: index, isInitialized: true });
				} else if (index !== this.data.selected) {
					this.setData({ selected: index });
				}
			} catch (e) {}
		},

		onTap(e) {
			if (this.data.interactionLocked || router.isTabSwitching()) return;
			const url = e.currentTarget.dataset.url;
			if (!url || !this.data.tabs.some(tab => '/' + tab.pagePath === url)) return;
			// 若点击的就是当前已选 Tab，则不做跳转，避免重复重建页面
			try {
				const pages = getCurrentPages();
				const currentRoute = (pages && pages.length) ? ('/' + pages[pages.length - 1].route) : '';
				if (currentRoute === url) {
					return;
				}
			} catch (err) {}
			const selected = this.data.tabs.findIndex(tab => '/' + tab.pagePath === url);
			// 一次提交两个按钮的样式，同时启动原生导航，不等待旧页渲染回调。
			this.setData({ selected });
			router.switchTab(url, {
				fail: () => this.setSelectedByRoute()
			});
		},

		forceRefresh() {
			try {
				const app = getApp();
				const tabs = (app && app.globalData && Array.isArray(app.globalData.currentTabs))
					? app.globalData.currentTabs : [];
				this.setSelectedByRoute(null, tabs);
			} catch (e) {
				console.error('[TabBar] forceRefresh error:', e);
			}
		},

		setInteractionLocked(locked) {
			this.setData({ interactionLocked: !!locked });
		},

		noop() {}
	}
});
