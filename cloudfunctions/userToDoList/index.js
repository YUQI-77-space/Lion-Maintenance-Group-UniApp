// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

// 引入各个操作模块
const { getTodoList } = require('./getTodoList')
const { getTodoDetail } = require('./getTodoDetail')
const { addTodo } = require('./addTodo')
const { updateTodoStatus } = require('./updateTodoStatus')
const { deleteTodo } = require('./deleteTodo')
const { getTodoCount } = require('./getTodoCount')

// 云函数入口函数
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  
  // 获取请求参数
  const { action, params } = event
  
  // 创建返回对象
  let result = {
    code: 200,
    data: null,
    message: 'success'
  }
  
  // 根据action调用对应方法
  try {
    switch (action) {
      case 'getTodoList':
        result = await getTodoList(params, OPENID)
        break
      case 'getTodoDetail':
        result = await getTodoDetail(params, OPENID)
        break
      case 'addTodo':
        result = await addTodo(params, OPENID)
        break
      case 'updateTodoStatus':
        result = await updateTodoStatus(params, OPENID)
        break
      case 'deleteTodo':
        result = await deleteTodo(params, OPENID)
        break
      case 'getTodoCount':
        result = await getTodoCount(params, OPENID)
        break
      default:
        result = {
          code: 404,
          data: null,
          message: '未找到对应的方法'
        }
    }
  } catch (err) {
    // 捕获错误
    result = {
      code: 500,
      data: null,
      message: err.message || '服务器内部错误'
    }
  }
  
  return result
} 