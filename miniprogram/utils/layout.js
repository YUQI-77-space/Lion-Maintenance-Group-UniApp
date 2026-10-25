// 窗口、胶囊和安全区统一使用 px；安全区不再叠加 env()。
function getLayout() {
  let info = {};
  let menu = {};
  try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (_) {}
  try { menu = wx.getMenuButtonBoundingClientRect() || {}; } catch (_) {}
  const statusBarHeight = info.statusBarHeight || 20;
  const navbarContentHeight = menu.height > 0 && menu.top >= statusBarHeight
    ? menu.height + (menu.top - statusBarHeight) * 2 : 44;
  // safeArea 使用屏幕坐标，不能从 windowHeight（可能扣除导航栏）相减。
  const safeBottom = info.safeArea && info.screenHeight
    ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0;
  return {
    statusBarHeight, navbarContentHeight,
    navBarHeight: statusBarHeight + navbarContentHeight,
    navbarRight: menu.left > 0 ? Math.max(0, info.windowWidth - menu.left + 8) : 96,
    // Tab 页占位包含栏体、悬浮间距和安全区，页面再另留内容间距。
    safeBottom, tabbarHeight: 60 + 16 + safeBottom,
    windowWidth: info.windowWidth || 375
  };
}

module.exports = { getLayout };
