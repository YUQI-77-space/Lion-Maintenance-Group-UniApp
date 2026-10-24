// node --test tests/design-remaining.test.js；纯本地脱敏测试，不访问云资源。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const display = require('../miniprogram/utils/ewaDisplay');
const read = name => fs.readFileSync(path.resolve('miniprogram', name), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(name, custom = {}) {
  let definition;
  const calls = [];
  const app = { globalData: { isLogin: true, openid: 'example-user', role: 'member' }, verifyUserAccountRemotely: async () => true, publish() {}, subscribe: () => () => {}, checkPermission: () => true, ...custom.app };
  const wx = { getStorageSync: () => null, setStorageSync() {}, showLoading() {}, hideLoading() {}, showToast() {}, pageScrollTo() {}, stopPullDownRefresh() {}, navigateBack() {}, showModal: async () => ({ confirm: true }), getWindowInfo: () => ({ windowWidth: 375 }), ...custom.wx };
  const api = { generateRequestId: () => 'example-request', call: async (name,payload) => { calls.push({ name, payload }); return custom.call ? custom.call(name,payload) : { success: false, code: 503, message: '模拟超时' }; } };
  const auth = { SCENES: {}, TEMPLATES: {}, requestApplicantAuth: async () => { throw new Error('拒绝通知'); }, requestSubscribeMessage: async () => {}, requestAssigneeAuth: async () => {}, ...custom.auth };
  const stub = new Proxy({}, { get: () => () => [] });
  const context = {
    Page: value => { definition = value; }, Component: value => { definition = value; },
    module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    wx, getApp: () => app, getCurrentPages: () => [{ route: 'pages/home/index' }],
    setTimeout, clearTimeout, setInterval, clearInterval,
    require: key => {
      if (custom.modules && key in custom.modules) return custom.modules[key];
      if (key.includes('apiAdapter')) return api;
      if (key.includes('layout')) return { getLayout: () => ({ statusBarHeight: 20, navBarHeight: 64, navbarContentHeight: 44, navbarRight: 96, safeBottom: 0, tabbarHeight: 56, windowWidth: 375 }) };
      if (key.includes('subscriptionAuth')) return auth;
      if (key.includes('repairCategories')) return require('../miniprogram/utils/repairCategories');
      if (key.includes('ewaDisplay')) return display;
      if (key.includes('time')) return require('../miniprogram/utils/time');
      if (key.includes('swrCache')) return { get: () => ({ exists: false }), set() {}, clear() {} };
      if (key.includes('activityStatusManager')) return { ActivityStatusManager: { processActivitiesForDisplay: value => value }, ActivityStatusMixin: {} };
      return stub;
    }
  };
  vm.runInNewContext(read(name), context);
  const instance = { ...definition, ...definition.methods, data: structuredClone(definition.data || {}), setData(patch, callback) {
    for (const [key,value] of Object.entries(patch)) {
      const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let object = this.data;
      keys.slice(0,-1).forEach(part => { object = object[part] || (object[part] = {}); });
      object[keys.at(-1)] = value;
    }
    if (callback) callback();
  } };
  return { instance, calls, app, wx, api, context };
}

test('胶囊与屏幕安全区统一口径，缺少系统 API 仍有标准栏高', () => {
  const { getLayout } = (() => {
    const ctx = { module: { exports: {} }, wx: { getWindowInfo: () => ({ statusBarHeight: 47, windowWidth: 390, windowHeight: 750, screenHeight: 844, safeArea: { bottom: 810 } }), getMenuButtonBoundingClientRect: () => ({ top: 51, height: 32, left: 280 }) } };
    vm.runInNewContext(read('utils/layout.js'),ctx);
    const layout = ctx.module.exports.getLayout();
    assert.equal(layout.safeBottom,34);
    assert.equal(layout.tabbarHeight,90);
    assert.equal(layout.navBarHeight,87);
    ctx.wx = {};
    assert.equal(ctx.module.exports.getLayout().navBarHeight,64);
    return ctx.module.exports;
  })();
  assert.equal(typeof getLayout,'function');
});

test('TabBar 连点只切一次，完成后释放锁，非法路径不导航', () => {
  let complete;
  const urls=[];
  const { instance } = harness('custom-tab-bar/index.js', { wx: { switchTab: options => { urls.push(options.url); complete=options.complete; } } });
  instance.data.tabs=[{ pagePath: 'pages/home/index' },{ pagePath: 'pages/repair/index' }];
  const event={ currentTarget: { dataset: { url: '/pages/repair/index', index: 1 } } };
  instance.onTap(event); instance.onTap(event);
  assert.equal(urls.length,1);
  complete();
  instance.onTap({ currentTarget: { dataset: { url: '/pages/team/home/index' } } });
  assert.equal(urls.length,1);
  assert.equal(instance._switching,false);
});

test('entry-item 只分发原事件，不直接跳转', () => {
  const { instance } = harness('components/entry-item/index.js');
  const events=[]; instance.triggerEvent=(...args)=>events.push(args);
  instance.data.path='/pages/repair/index'; instance.data.itemIndex=2;
  instance.onTap({});
  assert.equal(events[0][0],'tap');
  assert.equal(events[0][1].index,2);
});

test('报修锁覆盖订阅授权，拒绝通知仍只创建一次，超时保留核对与输入', async () => {
  const pending=deferred();
  const { instance,calls } = harness('pages/repair/index.js', { auth: { requestApplicantAuth: () => pending.promise } });
  Object.assign(instance.data, { currentStep:4, appointmentDate:'2099-01-01',appointmentTime:'10:00',selectedCategory:{name:'示例大类'},selectedSubcategory:{name:'示例子类'},tempState:{selectedType:{name:'示例问题'}},otherDescription:'需要保留的输入' });
  const first=instance.submitRepair(); await instance.submitRepair();
  assert.equal(instance.data.submitting,true);
  pending.resolve({ success:false }); await first;
  assert.equal(calls.length,1);
  assert.equal(calls[0].payload.config.retries,0);
  assert.equal(instance.data.submitUnknown,true);
  assert.equal(instance.data.currentStep,4);
  assert.equal(instance.data.otherDescription,'需要保留的输入');
  await instance.submitRepair(); assert.equal(calls.length,1);
});

test('报修成功仅使用真实 ID；共享适用字段保留、无效字段清除', async () => {
  const { instance } = harness('pages/repair/index.js', { call: async () => ({ success:true,data:{maintenanceTaskId:'real-test-id'} }) });
  instance.applicableFieldPatch([{key:'laptopModel'}]);
  instance.data.laptopModel='示例型号'; instance.data.phoneModel='旧手机';
  const patch=instance.applicableFieldPatch([{key:'laptopModel'}]);
  assert.equal(patch.laptopModel,'示例型号'); assert.equal(patch.phoneModel,'');
  Object.assign(instance.data,{currentStep:4,appointmentDate:'2099-01-01',appointmentTime:'10:00',selectedCategory:{name:'大类'},selectedSubcategory:{name:'子类'},tempState:{selectedType:{name:'类型'}}});
  await instance.submitRepair();
  assert.equal(instance.data.currentStep,5); assert.equal(instance.data.submittedTaskId,'real-test-id');
});

test('EWA 100/50/20 加权贡献为 50/20/2，总分保持后端72；0与缺失区分', () => {
  const normal=display.summarize([{ maintenanceEW:100,volunteerEW:50,dutyEW:20,totalEW:72 }]);
  assert.deepEqual(normal.rows.map(row=>row.contribution),[50,20,2]); assert.equal(normal.totalText,'72');
  const zero=display.summarize([{maintenanceEW:0,volunteerEW:0,dutyEW:0,totalEW:0}]);
  assert.equal(zero.totalText,'0'); assert.equal(zero.hasMissing,false);
  const missing=display.summarize([{maintenanceEW:0,volunteerEW:null,dutyEW:0}]);
  assert.equal(missing.rows[1].valueText,'—'); assert.equal(missing.totalText,'—');
});

test('志愿筛选旧响应不覆盖新响应，追加失败不推进页码', async () => {
  const pending=[];
  const { instance }=harness('pages/team/volunteer/list/index.js',{call:()=>{const d=deferred();pending.push(d);return d.promise;}});
  instance.processActivities=value=>value;
  const old=instance.getActivitiesList();
  instance.data.currentStatus='ended'; instance.data.page=1;
  const latest=instance.getActivitiesList();
  pending[1].resolve({success:true,data:{activities:[{activityId:'new'}],hasMore:true}});await latest;
  pending[0].resolve({success:true,data:{activities:[{activityId:'old'}],hasMore:false}});await old;
  assert.equal(instance.data.activities[0].activityId,'new');
  const append=instance.getActivitiesList();pending[2].resolve({success:false,message:'追加失败'});await append;
  assert.equal(instance.data.page,2);assert.equal(instance.data.activities.length,1);assert.equal(instance.data.loadError,'追加失败');
});

test('维修追加去重与失败重试保持页码', async () => {
  let success=false;
  const { instance }=harness('pages/team/maintenance/list/index.js',{call:async()=> success ? {success:true,data:{tasks:[{maintenanceTaskId:'a'},{maintenanceTaskId:'b'}],hasMore:false}} : {success:false,message:'失败'}});
  Object.assign(instance.data,{page:2,allTasks:[{maintenanceTaskId:'a'}],hasMore:true});
  await instance.loadMoreTasks();assert.equal(instance.data.page,2);assert.equal(instance.data.appendFailed,true);
  success=true;await instance.retryList();assert.equal(instance.data.page,3);assert.equal(instance.data.allTasks.length,2);
});

test('消息读取业务失败不清空已有列表，也不冒充空态', async () => {
  const { instance }=harness('pages/user/message/index.js');
  instance.data.messages=[{title:'上次消息'}];instance.data.isEmpty=false;
  await instance.loadMessages();assert.equal(instance.data.messages.length,1);assert.equal(instance.data.isEmpty,false);assert.ok(instance.data.loadError);
});

test('值班核对包含待确认项，跨周预检阻止旧周写入，订阅拒绝不抛出', async () => {
  const { instance,calls }=harness('pages/team/duty/roster/index.js',{call:async()=>({success:true,data:{weekNumber:2,year:2026}})});
  instance.data.currentWeek=1;instance.data.currentYear=2026;instance.checkEditPermission=()=>true;
  instance.data.userSlots.preSelectedSlots=[{dutySlotId:'slot-a',date:'2026-10-26',timeSlot:'上午',startTime:'08:00',endTime:'10:00'}];
  instance.processDutyData=()=>{};
  await instance.confirmSelection();
  assert.equal(calls.length,1);assert.equal(calls[0].payload.action,'getDutySlots');assert.match(instance.data.confirmationMessage,/当前周已变化/);assert.equal(instance.data.confirming,false);
});

test('值班确认重复点击不会重复核对／写入；接口写入无自动重试', async () => {
  const gate=deferred();
  const { instance,calls }=harness('pages/team/duty/roster/index.js',{call:async(name,payload)=>payload.action==='getDutySlots' ? {success:true,data:{weekNumber:1,year:2026}} : gate.promise});
  Object.assign(instance.data,{currentWeek:1,currentYear:2026,selectedSlotsDisplay:[{dutySlotId:'slot-a'}]});
  instance.checkEditPermission=()=>true;instance.loadDutyData=async()=>{};instance.loadUserDutySlots=async()=>{};instance.reconcileLocalSelection=()=>{};
  const first=instance.confirmSelection();await Promise.resolve();await Promise.resolve();await Promise.resolve();await instance.confirmSelection();
  gate.resolve({success:false,code:503});await first;
  const writes=calls.filter(call=>call.payload.action==='confirmDutySelection');
  assert.equal(writes.length,1);assert.equal(writes[0].payload.config.retries,0);assert.match(instance.data.confirmationMessage,/暂时无法确认结果/);
});

test('下拉 EWA 只读，不执行重算；管理保存取消不写接口', async () => {
  const {instance,calls}=harness('pages/team/ewa/manage/index.js',{wx:{showModal:async()=>({confirm:false})}});
  instance.data.hasPermission=true;instance.fetchUsers=async()=>{};await instance.onPullDownRefresh();assert.equal(calls.length,0);
  instance.data.editUser={ewaUserId:'a',ewaUserName:'测试成员',maintenanceEW:10,volunteerEW:20,dutyEW:30};
  await instance.saveUserEW();assert.equal(calls.length,0);assert.equal(instance.data.savingEW,false);
});

test('全部注册路由保留；本次新增相对 require 与样式导入均可解析', () => {
  const app=JSON.parse(read('app.json'));assert.equal(app.pages.length,31);
  for (const page of app.pages) for (const ext of ['js','json','wxml','wxss']) assert.ok(fs.existsSync(path.resolve('miniprogram',page+'.'+ext)));
  function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory() && !['images','config','node_modules'].includes(entry.name) ? walk(path.join(dir,entry.name)) : entry.isFile() ? [path.join(dir,entry.name)] : []); }
  for (const file of walk(path.resolve('miniprogram'))) {
    if (!file.endsWith('.wxss')) continue;
    const source=fs.readFileSync(file,'utf8');
    for (const match of source.matchAll(/@import\s+["']([^"']+)["']/g)) {
      const target=match[1].startsWith('/')?path.resolve('miniprogram','.'+match[1]):path.resolve(path.dirname(file),match[1]);
      assert.ok(fs.existsSync(target),`${file}: ${match[1]}`);
    }
  }
});

test('登录会话返回失败时不恢复旧身份，保留可见错误', async () => {
  const { instance,app }=harness('pages/login/index.js');
  app.globalData.isLogin=false;
  await instance.verifySession('old-user',{nickName:'旧资料'});
  assert.equal(app.globalData.isLogin,false);
  assert.equal(instance.data.isCheckingLogin,false);
  assert.match(instance.data.formError,/确认身份/);
});

test('旧身份与无身份归属的队列不能自动重放', async () => {
  let storage=[];let calls=0;
  const app={globalData:{isLogin:true,openid:'user-a',role:'member'}};
  const ctx={module:{exports:{}},getApp:()=>app,wx:{getStorageSync:()=>storage,setStorageSync:(key,value)=>{storage=value;}},require:key=>key.includes('apiAdapter')?{generateRequestId:()=> 'example',call:async()=>{calls++;return {success:true};}}:{isOnline:()=>true},setTimeout,clearTimeout};
  vm.runInNewContext(read('utils/outbox.js'),ctx);
  const queue=ctx.module.exports;
  queue.add('maintenanceTasks','exampleAction',{});
  app.globalData.openid='user-b';await queue.processQueue({untilEmpty:true});
  assert.equal(calls,0);assert.equal(storage.length,1);assert.equal(storage[0].status,'failed');
  storage=[{id:'legacy',status:'pending',nextAvailableAt:0,params:{}}];
  await queue.processQueue();assert.equal(calls,0);assert.equal(storage.length,1);assert.equal(storage[0].status,'failed');
});

test('EWA 汇总读取全部分页，失败不伪造 0 或抹掉已展示内容', async () => {
  let fail=false;
  const {instance,calls}=harness('pages/team/ewa/summary/index.js',{call:async(name,payload)=>fail?{success:false,message:'汇总失败'}:{success:true,data:{list:payload.params.page===1?Array.from({length:100},()=>({maintenanceEW:0,volunteerEW:0,dutyEW:0,totalEW:0})):[{maintenanceEW:100,volunteerEW:50,dutyEW:20,totalEW:72}],total:101}}});
  await instance.fetchSummary();assert.equal(calls.length,2);assert.equal(instance.data.totalUsers,101);assert.equal(instance.data.totalText,'72');
  fail=true;await instance.fetchSummary();assert.equal(instance.data.totalText,'72');assert.equal(instance.data.loadError,'汇总失败');
});

test('值班刷新遇到他人锁或占用时不再把失效的本地预选显示为可提交', () => {
  const {instance}=harness('pages/team/duty/roster/index.js');
  Object.assign(instance.data,{configData:{isEditingEnabled:true},selectedSlots:['locked','taken'],selectedSlotsDisplay:[{dutySlotId:'locked'},{dutySlotId:'taken'}],tableData:[{dailySlots:[
    {slotData:{dutySlotId:'locked',isAvailable:true,lockStatus:'locked',lockUserId:'another-user',lockExpireTime:'2099-01-01'}},
    {slotData:{dutySlotId:'taken',isAvailable:true,dutyHolderName:'另一位示例成员'}}
  ]}]});
  instance.updateTableDisplayStatus();
  assert.equal(instance.data.tableData[0].dailySlots[0].status,'locked');
  assert.equal(instance.data.tableData[0].dailySlots[1].status,'assigned');
  instance.reconcileLocalSelection();assert.equal(instance.data.selectedSlots.length,0);
});

test('预约校验不遮蔽时间工具，不会自动替换用户选择，过期保留输入', () => {
  const {instance}=harness('pages/repair/index.js');
  instance.data.appointmentDate='2000-01-01';instance.data.appointmentTime='09:00';
  assert.equal(instance.validateSelectedDateTime(instance.data.appointmentDate,instance.data.appointmentTime),false);
  assert.equal(instance.data.appointmentDate,'2000-01-01');assert.equal(instance.data.errorField,'appointmentTime');
  assert.equal(instance.validateSelectedDateTime('2099-01-01','10:00'),true);
});

test('EWA 调整缺失字段不能被空字符串自动保存为0', async () => {
  const {instance,calls}=harness('pages/team/ewa/manage/index.js');
  instance.data.editUser={ewaUserId:'sample',maintenanceEW:'',volunteerEW:0,dutyEW:0};
  await instance.saveUserEW();assert.equal(calls.length,0);assert.equal(instance.data.savingEW,false);
});
