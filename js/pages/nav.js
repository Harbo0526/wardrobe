/* ==========================================================================
   生活象限 · js/pages/nav.js
   --------------------------------------------------------------------------
   Phase 5 收尾：Nav module（左侧导航自定义排序：长按 → ▲▼ → 云端保存）

   自 index.html 物理抽取（**逐字节原样迁移**）：原主内联脚本 L2118–L2251（134 行正文；
   L2252 为尾随空行，保留在 index.html 作段落分隔）。
   14 个成员 = 9 个函数 + 5 个绑定
   （NAV_META · navOrders · navSortKey · NAV_KEYS · _navSaveT）。

   ⚠️ 两条 parse-time 语句原样迁移，未改成 DOMContentLoaded、未加 IIFE、未延迟执行：
      · document.addEventListener('pointerdown', …, true)   —— 点击侧栏外退出排序模式
      · initNavSort();                                       —— 渲染四个侧栏 + 绑定长按
      二者只依赖 DOM（脚本位于 body 末尾，DOM 已就绪）→ 迁到 page 模块后行为等价。

   ⚠️ 必须留在 index.html（本模块不迁移、不复制）：
      · navTo（Router 核心：showScreen + gotoCloth/renderLedger/renderCocktail/renderMine；
        被 markup onclick×4、doSync、js/pages/mine.js 调用）
      · spawnHomeBubbles（Home 域：#bubbleBack / #bubbleFront）
      · Router：showScreen / SCREENS / wbScreen / doAppBack / wb*Trap
      · Auth / Persistence / Gitee / Sync / Push 全套

   ⚠️ 跨模块调用（保持原样，未改成直接调用）：
      Nav → 页面模块：renderNav 通过 window[m.fn]() 字符串间接调用
                      clSwitch(cloth.js) / lgSwitch(ledger.js) / spSwitch(sleep.js) / ckSwitch(cocktail.js)
                      —— 点击时才求值，依赖页面模块的 window 属性，无 TDZ
      Nav → Core/Data：$ / toast / WBAuth / getSupabaseClient（profiles.nav_orders）
      Host → Nav：enterApp → loadNavOrder()
      Nav → Router：无（renderNav 不调 showScreen；Router 也不反向调用 Nav）
   ⚠️ Classic Script（非 ESM）；let/const 保持顶层 lexical binding。
   ========================================================================== */
/* ============ v5.1.17：左侧导航自定义排序（长按 → ▲▼ → 云端保存） ============
   数据 = profiles.nav_orders（jsonb，形如 {cl:[...],lg:[...],sp:[...],ck:[...]}）。
   交互 = 长按侧栏 0.5s 进入排序模式（轻微抖动 + 每项出现 ▲▼），▲▼ 交换并即时保存；
          点击侧栏以外区域 / 再次长按 → 退出排序模式。 */
const NAV_META = {
  cl: {
    box:'clSide', attr:'data-cl', fn:'clSwitch', def:['overview','list','bak'],
    items:{ overview:{emoji:'🏠',label:'概览'}, list:{emoji:'👗',label:'衣物'}, bak:{emoji:'☁️',label:'云端'} }
  },
  lg: {
    box:'lgSide', attr:'data-lg', fn:'lgSwitch', def:['overview','entry','calendar','stats','book','query','fuel','bak'],
    items:{ overview:{emoji:'🏠',label:'概览'}, entry:{emoji:'✍️',label:'录入'}, calendar:{emoji:'📅',label:'日历'},
            stats:{emoji:'📊',label:'统计'}, book:{emoji:'📒',label:'账本'}, query:{emoji:'🔍',label:'查询'}, fuel:{emoji:'⛽',label:'油费'}, bak:{emoji:'☁️',label:'云端'} }
  },
  sp: {
    box:'spSide', attr:'data-sp', fn:'spSwitch', def:['overview','entry','calendar','stats','bak'],
    items:{ overview:{emoji:'🏠',label:'概览'}, entry:{emoji:'✍️',label:'记录'}, calendar:{emoji:'📅',label:'日历'},
            stats:{emoji:'📊',label:'统计'}, bak:{emoji:'☁️',label:'云端'} }
  },
  ck: {
    box:'ckSide', attr:'data-ck', fn:'ckSwitch', def:['mix','mat','rec','bak'],
    items:{
      mix:{label:'调酒', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>'},
      mat:{label:'材料库', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h18"/></svg>'},
      rec:{label:'配方', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'},
      bak:{label:'备份', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 7v5l3 2"/></svg>'}
    }
  }
};
let navOrders = {};      // 各模块顺序
let navSortKey = null;   // 正在排序的模块（null = 非排序模式）
const NAV_KEYS = ['cl','lg','sp','ck'];

function navFullOrder(key){
  const m = NAV_META[key];
  const src = Array.isArray(navOrders[key]) ? navOrders[key] : [];
  const out = src.filter(function(k){ return m.items[k]; });
  m.def.forEach(function(k){ if(out.indexOf(k) < 0) out.push(k); });
  return out;
}
function renderNav(key){
  const m = NAV_META[key];
  const box = $(m.box); if(!box) return;
  const order = navFullOrder(key);
  navOrders[key] = order;
  const prev = box.querySelector('.active');
  const prevKey = prev ? prev.getAttribute(m.attr) : null;
  const sorting = (navSortKey === key);
  box.classList.toggle('sorting', sorting);
  const isCk = (key === 'ck');
  box.innerHTML = order.map(function(k, i){
    const it = m.items[k];
    const ic = isCk ? (it.svg || '') : ('<span class="lg-emoji">' + (it.emoji || '') + '</span>');
    const lb = isCk ? it.label : ('<span class="lg-label">' + it.label + '</span>');
    const mv = sorting ? ('<span class="nav-mv"><b data-mv="up" data-i="' + i + '">▲</b><b data-mv="down" data-i="' + i + '">▼</b></span>') : '';
    return '<button class="' + (isCk ? 'ck-scard' : 'lg-nav') + '" ' + m.attr + '="' + k + '">' + ic + lb + mv + '</button>';
  }).join('');
  const target = prevKey || m.def[0];
  box.querySelectorAll('[' + m.attr + ']').forEach(function(b){
    b.classList.toggle('active', b.getAttribute(m.attr) === target);
    b.onclick = function(){ if(navSortKey) return; window[m.fn](b.getAttribute(m.attr)); };
  });
  if(sorting){
    box.querySelectorAll('[data-mv]').forEach(function(b){
      b.onclick = function(ev){ ev.stopPropagation(); moveNav(key, parseInt(b.dataset.i, 10), b.dataset.mv); };
    });
  }
}
function moveNav(key, i, dir){
  const arr = navOrders[key] || navFullOrder(key);
  const j = (dir === 'up') ? i - 1 : i + 1;
  if(j < 0 || j >= arr.length) return;
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  navOrders[key] = arr;
  renderNav(key);
  saveNavOrder();
}
function enterNavSort(key){
  if(navSortKey === key){ exitNavSort(); return; }   // 同一侧栏再长按 = 退出
  if(navSortKey) renderNav(navSortKey);
  navSortKey = key;
  renderNav(key);
  toast('排序模式：用 ▲▼ 调整顺序，点空白处完成');
}
function exitNavSort(){
  if(!navSortKey) return;
  const k = navSortKey; navSortKey = null;
  renderNav(k);
}
function bindNavLongPress(key){
  const box = $(NAV_META[key].box);
  if(!box || box._lp) return;
  box._lp = true;
  let timer = null, sy = 0, moved = false;
  box.addEventListener('pointerdown', function(e){
    sy = e.clientY; moved = false;
    if(timer) clearTimeout(timer);
    timer = setTimeout(function(){ timer = null; if(!moved) enterNavSort(key); }, 500);
  });
  box.addEventListener('pointermove', function(e){ if(Math.abs(e.clientY - sy) > 8) moved = true; });
  const stop = function(){ if(timer){ clearTimeout(timer); timer = null; } };
  box.addEventListener('pointerup', stop);
  box.addEventListener('pointercancel', stop);
  box.addEventListener('pointerleave', stop);
  box.addEventListener('contextmenu', function(e){ e.preventDefault(); });   // 长按不弹系统菜单
}
document.addEventListener('pointerdown', function(e){
  if(!navSortKey) return;
  const box = $(NAV_META[navSortKey].box);
  if(box && box.contains(e.target)) return;    // 点在侧栏内 → 保持
  exitNavSort();
}, true);
async function loadNavOrder(){
  try{
    const u = await WBAuth.getCurrentUser(); if(!u) return;
    const r = await getSupabaseClient().from('profiles').select('nav_orders').eq('id', u.id).maybeSingle();
    if(r && r.data && r.data.nav_orders && typeof r.data.nav_orders === 'object') navOrders = r.data.nav_orders;
  }catch(e){ /* 静默：用默认顺序 */ }
  NAV_KEYS.forEach(function(k){ renderNav(k); });
}
let _navSaveT = null;
function saveNavOrder(){
  if(_navSaveT) clearTimeout(_navSaveT);
  _navSaveT = setTimeout(async function(){
    try{
      const u = await WBAuth.getCurrentUser(); if(!u) return;
      await getSupabaseClient().from('profiles').update({ nav_orders: navOrders }).eq('id', u.id);
    }catch(e){ /* 静默：仅本次顺序未上云 */ }
  }, 600);
}
function initNavSort(){
  NAV_KEYS.forEach(function(k){ renderNav(k); bindNavLongPress(k); });
}
initNavSort();   // 脚本位于 body 末尾，DOM 已就绪：先按默认顺序渲染 + 绑定长按
