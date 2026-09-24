/* ==========================================================================
   生活象限 · js/pages/ledger.js
   --------------------------------------------------------------------------
   Phase 5 候选 E：Ledger page module（记账工作台 #screen-ledger：概览 / 日历 / 统计 / 账本 / 油费面板）

   自 index.html 物理抽取（**逐字节原样迁移**）：57 个成员 = 52 个函数 + 5 个顶层绑定
   （lgState · LG_MODAL · lgEditId · lgBound · LG_BOOK_CATS），分三段迁入：
     ① 数据同步层（normalizeLedger / ledgerPath / pushLedgerData / pullLedgerData / tryPullLedger；
        **defaultLedger 留驻 index.html** —— defaultState() 的加载期依赖，见下方说明）
     ② 主簇（lgPad … lgSyncLedgerCloud，含 lgRefreshLedgerViews / lgAddFuelExpense / lgRemoveFuelExpense /
        fuSyncLedgerExpense —— 后者虽以 fu 命名，但属本簇，随 Ledger 迁移）
     ③ 面板簇（lgRenderCalendar / lgRenderStats / … / renderLedger / lgBind）

   ⚠️ 必须留在 index.html 的原位项（本模块只调用、不复制）：
      · defaultLedger（defaultState() 加载期依赖：let state = loadState() 同步执行，早于本文件加载）
      · 推送开关 + 提醒通道 + WBReminders（位于本模块两簇之间，属 Todo reminder / Web Push 基建）
      · defaultSleep / normalizeSleep / defaultFuel / normalizeFuel / sleepPath / pullSleepData / tryPullSleep
      · 宿主与持久化层：loadState / saveState / userDir / 其它云路径 / getGiteeToken / giteeFetch

   ⚠️ Classic Script（非 ESM）：顶层 function 声明即全局对象属性 → HTML onclick 与其它脚本按懒调用解析。
   ⚠️ Ledger ↔ Fuel 为既有双向懒调用环（lgSwitch→fuRenderAll · lgSaveEdit→fuRefreshAll ⇄
      fuSave→lgAddFuelExpense · fuDelete→lgRemoveFuelExpense · fuRefreshAll→lgRefreshLedgerViews ·
      fuSaveEdit→fuSyncLedgerExpense），双方均在函数体内调用，加载期 0 次求值。
   ⚠️ 数据只读写唯一 state.ledger（禁止第二状态树）。
   ========================================================================== */

/* ⚠️ defaultLedger 未随本模块迁移：它是 defaultState() 的加载期依赖（let state = loadState()
   在主脚本顶层同步执行，早于本文件加载）→ 与 defaultSleep/defaultFuel 同属状态形状段，
   留驻 index.html（调用点 L1879/L1916/L1933 为主脚本运行期路径）。 */
function normalizeLedger(L){
  const d = defaultLedger();
  if(!L || typeof L !== 'object') return d;
  return {
    records: Array.isArray(L.records) ? L.records : [],
    seeded: !!L.seeded,
    budgets: (L.budgets && typeof L.budgets === 'object') ? L.budgets : {},
    deleted: Array.isArray(L.deleted) ? L.deleted : []
  };
}
function ledgerPath(){ return userDir(state.user.name) + 'ledger.json'; }

async function pushLedgerData(username, updatedAt){
  const L = normalizeLedger(state.ledger);
  const payload = JSON.stringify({ updatedAt: updatedAt, records: L.records, seeded: L.seeded, budgets: L.budgets, deleted: L.deleted }, null, 2);
  await giteeWriteJSON(ledgerPath(), payload, 'sync ledger ' + username + ' ' + updatedAt);
}
async function pullLedgerData(overwrite){
  const remote = await giteeReadJSON(ledgerPath());
  if(!remote) return false;
  const rl = normalizeLedger({ records: remote.records, seeded: remote.seeded, budgets: remote.budgets, deleted: remote.deleted });
  if(overwrite){
    // 强制覆盖（启动/手动下拉取回）：以云端为准
    state.ledger = rl;
    return true;
  }
  // 合并模式 v4.2.5：按 id 取并集（云端 + 本地全部保留），再按墓碑过滤（删除全设备生效，防复活）；预算取双方并集
  const del = new Set([...(state.ledger.deleted||[]), ...(rl.deleted||[])].map(String));
  const map = new Map();
  (state.ledger.records||[]).forEach(r => { if(r && r.id != null && !del.has(String(r.id))) map.set(r.id, r); });
  (rl.records||[]).forEach(r => { if(r && r.id != null && !del.has(String(r.id))) if(!map.has(r.id)) map.set(r.id, r); });
  const budgets = Object.assign({}, rl.budgets||{}, state.ledger.budgets||{});
  state.ledger = { records: Array.from(map.values()), seeded: rl.seeded || state.ledger.seeded, budgets: budgets, deleted: [...del] };
  return true;
}
async function tryPullLedger(overwrite, doRefresh){
  if(doRefresh === undefined) doRefresh = true;   // 默认拉取后刷新界面；自动同步传 false 以免重置回概览
  let changed = false;
  try{ changed = await pullLedgerData(overwrite); }catch(err){ return false; }
  if(changed && doRefresh){ saveState(); refreshAfterSync(); }
  return changed;
}

/* ---------- 工具 ---------- */
function lgPad(n){ return n < 10 ? '0' + n : '' + n; }
function lgTodayStr(){ const d = new Date(); return d.getFullYear() + '-' + lgPad(d.getMonth()+1) + '-' + lgPad(d.getDate()); }
function lgIso(d){ return d.getFullYear() + '-' + lgPad(d.getMonth()+1) + '-' + lgPad(d.getDate()); }
function lgFmtMoney(n){ n = Math.round((n||0)*100)/100; return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function lgFmtShort(n){ const v = Math.round(n*10)/10; return ('' + v); }
/* v5.29.0：首页入口卡专用「紧凑金额」——首页 360px 卡通模式下、30px 环占位后只剩 39.3px 文字宽，
   故必须有比 lgFmtMoney 更短的写法（lgFmtMoney 会输出 ¥6,480.00）：
     < 1万    → ¥6,480（千分位整数，无小数）
     ≥ 1万    → ¥1.28万（最多 2 位小数；整数时自动不带小数点，如 ¥1万 / ¥12.8万）
     ≥ 100万  → ¥123万（整数万，避免卡片换行）
   ⚠️ 只做「显示格式化」：任何参与计算的金额仍使用原始 number / lgFmtMoney。 */
function lgFmtTiny(n){
  const v = Number(n) || 0, a = Math.abs(v);
  let body;
  if(a >= 1000000) body = Math.round(a/10000) + '万';
  else if(a >= 10000) body = (Math.round(a/100)/100) + '万';
  else body = Math.round(a).toLocaleString('zh-CN');
  return (v < 0 ? '-¥' : '¥') + body;
}
/* v5.30.0：首页「记账」入口卡摘要（纯函数：只读 state.ledger，不写 DOM / 不发网络 / 不改状态）
   口径与概览 lgRenderOverview 完全一致：本月 = record_date 前缀匹配 'YYYY-MM'，type 'inc'/'exp'。
   返回 { value, aux, ring }（卡片**不增高**：核心数据与辅助同在横向两栏里）：
     · value = 本月结余（紧凑金额，**负数保留负号**，不为了好看丢掉支出语义）
     · aux   = 本月收入 / 支出（紧凑金额，放在模块名一行的右侧）
     · ring  = 本月入账占比(%)——环上绿弧=入账、红弧=支出（v5.32.5 由「储蓄率」改为
       收支构成）；本月无任何收支时 null（首页隐藏环，不画假的 0%）
   ⚠️ 刻意不读 lgState —— 那是「记账页当前选中的月份」，首页必须恒为「本月」。 */
function lgHomeSummary(){
  const recs = (state.ledger && Array.isArray(state.ledger.records)) ? state.ledger.records : [];
  const mk = lgCurMonthKey();
  let inc = 0, exp = 0, hit = false;
  recs.forEach(function(r){
    if(!r.date || String(r.date).indexOf(mk) !== 0) return;
    hit = true;
    if(r.type === 'inc') inc += Number(r.amount) || 0; else exp += Number(r.amount) || 0;
  });
  inc = Math.round(inc*100)/100; exp = Math.round(exp*100)/100;
  const net = Math.round((inc - exp)*100)/100;
  return {
    value: hit ? lgFmtTiny(net) : '—',
    /* 收支去掉 ¥ 号（核心数据已带 ¥，卡片里也足够表明是钱）——这一栏与模块名同行，宽度有限 */
    aux: hit ? ('↑' + lgFmtTiny(inc).replace('¥', '') + ' · ↓' + lgFmtTiny(exp).replace('¥', ''))
             : '本月还没有记录',
    /* v5.33.4：首页记账卡「本月收支」**分色渲染**所需的两个片段 —— ↑入账（绿）/ ↓支出（红），
       具体色值由 CSS 按主题给（css/pages/home.css + css/theme.css 的 minimal/scrapbook 覆盖）。
       与 aux 同源同口径，只是拆成两段；aux 保留不动（纯文本场景 / 兼容）。
       无记录时同为 null → 渲染层回落到 aux 的空态文案「本月还没有记录」。 */
    auxInc: hit ? ('↑' + lgFmtTiny(inc).replace('¥', '')) : null,
    auxExp: hit ? ('↓' + lgFmtTiny(exp).replace('¥', '')) : null,
    /* v5.32.5：环语义 = 收支构成（CSS 绿弧 0→--ring-p、红弧 --ring-p→100%），
       --ring-p 写入账占比 inc/(inc+exp)；只有支出没有收入时（inc+exp>0）仍显示
       （全红环 = 全是支出），比隐藏更有信息量；本月无任何收支 → null 隐藏 */
    ring: (inc + exp) > 0 ? Math.max(0, Math.min(100, Math.round(inc/(inc + exp)*100))) : null
  };
}

let lgState = { type:'exp', calYM:null, statYM:null, selDate:null, qmode:'days' };

function lgDayTotals(date){
  let exp = 0, inc = 0;
  (state.ledger.records||[]).forEach(r => { if(r.date === date){ if(r.type === 'inc') inc += r.amount; else exp += r.amount; } });
  return { exp: Math.round(exp*100)/100, inc: Math.round(inc*100)/100 };
}

/* ---------- 概览 + 预算 ---------- */
function lgCurMonthKey(){ const d = new Date(); return d.getFullYear() + '-' + lgPad(d.getMonth()+1); }
function lgEnsureBudgets(){ if(!state.ledger.budgets || typeof state.ledger.budgets !== 'object') state.ledger.budgets = {}; }
function lgRenderOverview(){
  const recs = state.ledger.records || [];
  let inc = 0, exp = 0;
  const mk = lgCurMonthKey();
  recs.forEach(r => {
    if(r.date && r.date.indexOf(mk) === 0){ if(r.type === 'inc') inc += r.amount; else exp += r.amount; }
  });
  inc = Math.round(inc*100)/100; exp = Math.round(exp*100)/100;
  const net = Math.round((inc - exp)*100)/100;
  let save = 0;
  if(inc > 0) save = Math.round(net / inc * 10000) / 100;
  $('lgOvInc').textContent = lgFmtMoney(inc);
  $('lgOvExp').textContent = lgFmtMoney(exp);
  $('lgOvNet').textContent = lgFmtMoney(net);
  const saveEl = $('lgOvSave');
  saveEl.textContent = (save >= 0 ? '' : '-') + Math.abs(save).toFixed(2) + '%';
  saveEl.style.color = inc > 0 ? (net >= 0 ? 'var(--lg-inc)' : 'var(--lg-red)') : 'var(--lg-ink)';
  /* v5.5.0：最近消费卡片随概览一起刷新（放在预算的提前 return 之前，否则未设预算时会被跳过） */
  lgRenderRecentSpend();
  // 预算
  lgEnsureBudgets();
  const budget = state.ledger.budgets[mk] || 0;
  $('lgBudgetInput').value = budget ? budget : '';
  $('lgBudTotal').textContent = lgFmtMoney(budget);
  $('lgBudExp').textContent = lgFmtMoney(exp);
  const bar = $('lgBudBar'), tip = $('lgBudTip');
  if(!budget){ bar.style.width = '0%'; bar.style.background = 'var(--lg-inc)'; tip.textContent = '尚未设置本月预算'; tip.style.color = 'var(--lg-ink)'; return; }
  const pct = exp / budget * 100;
  bar.style.width = Math.min(100, pct) + '%';
  if(pct > 100){ bar.style.background = 'var(--lg-red)'; tip.style.color = 'var(--lg-red)'; tip.textContent = '已超支 ' + lgFmtMoney(exp - budget) + '（' + pct.toFixed(0) + '%）'; }
  else if(pct >= 80){ bar.style.background = 'var(--lg-primary)'; tip.style.color = 'var(--lg-deep)'; tip.textContent = '预警：已用 ' + pct.toFixed(0) + '%，仅剩 ' + lgFmtMoney(budget - exp); }
  else { bar.style.background = 'var(--lg-inc)'; tip.style.color = 'var(--lg-inc)'; tip.textContent = '已用 ' + pct.toFixed(0) + '%，还可花 ' + lgFmtMoney(budget - exp); }
}

/* v5.6.5：概览「最近收支」——同时取支出（exp）与收入（inc），按日期倒序（同日按创建时间倒序）取最新 5 条，
   每条显示 日期 / 金额（收入 + 绿、支出 − 红）/ 分类·备注；容器限高约 5 行，超出可上下滚动。 */
function lgRenderRecentSpend(){
  const box = $('lgRecentList'); if(!box) return;
  const all = (state.ledger.records || []).filter(r => r.type === 'exp' || r.type === 'inc');
  const list = all.slice().sort(function(a, b){
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if(d) return d;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }).slice(0, 5);
  const title = $('lgRecentTitle');
  if(title) title.textContent = '📊 最近收支' + (all.length ? '（最新 ' + list.length + ' 笔 · 共 ' + all.length + ' 笔）' : '');
  if(!list.length){
    box.innerHTML = '<div class="empty"><span class="empty-emoji">📊</span><div class="empty-text">还没有收支记录</div></div>';
    return;
  }
  box.innerHTML = list.map(function(r){
    const isInc = r.type === 'inc';
    const sub = [(r.cat || (isInc ? '收入' : '支出')), (r.note || '')].filter(Boolean).join(' · ');
    return '<div class="lg-recent-item">' +
      '<div class="rc-date">' + lgEsc(r.date || '') + '</div>' +
      '<div class="rc-main"><div class="rc-amt" style="color:' + (isInc ? 'var(--lg-inc)' : 'var(--lg-exp)') + '">' + (isInc ? '+' : '−') + lgFmtMoney(r.amount) + '</div>' +
      '<div class="rc-sub">' + lgEsc(sub) + '</div></div>' +
    '</div>';
  }).join('');
}

function lgSetBudget(){
  if(!state.user){ toast('请先登录'); return; }
  const v = parseFloat($('lgBudgetInput').value);
  if(!(v >= 0)){ toast('请输入有效预算金额'); return; }
  lgEnsureBudgets();
  const key = lgCurMonthKey();
  const amount = Math.round(v*100)/100;
  state.ledger.budgets[key] = amount;
  /* Phase 14：预算持久化到 ledger_budgets（year/month/category NULL 唯一） */
  const ym = key.split('-');
  const bid = state.ledger._budgetIds ? state.ledger._budgetIds[key] : null;
  if(bid){
    WBData.ledgerBudgets.update(bid, {amount: amount})
      .then(r => { if(r.error) throw r.error; }).catch(e => toast(WBErrors.normalize(e).message || '预算云端保存失败'));
  }else{
    WBData.ledgerBudgets.create({year: parseInt(ym[0],10), month: parseInt(ym[1],10), amount: amount})
      .then(r => { if(r.error) throw r.error; state.ledger._budgetIds = state.ledger._budgetIds || {}; state.ledger._budgetIds[key] = r.data.id; })
      .catch(e => toast(WBErrors.normalize(e).message || '预算云端保存失败'));
  }
  lgRenderOverview(); toast('预算已设定 ✓');
}
/* ---------- 导航切换 ---------- */
function lgRenderBanner(panel){
  const el = (typeof panel === 'string') ? $('lgp-' + panel) : panel;
  if(!el) return;
  const banner = el.querySelector('.lg-banner'); if(!banner) return;
  const title = banner.dataset.title || '记账', sub = banner.dataset.sub || '';
  const h3 = banner.querySelector('h3'); if(h3) h3.textContent = title;
  const p = banner.querySelector('p'); if(p) p.textContent = sub;
  // 圆形头像：随机 9 选 1
  const avatarIdx = Math.floor(Math.random()*9) + 1;
  const avatar = getComputedStyle($('screen-ledger')).getPropertyValue('--lg-avatar-' + avatarIdx).trim();
  const avatarEl = banner.querySelector('.lg-banner-avatar');
  if(avatarEl) avatarEl.style.backgroundImage = avatar;
  // emoji 散射：4 列 x 2 行网格，每格随机偏移 / 旋转 / 大小 / 透明度，仅取点不拥挤
  const emojis = ['🌸','💕','🎀','🍓','🌷','⭐','🧸','🍰','💗','🍡','🌙','☁️','🍒','🧁','💝','🍑'];
  const grid = banner.querySelector('.lg-banner-emojis'); if(!grid) return;
  grid.innerHTML = '';
  const cols = 4, rows = 2;
  const cellW = (banner.clientWidth || el.clientWidth) / cols, cellH = (banner.clientHeight || 76) / rows;
  for(let r = 0; r < rows; r++){
    for(let c = 0; c < cols; c++){
      const span = document.createElement('span');
      span.className = 'lg-banner-emoji';
      span.textContent = emojis[Math.floor(Math.random()*emojis.length)];
      const size = 17 + Math.random()*5;            // 17~22px
      const left = c*cellW + Math.random()*(cellW - size);
      const top = r*cellH + Math.random()*(cellH - size);
      const rot = (Math.random()*22 - 11).toFixed(1); // ±11°
      const op = (0.34 + Math.random()*0.16).toFixed(2); // .34~.50
      span.style.left = left + 'px';
      span.style.top = top + 'px';
      span.style.fontSize = size.toFixed(1) + 'px';
      span.style.transform = 'rotate(' + rot + 'deg)';
      span.style.opacity = op;
      grid.appendChild(span);
    }
  }
}
function lgSwitch(panel){
  lgState.panel = panel;   /* v5.4.6：记录当前面板，供云端数据到达后按需重渲染 */
  document.querySelectorAll('#lgSide .lg-nav').forEach(b => b.classList.toggle('active', b.dataset.lg === panel));
  document.querySelectorAll('#screen-ledger .lg-panel').forEach(p => p.classList.toggle('active', p.id === 'lgp-' + panel));
  const active = $('lgp-' + panel);
  if(active) lgRenderBanner(active);   // 每次切换模块重新随机头像 + emoji 散射
  if(panel === 'stats') lgRenderStats();
  else if(panel === 'calendar') lgRenderCalendar();
  else if(panel === 'overview') lgRenderOverview();
  else if(panel === 'fuel') fuRenderAll();          /* v5.3.0：油费面板 */
  else if(panel === 'entry') lgRenderRecent();      /* v5.6.3：录入/明细面板切换也刷新明细列表（修复"只有保存后才显示"） */
  else if(panel === 'book') lgRenderBook();         /* v5.10.1：账本独立子页面（切到该页即按当前数据渲染） */
}

/* ---------- 录入 ---------- */
function lgOneRecHTML(r){
  const fuTag = r.fuelId ? '<span class="fu-tag">' + (r.cat === '⚡ 电费' ? '⚡' : '⛽') + '</span>' : '';
  return '<div class="lg-rec ' + r.type + '" data-lgid="' + r.id + '"><span class="dot"></span>' +
    '<div class="ri"><div class="t">' + fuTag + lgEsc(r.cat || (r.type==='inc'?'收入':'支出')) + (r.note ? ' · ' + lgEsc(r.note) : '') + '</div>' +
    '<div class="s">' + (r.date||'') + ' · ' + (r.type==='inc'?'收入':'支出') + '</div></div>' +
    '<span class="amt">' + (r.type==='inc'?'+':'−') + lgFmtMoney(r.amount) + '</span>' +
    '<button class="del press" data-id="' + r.id + '">✕</button></div>';
}
/* v5.7.2：明细行 → 放大详情弹窗；✕ → 删除（阻止冒泡，避免误开详情）
   v5.33.2：✕ 删除前先二次确认 —— 明细卡右侧的 ✕ 与详情弹窗里的「删除」同口径
   （lgDeleteEdit 早就走 confirm），文案与判据完全一致，避免误触直接删掉一条记账。 */
function lgBindRecClicks(box){
  if(!box) return;
  box.querySelectorAll('.lg-rec[data-lgid]').forEach(function(el){
    el.onclick = function(){ lgOpenDetail(el.getAttribute('data-lgid')); };
  });
  box.querySelectorAll('.del').forEach(function(b){
    b.onclick = function(ev){
      if(ev) ev.stopPropagation();
      const r = lgRecById(b.dataset.id);
      const msg = (r && r.fuelId)
        ? '删除这条记账记录？（「' + (r.cat === '⚡ 电费' ? '⚡ 电费' : '⛽ 油费') + '」原始记录不会被删除）'
        : '删除这条记账记录？';
      if(!confirm(msg)) return;
      lgDeleteRec(b.dataset.id);
    };
  });
}
function lgRenderDayChart(date){
  const box = $('lgDayChart'); if(!box) return;
  const recs = (state.ledger.records||[]).filter(r => r.date === date);
  const inc = recs.filter(r => r.type==='inc').reduce((s,r)=>s+(+r.amount||0),0);
  const exp = recs.filter(r => r.type==='exp').reduce((s,r)=>s+(+r.amount||0),0);
  const total = inc + exp;
  if(total <= 0){
    box.innerHTML = '<div class="empty"><span class="empty-emoji">🍩</span><div class="empty-text">当天无收支，暂无占比</div></div>';
    return;
  }
  const incPct = inc/total*100;
  box.innerHTML =
    '<div class="lg-donut-wrap">' +
      '<div class="lg-donut" style="background:conic-gradient(#69D19D 0% ' + incPct.toFixed(2) + '%, #FF4D6D ' + incPct.toFixed(2) + '% 100%);">' +
        '<div class="lg-donut-hole"><div class="lg-donut-pct">' + Math.round(incPct) + '%</div><div class="lg-donut-sub">收入占比</div></div>' +
      '</div>' +
      '<div class="lg-donut-legend">' +
        '<div class="lg-legend-item"><span class="lg-legend-dot" style="background:#69D19D"></span>收入 ' + lgFmtMoney(inc) + '</div>' +
        '<div class="lg-legend-item"><span class="lg-legend-dot" style="background:#FF4D6D"></span>支出 ' + lgFmtMoney(exp) + '</div>' +
      '</div>' +
    '</div>';
}

function lgRenderRecent(){
  const list = $('lgDayList'); if(!list) return;
  // 不同日期分别保留，按时间倒序取最近 10 条；仅此区域可独立上下滚动
  const all = (state.ledger.records||[]).slice().sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  const recs = all.slice(0, 10);
  $('lgTodayTitle').textContent = '记账明细' + (all.length ? '（最近 ' + recs.length + ' / 共 ' + all.length + ' 笔）' : '');
  if(!recs.length){ list.innerHTML = '<div class="empty"><span class="empty-emoji">🐱</span><div class="empty-text">还没有任何记账记录</div></div>'; return; }
  list.innerHTML = recs.map(lgOneRecHTML).join('');
  lgBindRecClicks(list);
}
// 渲染日历面板「当日明细」列表（与点击某天后展示的列表一致），删除后即时刷新且停留在日历界面
function lgRenderCalDay(){
  const dl = $('lgCalDayList'); if(!dl) return;
  const recs = (state.ledger.records||[]).filter(r => r.date === lgState.selDate);
  dl.innerHTML = recs.length ? recs.map(lgOneRecHTML).join('') : '<div class="empty"><span class="empty-emoji">🐱</span><div class="empty-text">这一天还没有记录</div></div>';
  lgBindRecClicks(dl);
  const t = $('lgCalDayTitle');
  if(t) t.textContent = '当日明细 · ' + lgState.selDate + (recs.length ? '（' + recs.length + ' 笔）' : '');
}
function lgDeleteRec(id){
  const rec = (state.ledger.records||[]).find(r => r.id === id);
  state.ledger.records = (state.ledger.records||[]).filter(r => r.id !== id);
  if(rec) sbRemoveObj('ledger', rec);                // Phase 14：DAL 软删除
  lgRenderRecent();
  lgRenderCalDay();
  lgRenderDayChart(lgState.selDate);
  lgRenderCalendar(); lgRenderStats(); lgRenderOverview();
  try{ lgRenderBook(); }catch(e){}   /* v5.26.0：账本分类卡同步 */
  toast('已删除');
}
/* v5.7.2：记账任何增 / 改 / 删后统一刷新各视图（明细 / 日历 / 统计 / 概览 / 当天占比） */
function lgRefreshAll(){
  try{ lgRenderRecent(); }catch(e){}
  try{ lgRenderCalendar(); }catch(e){}
  try{ lgRenderStats(); }catch(e){}
  try{ lgRenderOverview(); }catch(e){}
  try{ lgRenderCalDay(); }catch(e){}
  try{ lgRenderDayChart(lgState.selDate); }catch(e){}
  try{ lgRenderBook(); }catch(e){}   /* v5.26.0：账本分类卡（含新增「交通」）同步刷新 */
}
/* ---------- v5.7.2：记账明细「放大查看 + 二次编辑」（复用通用弹窗组件） ---------- */
const LG_MODAL = { mask:'lgEditMask', title:'lgModalTitle', viewBox:'lgViewBox', formBox:'lgFormBox' };
let lgEditId = null;
/* v5.26.0：从「明细列表」（点统计卡 / 分类卡）进入单条详情时保存列表的返回函数；
   直接打开单条详情时为 null（此时不显示「‹ 返回」按钮）。 */
let lgViewBackFn = null;
function lgRecById(id){
  const list = (state.ledger && state.ledger.records) ? state.ledger.records : [];
  return list.find(function(r){ return String(r.id) === String(id); }) || null;
}
/* keepBack = true 表示「从明细列表点进来的」，此时保留 lgViewBackFn 以便返回列表 */
function lgOpenDetail(id, keepBack){
  const r = lgRecById(id); if(!r) return;
  if(!keepBack) lgViewBackFn = null;
  lgEditId = r.id;
  const isInc = r.type === 'inc';
  const isCharge = (r.cat === '⚡ 电费');
  const t = $('lgViewTitle');
  if(t) t.textContent = (isInc ? '+' : '−') + lgFmtMoney(r.amount) + (r.date ? ' · ' + r.date : '');
  const rows = $('lgViewRows');
  if(rows){
    rows.innerHTML = [
      wbRowHTML('日期', lgEsc(r.date || '')),
      wbRowHTML('类型', isInc ? '收入' : '支出'),
      wbRowHTML('金额', (isInc ? '+' : '−') + lgFmtMoney(r.amount), isInc ? 'inc' : 'exp'),
      wbRowHTML('分类', lgEsc(r.cat || '')),
      wbRowHTML('备注', lgEsc(r.note || '')),
      r.fuelId ? wbRowHTML('来源', isCharge ? '⚡ 由电费记录同步生成' : '⛽ 由油费记录同步生成') : ''
    ].join('');
  }
  const tm = $('lgViewTime');
  if(tm) tm.textContent = r.createdAt ? ('记录于 ' + String(r.createdAt).slice(0,10)) : '';
  /* 单条详情：恢复 编辑 / 删除 按钮；仅当来自明细列表时才显示「返回」 */
  const btns = $('lgViewBtns'); if(btns) btns.style.display = '';
  const bk = $('lgBackBtn'); if(bk) bk.style.display = lgViewBackFn ? '' : 'none';
  wbModalShow(LG_MODAL, true, '📒 记账详情');
}
function lgSwitchEdit(){
  const r = lgEditId ? lgRecById(lgEditId) : null;
  if(r){
    if($('lgEditDate')) $('lgEditDate').value = r.date || lgTodayStr();
    if($('lgEditType')) $('lgEditType').value = (r.type === 'inc' ? 'inc' : 'exp');
    if($('lgEditAmount')) $('lgEditAmount').value = (r.amount == null ? '' : r.amount);
    if($('lgEditCat')) $('lgEditCat').value = r.cat || '';
    if($('lgEditNote')) $('lgEditNote').value = r.note || '';
    const hint = $('lgEditHint');
    if(hint){
      if(r.fuelId){
        const isCharge = (r.cat === '⚡ 电费');
        hint.style.display = 'block';
        hint.textContent = isCharge
          ? '⚡ 该笔由「电费」记录同步生成；保存后日期/金额/备注会同步回电费记录（单价与电量保持不变）。'
          : '⛽ 该笔由「油费」记录同步生成；保存后日期/金额/备注会同步回油费记录（单价与升数保持不变）。';
      }
      else { hint.style.display = 'none'; hint.textContent = ''; }
    }
  }
  wbModalShow(LG_MODAL, false, '✏️ 编辑记账');
}
/* 关闭/取消：只收起弹窗并清理表单状态，绝不改动原数据 */
function lgCloseEdit(){
  wbModalHide(LG_MODAL);
  lgEditId = null;
  lgViewBackFn = null;
  ['lgEditDate','lgEditAmount','lgEditCat','lgEditNote'].forEach(function(k){ const el = $(k); if(el) el.value = ''; });
  const hint = $('lgEditHint'); if(hint) hint.style.display = 'none';
}
function lgSaveEdit(){
  if(!state.user){ toast('请先登录'); return; }
  const r = lgEditId ? lgRecById(lgEditId) : null;
  if(!r){ lgCloseEdit(); return; }
  const date = $('lgEditDate').value || lgTodayStr();
  const type = ($('lgEditType').value === 'inc') ? 'inc' : 'exp';
  const amount = parseFloat($('lgEditAmount').value);
  const cat = ($('lgEditCat').value || '').trim();
  const note = ($('lgEditNote').value || '').trim();
  if(!(amount > 0)){ toast('请输入有效金额'); return; }
  r.date = date;
  r.type = type;
  r.amount = Math.round(amount * 100) / 100;
  r.cat = cat;
  r.note = note;
  sbSaveObj('ledger', { id:r.id, _sbSaved:r._sbSaved }, {record_date:r.date, type:r.type, amount:r.amount, category:r.cat, note:r.note});
  /* 油费来源的记账：把 日期/金额/备注 同步回油费记录，保证「油费 ↔ 记账」两处一致 */
  if(r.fuelId){
    try{
      const fr = (state.fuel && state.fuel.records ? state.fuel.records : []).find(function(x){ return String(x.id) === String(r.fuelId); });
      if(fr){
        fr.date = r.date; fr.amount = r.amount; fr.note = r.note;
        sbSaveObj('fuel', { id:fr.id, _sbSaved:fr._sbSaved }, { record_date:fr.date, amount:fr.amount, unit_price:fr.price, volume:fr.vol, note:fr.note });
      }
    }catch(e){}
  }
  lgState.selDate = r.date;
  lgCloseEdit();
  lgRefreshAll();
  try{ fuRefreshAll(); }catch(e){}   /* 油费各视图同步 */
  toast('已保存 ✓');
}
function lgDeleteEdit(){
  const id = lgEditId;
  if(!id) return;
  const r = lgRecById(id);
  const msg = (r && r.fuelId)
    ? '删除这条记账记录？（「' + (r.cat === '⚡ 电费' ? '⚡ 电费' : '⛽ 油费') + '」原始记录不会被删除）'
    : '删除这条记账记录？';
  if(!confirm(msg)) return;
  lgCloseEdit();
  lgDeleteRec(id);
}

/* ===== v5.26.0：点击统计卡 / 分类卡 → 弹出该组明细，并可逐条二次编辑 =====
   完全复用既有 #lgEditMask 弹窗（不新建第二套弹窗）：
     · 列表态：标题 + 若干行明细（点击任意一行 → 该条详情）
     · 详情态：原有 编辑 / 删除 流程（lgSwitchEdit / lgSaveEdit / lgDeleteEdit）不变
     · 从列表进入详情时出现「‹ 返回」，可退回列表继续看别的明细。 */
/* v5.26.1：明细行改「两行制」—— 第一行 日期·分类（左）+ 金额（右），第二行 备注**独占整行**。
   旧实现复用 .wb-row（.k 固定 70px），长备注被压在 70px 窄列里折成多行、几乎读不了；
   备注非空时才渲染第二行。 */
function lgListRowHTML(r){
  const isInc = r.type === 'inc';
  const head = (r.date || '') + (r.cat ? ' · ' + r.cat : '');
  const note = String(r.note || '').trim();
  return '<div class="lg-row" data-lgrow="' + r.id + '">' +
    '<div class="lg-row-top">' +
      '<span class="lg-row-h">' + lgEsc(head) + '</span>' +
      '<span class="lg-row-a ' + (isInc ? 'inc' : 'exp') + '">' + (isInc ? '+' : '−') + lgFmtMoney(r.amount) + '</span>' +
    '</div>' +
    (note ? '<div class="lg-row-note">' + lgEsc(note) + '</div>' : '') +
  '</div>';
}
/* 列表态渲染（titleText 已含年月前缀；list 为已排序的记录数组） */
function lgShowListView(titleText, list, emptyText){
  lgEditId = null;
  const t = $('lgViewTitle'); if(t) t.textContent = titleText;
  const rows = $('lgViewRows');
  if(rows){
    rows.innerHTML = list.length
      ? list.map(lgListRowHTML).join('')
      : '<div class="lg-row lg-row-empty">' + lgEsc(emptyText || '本月没有记录') + '</div>';
    rows.querySelectorAll('[data-lgrow]').forEach(function(el){
      el.onclick = function(){ lgOpenDetail(el.getAttribute('data-lgrow'), true); };
    });
  }
  const tm = $('lgViewTime');
  if(tm) tm.textContent = list.length ? ('共 ' + list.length + ' 条 · 点击任一条可查看 / 二次编辑') : '';
  const btns = $('lgViewBtns'); if(btns) btns.style.display = 'none';       /* 列表态隐藏单条的 编辑/删除 */
  const bk = $('lgBackBtn'); if(bk) bk.style.display = 'none';
  wbModalShow(LG_MODAL, true, '📒 记账明细');
}
function lgListSort(list){
  return list.slice().sort(function(a, b){ return String(b.date || '').localeCompare(String(a.date || '')); });
}
/* 概览 / 统计的 4 张汇总卡：本月收入 / 支出 / 结余 / 储蓄率 */
function lgOpenSummary(kind){
  const d0 = new Date();
  const ym = lgState.statYM || { y: d0.getFullYear(), m: d0.getMonth() + 1 };
  const prefix = ym.y + '-' + lgPad(ym.m);
  const all = (state.ledger && state.ledger.records) ? state.ledger.records : [];
  const inMonth = all.filter(function(r){ return r && r.date && String(r.date).indexOf(prefix) === 0; });
  const inc = inMonth.filter(function(r){ return r.type === 'inc'; });
  const exp = inMonth.filter(function(r){ return r.type === 'exp'; });
  const map = {
    inc:  { name: '本月收入明细', list: inc },
    exp:  { name: '本月支出明细', list: exp },
    net:  { name: '本月结余明细（收入 + 支出）', list: inc.concat(exp) },
    save: { name: '本月储蓄率构成（收入 + 支出）', list: inc.concat(exp) }
  };
  const T = map[kind] || { name: '本月明细', list: inMonth };
  lgViewBackFn = function(){ lgOpenSummary(kind); };
  lgShowListView(ym.y + '年' + ym.m + '月 · ' + T.name, lgListSort(T.list), '本月没有记录');
}
/* 账本页分类卡：列出该分组本月全部支出明细（与 lgBookAgg 同一套归类口径） */
function lgOpenCat(idx){
  const cat = LG_BOOK_CATS[idx];
  if(!cat) return;
  const d0 = new Date();
  const ym = lgState.statYM || { y: d0.getFullYear(), m: d0.getMonth() + 1 };
  const prefix = ym.y + '-' + lgPad(ym.m);
  const REST_IDX = LG_BOOK_CATS.findIndex(function(c){ return !!c.rest; });
  const list = lgListSort((state.ledger && state.ledger.records ? state.ledger.records : []).filter(function(r){
    if(!r || r.type !== 'exp' || !r.date || String(r.date).indexOf(prefix) !== 0) return false;
    return lgCatIndexOf(r.cat, REST_IDX) === idx;
  }));
  lgViewBackFn = function(){ lgOpenCat(idx); };
  lgShowListView(ym.y + '年' + ym.m + '月 · ' + cat.emoji + ' ' + cat.name, list, '该分组本月没有记录');
}
/* 「‹ 返回」：退回上一个明细列表 */
function lgGroupBack(){ if(lgViewBackFn){ lgViewBackFn(); } }

/* ===== v5.5.0：油费 ↔ 普通记账 联动（v5.26.0 起同样覆盖电费）=====
   加油 / 充电保存时同步写入一条「支出」记账记录，使概览/日历/统计/明细一并计入；
   分类按来源 kind 区分（用户定稿）：加油 → '⛽ 油费'，充电 → '⚡ 电费'，两者都归入「交通」组
   （见 LG_BOOK_CATS 的交通 keys：含 '油费' 与 '⚡ 电费'；不含裸 '电费'，故家庭电费仍归「居住」）。
   该记账记录的 legacy_id 记为 'fuel:<油电费记录id>'，删除时据此联动删除这笔。
   注意：只做「油电费 → 记账」单向联动——在记账里单独删除这笔不会删掉原始记录，避免误删加油/充电数据。 */
function lgRefreshLedgerViews(){
  try{
    lgRenderOverview();                                  /* 内含 4 张卡 + 最近消费 */
    lgRenderRecent();
    lgRenderCalendar();
    lgRenderStats();
    lgRenderCalDay();
    lgRenderBook();                                      /* v5.26.0：加油/充电联动后账本分类卡同步 */
  }catch(e){ /* 渲染容错，不阻塞保存流程 */ }
}
function lgAddFuelExpense(fuelRec){
  if(!state.ledger || !Array.isArray(state.ledger.records)) return;
  const amt = Math.round((Number(fuelRec.amount) || 0) * 100) / 100;
  if(!(amt > 0)) return;
  const rec = {
    id: wbUuid(),
    date: fuelRec.date,
    type: 'exp',
    amount: amt,
    cat: (fuelRec.kind === 'charge' ? '⚡ 电费' : '⛽ 油费'),   /* v5.26.0：按 kind 区分油 / 电 */
    note: (fuelRec.note || '').trim(),
    fuelId: fuelRec.id,                                 /* 内存标记：来源油电费记录 id */
    createdAt: new Date().toISOString(),
    _sbSaved: false
  };
  state.ledger.records.push(rec);
  sbSaveObj('ledger', rec, {
    record_date: rec.date, type: rec.type, amount: rec.amount,
    category: rec.cat, note: rec.note, legacy_id: 'fuel:' + rec.fuelId
  });
  lgRefreshLedgerViews();
}
function lgRemoveFuelExpense(fuelId){
  if(!state.ledger || !Array.isArray(state.ledger.records)) return;
  const hits = state.ledger.records.filter(function(r){ return r.fuelId === fuelId; });
  if(!hits.length) return;
  state.ledger.records = state.ledger.records.filter(function(r){ return r.fuelId !== fuelId; });
  hits.forEach(function(r){ try{ sbRemoveObj('ledger', r); }catch(e){} });
  lgRefreshLedgerViews();
}

/* v5.7.2：油费记录被「二次编辑」后，把 日期 / 金额 / 备注 同步到由它生成的那条记账支出。
   只做「油费 → 记账」单向同步（与 v5.5.0 的删除联动一致），单价与升数不受影响。 */
function fuSyncLedgerExpense(fuelRec){
  if(!fuelRec) return;
  try{
    const led = (state.ledger && state.ledger.records) ? state.ledger.records : [];
    led.forEach(function(x){
      if(String(x.fuelId) === String(fuelRec.id)){
        x.date = fuelRec.date;
        x.amount = fuelRec.amount;
        x.note = fuelRec.note || '';
        sbSaveObj('ledger', { id:x.id, _sbSaved:x._sbSaved }, {record_date:x.date, type:x.type, amount:x.amount, category:x.cat, note:x.note});
      }
    });
  }catch(e){}
}

function lgSave(){
  if(!state.user){ toast('请先登录'); return; }
  const type = lgState.type;
  const date = $('lgDate').value || lgTodayStr();
  const amount = parseFloat($('lgAmount').value);
  if(!(amount > 0)){ toast('请输入有效金额'); return; }
  const rec = {
    id: wbUuid(),                                    // Phase 14：前端 UUID = Supabase 主键
    date: date,
    type: type,
    amount: Math.round(amount*100)/100,
    cat: $('lgCat').value.trim(),
    note: $('lgNote').value.trim(),
    createdAt: new Date().toISOString(),
    _sbSaved: false
  };
  state.ledger.records.push(rec);
  sbSaveObj('ledger', rec, {record_date: rec.date, type: rec.type, amount: rec.amount, category: rec.cat, note: rec.note});
  $('lgAmount').value = ''; $('lgCat').value = ''; $('lgNote').value = '';
  lgState.selDate = date;
  lgRenderRecent(date);
  lgRenderCalendar(); lgRenderStats(); lgRenderOverview();
  toast('已保存 ✓');
}
function lgAutoSync(){
  const token = getGiteeToken();
  if(!token || !state.user){ return; }
  // 录入/删除/设预算后：先【上传】本次增删改到云端（删除先落地，云端不再保留该记录），
  // 再【合并】云端（此时云端已是删除后状态，不会把刚删的拉回；同时保留其它设备的新录入）。
  // 注意：自动同步不触发整页 renderLedger（否则会重置回概览面板），界面停留在当前操作面板。
  // v4.2.5 合并式同步：先拉云端与本地取并集（墓碑过滤），再上传合并后的全量 → 云端恒为所有设备并集
  tryPullLedger(false, false)
    .then(() => pushLedgerData(state.user.name, new Date().toISOString()))
    .catch(() => {});
}
// v5.1.3：统一为 Supabase 手动下拉刷新（数据实时上传，无需 Gitee）
function lgPullLedgerCloud(){
  if(!state.user){ toast('请先登录'); return; }
  sbLoadAll().then(() => { toast('已从云端刷新记账数据 ✓'); }).catch(e => toast('刷新失败：' + (e && e.message ? e.message : '未知错误')));
}
// v5.1.3：统一为 Supabase 手动刷新（数据实时上传，无需 Gitee）
function lgPushLedgerCloud(){
  if(!state.user){ toast('请先登录'); return; }
  sbLoadAll().then(() => { toast('已刷新云端记账数据 ✓'); }).catch(e => toast('刷新失败：' + (e && e.message ? e.message : '未知错误')));
}
// v5.1.3：统一为 Supabase 手动刷新（数据实时上传，无需 Gitee）
function lgSyncLedgerCloud(){
  if(!state.user){ toast('请先登录'); return; }
  return sbLoadAll().then(() => { toast('记账已刷新云端数据 ✓'); }).catch(e => toast('刷新失败：' + (e && e.message ? e.message : '未知错误')));
}

/* ---------- 日历 ---------- */
function lgRenderCalendar(){
  const ym = lgState.calYM;
  const first = new Date(ym.y, ym.m - 1, 1);
  const startDow = first.getDay();
  const days = new Date(ym.y, ym.m, 0).getDate();
  const cells = [];
  for(let i = 0; i < startDow; i++) cells.push(null);
  for(let d = 1; d <= days; d++) cells.push(d);
  while(cells.length % 7) cells.push(null);
  let html = '';
  cells.forEach(d => {
    if(d === null){ html += '<div class="lg-cell empty"></div>'; return; }
    const ds = ym.y + '-' + lgPad(ym.m) + '-' + lgPad(d);
    const t = lgDayTotals(ds);
    const isToday = ds === lgTodayStr();
    const isSel = ds === lgState.selDate;
    html += '<div class="lg-cell' + (isToday ? ' today' : '') + (isSel ? ' sel' : '') + '" data-date="' + ds + '">' +
      '<div class="lg-d">' + d + '</div>' +
      (t.exp > 0 ? '<div class="lg-c exp">' + lgFmtShort(t.exp) + '</div>' : '') +
      (t.inc > 0 ? '<div class="lg-c inc">' + lgFmtShort(t.inc) + '</div>' : '') +
    '</div>';
  });
  const grid = $('lgCalGrid');
  grid.innerHTML = html;
  $('lgCalTitle').textContent = ym.y + '年' + ym.m + '月';
  grid.querySelectorAll('.lg-cell[data-date]').forEach(c => c.onclick = () => {
    lgState.selDate = c.dataset.date;
    $('lgDate').value = c.dataset.date;
    const recs = (state.ledger.records||[]).filter(r => r.date === c.dataset.date);
    lgRenderRecent(c.dataset.date);
    lgRenderCalendar();
    const t = $('lgCalDayTitle');
    if(t) t.textContent = '当日明细 · ' + c.dataset.date + (recs.length ? '（' + recs.length + ' 笔）' : '');
    const dl = $('lgCalDayList');
    if(dl){
      dl.innerHTML = recs.length ? recs.map(lgOneRecHTML).join('') : '<div class="empty"><span class="empty-emoji">🐱</span><div class="empty-text">这一天还没有记录</div></div>';
      lgBindRecClicks(dl);
    }
    lgRenderDayChart(c.dataset.date);
  });
}

/* ---------- 统计 ---------- */
function lgRenderStats(){
  const ym = lgState.statYM;
  $('lgStatTitle').textContent = ym.y + '年' + ym.m + '月';
  const prefix = ym.y + '-' + lgPad(ym.m);
  let inc = 0, exp = 0;
  const incByDay = {}, expByDay = {};
  (state.ledger.records||[]).forEach(r => {
    if(r.date && r.date.indexOf(prefix) === 0){
      if(r.type === 'inc'){ inc += r.amount; incByDay[r.date] = (incByDay[r.date] || 0) + r.amount; }
      else { exp += r.amount; expByDay[r.date] = (expByDay[r.date] || 0) + r.amount; }
    }
  });
  inc = Math.round(inc*100)/100; exp = Math.round(exp*100)/100;
  const net = Math.round((inc - exp)*100)/100;
  let save = 0;
  if(inc > 0) save = Math.round(net / inc * 10000) / 100;
  $('lgStatInc').textContent = lgFmtMoney(inc);
  $('lgStatExp').textContent = lgFmtMoney(exp);
  $('lgStatNet').textContent = lgFmtMoney(net);
  const saveEl = $('lgStatSave');
  if(saveEl){ saveEl.textContent = (save >= 0 ? '' : '-') + Math.abs(save).toFixed(2) + '%'; saveEl.style.color = inc > 0 ? (net >= 0 ? 'var(--lg-inc)' : 'var(--lg-red)') : 'var(--lg-ink)'; }
  // 统计图：横轴=当月每天，支出红、收入绿
  const total = new Date(ym.y, ym.m, 0).getDate();
  const labels = [], expArr = [], incArr = [];
  for(let d = 1; d <= total; d++){
    const ds = ym.y + '-' + lgPad(ym.m) + '-' + lgPad(d);
    labels.push(d);
    expArr.push(Math.round((expByDay[ds] || 0) * 100) / 100);
    incArr.push(Math.round((incByDay[ds] || 0) * 100) / 100);
  }
  const legend = '<div class="lg-legend"><span><i style="background:#FF4D6D"></i>支出</span><span><i style="background:#69D19D"></i>收入</span></div>';
  const statSvg = lgGroupBarSVG(labels, expArr, incArr, '#FF4D6D', '#69D19D');
  $('lgStatChart').innerHTML = legend + statSvg;
  lgState.statChartHtml = legend + statSvg;   /* v5.6.4：缓存图表 HTML 供放大弹窗使用 */
  // 每日收支小条：收入绿、支出红
  const box = $('lgStatDays');
  const days = Array.from(new Set(Object.keys(incByDay).concat(Object.keys(expByDay))));   /* v5.6.4：去重，避免同一天收+支出现两根柱子 */
  if(!days.length){ box.innerHTML = '<div class="empty"><span class="empty-emoji">📭</span><div class="empty-text">本月暂无记录</div></div>'; return; }
  const maxv = Math.max(1, ...days.map(d => expByDay[d] || 0), ...days.map(d => incByDay[d] || 0));
  /* v5.33.2：柱高改用**开方缩放**（与 lgGroupBarSVG 同一规则，见该函数注释）——
     线性比例下「25 元 vs 6400 元」= 0.4%，柱高不足 1px，只能靠 2px 保底，小额看不出量级。
     v5.33.3：**该侧金额为 0 时不再画柱** —— 原实现 hOf(0) 也返回 2px（外加 CSS 的
     `min-height:2px`），于是「只有支出的一天」右侧仍多出一根 2px 绿柱，看起来像当天有收入。
     现在金额为 0 时整根 `<i>` 不输出（彻底不占位；.lg-daybar 本身定宽 16px，横轴对齐不变）。 */
  const hOf = v => v > 0 ? Math.max(2, 56 * Math.sqrt(v / maxv)) : 0;
  box.innerHTML = days.sort().map(d => {
    const ei = Math.round((expByDay[d] || 0) * 100) / 100, ii = Math.round((incByDay[d] || 0) * 100) / 100;
    const he = hOf(ei), hi = hOf(ii);
    const barE = he > 0 ? '<i class="exp" style="height:' + he + 'px"></i>' : '';
    const barI = hi > 0 ? '<i class="inc" style="height:' + hi + 'px"></i>' : '';
    return '<div class="lg-daybar" title="' + d + ' 收' + lgFmtMoney(ii) + ' 支' + lgFmtMoney(ei) + '">' +
      '<div class="bi">' + barE + barI + '</div>' +
      '<small>' + parseInt(d.slice(8), 10) + '</small></div>';
  }).join('');
}

/* v5.6.4：统计图放大弹窗（点击 🔍 放大、横向滑动查看整月） */
function lgZoomStatChart(){
  if(!lgState.statChartHtml){ toast('暂无图表数据'); return; }
  const ym = lgState.statYM || { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
  $('lgStatZoomTitle').textContent = ym.y + '年' + ym.m + '月 · 收支柱状图';
  const box = $('lgStatZoomBox');
  box.innerHTML = lgState.statChartHtml;
  const svg = box.querySelector('svg');
  if(svg && svg.viewBox && svg.viewBox.baseVal){
    svg.style.width = svg.viewBox.baseVal.width + 'px';   /* 按自然宽度渲染，超出容器横向滚动 */
    svg.style.height = 'auto';
  }
  $('lgStatZoomModal').classList.add('show');
}

/* =====================================================================
   账本（v5.10.0）：支出构成「只读展示」模块
   ─────────────────────────────────────────────────────────────────────
   只读边界：不修改 lgSave / lgRenderRecent / 日历 / 查询 / 二次编辑 / 删除 /
   搜索 等任何既有记账逻辑，仅从 state.ledger.records[] 聚合后展示。
   数据：{ id, date:'YYYY-MM-DD', type:'inc'|'exp', amount, cat, note, createdAt }
     · 本月收入 = 当月 type==='inc' 的 amount 合计
     · 本月支出 = 当月 type==='exp' 的 amount 合计
     · 支出构成 = 当月支出按 cat 归入「固定七类 + 其他」（见 LG_BOOK_CATS）
     分类字段说明：记账「分类」是**自由文本**输入（placeholder「如 餐饮 / 工资 / 交通」），
     项目里并无固定分类枚举，因此这里用「关键词命中」把自由文本归类：
      · 按 LG_BOOK_CATS 的声明顺序（= 图表从左到右的顺序）依次匹配，
        一条记录命中第一个关键词即归入该类 → 确定性归类，绝不重复计数；
      · 未命中任何关键词的支出（含分类为空）→ 全部兜入最后一类「其他」，
        因此「支出构成」8 根柱子金额之和 = 本月支出总额（百分比合计 100%）。
     ⇒ 需要增删关键词 / 别名，只改 LG_BOOK_CATS 一处即可。
     v5.26.0 新增「交通」类：油费（⛽ 油费）/ 电费（⚡ 电费）/ 充电 / 停车 等归入交通。
       ⚠ 顺序：交通必须排在「居住」**之前**——「⚡ 电费」内含「电费」二字，而「电费」是
         「居住」的关键词；若「居住」在前，充电同步生成的记账会被误归到居住。
         交通的关键词刻意不含裸「电费」，因此家庭生活「电费」仍归「居住」（用户要求）。
     ===================================================================== */
     const LG_BOOK_CATS = [
  /* v5.26.0 交通：必须位于「居住」之前（见上方顺序说明） */
  { name: '交通', emoji: '🚗', color: '#4C9A8F', keys: ['交通','油费','加油','油卡','充电','充电费','充电桩','电车','停车','停车费','过路','过路费','高速','打车','出租','滴滴','公交','地铁','火车','高铁','机票','车票','⚡ 电费'] },
  { name: '居住', emoji: '🏠', color: '#D4A017', keys: ['居住','房租','租房','租金','房贷','水电','电费','水费','燃气','煤气','物业','家居','家具','家电','装修','宽带','网费','窗帘','床品','收纳','五金','维修'] },
  { name: '购物', emoji: '🛍️', color: '#D07CB0', keys: ['购物','衣服','服饰','鞋','裤','裙','帽','包包','数码','电子','日用','超市','淘宝','京东','拼多多','商场','饰品'] },
  { name: '学习', emoji: '📚', color: '#4E8FD0', keys: ['学习','书','培训','课程','教育','文具','学费','考试','报名','网课','资料'] },
  { name: '餐饮', emoji: '🍜', color: '#F08A3C', keys: ['餐饮','吃','饭','外卖','美食','咖啡','奶茶','饮料','零食','早餐','午餐','午饭','晚餐','晚饭','夜宵','聚餐','食堂','水果','菜','饼','火锅','烧烤','汉堡','披萨','蛋糕','面包','粥','汤','米线','米粉','快餐','面馆','小吃','饭店','酒楼','烘焙'] },
  { name: '美妆', emoji: '💄', color: '#B49BE0', keys: ['美妆','化妆','护肤','美容','口红','面膜','香水','洗发','沐浴','洗护','身体乳'] },
  { name: '宠物', emoji: '🐱', color: '#5FA463', keys: ['宠物','猫','狗','猫粮','狗粮','猫砂','疫苗','驱虫','宠物医院'] },
  /* v5.10.0 兜底类：rest:true → 不参与关键词匹配，承接所有未归类支出（含分类为空） */
  { name: '其他', emoji: '🧾', color: '#8896A0', keys: [], rest: true }
];
/* 金额显示：整数略去小数、非整数保留两位（与设计稿「¥980 / ¥1280 / ¥0」一致） */
function lgBookMoney(v){
  const n = Math.round((Number(v) || 0) * 100) / 100;
  return '¥' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}
/* v5.26.0：分类归类口径抽成公共函数 —— 供 lgBookAgg（账本环形图聚合）与
   lgOpenCat（点击分类卡看该组明细）共用，保证「图上金额」与「点开看到的明细」
   永远是同一套关键词匹配，两处不会各自漂移。
   规则：按 LG_BOOK_CATS 声明顺序命中第一个关键词即归类；rest 类不参与匹配；
        未命中（含分类为空）→ restIdx（「其他」）。 */
function lgCatIndexOf(catValue, restIdx){
  const cat = String(catValue || '').trim().toLowerCase();
  if(cat){
    for(let i = 0; i < LG_BOOK_CATS.length; i++){
      if(LG_BOOK_CATS[i].rest) continue;              /* 「其他」不参与关键词匹配 */
      const keys = LG_BOOK_CATS[i].keys;
      for(let k = 0; k < keys.length; k++){
        if(cat.indexOf(keys[k].toLowerCase()) !== -1) return i;   /* 命中第一个即归类 */
      }
    }
  }
  return restIdx;
}
/* 聚合当前视图月份（lgState.statYM 首次渲染即当前月）→ { inc, exp, cats[] } */
function lgBookAgg(){
  const d0 = new Date();
  const ym = lgState.statYM || { y: d0.getFullYear(), m: d0.getMonth() + 1 };
  const prefix = ym.y + '-' + lgPad(ym.m);
  const REST_IDX = LG_BOOK_CATS.findIndex(function(c){ return !!c.rest; });   /* 「其他」下标 */
  let inc = 0, exp = 0;
  const sums = LG_BOOK_CATS.map(function(){ return 0; });
  (state.ledger.records || []).forEach(function(r){
    if(!r || !r.date || String(r.date).indexOf(prefix) !== 0) return;
    const amt = Number(r.amount) || 0;
    if(r.type === 'inc'){ inc += amt; return; }
    if(r.type !== 'exp') return;
    exp += amt;
    /* v5.26.0：归类改用公共函数 lgCatIndexOf（与「点击分类卡看明细」同一口径） */
    sums[lgCatIndexOf(r.cat, REST_IDX)] += amt;
  });
  inc = Math.round(inc * 100) / 100;
  exp = Math.round(exp * 100) / 100;
  const cats = LG_BOOK_CATS.map(function(c, i){
    const amount = Math.round(sums[i] * 100) / 100;
    let pct = 0;
    if(exp > 0){                                        /* 总支出为 0 → 一律 0.0，杜绝 NaN / Infinity */
      const p = amount / exp * 100;
      if(isFinite(p)) pct = Math.round(p * 10) / 10;
    }
    return { name: c.name, emoji: c.emoji, color: c.color, amount: amount, pct: pct };
  });
  return { inc: inc, exp: exp, cats: cats };
}

/* 右侧分类明细：每类一张独立卡片 =「彩色浅底图标块 + 分类名 / 金额两行 + 右侧占比」
   图标块底色取该分类识别色的 15% 透明（c.color + '26'），与左侧柱色一一对应 */
function lgBookListHTML(cats){
  return cats.map(function(c, i){
    /* v5.26.0：data-cat = LG_BOOK_CATS 下标 → 点击整卡查看该分组本月明细（lgOpenCat） */
    return '<div class="book-row" data-cat="' + i + '">' +
      '<div class="bi" style="background:' + c.color + '26">' + c.emoji + '</div>' +
      '<div class="bmid">' +
        '<div class="bn">' + lgEsc(c.name) + '</div>' +
        '<div class="bv">' + lgBookMoney(c.amount) + '</div>' +
      '</div>' +
      '<div class="bp">' + c.pct.toFixed(1) + '%</div>' +
    '</div>';
  }).join('');
}
/* 渲染入口：lgSwitch('book') 调用 → 切到账本页 / 新增 / 编辑 / 删除 / 云端数据到达后实时联动 */
function lgRenderBook(){
  try{
    const agg = lgBookAgg();
    const incEl = $('bookInc'), expEl = $('bookExp');
    if(incEl) incEl.textContent = lgFmtMoney(agg.inc);
    if(expEl) expEl.textContent = lgFmtMoney(agg.exp);
    const list = $('bookList');
    if(list){
      list.innerHTML = lgBookListHTML(agg.cats);
      /* v5.26.0：分类卡整卡可点击 → 弹出该分组本月明细（每次重渲染后重新绑定） */
      list.querySelectorAll('.book-row[data-cat]').forEach(function(el){
        el.onclick = function(){ lgOpenCat(parseInt(el.getAttribute('data-cat'), 10)); };
      });
    }
  }catch(e){ console.error('lgRenderBook 异常：', e); }
}

/* ---------- 查询（柱状图 + 折线图） ---------- */
function lgRunQuery(){
  const mode = lgState.qmode;
  const s = $('lgRangeStart').value, e = $('lgRangeEnd').value;
  if(!s || !e){ toast('请选择起止日期'); return; }
  let labels = [], expArr = [], incArr = [];
  if(mode === 'days'){
    let cur = new Date(s + 'T00:00:00'), end = new Date(e + 'T00:00:00');
    if(cur > end){ toast('开始日期应早于结束日期'); return; }
    while(cur <= end && labels.length <= 60){
      const ds = lgIso(cur);
      labels.push((cur.getMonth()+1) + '/' + cur.getDate());
      const t = lgDayTotals(ds); expArr.push(t.exp); incArr.push(t.inc);
      cur.setDate(cur.getDate() + 1);
    }
    if(labels.length > 60){ labels = labels.slice(0,60); expArr = expArr.slice(0,60); incArr = incArr.slice(0,60); toast('区间过大，已截取前 60 天'); }
  } else {
    let sy = +s.split('-')[0], sm = +s.split('-')[1], ey = +e.split('-')[0], em = +e.split('-')[1];
    if(sy > ey || (sy === ey && sm > em)){ toast('开始月份应早于结束月份'); return; }
    let y = sy, m = sm;
    while((y < ey || (y === ey && m <= em)) && labels.length <= 36){
      const pm = (m < 10 ? '0' + m : '' + m);
      labels.push(y + '/' + pm);
      let inc = 0, exp = 0;
      (state.ledger.records||[]).forEach(r => {
        if(r.date && r.date.indexOf(y + '-' + pm) === 0){ if(r.type === 'inc') inc += r.amount; else exp += r.amount; }
      });
      incArr.push(Math.round(inc*100)/100); expArr.push(Math.round(exp*100)/100);
      m++; if(m > 12){ m = 1; y++; }
    }
    if(labels.length > 36){ labels = labels.slice(0,36); expArr = expArr.slice(0,36); incArr = incArr.slice(0,36); toast('区间过大，已截取前 36 个月'); }
  }
  if(!labels.length){ toast('该区间没有数据'); return; }
  $('lgQueryResult').hidden = false;
  $('lgBarChart').innerHTML = lgGroupBarSVG(labels, expArr, incArr, '#FF4D6D', '#69D19D');
  $('lgLineChart').innerHTML = lgLineSVG(labels, expArr, incArr, '#FF4D6D', '#69D19D');
}

/* ---------- SVG 图表（颜色用十六进制，SVG 表现属性不支持 var()） ---------- */
function lgGroupBarSVG(labels, arrA, arrB, colorA, colorB){
  const n = labels.length;
  const W = Math.max(280, n * 46), H = 190, padL = 40, padB = 34, padT = 30, padR = 10;   /* v5.9.0：顶部留白放大数值标注 */
  const cw = W - padL - padR, ch = H - padT - padB;
  const max = Math.max(1, ...arrA, ...arrB);
  /* v5.33.2：柱高由**线性比例**改为**开方缩放**（ratio = √(v/max)）。
     背景：用户实测「6400 元与 25 元同图」时，线性比例下 25/6400 = 0.39%，
     126px 的绘图区里柱高只有 0.49px ⇒ 小额被完全压平，图形完全读不出量级差异。
     开方后 25 元 = 6.25%（约 8px，清晰可见），6400 元仍满高 —— 保留「谁大谁小」的
     单调性与直观对比，同时**不追求严格线性**（用户明确不需要这种精确对比）。
     ⚠️ 刻度随之改为**开方刻度**：第 i 条网格线标注值 = max·t²（t = 1 - i/4），
     与柱高公式互逆，因此网格线与柱顶严格对齐，不会产生误导。 */
  const ratio = function(v){ return Math.sqrt(Math.max(0, v) / max); };
  const gw = cw / n;
  const fs = Math.max(7.5, Math.min(11, gw * 0.26));    /* 数值字号随柱间距自适应 */
  const cLa = wbDarken(colorA, .66), cLb = wbDarken(colorB, .66);
  let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">';
  for(let i = 0; i <= 4; i++){
    const t = 1 - i / 4;                                 /* 归一化高度：1（顶）→ 0（底） */
    const y = padT + ch * (1 - t);
    const v = Math.round(max * t * t);                   /* 开方刻度：值 = max·t²（与柱高互逆） */
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#eee"/>';
    svg += '<text x="' + (padL - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="#9aa49a">' + wbMoneyShort(v) + '</text>';
  }
  for(let i = 0; i < n; i++){
    const gx = padL + gw * i, bw = Math.min(gw * 0.34, 22);
    const xa = gx + gw * 0.5 - bw - 1, xb = gx + gw * 0.5 + 1;
    const ha = ch * ratio(arrA[i] || 0), hb = ch * ratio(arrB[i] || 0);
    svg += '<rect x="' + xa + '" y="' + (padT + ch - ha) + '" width="' + bw + '" height="' + ha + '" rx="2" fill="' + colorA + '"/>';
    svg += '<rect x="' + xb + '" y="' + (padT + ch - hb) + '" width="' + bw + '" height="' + hb + '" rx="2" fill="' + colorB + '"/>';
    /* 数值直接标在柱顶：B（收入）比 A（支出）再抬高约一个字高，避免相邻两数字重叠；0 值不标以减噪 */
    if(arrA[i] > 0) svg += wbChartLabel(xa + bw / 2, padT + ch - ha - 4, wbMoneyShort(arrA[i]), fs, cLa);
    if(arrB[i] > 0) svg += wbChartLabel(xb + bw / 2, padT + ch - hb - 4 - (fs + 2), wbMoneyShort(arrB[i]), fs, cLb);
    let lb = labels[i]; if(lb && lb.length > 5) lb = lb.slice(0, 5);
    svg += '<text x="' + (gx + gw * 0.5) + '" y="' + (H - padB + 13) + '" text-anchor="middle" font-size="10" fill="#8a9790">' + lgEsc('' + lb) + '</text>';
  }
  svg += '</svg>';
  return svg;
}
function lgLineSVG(labels, arrA, arrB, colorA, colorB, capW){
  const n = labels.length;
  const W = Math.min(Math.max(280, n * 46), (capW && capW > 0) ? capW : 99999), H = 190, padL = 40, padB = 34, padT = 30, padR = 10;
  const cw = W - padL - padR, ch = H - padT - padB;
  const max = Math.max(1, ...arrA, ...arrB);
  const gw = cw / n;
  const fs = Math.max(7.5, Math.min(11, gw * 0.26));
  const cLa = wbDarken(colorA, .66), cLb = wbDarken(colorB, .66);
  const pt = (i, val) => [padL + gw * i + gw / 2, padT + ch - ch * (val || 0) / max];
  let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">';
  for(let i = 0; i <= 4; i++){
    const y = padT + ch * i / 4, v = Math.round(max * (1 - i / 4));
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#eee"/>';
    svg += '<text x="' + (padL - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="#9aa49a">' + wbMoneyShort(v) + '</text>';
  }
  let pathA = '', pathB = '';
  for(let i = 0; i < n; i++){ const p = pt(i, arrA[i]); pathA += (i ? 'L' : 'M') + p[0] + ' ' + p[1] + ' '; }
  for(let i = 0; i < n; i++){ const p = pt(i, arrB[i]); pathB += (i ? 'L' : 'M') + p[0] + ' ' + p[1] + ' '; }
  svg += '<path d="' + pathA + '" fill="none" stroke="' + colorA + '" stroke-width="2"/>';
  svg += '<path d="' + pathB + '" fill="none" stroke="' + colorB + '" stroke-width="2"/>';
  for(let i = 0; i < n; i++){
    const a = pt(i, arrA[i]), b = pt(i, arrB[i]);
    svg += '<circle cx="' + a[0] + '" cy="' + a[1] + '" r="2.5" fill="' + colorA + '"/>';
    svg += '<circle cx="' + b[0] + '" cy="' + b[1] + '" r="2.5" fill="' + colorB + '"/>';
    /* 数据点数值直接标注：A 在上、B 再抬高约一个字高，避免两点数值重叠 */
    if(arrA[i] > 0) svg += wbChartLabel(a[0], a[1] - 7, wbMoneyShort(arrA[i]), fs, cLa);
    if(arrB[i] > 0) svg += wbChartLabel(b[0], b[1] - 7 - (fs + 2), wbMoneyShort(arrB[i]), fs, cLb);
    let lb = labels[i]; if(lb && lb.length > 5) lb = lb.slice(0, 5);
    svg += '<text x="' + (padL + gw * i + gw / 2) + '" y="' + (H - padB + 13) + '" text-anchor="middle" font-size="10" fill="#8a9790">' + lgEsc('' + lb) + '</text>';
  }
  svg += '</svg>';
  return svg;
}

/* ---------- 渲染入口 ---------- */
function renderLedger(){
  try{
    // 随机选一张柔和粉色背景图铺满记账页
    const bgIdx = Math.floor(Math.random()*5) + 1;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--lg-bg-' + bgIdx).trim();
    const screen = $('screen-ledger');
    if(screen) screen.style.backgroundImage = bg;
    if(!lgState.calYM){ const d = new Date(); lgState.calYM = { y:d.getFullYear(), m:d.getMonth()+1 }; }
    if(!lgState.statYM){ const d = new Date(); lgState.statYM = { y:d.getFullYear(), m:d.getMonth()+1 }; }
    if(!lgState.selDate) lgState.selDate = lgTodayStr();
    $('lgDate').value = lgState.selDate;
    if(!$('lgRangeStart').value){ const t = new Date(), e = new Date(); e.setDate(e.getDate() - 6); $('lgRangeStart').value = lgIso(e); $('lgRangeEnd').value = lgIso(t); }
    lgBind();
    lgSwitch('overview');
    lgRenderRecent();
    lgRenderCalendar();
    lgRenderStats();
  }catch(e){ console.error('renderLedger 异常：', e); }
}
let lgBound = false;
function lgBind(){
  if(lgBound) return; lgBound = true;
  document.querySelectorAll('#lgSide .lg-nav').forEach(b => b.onclick = () => lgSwitch(b.dataset.lg));
  document.querySelectorAll('#screen-ledger .lg-type-btn[data-type]').forEach(b => b.onclick = () => {
    lgState.type = b.dataset.type;
    document.querySelectorAll('#screen-ledger .lg-type-btn[data-type]').forEach(x => x.classList.toggle('active', x === b));
  });
  document.querySelectorAll('#screen-ledger .lg-type-btn[data-qmode]').forEach(b => b.onclick = () => {
    lgState.qmode = b.dataset.qmode;
    document.querySelectorAll('#screen-ledger .lg-type-btn[data-qmode]').forEach(x => x.classList.toggle('active', x === b));
    $('lgRangeLabel').textContent = b.dataset.qmode === 'days' ? '开始日期' : '开始月份';
    $('lgRangeLabel2').textContent = b.dataset.qmode === 'days' ? '结束日期' : '结束月份';
  });
  $('lgSave').onclick = lgSave;
  $('lgCalPrev').onclick = () => { lgState.calYM.m--; if(lgState.calYM.m < 1){ lgState.calYM.m = 12; lgState.calYM.y--; } lgRenderCalendar(); };
  $('lgCalNext').onclick = () => { lgState.calYM.m++; if(lgState.calYM.m > 12){ lgState.calYM.m = 1; lgState.calYM.y++; } lgRenderCalendar(); };
  $('lgStatPrev').onclick = () => { lgState.statYM.m--; if(lgState.statYM.m < 1){ lgState.statYM.m = 12; lgState.statYM.y--; } lgRenderStats(); };
  $('lgStatNext').onclick = () => { lgState.statYM.m++; if(lgState.statYM.m > 12){ lgState.statYM.m = 1; lgState.statYM.y++; } lgRenderStats(); };
  $('lgStatZoom').onclick = lgZoomStatChart;   /* v5.6.4：统计图放大 */
  /* v5.26.0：概览 4 卡 / 统计 4 卡可点击 → 弹窗列出本月对应明细（顺序固定：收入/支出/结余/储蓄率） */
  const SUM_KEYS = ['inc', 'exp', 'net', 'save'];
  document.querySelectorAll('#lgp-overview .lg-ov-card').forEach(function(el, i){
    el.onclick = function(){ lgOpenSummary(SUM_KEYS[i]); };
  });
  document.querySelectorAll('#lgp-stats .lg-sum').forEach(function(el, i){
    el.onclick = function(){ lgOpenSummary(SUM_KEYS[i]); };
  });
  $('lgQueryBtn').onclick = lgRunQuery;
  $('lgBudgetSet').onclick = lgSetBudget;
  $('lgHeaderSync').onclick = () => {
    if(!state.user){ toast('请先登录'); return; }
    syncSpin($('lgHeaderSync'), sbLoadAll);
  };
  $('lgSync').onclick = () => {
    if(!state.user){ toast('请先登录'); return; }
    syncSpin($('lgSync'), lgSyncLedgerCloud);
  };
}
