// 定时器只负责唤醒；目标周由服务端北京时间计算，不再将 currentWeek 加一。
const { switchToWeek } = require('./switchToWeek')

exports.main = async () => switchToWeek({}, null, { automatic: true })
