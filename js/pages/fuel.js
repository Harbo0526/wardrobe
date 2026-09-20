/* ==========================================================================
   生活象限 · js/pages/fuel.js
   --------------------------------------------------------------------------
   Phase 5 Candidate C：Fuel page module（油费记账页）
   自 index.html 物理抽取（原 L6635–L6953，共 319 行），**逐字节原样迁移**：
   27 个 fu* 函数 + 3 个顶层变量（fuState / FU_MODAL / fuEditId）。

   v5.26.0（本版新增）：油费 → **油电费**。
     · 同一张表 public.fuel_records 承载两种记录，用 kind 区分（'fuel' | 'charge'）；
     · 「记录加油」卡片下方新增「记录电费」卡片，字段一一对应：
         充电日期 → date/record_date、充电金额 → amount、
         充电电量 → vol/volume（kWh）、充电单价 → price/unit_price（元/度）；
     · 两张卡片各自独立折叠（localStorage，参考待办卡片实现）；
     · 概览统计**油 / 电分开**（年总价、月总价、月均费用、月均数量），
       升数与 kWh 物理单位不同，**绝不混算**；
     · 明细 / 日历 / 查询合并展示两种记录，并用 ⛽ / ⚡ 徽标区分；日历按天合计金额，
       当天明细里数量分列（L / kWh）；
     · 联动记账：加油 → 分类 '⛽ 油费'，充电 → 分类 '⚡ 电费'，两者都归入账本「交通」组。
       原有 30 个 fu* 符号名全部保留（架构校验要求「各自恰好定义一次」），
       既有 fu* 入口语义不变（fuSave 仍= 保存加油），仅内部按 kind 参数化。

   ⚠️ Classic Script（非 ESM）：顶层 function 声明即全局对象属性 →
      HTML onclick（fuCloseEdit / fuSwitchEdit / fuDeleteEdit / fuSaveEdit /
      fuToggleCollapse）与主脚本的 lgSwitch() / lgSaveEdit() 均可跨脚本懒调用。
   ⚠️ 加载位置：紧跟 js/pages/cocktail.js、位于主内联脚本之后。
   ⚠️ 与 js/fuel.js **不是同一件事**：js/fuel.js 是「油价趋势」（只读 Supabase 油价数据），
      本文件是「油电费记账」（本地记录 CRUD + 联动记账）。两者禁止合并。

   保留在 index.html 的协作方（跨脚本懒调用，本文件不持有其定义）：
     Ledger：lgAddFuelExpense / lgRemoveFuelExpense / lgRefreshLedgerViews / fuSyncLedgerExpense
     状态形状：state（唯一）/ defaultFuel
     core / bridge：$ · toast · spEsc · wbRowHTML · wbModalShow · wbModalHide
                    sbSaveObj · sbRemoveObj · wbUuid
   ========================================================================== */

/* =====================================================================
   油电费模块（v5.3.0 油费 / v5.26.0 加充电）：
   概览统计 / 记录加油 / 记录电费 / 记录明细 / 日历统计 / 日志查询
   数据：state.fuel.records[] = { id, kind, date, amount, price, vol, note, createdAt, _sbSaved }
   云端：public.fuel_records（DAL 模块名 'fuel'，见 js/data/index.js）
   ===================================================================== */
let fuState = { calYM: null };
/* v5.26.0：当前「详情 / 编辑」弹窗对应的记录类型（'fuel' | 'charge'）——
   两种记录共用同一个 fuEditMask 弹窗（不新建第二套编辑弹窗）。 */
let fuEditKind = 'fuel';
function fuPad(n){ return (n < 10 ? '0' + n : '' + n); }
function fuTodayStr(){ const d = new Date(); return d.getFullYear() + '-' + fuPad(d.getMonth()+1) + '-' + fuPad(d.getDate()); }
function fuRecs(){ return (state.fuel && Array.isArray(state.fuel.records)) ? state.fuel.records : []; }
function fuMoney(n){ return '¥' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

/* ---------- v5.26.0：两种记录类型（kind）的文案与单位配置 ----------
   前缀 p 同时决定卡片内元素 id（fuel→fu*，charge→ec*）与概览卡 id。 */
const FU_KINDS = {
  fuel: {
    p: 'fu', kind: 'fuel', emoji: '⛽', name: '油费', card: '记录加油', ledCat: '⛽ 油费',
    dateLabel: '加油日期', amountLabel: '加油金额（元）', priceLabel: '加油单价（元/升）',
    volLabel: '加油体积（升）', volPh: '如 39.2', notePh: '如：中石化 92#',
    priceUnit: '元/升', qtyUnit: 'L', qtyName: '升', qtyRow: '油量'
  },
  charge: {
    p: 'ec', kind: 'charge', emoji: '⚡', name: '电费', card: '记录电费', ledCat: '⚡ 电费',
    dateLabel: '充电日期', amountLabel: '充电金额（元）', priceLabel: '充电单价（元/度）',
    volLabel: '充电电量（度）', volPh: '如 50', notePh: '如：国家电网 快充',
    priceUnit: '元/度', qtyUnit: 'kWh', qtyName: '度', qtyRow: '电量'
  }
};
function fuCfg(kind){ return FU_KINDS[kind === 'charge' ? 'charge' : 'fuel']; }
function fuKindOf(r){ return (r && r.kind === 'charge') ? 'charge' : 'fuel'; }   /* 历史行兜底 fuel */
function fuRecsOf(kind){ return fuRecs().filter(function(r){ return fuKindOf(r) === kind; }); }
/* 卡片内元素：$('fu' + 'Date') / $('ec' + 'Date') … */
function fuEl(kind, name){ return $(fuCfg(kind).p + name); }
function fuR2(n){ return String(Math.round(n * 100) / 100); }

/* 概览：油 / 电**分开**两个 4 卡（年总价 / 月总价 / 月均费用 / 月均数量）。
   禁止把「升」与「kWh」相加——每类只在自己的记录内聚合。 */
function fuRenderOverview(){
  const now = new Date();
  const yPf = now.getFullYear() + '-', mPf = yPf + fuPad(now.getMonth() + 1);
  ['fuel', 'charge'].forEach(function(kind){
    const cfg = fuCfg(kind);
    let yTotal = 0, mTotal = 0;
    const mCost = {}, mQty = {};
    fuRecsOf(kind).forEach(function(r){
      const d = r.date || '', amt = Number(r.amount) || 0, qty = Number(r.vol) || 0;
      if(d.indexOf(yPf) === 0) yTotal += amt;
      if(d.indexOf(mPf) === 0) mTotal += amt;
      const mk = d.slice(0, 7);
      if(mk){ mCost[mk] = (mCost[mk] || 0) + amt; mQty[mk] = (mQty[mk] || 0) + qty; }
    });
    const yMks = Object.keys(mCost).filter(function(k){ return k.indexOf(yPf) === 0; });
    const n = yMks.length;
    const avgCost = n ? (yMks.reduce(function(s,k){ return s + mCost[k]; }, 0) / n) : 0;
    const avgQty  = n ? (yMks.reduce(function(s,k){ return s + mQty[k]; }, 0) / n) : 0;
    const set = function(suffix, txt){ const el = $(cfg.p + suffix); if(el) el.textContent = txt; };
    set('YearTotal', fuMoney(yTotal));
    set('MonthTotal', fuMoney(mTotal));
    set('AvgCost', fuMoney(avgCost));
    set('AvgVol', (Math.round(avgQty * 10) / 10) + cfg.qtyUnit);
  });
}

/* 记录明细（两种记录合并，按日期倒序；容器限高约两行，可上下滑动看历史） */
function fuSorted(){
  return fuRecs().slice().sort(function(a, b){ return String(b.date||'').localeCompare(String(a.date||'')); });
}
/* v5.7.2：明细行统一模板（记录明细 / 日历当天明细 / 查询结果共用）；整行可点击 → 放大详情弹窗
   v5.26.0：行首按 kind 显示 ⛽ / ⚡，单价与数量按 kind 的单位显示（元/升·元/度，L·kWh） */
function fuItemHTML(r, withDel){
  const cfg = fuCfg(fuKindOf(r));
  const sub = [(r.price != null ? r.price + ' ' + cfg.priceUnit : ''), (r.vol != null ? r.vol + cfg.qtyUnit : ''), (r.note || '')].filter(Boolean).join(' · ');
  return '<div class="fu-item" data-fuid="' + r.id + '">' +
    '<div class="fu-date">' + (r.date || '') + '</div>' +
    '<div class="fu-main"><div class="fu-amt"><span class="fu-kind">' + cfg.emoji + '</span> ' + fuMoney(r.amount) + '</div>' + (sub ? '<div class="fu-sub">' + spEsc(sub) + '</div>' : '') + '</div>' +
    (withDel ? '<button class="fu-del" data-fudel="' + r.id + '" title="删除">✕</button>' : '') +
  '</div>';
}
/* 绑定：整行 → 详情弹窗；✕ → 删除（阻止冒泡，避免误开详情） */
function fuBindItems(box){
  if(!box) return;
  box.querySelectorAll('.fu-item[data-fuid]').forEach(function(el){
    el.onclick = function(){ fuOpenDetail(el.getAttribute('data-fuid')); };
  });
  box.querySelectorAll('[data-fudel]').forEach(function(b){
    b.onclick = function(ev){ ev.stopPropagation(); fuDelete(b.getAttribute('data-fudel')); };
  });
}
function fuRenderList(){
  const box = $('fuList'); if(!box) return;
  const list = fuSorted();
  const t = $('fuListTitle'); if(t) t.textContent = '记录明细' + (list.length ? '（' + list.length + '）' : '');
  if(!list.length){ box.innerHTML = '<div class="empty"><span class="empty-emoji">⛽</span><div class="empty-text">还没有油电费记录</div></div>'; return; }
  box.innerHTML = list.map(function(r){ return fuItemHTML(r, true); }).join('');
  fuBindItems(box);
}

/* v5.4.7：金额 / 单价 / 体积（电量）自动换算。
   规则：金额是必需项（没金额不换算）；填了单价 → 算数量；填了数量 → 算单价；
   改金额时优先按已填单价重算数量，否则按已填数量重算单价。
   说明：程序化写 value 不会触发 input 事件，故三者不会互相递归触发。 */
function fuAutoCalcOf(kind, src){
  const amtEl = fuEl(kind, 'Amount'), priceEl = fuEl(kind, 'Price'), volEl = fuEl(kind, 'Vol');
  if(!amtEl || !priceEl || !volEl) return;
  const amt = parseFloat(amtEl.value);
  if(!(amt > 0)) return;                       // 无金额则无从换算
  const price = parseFloat(priceEl.value);
  const vol = parseFloat(volEl.value);
  if(src === 'price'){
    if(price > 0) volEl.value = fuR2(amt / price);        // 单价 → 数量 = 金额 ÷ 单价
  } else if(src === 'vol'){
    if(vol > 0) priceEl.value = fuR2(amt / vol);          // 数量 → 单价 = 金额 ÷ 数量
  } else {
    if(price > 0) volEl.value = fuR2(amt / price);
    else if(vol > 0) priceEl.value = fuR2(amt / vol);
  }
}
/* 保留原符号名：fuAutoCalc = 加油卡片的自动换算（内部按 kind 参数化） */
function fuAutoCalc(src){ fuAutoCalcOf('fuel', src); }
/* v5.26.0：电费卡片的自动换算 */
function ecAutoCalc(src){ fuAutoCalcOf('charge', src); }

/* 保存一条记录（kind = 'fuel' 加油 / 'charge' 充电） */
function fuSaveOf(kind){
  if(!state.user){ toast('请先登录'); return; }
  const cfg = fuCfg(kind);
  const date = fuEl(kind, 'Date').value;
  const amount = parseFloat(fuEl(kind, 'Amount').value);
  const price = fuEl(kind, 'Price').value === '' ? null : parseFloat(fuEl(kind, 'Price').value);
  const vol = fuEl(kind, 'Vol').value === '' ? null : parseFloat(fuEl(kind, 'Vol').value);
  const note = (fuEl(kind, 'Note').value || '').trim();
  if(!date){ toast('请选择' + cfg.dateLabel); return; }
  if(!(amount > 0)){ toast('请输入有效的' + cfg.amountLabel.replace('（元）', '')); return; }
  if(price !== null && !(price >= 0)){ toast('单价无效'); return; }
  if(vol !== null && !(vol >= 0)){ toast('数量无效'); return; }
  const rec = { id: wbUuid(), kind: kind, date: date, amount: Math.round(amount*100)/100,
                price: price === null ? null : Math.round(price*100)/100,
                vol: vol === null ? null : Math.round(vol*100)/100,
                note: note, createdAt: new Date().toISOString(), _sbSaved: false };
  state.fuel.records.push(rec);
  sbSaveObj('fuel', rec, { record_date: rec.date, amount: rec.amount, unit_price: rec.price, volume: rec.vol, kind: rec.kind, note: rec.note });
  lgAddFuelExpense(rec);   /* v5.5.0：同步生成一条记账「支出」（加油→⛽ 油费 / 充电→⚡ 电费），概览/日历/统计/明细/账本一并计入 */
  fuEl(kind, 'Amount').value = ''; fuEl(kind, 'Price').value = ''; fuEl(kind, 'Vol').value = ''; fuEl(kind, 'Note').value = '';
  fuState.selDate = rec.date;
  fuRefreshAll();
  toast('已保存' + cfg.card.slice(2) + '记录 ✓（已同步到记账）');
}
/* 保留原符号名：fuSave = 保存加油记录（语义与 v5.25.0 完全一致） */
function fuSave(){ fuSaveOf('fuel'); }
/* v5.26.0：保存充电记录 */
function ecSave(){ fuSaveOf('charge'); }

/* 删除记录 */
function fuDelete(id){
  const recs = fuRecs();
  const i = recs.findIndex(function(r){ return r.id === id; });
  if(i < 0) return;
  const rec = recs[i];
  if(!confirm('删除这条' + fuCfg(fuKindOf(rec)).card.slice(2) + '记录？')) return;
  recs.splice(i, 1);
  try{ sbRemoveObj('fuel', rec); }catch(e){}
  lgRemoveFuelExpense(id);   /* v5.5.0：联动删除由这笔油电费生成的记账支出 */
  fuRefreshAll();
  toast('已删除（已同步到记账）');
}

/* 日历统计：显示每天一共花了多少油电费（金额可加总，单位无关） */
function fuDayTotal(ds){
  return fuRecs().filter(function(r){ return r.date === ds; })
    .reduce(function(s, r){ return s + (Number(r.amount) || 0); }, 0);
}
function fuRenderCalendar(){
  const grid = $('fuCalGrid'); if(!grid) return;
  if(!fuState.calYM){ const d = new Date(); fuState.calYM = { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  const ym = fuState.calYM;
  $('fuCalTitle').textContent = ym.y + '年' + ym.m + '月';
  const first = new Date(ym.y, ym.m - 1, 1);
  const startDow = first.getDay();
  const days = new Date(ym.y, ym.m, 0).getDate();
  const today = fuTodayStr();
  let h = '';
  for(let i = 0; i < startDow; i++) h += '<span class="lg-cell empty"></span>';
  for(let d = 1; d <= days; d++){
    const ds = ym.y + '-' + fuPad(ym.m) + '-' + fuPad(d);
    const amt = fuDayTotal(ds);
    const cls = 'lg-cell' + (ds === today ? ' fu-today' : '') + (amt > 0 ? ' fu-has' : '') + (ds === fuState.selDate ? ' sel' : '');
    h += '<span class="' + cls + '" data-fuday="' + ds + '" title="' + ds + (amt > 0 ? ' ' + fuMoney(amt) : '') + '">' +
         '<span class="lg-d">' + d + '</span>' +
         (amt > 0 ? '<b class="fu-cal-amt">' + (Math.round(amt * 10) / 10) + '</b>' : '') + '</span>';
  }
  grid.innerHTML = h;
  grid.querySelectorAll('[data-fuday]').forEach(function(c){
    c.onclick = function(){ fuCalSelect(c.getAttribute('data-fuday')); };
  });
}
/* v5.7.2：点击日历某天 → 记录选中日期并刷新「当天明细」 */
function fuCalSelect(ds){ fuState.selDate = ds; fuRenderCalendar(); fuRenderCalDay(); }
/* v5.7.2：当天全部油电费明细 + 当天统计（无记录明确提示）
   v5.26.0：金额合计 + 油量/电量**分列**（升与 kWh 不相加） */
function fuRenderCalDay(){
  const box = $('fuCalDay'); if(!box) return;
  const ds = fuState.selDate;
  if(!ds){ box.innerHTML = '<div class="fu-cal-empty">点击上方日期查看当天油电费明细</div>'; return; }
  const list = fuRecs().filter(function(r){ return r.date === ds; })
    .sort(function(a,b){ return String(a.createdAt||'').localeCompare(String(b.createdAt||'')); });
  const totalAmt = list.reduce(function(s,r){ return s + (Number(r.amount)||0); }, 0);
  const sumQty = function(kind){
    return list.filter(function(r){ return fuKindOf(r) === kind; })
      .reduce(function(s,r){ return s + (Number(r.vol)||0); }, 0);
  };
  const fuelQty = sumQty('fuel'), chgQty = sumQty('charge');
  const parts = [];
  if(fuelQty > 0) parts.push('⛽ ' + (Math.round(fuelQty*10)/10) + 'L');
  if(chgQty > 0) parts.push('⚡ ' + (Math.round(chgQty*10)/10) + 'kWh');
  const head = '<div class="cdh"><b>' + ds + (list.length ? '（' + list.length + ' 笔）' : '') + '</b>' +
    (list.length ? '<span class="sum">合计 ' + fuMoney(totalAmt) + (parts.length ? ' · ' + parts.join(' · ') : '') + '</span>' : '') + '</div>';
  if(!list.length){ box.innerHTML = head + '<div class="fu-cal-empty">当天暂无油电费记录</div>'; return; }
  box.innerHTML = head + '<div class="fu-cal-list">' + list.map(function(r){ return fuItemHTML(r, false); }).join('') + '</div>';
  fuBindItems(box);
}
/* v5.7.2：任何增 / 改 / 删后统一刷新——
   概览统计 / 记录明细 / 日历标记 / 当天明细 / 查询结果 / 以及联动的记账各视图。 */
function fuRefreshAll(){
  try{ fuRenderOverview(); }catch(e){}
  try{ fuRenderList(); }catch(e){}
  try{ fuRenderCalendar(); }catch(e){}
  try{ fuRenderCalDay(); }catch(e){}
  try{ const q = $('fuQueryResult'); if(q && q.innerHTML) fuRunQuery(); }catch(e){}
  try{ lgRefreshLedgerViews(); }catch(e){}
}

/* ---------- v5.26.0：卡片折叠（记录加油 / 记录电费 各自独立，参考待办卡片实现） ----------
   状态记本机 localStorage（不随账号、不跨设备），键 wb_fuel_collapsed / wb_charge_collapsed，
   值与待办一致（'1' = 已折叠）。折叠只隐藏卡片正文，标题栏（含按钮）始终可见。 */
function fuCollapseKey(kind){ return fuCfg(kind).kind === 'charge' ? 'wb_charge_collapsed' : 'wb_fuel_collapsed'; }
function fuIsCollapsed(kind){
  try{ return localStorage.getItem(fuCollapseKey(kind)) === '1'; }catch(e){ return false; }
}
function fuApplyCollapse(kind){
  const cfg = fuCfg(kind);
  const on = fuIsCollapsed(kind);
  const body = $(cfg.p + 'CardBody'); if(body) body.style.display = on ? 'none' : '';
  const btn = $(cfg.p + 'CollapseBtn'); if(btn) btn.textContent = on ? '⌄' : '⌃';
}
function fuToggleCollapse(kind){
  const on = !fuIsCollapsed(kind);
  try{ localStorage.setItem(fuCollapseKey(kind), on ? '1' : '0'); }catch(e){}
  fuApplyCollapse(kind);
}

/* ---------- v5.7.2：油电费明细「放大查看 + 二次编辑」（复用通用弹窗组件） ---------- */
const FU_MODAL = { mask:'fuEditMask', title:'fuModalTitle', viewBox:'fuViewBox', formBox:'fuFormBox' };
let fuEditId = null;
function fuGet(id){ return fuRecs().find(function(r){ return String(r.id) === String(id); }) || null; }
function fuHm(rec){
  const d = rec && rec.createdAt ? new Date(rec.createdAt) : null;
  return (d && !isNaN(d.getTime())) ? (fuPad(d.getHours()) + ':' + fuPad(d.getMinutes())) : '';
}
function fuOpenDetail(id){
  const r = fuGet(id); if(!r) return;
  const cfg = fuCfg(fuKindOf(r));
  fuEditId = r.id;
  fuEditKind = cfg.kind;
  const t = $('fuViewTitle');
  if(t) t.textContent = cfg.emoji + ' ' + fuMoney(r.amount) + (r.date ? ' · ' + r.date : '');
  const rows = $('fuViewRows');
  if(rows){
    rows.innerHTML = [
      wbRowHTML('日期', spEsc(r.date || '')),
      wbRowHTML('金额', fuMoney(r.amount), 'exp'),
      wbRowHTML('单价', r.price != null ? (r.price + ' ' + cfg.priceUnit) : ''),
      wbRowHTML(cfg.qtyRow, r.vol != null ? (r.vol + ' ' + cfg.qtyUnit) : ''),
      wbRowHTML('备注', spEsc(r.note || ''))
    ].join('');
  }
  const tm = $('fuViewTime');
  if(tm) tm.textContent = r.createdAt ? ('记录于 ' + String(r.createdAt).slice(0,10) + (fuHm(r) ? ' ' + fuHm(r) : '')) : '';
  wbModalShow(FU_MODAL, true, cfg.emoji + ' ' + cfg.name + '详情');
}
/* 编辑表单标签与占位符随 kind 切换（两种记录共用同一个编辑弹窗，不新建第二套） */
function fuEditLabels(kind){
  const cfg = fuCfg(kind);
  const set = function(id, txt){ const el = $(id); if(el) el.textContent = txt; };
  const ph  = function(id, txt){ const el = $(id); if(el) el.placeholder = txt; };
  set('fuEditLbDate', cfg.dateLabel + ' *');
  set('fuEditLbAmount', cfg.amountLabel.replace('（元）', '（元）*'));
  set('fuEditLbPrice', cfg.priceLabel);
  set('fuEditLbVol', cfg.volLabel);
  ph('fuEditAmount', cfg === FU_KINDS.charge ? '如 60' : '如 300');
  ph('fuEditPrice', cfg === FU_KINDS.charge ? '如 1.20' : '如 7.65');
  ph('fuEditVol', cfg === FU_KINDS.charge ? '如 50' : '如 39.2');
  ph('fuEditNote', cfg.notePh);
}
function fuSwitchEdit(){
  const r = fuEditId ? fuGet(fuEditId) : null;
  if(r){
    fuEditKind = fuKindOf(r);
    fuEditLabels(fuEditKind);
    if($('fuEditDate')) $('fuEditDate').value = r.date || fuTodayStr();
    if($('fuEditAmount')) $('fuEditAmount').value = (r.amount == null ? '' : r.amount);
    if($('fuEditPrice')) $('fuEditPrice').value = (r.price == null ? '' : r.price);
    if($('fuEditVol')) $('fuEditVol').value = (r.vol == null ? '' : r.vol);
    if($('fuEditNote')) $('fuEditNote').value = r.note || '';
  }
  wbModalShow(FU_MODAL, false, '✏️ 编辑' + fuCfg(fuEditKind).name);
}
/* 关闭/取消：只收起弹窗并清理表单状态，绝不改动原数据 */
function fuCloseEdit(){
  wbModalHide(FU_MODAL);
  fuEditId = null;
  ['fuEditDate','fuEditAmount','fuEditPrice','fuEditVol','fuEditNote'].forEach(function(k){ const el = $(k); if(el) el.value = ''; });
}
/* 编辑弹窗内的金额 / 单价 / 数量自动换算（与录入区同一套规则） */
function fuEditAutoCalc(src){
  const amtEl = $('fuEditAmount'), priceEl = $('fuEditPrice'), volEl = $('fuEditVol');
  if(!amtEl || !priceEl || !volEl) return;
  const amt = parseFloat(amtEl.value); if(!(amt > 0)) return;
  const price = parseFloat(priceEl.value), vol = parseFloat(volEl.value);
  if(src === 'price'){ if(price > 0) volEl.value = fuR2(amt / price); }
  else if(src === 'vol'){ if(vol > 0) priceEl.value = fuR2(amt / vol); }
  else { if(price > 0) volEl.value = fuR2(amt / price); else if(vol > 0) priceEl.value = fuR2(amt / vol); }
}
function fuSaveEdit(){
  if(!state.user){ toast('请先登录'); return; }
  const r = fuEditId ? fuGet(fuEditId) : null;
  if(!r){ fuCloseEdit(); return; }
  const cfg = fuCfg(fuKindOf(r));
  const date = $('fuEditDate').value;
  const amount = parseFloat($('fuEditAmount').value);
  const price = $('fuEditPrice').value === '' ? null : parseFloat($('fuEditPrice').value);
  const vol = $('fuEditVol').value === '' ? null : parseFloat($('fuEditVol').value);
  const note = ($('fuEditNote').value || '').trim();
  if(!date){ toast('请选择' + cfg.dateLabel); return; }
  if(!(amount > 0)){ toast('请输入有效的' + cfg.amountLabel.replace('（元）', '')); return; }
  if(price !== null && !(price >= 0)){ toast('单价无效'); return; }
  if(vol !== null && !(vol >= 0)){ toast('数量无效'); return; }
  r.date = date;
  r.amount = Math.round(amount * 100) / 100;
  r.price = price === null ? null : Math.round(price * 100) / 100;
  r.vol = vol === null ? null : Math.round(vol * 100) / 100;
  r.note = note;
  sbSaveObj('fuel', { id:r.id, _sbSaved:r._sbSaved }, { record_date:r.date, amount:r.amount, unit_price:r.price, volume:r.vol, kind:fuKindOf(r), note:r.note });
  fuSyncLedgerExpense(r);   /* 油电费 → 记账：同一条支出的日期/金额/备注保持一致 */
  fuState.selDate = r.date;
  fuCloseEdit();
  fuRefreshAll();
  toast('已保存 ✓（已同步到记账）');
}
function fuDeleteEdit(){
  const id = fuEditId;
  if(!id) return;
  const r = fuGet(id);
  if(!confirm('删除这条' + fuCfg(fuKindOf(r)).card.slice(2) + '记录？')) return;
  fuCloseEdit();
  fuDelete(id);
}

/* 日志查询：某天至某天的明细统计
   v5.26.0：金额合计 + 油量/电量分列 + 各自的平均单价（升与 kWh 不混算） */
function fuRunQuery(){
  const s = $('fuQStart').value, e = $('fuQEnd').value;
  const box = $('fuQueryResult');
  if(!s || !e){ toast('请选择开始与结束日期'); return; }
  if(s > e){ toast('开始日期不能晚于结束日期'); return; }
  const list = fuRecs().filter(function(r){ return r.date >= s && r.date <= e; })
    .sort(function(a,b){ return String(a.date||'').localeCompare(String(b.date||'')); });
  if(!list.length){ box.innerHTML = '<div class="empty"><span class="empty-emoji">📭</span><div class="empty-text">该区间没有油电费记录</div></div>'; return; }
  const totalAmt = list.reduce(function(x,r){ return x + (Number(r.amount)||0); }, 0);
  const agg = function(kind){
    let amt = 0, qty = 0, n = 0;
    list.forEach(function(r){
      if(fuKindOf(r) !== kind) return;
      amt += (Number(r.amount) || 0); qty += (Number(r.vol) || 0); n++;
    });
    return { amt: amt, qty: qty, n: n, avg: qty > 0 ? (amt / qty) : 0 };
  };
  const f = agg('fuel'), c = agg('charge');
  const daySet = {}; list.forEach(function(r){ daySet[r.date] = 1; });
  const nDays = Object.keys(daySet).length;
  let h = '<div class="fu-sum">' +
    '<div class="box"><div class="k">总金额</div><div class="v">' + fuMoney(totalAmt) + '</div></div>' +
    '<div class="box"><div class="k">次数 / 天数</div><div class="v">' + list.length + ' 次 / ' + nDays + ' 天</div></div>' +
    '<div class="box"><div class="k">⛽ 油量合计</div><div class="v">' + (Math.round(f.qty*10)/10) + 'L</div></div>' +
    '<div class="box"><div class="k">⚡ 电量合计</div><div class="v">' + (Math.round(c.qty*10)/10) + 'kWh</div></div>' +
    '<div class="box"><div class="k">⛽ 平均单价</div><div class="v">' + (f.avg ? (Math.round(f.avg*100)/100) + ' 元/升' : '—') + '</div></div>' +
    '<div class="box"><div class="k">⚡ 平均单价</div><div class="v">' + (c.avg ? (Math.round(c.avg*100)/100) + ' 元/度' : '—') + '</div></div>' +
  '</div>';
  h += '<div style="margin-top:10px;">' + list.map(function(r){ return fuItemHTML(r, false); }).join('') + '</div>';
  box.innerHTML = h;
  fuBindItems(box);   /* v5.7.2：查询结果同样可点击放大 + 二次编辑 */
}

/* 渲染入口（切到「油电费」面板时调用） */
function fuRenderAll(){
  if(!state.fuel) state.fuel = defaultFuel();
  ['fuel', 'charge'].forEach(function(kind){
    const cfg = fuCfg(kind);
    const dEl = fuEl(kind, 'Date'); if(dEl && !dEl.value) dEl.value = fuTodayStr();
    fuApplyCollapse(kind);                        /* v5.26.0：恢复本机折叠状态 */
  });
  if(!$('fuQStart').value) $('fuQStart').value = fuTodayStr();
  if(!$('fuQEnd').value) $('fuQEnd').value = fuTodayStr();
  if(!fuState.selDate) fuState.selDate = fuTodayStr();
  fuRenderOverview(); fuRenderList(); fuRenderCalendar(); fuRenderCalDay();
  $('fuQueryResult').innerHTML = '';
  $('fuSave').onclick = fuSave;
  if($('ecSave')) $('ecSave').onclick = ecSave;                        /* v5.26.0：电费卡片保存 */
  /* v5.4.7：金额 / 单价 / 数量 三者即时自动换算（两张卡片各自独立） */
  $('fuAmount').oninput = function(){ fuAutoCalc('amount'); };
  $('fuPrice').oninput = function(){ fuAutoCalc('price'); };
  $('fuVol').oninput = function(){ fuAutoCalc('vol'); };
  if($('ecAmount')) $('ecAmount').oninput = function(){ ecAutoCalc('amount'); };
  if($('ecPrice')) $('ecPrice').oninput = function(){ ecAutoCalc('price'); };
  if($('ecVol')) $('ecVol').oninput = function(){ ecAutoCalc('vol'); };
  /* v5.7.2：编辑弹窗内同样支持自动换算 */
  if($('fuEditAmount')) $('fuEditAmount').oninput = function(){ fuEditAutoCalc('amount'); };
  if($('fuEditPrice')) $('fuEditPrice').oninput = function(){ fuEditAutoCalc('price'); };
  if($('fuEditVol')) $('fuEditVol').oninput = function(){ fuEditAutoCalc('vol'); };
  $('fuCalPrev').onclick = function(){ const ym = fuState.calYM; ym.m--; if(ym.m < 1){ ym.m = 12; ym.y--; } fuRenderCalendar(); };
  $('fuCalNext').onclick = function(){ const ym = fuState.calYM; ym.m++; if(ym.m > 12){ ym.m = 1; ym.y++; } fuRenderCalendar(); };
  $('fuQueryBtn').onclick = fuRunQuery;
}
