// 消息管理云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { createMessage } = require('./createMessage')
const { createMessages } = require('./createMessages')
const { getMessage } = require('./getMessage')
const { markTheMessageAsRead } = require('./markTheMessageAsRead')
const { removalMessages } = require('./removalMessages')
const { sendMessages } = require('./sendMessages')
const { updateMessageList } = require('./updateMessageList')

exports.main = async (event, context) => {
	const wxContext = cloud.getWXContext()
	const OPENID = wxContext.OPENID
	const { action, params, messageData } = event
	
	if (action === 'sendMessage' && messageData) {
		return await sendMessages({ messageData }, OPENID)
	}
	
	switch (action) {
		case 'createMessage':
			return await createMessage(params, OPENID)
		case 'createMessages':
			return await createMessages(params, OPENID)
		case 'getMessage':
			return await getMessage(params, OPENID)
		case 'markTheMessageAsRead':
			return await markTheMessageAsRead(params, OPENID)
		case 'removalMessages':
			return await removalMessages(params, OPENID)
		case 'sendMessages':
			return await sendMessages(params, OPENID)
		case 'updateMessageList':
			return await updateMessageList(params, OPENID)
		default:
			return {
				code: 404,
				data: null,
				message: `未找到名为 ${action} 的操作`
			}
	}
} 
