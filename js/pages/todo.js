/* ==========================================================================
   生活象限 · js/pages/todo.js
   --------------------------------------------------------------------------
   Phase 5 候选 D：Todo page module（待办清单 + 页面内提醒弹窗）

   自 index.html 物理抽取（原 L5647–L6283，共 637 行），**逐字节原样迁移**（含 26 行段头注释）：
   47 个函数（42 个 todo* + 5 个提醒聚合非前缀：remindItemKey / remindSourceTitle /
   remindTodoItems / remindMemoItems / bindTodoPagers）+ 12 个顶层绑定。

   ⚠️ 业务规则一律未改（只搬位置）：
      · 业务日期每天 02:00 日切（todoBizDate：d.getHours() < 2 归前一天）
      · 每日待办「打卡」实例生成与无效实例清理（todoEnsureDaily / todoCleanLegacyDaily）
      · 模板生效日期取创建时刻的本地日历日（todoTemplateEffDate：15 号创建 → 15 号生效）
      · 页面内提醒弹窗（todoRemind*）：到点判定 + 「关闭提醒 / 稍后提醒」
      · Web Push / webhook 服务端通道代码仍在 index.html，未启用、未改动

   ⚠️ 加载期语句原样保留（3 条，只注册监听/定时器 + try 包裹的 localStorage 读取）：
      document.addEventListener('visibilitychange', …) · setInterval(…, 60000) ·
      try { todoCollapsed = localStorage.getItem('wb_todo_collapsed') === '1'; } catch(e){}
      → todoRemindTick() 只在回调内触发，加载期不执行任何应用函数。

   ⚠️ Classic Script（非 ESM）：HTML onclick 直接解析；运行期懒调用 js/bridge 与 memo 模块。
      数据只读写唯一的 state.todos（禁止第二状态树）。
   ========================================================================== */

/* =====================================================================
   待办清单（v5.9.2 独立模块：每日待办 / 临时待办 ＋ 提醒时间）
   ─────────────────────────────────────────────────────────────────────
   数据：state.todos.records[] = {
     id, type:'daily'|'temporary', content,
     businessDate:'YYYY-MM-DD'|null,      // 每日待办实例=业务日期（每天 02:00 切换）；模板 businessDate=null
     templateId:UUID|null,               // 每日待办实例指向模板 id；模板自身为 null（v5.10.3 打卡机制）
     done:bool, doneAt:ISO|null,          // 完成状态 / 实际完成时间（取实际操作时刻）
     reminderAt:ISO|null,                 // 提醒时间（本机时区；实例不自动重复提醒）
     reminderStatus:'none'|'pending'|'sent'|'failed'|'cancelled',
     reminderSentAt:ISO|null,             // 服务端回写的实际投递时间（前端只读）
     createdAt:ISO, _sbSaved:bool }
   云端：public.todos（DAL 模块名 'todos'，见 js/data/index.js）

   业务日期：每天 02:00 为切换点（02:00 前仍属前一天）——与系统自然日解耦。
   提醒（v5.13.11 起 =「页面内弹窗」，不再依赖任何推送服务）：
     · 到点判定：打开页面（或从后台切回）时检查 reminder_at <= now 且 reminder_status='pending'
       → 弹窗提醒（见下方 todoRemind* 函数）；页面打开期间另有 60 秒兜底检查。
     · 弹窗选项：「关闭提醒」写 reminder_status='sent'（这条不再提醒）；
                 「稍后提醒」保持 'pending' → 下次打开页面再弹（本次会话不再重复弹）。
     · 服务端推送通道（Edge Function `todo-reminder` + pg_cron + reminder_channels +
       Web Push）**代码全部保留，但用户端暂不展示、暂不启用**：
       Web Push 依赖 Google FCM（大陆被墙 + 国产 ROM 无 GMS → 必然失败）；
       国内可达通道（企业微信/钉钉/飞书群机器人）需每个用户各自配置一次。
   本模块不改动备忘录 / 油费 / 记账 / 睡眠 / 衣橱等任何既有数据与逻辑。
   ===================================================================== */
const TODO_LABEL = { daily: '每日待办', temporary: '临时待办' };
const TODO_REMIND_TEXT = { none: '', pending: '待提醒', sent: '已提醒', failed: '提醒失败', cancelled: '已取消提醒' };
let todoEditId = null;        /* 当前弹窗对应的待办 UUID（null = 新增） */
let todoEditType = 'daily';   /* 新增时归属的分区 */

function todoPad2(n){ return (n < 10 ? '0' : '') + n; }
/* 业务日期：每天 02:00 切换（02:00 前仍算前一天）→ 返回值即「当前业务日」 */
function todoBizDate(ts){
  const d = new Date(ts == null ? Date.now() : ts);
  if(d.getHours() < 2) d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + todoPad2(d.getMonth()+1) + '-' + todoPad2(d.getDate());
}
/* ISO / 时间戳 → 'YYYY-MM-DD HH:MM'（本地时区，展示用） */
function todoStamp(v){
  if(v == null || v === '') return '';
  const d = new Date(v);
  if(isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + todoPad2(d.getMonth()+1) + '-' + todoPad2(d.getDate()) + ' ' +
         todoPad2(d.getHours()) + ':' + todoPad2(d.getMinutes());
}
/* datetime-local 值（'YYYY-MM-DDTHH:MM'）→ ISO 字符串；空/非法 → '' */
function todoLocalToIso(v){
  if(!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
/* ISO → datetime-local 值 */
function todoIsoToLocal(iso){
  if(!iso) return '';
  const d = new Date(iso); if(isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + todoPad2(d.getMonth()+1) + '-' + todoPad2(d.getDate()) + 'T' +
         todoPad2(d.getHours()) + ':' + todoPad2(d.getMinutes());
}
/* 存储层：懒初始化（登录前 / 模块缺失时也能安全渲染） */
function todoStore(){
  if(!state.todos || typeof state.todos !== 'object' || !Array.isArray(state.todos.records)){
    state.todos = { records: [], deleted: [] };
  }
  if(!Array.isArray(state.todos.deleted)) state.todos.deleted = [];
  return state.todos;
}
function todoRecs(){ return todoStore().records; }
function todoById(id){ return todoRecs().find(t => String(t.id) === String(id)) || null; }
/* ── 待办实体判定（单一事实来源，v5.12.2）─────────────────────────────────
   模板(template)  = type='daily' && businessDate 为空 && templateId 为空
                    → 仅作「每日重复」的生成来源，**绝不作为列表项展示**
   实例(instance)  = type='daily' && businessDate 非空 && templateId 非空
                    → 某模板在某业务日的一次打卡；须「模板存活 且 businessDate >= 模板生效日」才有效
   一次性(one-off) = 临时待办，或 type='daily' && businessDate 非空 && templateId 为空
                    → 只在所属业务日出现一次，永不重复
   修复要点：模板不再进列表 → 不再出现「模板+实例」重复；模板也不再能被误删，从而不再产生孤儿实例。 */
function todoIsTemplate(t){ return !!t && t.type === 'daily' && !t.businessDate && !t.templateId; }
function todoIsInstance(t){ return !!t && t.type === 'daily' && !!t.businessDate && !!t.templateId; }
function todoIsOneOff(t){ return !!t && (t.type === 'temporary' || (t.type === 'daily' && !!t.businessDate && !t.templateId)); }
/* 有效「每日待办」列表项：排除模板；实例须模板存活且在生效日之后；一次性按业务日展示 */
function todoDailyItems(){
  const recs = todoRecs();
  const tpl = {};
  recs.filter(todoIsTemplate).forEach(t => { tpl[String(t.id)] = t; });
  const out = [];
  recs.forEach(t => {
    if(!t || t.type !== 'daily' || todoIsTemplate(t)) return;
    if(todoIsInstance(t)){
      const tp = tpl[String(t.templateId)];
      if(!tp) return;                                  /* 模板已不存在（孤儿实例）→ 非法，不展示 */
      const eff = todoTemplateEffDate(tp);
      if(eff && t.businessDate < eff) return;          /* 生效日之前的非法实例 → 不展示 */
      out.push(t); return;
    }
    if(t.businessDate) out.push(t);                    /* 一次性每日待办（templateId=null） */
  });
  return out;
}
/* 无效的每日实例（孤儿 / 生效日之前）→ 供清理软删：删除脏数据，而非在 UI 上隐藏旧日期 */
function todoDailyInvalid(){
  const recs = todoRecs();
  const tpl = {};
  recs.filter(todoIsTemplate).forEach(t => { tpl[String(t.id)] = t; });
  return recs.filter(t => {
    if(!todoIsInstance(t)) return false;
    const tp = tpl[String(t.templateId)];
    if(!tp) return true;
    const eff = todoTemplateEffDate(tp);
    return !!(eff && t.businessDate < eff);
  });
}
/* 展示态提醒状态：reminderSentAt 由服务端回写；已完成且未发送 → 视为已取消
   v5.13.11：补上 reminderStatus==='sent' 的判定 —— 页面内弹窗点「关闭提醒」后即为 'sent'；
   原实现只认服务端回写的 reminderSentAt，会把 'sent' 落回 'pending' 导致重复弹窗。 */
function todoRemindState(t){
  if(!t || !t.reminderAt) return 'none';
  if(t.reminderStatus === 'sent' || t.reminderSentAt) return 'sent';
  if(t.reminderStatus === 'failed') return 'failed';
  if(t.done) return 'cancelled';
  return 'pending';
}

/* =====================================================================
   v5.13.11 起：提醒 —— 页面内弹窗（纯前端，不依赖任何推送服务）
   v5.13.12：同时覆盖「待办」与「备忘」（备忘的提醒字段与待办完全同构）
   ─────────────────────────────────────────────────────────────────────
   规则（用户定义）：
     · 提醒时间【未到】就打开页面 → 不弹（安静等到点）；
     · 提醒时间【已过】才打开页面 → 弹窗提醒；
     · 弹窗两个选项：
         「关闭提醒」= 这条不再提醒（写 reminder_status='sent'）；
         「稍后提醒」= 保持 pending → 下次打开页面再弹（本次会话内不再重复弹）。
   触发时机：① enterApp 数据加载完成后 ② 页面重新可见（切回前台）③ 页面打开时每 60 秒兜底。
   持久化：只用既有字段 todos.reminder_status（'pending' → 'sent'），不新增表；
           前端只写 reminder_status（reminder_sent_at 仍归服务端，前端不可写）。
   说明：v5.13.11 起提醒改为纯前端页面内弹窗，因此这里刻意使用定时器；
         服务端推送通道（Edge Function + pg_cron + reminder_channels）保留但暂不启用。
   ===================================================================== */
var todoRemindShown = {};      /* 本次会话已弹过的项（key = kind:id；「稍后提醒」后本次不再弹） */
var todoRemindQueue = [];      /* 待弹队列（多条到点时逐条弹） */
var todoRemindCur = null;      /* 当前弹窗对应的项 {kind,id,title,text,reminderAt} */

/* v5.13.12：提醒统一抽象为「项」{kind:'todo'|'memo', id, title, text, reminderAt}
   （函数名保留 todoRemind* 前缀，避免改动已有内联绑定；实际同时服务于「待办」与「备忘」） */
function remindItemKey(it){ return it.kind + ':' + String(it.id); }
function remindSourceTitle(kind){ return kind === 'memo' ? '备忘提醒' : '待办提醒'; }

/* 待办侧：未完成、非模板、reminder_status='pending'、reminder_at <= now */
function remindTodoItems(){
  var now = Date.now();
  return todoRecs().filter(function(t){
    if(!t || !t.reminderAt) return false;
    if(t.done) return false;
    if(todoIsTemplate(t)) return false;                        /* 模板不是可提醒实体 */
    if(String(t.reminderStatus || 'none') !== 'pending') return false;
    var ts = new Date(t.reminderAt).getTime();
    return !isNaN(ts) && ts <= now;                            /* 已过点才提醒 */
  }).map(function(t){
    return { kind: 'todo', id: t.id, title: remindSourceTitle('todo'),
             text: t.content || '', reminderAt: t.reminderAt };
  });
}
/* 备忘侧：reminder_status='pending'、reminder_at <= now（标题 + 正文一起显示） */
function remindMemoItems(){
  var now = Date.now();
  return loadMemos().filter(function(m){
    if(!m || !m.reminderAt) return false;
    if(String(m.reminderStatus || 'none') !== 'pending') return false;
    var ts = new Date(m.reminderAt).getTime();
    return !isNaN(ts) && ts <= now;
  }).map(function(m){
    return { kind: 'memo', id: m._id, title: remindSourceTitle('memo'),
             text: (m.title ? m.title + '\n' : '') + (m.t || ''), reminderAt: m.reminderAt };
  });
}
/* 「已到点且待提醒」的项：待办 + 备忘，按提醒时间升序（最早到点的先弹） */
function todoRemindDueList(){
  return remindTodoItems().concat(remindMemoItems())
    .filter(function(it){ return !todoRemindShown[remindItemKey(it)]; })    /* 本次会话已弹过 → 跳过 */
    .sort(function(a, b){ return new Date(a.reminderAt) - new Date(b.reminderAt); });
}
/* 入口：检查并弹出（未登录 / 已有弹窗在显示 / 无到点项 → 直接返回） */
function todoRemindTick(){
  try{
    if(!state || !state.user) return;
    if(todoRemindCur) return;
    var due = todoRemindDueList();
    if(!due.length) return;
    todoRemindQueue = due.slice(1);
    todoRemindShow(due[0]);
  }catch(e){}
}
function todoRemindShow(it){
  if(!it) return;
  todoRemindCur = it;
  todoRemindShown[remindItemKey(it)] = true;      /* 本次会话只弹一次 */
  var ti = $('trTitle'); if(ti) ti.textContent = '🔔 ' + it.title;
  var el = $('trText'); if(el) el.textContent = it.text || '';
  var tm = $('trTime'); if(tm) tm.textContent = '提醒时间：' + todoStamp(it.reminderAt);
  var more = $('trMore');
  if(more){
    var rest = todoRemindQueue.length;
    more.style.display = rest > 0 ? 'block' : 'none';
    more.textContent = rest > 0 ? ('还有 ' + rest + ' 条到点提醒') : '';
  }
  var pop = $('todoRemindPop'); if(pop) pop.style.display = 'flex';
}
function todoRemindNext(){
  if(!todoRemindQueue.length) return;
  var nt = todoRemindQueue.shift();
  setTimeout(function(){ todoRemindShow(nt); }, 200);         /* 稍作间隔，避免弹窗瞬切 */
}
/* 「关闭提醒」：这条不再提醒（待办 / 备忘分别写回各自表的 reminder_status='sent'） */
function todoRemindClose(){
  var it = todoRemindCur;
  if(it && it.kind === 'memo'){
    var m = memoById(it.id);
    if(m){
      m.reminderStatus = 'sent';
      sbSaveObj('memos', {_id: m._id, id: m._id, _sbSaved: m._sbSaved}, { reminder_status: 'sent' });
    }
    try{ memoRefreshAll(); }catch(e){}
  }else if(it){
    var t = todoById(it.id);
    if(t){ t.reminderStatus = 'sent'; sbSaveObj('todos', t, { reminder_status: 'sent' }); }
    try{ todoRefreshViews(); }catch(e){}   /* v5.27.0：提醒状态也影响行内 🔔，首页与弹窗一起刷新 */
  }
  todoRemindCur = null;
  var pop = $('todoRemindPop'); if(pop) pop.style.display = 'none';
  toast('已关闭该提醒');
  todoRemindNext();
}
/* 「稍后提醒」：保持 pending → 下次打开页面（或从后台切回）会再次弹出 */
function todoRemindLater(){
  todoRemindCur = null;
  var pop = $('todoRemindPop'); if(pop) pop.style.display = 'none';
  toast('稍后提醒：下次打开页面再弹');
  todoRemindNext();
}
/* 触发登记：切回前台 + 每 60 秒兜底（仅登录后生效；切后台不算「打开页面」，不会重复弹） */
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'visible') todoRemindTick();
});
setInterval(function(){
  if(document.visibilityState === 'visible') todoRemindTick();
}, 60000);
/* 排序：未完成在前，同组按创建顺序（清单语义） */
function todoCmp(a, b){
  const d = (a.done ? 1 : 0) - (b.done ? 1 : 0);
  if(d) return d;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}
/* 折叠态（v5.11.0）：整卡一键折叠，状态记本机 localStorage（不随账号）；折叠后每板块只露一条，可上下滑动逐条切换 */
let todoCollapsed = false;
try { todoCollapsed = (localStorage.getItem('wb_todo_collapsed') === '1'); } catch(e){}
let todoDailyCursor = 0, todoTempCursor = 0;   // 折叠后各板块当前显示的明细序号（不持久化）
let todoDailyLen = 0, todoTempLen = 0;
let todoPagersBound = false;
function todoToggleCollapse(){
  todoCollapsed = !todoCollapsed;
  try { localStorage.setItem('wb_todo_collapsed', todoCollapsed ? '1' : '0'); } catch(e){}
  todoRender();
}
function todoPagerStep(sect, delta){
  if(!todoCollapsed) return;
  const len = (sect === 'daily') ? todoDailyLen : todoTempLen;
  if(len <= 1) return;
  let i = (sect === 'daily') ? todoDailyCursor : todoTempCursor;
  i = Math.min(len - 1, Math.max(0, i + delta));
  if(sect === 'daily') todoDailyCursor = i; else todoTempCursor = i;
  todoRender();
}
function bindTodoPagers(){
  ['daily','temp'].forEach(function(sect){
    const box = (sect === 'daily') ? $('todoDailyList') : $('todoTempList');
    if(!box) return;
    let sy = null;
    box.addEventListener('touchstart', function(e){ sy = e.touches[0].clientY; }, { passive:true });
    box.addEventListener('touchend', function(e){
      if(sy === null || !todoCollapsed) return;
      const dy = e.changedTouches[0].clientY - sy; sy = null;
      if(Math.abs(dy) > 28) todoPagerStep(sect, dy < 0 ? 1 : -1);
    }, { passive:true });
    box.addEventListener('wheel', function(e){
      if(!todoCollapsed || Math.abs(e.deltaY) < 6) return;
      todoPagerStep(sect, e.deltaY > 0 ? 1 : -1);
    }, { passive:true });
  });
}
function todoItemHTML(t, pre){
  const done = !!t.done;
  const rs = todoRemindState(t);
  const bell = (rs === 'none') ? '' :
    '<span class="todo-bell' + (rs === 'pending' ? ' on' : '') + '" title="' +
    spEsc('提醒 ' + todoStamp(t.reminderAt) + (TODO_REMIND_TEXT[rs] ? ' · ' + TODO_REMIND_TEXT[rs] : '')) + '">🔔</span>';
  return '<div class="todo-item' + (done ? ' done' : '') + '" data-id="' + spEsc(String(t.id)) + '">' +
    (pre ? '<span class="todo-pre">' + pre + '</span>' : '') +
    '<button class="todo-ck" type="button" data-ck="' + spEsc(String(t.id)) + '">' + (done ? '✓' : '') + '</button>' +
    '<span class="todo-tx">' + spEsc(t.content || '') + '</span>' + bell +
    '<button class="todo-ed" type="button" data-ed="' + spEsc(String(t.id)) + '">✏</button>' +
  '</div>';
}
function todoEmptyHTML(){ return '<div class="todo-empty">还没有待办，点右上角 ＋ 添加</div>'; }
/* v5.27.0：待办行的「完成 / 编辑」点击绑定 —— 首页两区与「全部待办」弹窗**共用同一套**，不复制业务代码。
   每次渲染后重新赋值（onclick 覆盖式赋值，不会累积重复监听）。 */
function todoBindItems(box){
  if(!box) return;
  box.querySelectorAll('[data-ck]').forEach(b => { b.onclick = function(e){ e.stopPropagation(); todoToggle(this.dataset.ck); }; });
  box.querySelectorAll('[data-ed]').forEach(b => { b.onclick = function(e){ e.stopPropagation(); todoOpenDetail(this.dataset.ed); }; });
}
/* 折叠态：每板块只显示排序后第一条（触摸上下滑 / 桌面滚轮可逐条切换，无可见翻页箭头） */
function todoCollapsedOne(items, sect, dateOf){
  if(!items.length) return todoEmptyHTML();
  let i = (sect === 'daily') ? todoDailyCursor : todoTempCursor;
  if(i >= items.length) i = 0;
  if(i < 0) i = 0;
  const t = items[i];
  const pre = (sect === 'daily' && dateOf) ? spEsc(dateOf(t)) : '';
  return todoItemHTML(t, pre);
}
/* 渲染两区（每次渲染后重绑事件，避免重复绑定） */
function todoRender(){
  try{
    if(!todoPagersBound){ bindTodoPagers(); todoPagersBound = true; }
    const cb = $('todoCollapseBtn');
    if(cb) cb.textContent = todoCollapsed ? '⌄' : '⌃';
    todoEnsureDaily();              // v5.10.4：每日待办「打卡」——每次渲染前确保当天实例已生成
    const biz = todoBizDate();
    /* ---- ① 每日待办：只展示「有效实例 + 一次性」；模板(template)永不进列表（历史按业务日期倒序） ---- */
    const dl = $('todoDailyList');
    if(dl){
      const byDate = {};
      todoDailyItems().forEach(t => {
        const k = t.businessDate || '';
        if(!k) return;                                   /* 防御：无业务日期的记录不进每日区 */
        (byDate[k] = byDate[k] || []).push(t);
      });
      const dates = Object.keys(byDate).sort((a, b) => String(b).localeCompare(String(a)));   /* 新日期在前 */
      if(!dates.length){
        dl.innerHTML = todoEmptyHTML();
        todoDailyLen = 0;
      }else if(todoCollapsed){
        const flat = [];
        dates.forEach(dt => byDate[dt].slice().sort(todoCmp).forEach(t => flat.push(t)));
        todoDailyLen = flat.length;
        dl.innerHTML = todoCollapsedOne(flat, 'daily', function(t){
          const dt = t.businessDate || '';
          return dt + (dt === biz ? ' · 今天' : '');
        });
      }else{
        let html = '';
        if(!byDate[biz]) html += '<div class="todo-empty">今日暂无待办，点 ＋ 添加</div>';
        dates.forEach(dt => {
          html += '<div class="todo-day">' + spEsc(dt + (dt === biz ? ' · 今天' : '')) + '</div>';
          html += byDate[dt].slice().sort(todoCmp).map(t => todoItemHTML(t)).join('');
        });
        dl.innerHTML = html;
        todoDailyLen = 0;
      }
      const today = byDate[biz] || [];
      const c = $('todoDailyCnt');
      if(c) c.textContent = today.length ? '（' + today.filter(t => t.done).length + '/' + today.length + '）' : '';
    }
    /* ---- ② 临时待办：不随业务日切换，长期保留 ---- */
    const tl = $('todoTempList');
    if(tl){
      const all = todoRecs().filter(t => t.type === 'temporary');
      if(!all.length){
        tl.innerHTML = todoEmptyHTML();
        todoTempLen = 0;
      }else if(todoCollapsed){
        todoTempLen = all.length;
        tl.innerHTML = todoCollapsedOne(all.slice().sort(todoCmp), 'temp', null);
      }else{
        tl.innerHTML = all.slice().sort(todoCmp).map(t => todoItemHTML(t)).join('');
        todoTempLen = 0;
      }
      const c2 = $('todoTempCnt');
      if(c2) c2.textContent = all.length ? '（' + all.filter(t => t.done).length + '/' + all.length + '）' : '';
    }
    /* ---- 事件绑定（与「全部待办」弹窗共用同一套行绑定） ---- */
    [dl, tl].forEach(todoBindItems);
    /* v5.27.0：两区标题（含 ⤢ 提示）可点击 → 打开「全部待办」弹窗。
       标题栏原本没有任何点击事件（折叠 ⌄/⌃ 与 ＋ 是独立 button，点在它们上不会冒泡到这里，
       因为绑定目标只有标题 span 本身），故直接赋值即可，既扩展了交互也不会与折叠/新增冲突。 */
    const dtl = $('todoDailyTitle'); if(dtl) dtl.onclick = function(){ todoOpenFull('daily'); };
    const ttl = $('todoTempTitle'); if(ttl) ttl.onclick = function(){ todoOpenFull('temporary'); };
  }catch(e){ console.error('todoRender 异常：', e); }
}
/* =====================================================================
   v5.27.0：「全部待办」放大查看弹窗（#todoFullMask）
   ---------------------------------------------------------------------
   一个弹窗 + 动态标题/数据：点「每日待办」标题看全部每日待办，点「临时待办」标题看全部临时待办。
   首页原有展示**完全不变**（每区仍是「约 3 行高 + 内部滚动」，见 css/pages/todo.css 的 .todo-list），
   本弹窗只是把**同一份数据全量铺开**，不限制条数。

   一律复用既有数据与业务，不新造一套：
     · 每日：todoDailyItems()（自动排除模板、过滤孤儿/生效日之前的非法实例）+ 按业务日分组 + todoCmp 排序
     · 临时：todoRecs().filter(type === 'temporary') + todoCmp 排序
     · 行模板 todoItemHTML()（⭕/☑ + 内容 + 🔔 + ✏，与首页同一模板）
     · 行事件 todoBindItems()（完成 todoToggle 的二次确认与完成时间、编辑 todoOpenDetail）全都不变
     · todoEnsureDaily()「每日打卡」保障也走同一条路径，02:00 业务日切/模板生效日规则未改
   ===================================================================== */
let todoFullType = null;   /* 'daily' | 'temporary'；null = 弹窗未打开 */
/* 弹窗列表正文（纯拼 HTML，不含事件；数据与排序与首页一致，只是不截断） */
function todoFullHTML(){
  if(todoFullType === 'daily'){
    const biz = todoBizDate();
    const byDate = {};
    todoDailyItems().forEach(t => {
      const k = t.businessDate || '';
      if(!k) return;                                     /* 防御：无业务日期的记录不进每日区（与首页同规则） */
      (byDate[k] = byDate[k] || []).push(t);
    });
    const dates = Object.keys(byDate).sort((a, b) => String(b).localeCompare(String(a)));   /* 新日期在前 */
    if(!dates.length) return todoEmptyHTML();
    return dates.map(dt =>
      '<div class="todo-day">' + spEsc(dt + (dt === biz ? ' · 今天' : '')) + '</div>' +
      byDate[dt].slice().sort(todoCmp).map(t => todoItemHTML(t)).join('')
    ).join('');
  }
  const all = todoRecs().filter(t => t.type === 'temporary');
  if(!all.length) return todoEmptyHTML();
  return all.slice().sort(todoCmp).map(t => todoItemHTML(t)).join('');
}
/* 重渲染弹窗内容（弹窗未打开时为空操作） */
function todoFullRender(){
  if(!todoFullType) return;
  const box = $('todoFullBody'); if(!box) return;
  todoEnsureDaily();                                     /* 与首页同一条「每日打卡」保障，规则未改 */
  const title = $('todoFullTitle');
  if(title) title.textContent = (TODO_LABEL[todoFullType] || '待办') + ' · 全部';
  box.innerHTML = todoFullHTML();
  todoBindItems(box);                                    /* 与首页共用同一套行事件绑定 */
}
/* 打开：先读最新数据再渲染，然后显示；滚动位置回到顶部 */
function todoOpenFull(type){
  todoFullType = (type === 'temporary') ? 'temporary' : 'daily';
  todoFullRender();
  const body = $('todoFullBody'); if(body) body.scrollTop = 0;
  const m = $('todoFullMask'); if(m) m.style.display = 'flex';
}
/* 关闭：只收起弹窗、清掉当前类型；不影响首页的展开/折叠状态与任何数据 */
function todoCloseFull(){
  const m = $('todoFullMask'); if(m) m.style.display = 'none';
  todoFullType = null;
}
/* 首页两区 + 「全部待办」弹窗统一刷新（完成 / 编辑 / 删除后调用；弹窗未打开时只刷新首页） */
function todoRefreshViews(){
  todoRender();
  try{ todoFullRender(); }catch(e){}
}

/* 新建：每日待办改为「模板」（businessDate=null），由 todoEnsureDaily 每天生成未完成实例；临时待办无日期 */
function todoCreate(type, content, remindIso){
  const isTemp = (type === 'temporary');
  const t = {
    id: wbUuid(),
    type: isTemp ? 'temporary' : 'daily',
    content: content,
    businessDate: null,          // 每日待办=模板（无业务日期）；实例由 todoEnsureDaily 按业务日生成
    done: false, doneAt: null,
    reminderAt: remindIso || null,
    reminderStatus: remindIso ? 'pending' : 'none',
    reminderSentAt: null,
    templateId: null,            // 每日待办模板自身 templateId 为空；生成的实例填模板 id
    createdAt: new Date().toISOString(),
    _sbSaved: false
  };
  todoRecs().push(t);
  sbSaveObj('todos', t, {
    type: t.type, content: t.content, business_date: t.businessDate,
    done: false, done_at: null, reminder_at: t.reminderAt, reminder_status: t.reminderStatus,
    template_id: t.templateId
  });
  return t;
}
/* 模板生效日期 = 创建时刻的「本地日历日」（YYYY-MM-DD）；模板只能从生效日期起生成实例（v5.11.1）。
   v5.11.3：createdAt/created_at 是 UTC 时间戳，原先直接 slice(0,10) 取 UTC 日期——
   东八区 00:00–07:59 创建会被算成前一天生效（15日创建→14日生效→14日出现实例）。改为转本地日期。 */
function todoTemplateEffDate(tp){
  const c = tp.createdAt || '';
  if(!c) return '';
  const d = new Date(c);
  if(!isNaN(d.getTime())) return d.getFullYear() + '-' + todoPad2(d.getMonth() + 1) + '-' + todoPad2(d.getDate());
  return (c.length >= 10) ? c.slice(0, 10) : '';   /* 解析失败退回字符串截断（兼容旧数据） */
}
/* 清理「无效每日实例」：① 孤儿（模板已不存在）② 生效日之前被错误生成。
   仅处理 type='daily' 且 templateId 非空的行；一次性/临时待办（templateId=null）一律不受影响。
   v5.12.2：改为「每次渲染都校验并软删」，不再用「会话内只跑一次」标记（否则登录/刷新后不再清理）。 */
function todoCleanLegacyDaily(){
  try{
    const recs = todoRecs();
    todoDailyInvalid().forEach(function (t) {
      try { sbRemoveObj('todos', t); } catch (e) {}
      const i = recs.indexOf(t); if(i >= 0) recs.splice(i, 1);   // 本地立即移除
    });
  }catch(e){ console.error('todoCleanLegacyDaily 异常：', e); }
}
/* v5.13.6（Phase 1·待办提醒）：每日待办「实例」继承模板的提醒时刻。
   ─────────────────────────────────────────────────────────────
   语义（已确认）：模板只提供「一天中的时刻」，实例按自己的业务日套用该时刻：
     模板 reminderAt = 09:00  →  09-15 实例 = 2026-09-15 09:00
                              →  09-16 实例 = 2026-09-16 09:00
   模板上的「日期」不参与计算（并不表示"从某天才开始提醒"）。
   边界：算出的时刻若已经过去（例如当天 10:00 才首次打开、提醒时间为 09:00），
         本次不设提醒（返回 null）→ 避免打开 App 时立刻补发一条过期通知。
   返回：可投放的提醒时刻 ISO 字符串；未设提醒 / 已过点 → null。
   注意：只影响「新生成」的实例；当天已存在的实例由编辑流程（todoSaveEdit）更新。 */
function todoReminderForBiz(tp, biz){
  if(!tp || !tp.reminderAt || !biz) return null;
  const src = new Date(tp.reminderAt);
  if(isNaN(src.getTime())) return null;
  const p = String(biz).split('-');
  if(p.length !== 3) return null;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
                     src.getHours(), src.getMinutes(), 0, 0);
  if(isNaN(d.getTime())) return null;
  if(d.getTime() <= Date.now()) return null;
  return d.toISOString();
}
/* 每日待办「打卡」机制（v5.10.3）：
   每条每日待办 = 一条模板(template：type='daily'、businessDate 空、templateId 空)。
   每次渲染前，为「当前业务日」生成一份未完成实例（businessDate=今日业务日、templateId=模板 id）。
   铁律：模板「生效日」（= 模板创建时刻的本地日历日）之前，绝不生成任何实例。
   幂等：同一模板同一业务日已存在实例则跳过，不会重复生成。旧业务日实例保留为历史。
   v5.12.2：只认「模板」实体生成（谓词 todoIsTemplate），一次性/临时/实例都不参与生成。 */
function todoEnsureDaily(){
  try{
    todoCleanLegacyDaily();          // 先清理无效实例（孤儿 / 生效日之前）
    const biz = todoBizDate();
    const recs = todoRecs();
    recs.filter(todoIsTemplate).forEach(function (tp) {
      const eff = todoTemplateEffDate(tp);
      if(eff && biz < eff) return;   // 生效日之前绝不生成实例（含 02:00 业务日边界回溯）
      const exists = recs.some(function (r) {
        return todoIsInstance(r) && r.businessDate === biz && String(r.templateId) === String(tp.id);
      });
      if(exists) return;
      const rIso = todoReminderForBiz(tp, biz);   /* v5.13.6：继承模板提醒时刻（已过点 → null） */
      const inst = {
        id: wbUuid(), type: 'daily', content: tp.content,
        businessDate: biz, done: false, doneAt: null,
        reminderAt: rIso, reminderStatus: rIso ? 'pending' : 'none', reminderSentAt: null,
        templateId: tp.id, createdAt: new Date().toISOString(), _sbSaved: false
      };
      recs.push(inst);
      sbSaveObj('todos', inst, {
        type: 'daily', content: inst.content, business_date: inst.businessDate,
        done: false, done_at: null, reminder_at: rIso, reminder_status: rIso ? 'pending' : 'none',
        template_id: tp.id
      });
    });
  }catch(e){ console.error('todoEnsureDaily 异常：', e); }
}
/* 完成 / 取消完成（均二次确认）；完成时间取实际操作时刻 */
function todoToggle(id){
  const t = todoById(id); if(!t) return;
  if(!t.done){
    if(!confirm('标记为「已完成」？')) return;
    const now = new Date().toISOString();
    t.done = true; t.doneAt = now;
    if(t.reminderAt && !t.reminderSentAt) t.reminderStatus = 'cancelled';   /* 已完成 → 服务端不再投递 */
    sbSaveObj('todos', t, { done: true, done_at: now, reminder_status: t.reminderStatus });
    toast('已完成 ✓');
  }else{
    if(!confirm('取消完成，恢复为「未完成」？')) return;
    t.done = false; t.doneAt = null;
    if(t.reminderAt && !t.reminderSentAt) t.reminderStatus = 'pending';     /* 复原 → 重新排队等待投递 */
    sbSaveObj('todos', t, { done: false, done_at: null, reminder_status: t.reminderStatus });
    toast('已取消完成');
  }
  todoRefreshViews();   /* v5.27.0：首页两区 + 「全部待办」弹窗一起刷新（弹窗未打开时只刷新首页） */
}
/* ---------- 详情 / 编辑弹窗（复用通用 .wb-* 框架） ---------- */
const TODO_MODAL = { mask:'todoEditMask', title:'todoModalTitle', viewBox:'todoViewBox', formBox:'todoFormBox' };
function todoShowBox(view){
  const title = view ? '待办详情'
    : (todoEditId ? '✏️ 编辑待办' : ('＋ 新增' + (TODO_LABEL[todoEditType] || '待办')));
  wbModalShow(TODO_MODAL, view, title);
}
function todoEditMetaHint(){
  const el = $('todoEditMeta'); if(!el) return;
  if(todoEditType === 'daily'){
    el.textContent = '「每日待办」· 每天自动生成一份新的未完成待办（打卡），历史按业务日期归档（每天 02:00 切换，02:00 前算前一天）。' +
                     '提醒时间只取「时刻」—— 此后每天到该时刻各提醒一次（今天该时刻已过则从明天开始）。';
  }else{
    el.textContent = '归入「临时待办」· 不随每日初始化清空，长期保留；提醒时间只对本次这一条生效。';
  }
}
function todoOpenNew(type){
  todoEditId = null;
  todoEditType = (type === 'temporary') ? 'temporary' : 'daily';
  if($('todoEditText')) $('todoEditText').value = '';
  if($('todoEditRemind')) $('todoEditRemind').value = '';
  todoEditMetaHint();
  todoShowBox(false);
  const f = $('todoEditText');
  if(f){ try{ f.focus(); }catch(e){} }   /* 同步聚焦即可，无需 setTimeout */
}
function todoOpenDetail(id){
  const t = todoById(id); if(!t) return;
  todoEditId = t.id; todoEditType = t.type;
  const b = $('todoViewBody'); if(b) b.textContent = t.content || '';
  const rows = $('todoViewRows');
  if(rows){
    const rs = todoRemindState(t);
    let html = wbRowHTML('类型', TODO_LABEL[t.type] || t.type);
    if(t.type === 'daily') html += wbRowHTML('归属日期', spEsc(t.businessDate || '—'));
    html += wbRowHTML('创建时间', spEsc(todoStamp(t.createdAt) || '—'));
    if(t.done){
      html += wbRowHTML('完成状态', '✓ 已完成', 'inc');
      html += wbRowHTML('完成时间', spEsc(todoStamp(t.doneAt) || '—'));
    }else{
      html += wbRowHTML('完成状态', '未完成');
    }
    if(t.reminderAt){
      html += wbRowHTML('提醒时间', spEsc(todoStamp(t.reminderAt)));
      html += wbRowHTML('提醒状态', spEsc(TODO_REMIND_TEXT[rs] || rs));
      if(t.reminderSentAt) html += wbRowHTML('实际提醒于', spEsc(todoStamp(t.reminderSentAt)));
    }else{
      html += wbRowHTML('提醒', '未设置');
    }
    rows.innerHTML = html;
  }
  const tm = $('todoViewTime');
  if(tm) tm.textContent = (t.done && t.doneAt) ? ('完成于 ' + todoStamp(t.doneAt)) : '';
  todoShowBox(true);
}
function todoSwitchEdit(){
  const t = todoEditId ? todoById(todoEditId) : null;
  if(t){
    if($('todoEditText')) $('todoEditText').value = t.content || '';
    if($('todoEditRemind')) $('todoEditRemind').value = todoIsoToLocal(t.reminderAt);
  }
  todoEditMetaHint();
  todoShowBox(false);
}
function todoCloseEdit(){
  wbModalHide(TODO_MODAL);
  todoEditId = null;
  if($('todoEditText')) $('todoEditText').value = '';
  if($('todoEditRemind')) $('todoEditRemind').value = '';
  if($('todoEditMeta')) $('todoEditMeta').textContent = '';
}
function todoSaveEdit(){
  const v = ($('todoEditText') ? $('todoEditText').value : '').trim();
  if(!v){ toast('内容不能为空'); return; }
  const remind = todoLocalToIso($('todoEditRemind') ? $('todoEditRemind').value : '');
  if(todoEditId){
    const t = todoById(todoEditId);
    if(!t){ todoCloseEdit(); todoRefreshViews(); return; }
    t.content = v;
    /* 提醒时间有变 → 状态重置为待提醒并清掉旧的投递时间（服务端按新时间重新排队） */
    if(String(t.reminderAt || '') !== String(remind || '')){
      t.reminderAt = remind || null;
      t.reminderStatus = remind ? 'pending' : 'none';
      t.reminderSentAt = null;
    }
    sbSaveObj('todos', t, { content: t.content, reminder_at: t.reminderAt, reminder_status: t.reminderStatus });
    /* 每日待办实例 → 同步更新其「模板」（业务定义），使之后续日期沿用新内容/提醒 */
    if(t.type === 'daily' && t.templateId){
      const tp = todoById(t.templateId);
      if(tp){
        tp.content = v;
        if(String(tp.reminderAt || '') !== String(remind || '')){
          tp.reminderAt = remind || null;
          tp.reminderStatus = remind ? 'pending' : 'none';
          tp.reminderSentAt = null;
        }
        sbSaveObj('todos', tp, { content: tp.content, reminder_at: tp.reminderAt, reminder_status: tp.reminderStatus });
      }
    }
  }else{
    todoCreate(todoEditType, v, remind);
  }
  todoCloseEdit(); todoRefreshViews(); toast('已保存 ✓');
}
function todoDelete(id, skipConfirm){
  const st = todoStore();
  const t = st.records.find(x => String(x.id) === String(id));
  if(!t){ todoRefreshViews(); return; }
  /* 每日待办（实例或模板）→ 级联删除整条「模板」（含全部历史实例）；一次性/临时待办只删自身。
     v5.12.2：删「模板」本身也级联其全部实例，杜绝产生孤儿实例。 */
  const tplId = (t.type === 'daily') ? (t.templateId || (todoIsTemplate(t) ? t.id : null)) : null;
  const recurring = !!tplId;
  if(!skipConfirm && !confirm(recurring ? '删除这条每日待办（含全部历史）？' : '删除这条待办？')) return;
  if(recurring){
    const victimIds = {};
    victimIds[String(t.id)] = 1; victimIds[String(tplId)] = 1;
    st.records.forEach(function (x) {
      if(x.type === 'daily' && x.templateId && String(x.templateId) === String(tplId)) victimIds[String(x.id)] = 1;
    });
    st.records.forEach(function (x) { if(victimIds[String(x.id)]) sbRemoveObj('todos', x); });
    st.records = st.records.filter(function (x) { return !victimIds[String(x.id)]; });
  }else{
    st.records = st.records.filter(x => String(x.id) !== String(id));
    sbRemoveObj('todos', t);                                     /* DAL 软删除 */
  }
  if(todoEditId && String(todoEditId) === String(id)) todoCloseEdit();
  todoRefreshViews(); toast('已删除');
}
function todoDeleteEdit(){
  const id = todoEditId; if(!id) return;
  if(!confirm('删除这条待办？')) return;
  todoCloseEdit();
  todoDelete(id, true);                                        /* 已确认，避免二次弹窗 */
}
