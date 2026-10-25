const { changeSelection } = require('./dutySelection')
exports.selectDutySlots = (event, openid) => changeSelection(event, openid)
