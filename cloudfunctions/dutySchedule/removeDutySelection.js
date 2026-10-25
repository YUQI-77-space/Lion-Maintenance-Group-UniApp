const { changeSelection } = require('./dutySelection')
exports.removeDutySelection = (event, openid) => changeSelection(event, openid, 'cancel')
