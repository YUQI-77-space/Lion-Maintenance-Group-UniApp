const { getLayout } = require('../utils/layout');
Component({
	data: {
		tabs: [],
		safeBottom: getLayout().safeBottom,
		selected: 0,
		isInitialized: false,
		interactionLocked: false
	},

	lifetimes: {
		attached() {
			try {
				const app = getApp();
				const initTabs = (app && app.globalData && Array.isArray(app.globalData.currentTabs))
					? app.globalData.currentTabs : [];
				this.setData({ tabs: initTabs, isInitialized: true });
				this.setSelectedByRoute();
				this._unsubscribe = app && app.subscribe && app.subscribe('tabsChanged', (tabs) => {
					if (!Array.isArray(tabs)) return;
					this.setData({ tabs, isInitialized: true });
					this.setSelectedByRoute();
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
				this.setData({ tabs, isInitialized: true });
				this.setSelectedByRoute();
			} catch (e) {}
		}
	},

	methods: {
		setSelectedByRoute() {
			try {
				const pages = getCurrentPages();
				if (!pages || pages.length === 0) return;
				const route = pages[pages.length - 1].route;
				const full = `/${route}`;
				const index = this.data.tabs.findIndex(t => `/${t.pagePath}` === full);
				if (index >= 0 && index !== this.data.selected) {
					this.setData({ selected: index });
				}
			} catch (e) {}
		},

		onTap(e) {
			if (this.data.interactionLocked || this._switching) return;
			const url = e.currentTarget.dataset.url;
			if (!url || !this.data.tabs.some(tab => '/' + tab.pagePath === url)) return;
			// 若点击的就是当前已选 Tab，则不做跳转，避免重复重建页面
			try {
				const pages = getCurrentPages();
				const currentRoute = (pages && pages.length) ? ('/' + pages[pages.length - 1].route) : '';
				const tappedIndex = e.currentTarget.dataset.index;
				const idx = typeof tappedIndex === 'number' ? tappedIndex : parseInt(tappedIndex, 10);
				const sameByIndex = !isNaN(idx) && idx === this.data.selected;
				if (currentRoute === url) {
					return;
				}
			} catch (err) {}
			this._switching = true;
			const complete = () => { this._switching = false; this.setSelectedByRoute(); };
			wx.switchTab({ url, complete });
		},

		forceRefresh() {
			try {
				const app = getApp();
				const tabs = (app && app.globalData && Array.isArray(app.globalData.currentTabs))
					? app.globalData.currentTabs : [];
				this.setData({ tabs, isInitialized: true });
				this.setSelectedByRoute();
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