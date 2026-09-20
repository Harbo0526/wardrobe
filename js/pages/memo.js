/* ==========================================================================
   生活象限 · js/pages/memo.js
   --------------------------------------------------------------------------
   Phase 5 候选 D：Memo page module（备忘：首页备忘卡 + 详情/编辑/日历/搜索弹窗）

   自 index.html 物理抽取（原 L2600–L2934，共 335 行），**逐字节原样迁移**：
   42 个函数（31 个 memo* + 11 个备忘专属非前缀：loadMemoStore / saveMemoStore / loadMemos /
   renderMemos / addMemo / delMemo / mergeMemoStores / pushMemoData / pullMemoData /
   tryPullMemo / wbDateToLocalTs）+ 3 个顶层绑定（MEMO_MODAL / memoEditId / memoCalState）。

   ⚠️ Classic Script（非 ESM）：顶层 function 声明即全局对象属性 →
      HTML onclick 与主脚本 / js/bridge 均按懒调用解析，无需任何 window.* 包装。

   ⚠️ 加载位置：紧跟 js/pages/fuel.js、位于主内联脚本之后；加载期 0 处应用调用。
      本模块在运行期调用 js/bridge 的 sbSaveObj / sbRemoveObj / wbUuid（bridge 更晚加载，
      全部为函数体内懒调用）；与 js/pages/todo.js 互有 3 处懒调用（提醒文案与提醒时刻）。

   ⚠️ 本模块的备忘数据只读写唯一的 state.memos（禁止第二状态树）。
      旧 Gitee 同步路径（userDir / giteeReadJSON / giteeWriteJSON / getGiteeToken）仍留在
      index.html，本模块只调用、不复制。
   ========================================================================== */

/* 备忘（Phase 16 修复）：唯一数据源 = 内存 state.memos（云端经 sbLoadAll 下拉 / sbSaveObj 上行同步）。
   V4.x 的 localStorage 路径已废弃——业务数据不落盘（红线），且导致跨设备同步后 UI 不显示云端备忘。 */
function memoKey(){ return 'memo_' + (state.user && state.user.name ? state.user.name : 'guest'); } /* 仅保留旧 key 名兼容检查，不再读写 */
function loadMemoStore(){
  if(!state.memos || typeof state.memos !== 'object' || !Array.isArray(state.memos.memos)){
    state.memos = { memos: [], deleted: [] };
  }
  if(!Array.isArray(state.memos.deleted)) state.memos.deleted = [];
  return state.memos;
}
function saveMemoStore(st){ state.memos = { memos: st.memos, deleted: st.deleted }; }
function loadMemos(){ return loadMemoStore().memos; }
/* ---------- v5.7.0 备忘公共工具（日期一律走本地时间，避免 UTC 解析错位） ---------- */
function memoPad2(n){ return (n < 10 ? '0' : '') + n; }
/* 时间戳 → 本地日期键 YYYY-MM-DD（与日历/搜索/编辑共用同一口径） */
function memoDateKey(ts){
  const d = new Date(Number(ts));
  return d.getFullYear() + '-' + memoPad2(d.getMonth()+1) + '-' + memoPad2(d.getDate());
}
function memoTimeHM(ts){ const d = new Date(Number(ts)); return memoPad2(d.getHours()) + ':' + memoPad2(d.getMinutes()); }
function memoShortTime(ts){ const d = new Date(Number(ts)); return (d.getMonth()+1) + '/' + d.getDate() + ' ' + memoTimeHM(ts); }
/* YYYY-MM-DD → 本地时间戳；时分秒毫秒沿用 baseTs（新建用「现在」），确保同日多条不冲突且当天排序自然 */
function memoDateToTs(dateStr, baseTs){
  const p = String(dateStr || '').split('-').map(Number);
  if(p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
  const b = baseTs ? new Date(Number(baseTs)) : new Date();
  return new Date(p[0], p[1]-1, p[2], b.getHours(), b.getMinutes(), b.getSeconds(), b.getMilliseconds()).getTime();
}
/* 备忘身份统一用 _id（UUID，稳定）：修复原代码用 at 做身份 + 字符串/数字比较导致的删除失效 */
function memoById(id){ return loadMemos().find(m => m && String(m._id) === String(id)) || null; }
/* 任何增/改/删后统一刷新：列表 +（若打开）日历 +（若打开）搜索结果 */
function memoRefreshAll(){
  try{ renderMemos(); }catch(e){}
  try{ const c = $('memoCalMask'); if(c && c.style.display !== 'none') memoRenderCal(); }catch(e){}
  try{ const s = $('memoSearchMask'); if(s && s.style.display !== 'none') memoRunSearch(); }catch(e){}
}
function renderMemos(){
  const list = $('home-memo-list'); if(!list) return;
  const memos = loadMemos().slice().sort((a,b)=>b.at-a.at);   // 最新在最上
  const cnt = $('home-memo-cnt');
  if(cnt) cnt.textContent = memos.length ? memos.length + ' 条' : '';
  if(!memos.length){
    list.innerHTML = '<div style="text-align:center;font-size:12px;color:var(--ink-faint);padding:8px 0;">还没有备忘，记一条吧 📝</div>';
    return;
  }
  list.innerHTML = memos.map(m=>{
    const id = String(m._id || '');
    /* v5.13.12：已设提醒的备忘显示 🔔（纯展示，与待办同构） */
    const bell = m.reminderAt
      ? ('<span style="font-size:11px;margin-left:4px;" title="' + spEsc(memoRemindText(m)) + '">🔔</span>')
      : '';
    return '<div class="memo-item" data-id="' + id + '"><span class="mt">' +
      (m.title ? '<span class="mtitle">' + spEsc(m.title) + '</span>' : '') +
      spEsc(m.t) + bell + '</span><span class="mtime">' + memoShortTime(m.at) + '</span>' +
      '<button class="mdel press" data-id="' + id + '">✕</button></div>';
  }).join('');
  list.querySelectorAll('.memo-item').forEach(c => c.onclick = () => memoOpenDetail(c.dataset.id));
  list.querySelectorAll('.mdel').forEach(b => b.onclick = (e) => { e.stopPropagation(); delMemo(b.dataset.id); });
}
/* v5.13.12：备忘提醒状态与文案（与待办同构，纯展示用） */
function memoRemindState(m){
  if(!m || !m.reminderAt) return 'none';
  if(m.reminderStatus === 'sent' || m.reminderSentAt) return 'sent';
  if(m.reminderStatus === 'failed') return 'failed';
  return 'pending';
}
function memoRemindText(m){
  if(!m || !m.reminderAt) return '';
  const txt = TODO_REMIND_TEXT[memoRemindState(m)];
  return '提醒 ' + todoStamp(m.reminderAt) + (txt ? '（' + txt + '）' : '');
}
/* 新建备忘（dateStr 决定所属日期；不传则用当下时间）→ 上行 Supabase（title/content/legacy_id=at）
   v5.13.12：remindIso = 提醒时间（ISO 字符串；空 = 不提醒） */
function memoCreate(content, title, at, dateStr, remindIso){
  const ts = (dateStr ? memoDateToTs(dateStr, at || Date.now()) : null) || at || Date.now();
  const mid = wbUuid();                              // Phase 14：前端 UUID = Supabase 主键
  const m = { t: content, title: title || '', at: ts, _id: mid, _sbSaved: false,
              reminderAt: remindIso || null, reminderStatus: remindIso ? 'pending' : 'none',
              reminderSentAt: null };
  const st = loadMemoStore(); st.memos.push(m); saveMemoStore(st);
  sbSaveObj('memos', {_id: mid, id: mid},
    {title: m.title, content: content, legacy_id: String(ts),
     reminder_at: m.reminderAt, reminder_status: m.reminderStatus});
  return m;
}
function addMemo(){
  const inp = $('home-memo-input'); if(!inp) return;
  const v = inp.value.trim(); if(!v){ toast('先写点什么吧'); return; }
  memoCreate(v, '', Date.now());
  inp.value = ''; memoRefreshAll(); toast('已记下 ✓');
}
/* 删除：修复原 `filter(m => m.at !== at)` 的类型不匹配（number !== string 恒真 → 明细删不掉） */
function delMemo(id, skipConfirm){
  const st = loadMemoStore();
  const target = st.memos.find(m => String(m._id) === String(id));
  if(!target){ renderMemos(); return; }
  if(!skipConfirm && !confirm('删除这条备忘？')) return;
  const at = Number(target.at);
  st.memos = st.memos.filter(m => String(m._id) !== String(id));
  if(at && !st.deleted.some(x => Number(x) === at)) st.deleted.push(at);
  if(target._id) sbRemoveObj('memos', {_id: target._id, id: target._id});   // Phase 14：DAL 软删除
  saveMemoStore(st);
  if(memoEditId && String(memoEditId) === String(id)) memoCloseEdit();
  memoRefreshAll(); toast('已删除');
}
/* ---------- 备忘云端同步（v4.2.3：合并式同步，多设备不互相覆盖） ----------
   数据文件 data/<用户>/memo.json = { updatedAt, memos:[{t,at}], deleted:[at...] }。
   核心改动：同步时先「拉云端 → 与本地按 id(at) 取并集 + 墓碑过滤 → 写回本地」，再把合并后的全量上传云端，
   两台设备各记一条 → 云端为并集，谁也不覆盖谁；删除走墓碑列表，同样在全设备生效。 */
function memoPath(){ return userDir(state.user.name) + 'memo.json'; }
function mergeMemoStores(local, remote){
  const del = new Set([...(local.deleted||[]), ...(remote.deleted||[])].map(Number));
  const map = new Map();                                                        // id = at（创建时间戳，天然唯一）
  (local.memos||[]).forEach(m => { if(m && typeof m.t === 'string' && m.at && !del.has(Number(m.at))) map.set(Number(m.at), m); });
  (remote.memos||[]).forEach(m => { if(m && typeof m.t === 'string' && m.at && !del.has(Number(m.at))) if(!map.has(Number(m.at))) map.set(Number(m.at), m); });
  return { memos: [...map.values()].sort((a,b)=>b.at-a.at), deleted: [...del] };
}
async function pushMemoData(username){
  const st = loadMemoStore();
  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), memos: st.memos, deleted: st.deleted }, null, 2);
  await giteeWriteJSON(memoPath(), payload, 'sync memo ' + username + ' ' + new Date().toISOString());
}
async function pullMemoData(){
  const remote = await giteeReadJSON(memoPath());
  if(!remote) return false;                       // 云端无文件 → 保留本地，等下次推送建立
  const remoteStore = { memos: Array.isArray(remote.memos)?remote.memos:[], deleted: Array.isArray(remote.deleted)?remote.deleted:[] };
  saveMemoStore(mergeMemoStores(loadMemoStore(), remoteStore));   // 合并写回本地，绝不丢设备侧记录
  renderMemos();
  return true;
}
async function tryPullMemo(){
  try{ return await pullMemoData(); }catch(err){ return false; }
}
async function memoAutoSync(){
  const token = getGiteeToken();
  if(!token || !state.user) return;               // 未登录/未配令牌 → 仅存本机
  try{
    await pullMemoData();                         // ① 拉云端并与本地合并（union + 墓碑过滤）
    await pushMemoData(state.user.name);          // ② 上传合并后的全量 → 云端恒为所有设备并集
  }catch(e){}                                     // 静默失败，不影响本地使用
}
/* 通用：YYYY-MM-DD → 本地时间戳（禁用 new Date('YYYY-MM-DD') 的 UTC 解析，避免日期错位） */
function wbDateToLocalTs(dateStr, hm){
  const p = String(dateStr || '').split('-').map(Number);
  if(p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
  const t = String(hm || '00:00').split(':').map(Number);
  return new Date(p[0], p[1] - 1, p[2], t[0] || 0, t[1] || 0, 0, 0).getTime();
}

/* ================= 备忘：详情 / 二次编辑（复用通用框架） =================
   查看模式（放大展示全文）⇄ 编辑模式（标题 / 内容 / 日期 / 提醒时间）。
   身份一律用 _id；日期改动 → 同步写 legacy_id（DB 侧即备忘的 at 语义）。
   v5.13.12：新增「提醒时间」——与待办同构，到点由「页面内弹窗」提醒（见 todoRemind* 引擎）。 */
const MEMO_MODAL = { mask:'memoEditMask', title:'memoModalTitle', viewBox:'memoViewBox', formBox:'memoFormBox' };
let memoEditId = null;      // 当前弹窗对应的备忘 UUID
function memoShowBox(view){
  wbModalShow(MEMO_MODAL, view, view ? '📝 备忘详情' : (memoEditId ? '✏️ 编辑备忘' : '📝 新增备忘'));
}
function memoOpenDetail(id){
  const m = memoById(id); if(!m) return;
  memoEditId = m._id;
  const tt = $('memoViewTitle'), bb = $('memoViewBody'), tm = $('memoViewTime');
  if(tt){ tt.textContent = m.title || ''; tt.style.display = m.title ? 'block' : 'none'; }
  if(bb) bb.textContent = m.t || '';
  if(tm) tm.textContent = '记录于 ' + memoDateKey(m.at) + ' ' + memoTimeHM(m.at) +
    (m.reminderAt ? ('　·　' + memoRemindText(m)) : '');
  memoShowBox(true);
}
/* 新建（可为指定日期）：dateStr = 'YYYY-MM-DD' */
function memoOpenNew(dateStr){
  memoEditId = null;
  if($('memoEditTitle')) $('memoEditTitle').value = '';
  if($('memoEditText')) $('memoEditText').value = '';
  if($('memoEditDate')) $('memoEditDate').value = dateStr || memoDateKey(Date.now());
  if($('memoEditRemind')) $('memoEditRemind').value = '';
  if($('memoEditTime')) $('memoEditTime').textContent = '';
  memoShowBox(false);
  const f = $('memoEditText'); if(f) setTimeout(() => { try{ f.focus(); }catch(e){} }, 30);
}
/* 查看 → 编辑：把当前备忘字段填入表单 */
function memoSwitchEdit(){
  const m = memoEditId ? memoById(memoEditId) : null;
  if(m){
    if($('memoEditTitle')) $('memoEditTitle').value = m.title || '';
    if($('memoEditText')) $('memoEditText').value = m.t || '';
    if($('memoEditDate')) $('memoEditDate').value = memoDateKey(m.at);
    if($('memoEditRemind')) $('memoEditRemind').value = todoIsoToLocal(m.reminderAt);
    if($('memoEditTime')) $('memoEditTime').textContent = '创建于 ' + memoDateKey(m.at) + ' ' + memoTimeHM(m.at);
  }
  memoShowBox(false);
}
/* 关闭并彻底清理状态（防「弹窗关闭后状态残留」） */
function memoCloseEdit(){
  wbModalHide(MEMO_MODAL);
  memoEditId = null;
  if($('memoEditTitle')) $('memoEditTitle').value = '';
  if($('memoEditText')) $('memoEditText').value = '';
  if($('memoEditDate')) $('memoEditDate').value = '';
  if($('memoEditRemind')) $('memoEditRemind').value = '';
  if($('memoEditTime')) $('memoEditTime').textContent = '';
}
function memoSaveEdit(){
  const v = ($('memoEditText') ? $('memoEditText').value : '').trim();
  const title = ($('memoEditTitle') ? $('memoEditTitle').value : '').trim();
  const dateStr = ($('memoEditDate') ? $('memoEditDate').value : '') || memoDateKey(Date.now());
  const remind = todoLocalToIso($('memoEditRemind') ? $('memoEditRemind').value : '');
  if(!v){ toast('内容不能为空'); return; }
  if(memoEditId){
    const st = loadMemoStore();
    const m = st.memos.find(x => String(x._id) === String(memoEditId));
    if(!m){ memoCloseEdit(); memoRefreshAll(); return; }
    const newAt = memoDateToTs(dateStr, m.at) || m.at;
    m.title = title; m.t = v; m.at = newAt;
    /* v5.13.12：提醒时间有变 → 状态重置为待提醒并清掉旧的投递时间（与待办同一口径） */
    if(String(m.reminderAt || '') !== String(remind || '')){
      m.reminderAt = remind || null;
      m.reminderStatus = remind ? 'pending' : 'none';
      m.reminderSentAt = null;
    }
    saveMemoStore(st);
    sbSaveObj('memos', {_id: m._id, id: m._id, _sbSaved: m._sbSaved},
      {title: title, content: v, legacy_id: String(newAt),
       reminder_at: m.reminderAt, reminder_status: m.reminderStatus});
  }else{
    memoCreate(v, title, Date.now(), dateStr, remind);
  }
  memoCloseEdit(); memoRefreshAll(); toast('已保存 ✓');
}
function memoDeleteEdit(){
  const id = memoEditId;
  if(!id) return;
  if(!confirm('删除这条备忘？')) return;
  memoCloseEdit();
  delMemo(id, true);   // 已确认，避免二次弹窗
}

/* ================= v5.7.0：备忘日历弹窗 ================= */
let memoCalState = { y: 0, m: 0, sel: null };
function memoOpenCalendar(){
  const now = new Date();
  if(!memoCalState.y){ memoCalState.y = now.getFullYear(); memoCalState.m = now.getMonth()+1; }
  if(!memoCalState.sel) memoCalState.sel = memoDateKey(Date.now());
  memoRenderCal();
  $('memoCalMask').style.display = 'flex';
}
function memoCalClose(){
  const mask = $('memoCalMask'); if(mask) mask.style.display = 'none';
  memoCalState.sel = null;   // 清理选择，避免下次打开残留旧日期
}
function memoCalShift(delta){
  let m = memoCalState.m + delta, y = memoCalState.y;
  while(m < 1){ m += 12; y -= 1; }
  while(m > 12){ m -= 12; y += 1; }
  memoCalState.m = m; memoCalState.y = y;
  memoRenderCal();
}
function memoCalSelect(dateStr){ memoCalState.sel = dateStr; memoRenderCal(); }
function memoDayMemos(dateStr){
  return loadMemos().filter(m => memoDateKey(m.at) === dateStr).sort((a,b)=>b.at-a.at);
}
function memoRenderCal(){
  const grid = $('memoCalGrid'); if(!grid) return;
  const y = memoCalState.y, m = memoCalState.m;
  const startDow = new Date(y, m-1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const cells = [];
  for(let i = 0; i < startDow; i++) cells.push(null);
  for(let d = 1; d <= days; d++) cells.push(d);
  while(cells.length % 7) cells.push(null);
  const counts = {};                                   // 每个日期的备忘条数（实时统计）
  loadMemos().forEach(mm => { const k = memoDateKey(mm.at); counts[k] = (counts[k] || 0) + 1; });
  const today = memoDateKey(Date.now());
  grid.innerHTML = cells.map(d => {
    if(d === null) return '<div class="memo-cal-cell empty"></div>';
    const ds = y + '-' + memoPad2(m) + '-' + memoPad2(d);
    const n = counts[ds] || 0;
    return '<div class="memo-cal-cell' + (ds === today ? ' today' : '') + (ds === memoCalState.sel ? ' sel' : '') + (n ? ' has' : '') +
      '" data-date="' + ds + '"><div class="cd">' + d + '</div>' + (n ? '<div class="cm">' + n + '</div>' : '') + '</div>';
  }).join('');
  const t = $('memoCalTitle'); if(t) t.textContent = y + '年' + m + '月';
  grid.querySelectorAll('.memo-cal-cell[data-date]').forEach(c => c.onclick = () => memoCalSelect(c.dataset.date));
  memoRenderCalDay();
}
function memoRenderCalDay(){
  const box = $('memoCalDay'); if(!box) return;
  const ds = memoCalState.sel || memoDateKey(Date.now());
  const items = memoDayMemos(ds);
  const head = '<div class="cdh"><b>' + ds + (items.length ? '（' + items.length + ' 条）' : '') + '</b>' +
    '<button class="cadd press" data-new="' + ds + '">＋ 新增备忘</button></div>';
  const list = items.length
    ? '<div class="memo-cal-list">' + items.map(mm =>
        '<div class="memo-cal-mini" data-id="' + String(mm._id || '') + '">' +
        (mm.title ? '<div class="t">' + spEsc(mm.title) + '</div>' : '') +
        '<div class="c">' + spEsc(mm.t) +
          /* v5.14.0：当日明细里「已设提醒」的备忘也显示小铃铛（与首页备忘列表同一口径） */
          (mm.reminderAt ? ' <span style="font-size:11px;margin-left:2px;" title="' + spEsc(memoRemindText(mm)) + '">🔔</span>' : '') +
        '</div>' +
        '<div class="mtime">' + memoTimeHM(mm.at) + '</div></div>').join('') + '</div>'
    : '<div class="memo-cal-empty">这一天还没有备忘</div>';
  box.innerHTML = head + list;
  const add = box.querySelector('.cadd');
  if(add) add.onclick = () => memoOpenNew(add.dataset.new);
  box.querySelectorAll('.memo-cal-mini').forEach(x => x.onclick = () => memoOpenDetail(x.dataset.id));
}

/* ================= v5.7.0：备忘搜索弹窗 ================= */
function memoOpenSearch(){
  const mask = $('memoSearchMask'); if(mask) mask.style.display = 'flex';
  const inp = $('memoSearchInput'); if(inp){ inp.value = ''; setTimeout(() => { try{ inp.focus(); }catch(e){} }, 30); }
  memoRunSearch();
}
function memoSearchClose(){
  const mask = $('memoSearchMask'); if(mask) mask.style.display = 'none';
  const inp = $('memoSearchInput'); if(inp) inp.value = '';
  const list = $('memoSearchList'); if(list) list.innerHTML = '';
}
/* 高亮用的正则片段：先做 HTML 转义（与正文口径一致），再转义正则元字符 */
function memoSearchEsc(s){ return spEsc(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function memoRunSearch(){
  const list = $('memoSearchList'); if(!list) return;
  const q = (($('memoSearchInput') && $('memoSearchInput').value) || '').trim().toLowerCase();
  if(!q){ list.innerHTML = '<div class="memo-search-empty">输入关键词，搜索标题或内容</div>'; return; }
  const hits = loadMemos().slice().sort((a,b)=>b.at-a.at)
    .filter(m => (((m.title || '') + ' ' + (m.t || '')).toLowerCase().indexOf(q) >= 0));
  if(!hits.length){ list.innerHTML = '<div class="memo-search-empty">暂无匹配备忘录</div>'; return; }
  const re = new RegExp('(' + memoSearchEsc(q) + ')', 'gi');
  list.innerHTML = hits.map(m => {
    const title = spEsc(m.title || ''), body = spEsc(m.t || '');
    return '<div class="memo-search-item" data-id="' + String(m._id || '') + '">' +
      (title ? '<div class="t">' + title.replace(re, '<mark>$1</mark>') + '</div>' : '') +
      '<div class="c">' + body.replace(re, '<mark>$1</mark>') + '</div>' +
      '<div class="mtime">' + memoDateKey(m.at) + ' ' + memoTimeHM(m.at) + '</div></div>';
  }).join('');
  list.querySelectorAll('.memo-search-item').forEach(x => x.onclick = () => memoOpenDetail(x.dataset.id));
}
