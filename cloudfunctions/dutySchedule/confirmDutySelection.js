const { changeSelection } = require('./dutySelection')
exports.confirmDutySelection = (event, openid) => changeSelection(event, openid, 'confirm')
