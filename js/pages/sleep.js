/* ==========================================================================
   生活象限 · js/pages/sleep.js
   --------------------------------------------------------------------------
   Phase 5 候选 D：Sleep page module（睡眠屏 #screen-sleep：概览 / 记录 / 日历 / 统计 / 云端）

   自 index.html 物理抽取（原 L6996–L7434，共 439 行），**逐字节原样迁移**（含段头注释）：
   36 个 sp* 函数 + 2 个顶层绑定（spState / spBound）。

   ⚠️ 业务规则一律未改（只搬位置）：
      · 归属日期：00:00–04:59 入睡归「前一天」，05:00 及以后计入当天（spAttrDate）
      · 跨午夜时长：结束 ≤ 开始自动 +24h（spDuration / spDuration2）
      · 跨午夜均值修正：12:00 之前的时刻视为次日后再求平均（spAvgTime）
      · 昨夜睡眠窗口「昨天 19:00 ~ 今天 12:00」（spLastNightMin）

   ⚠️ 页面入口包装 gotoSleep() / renderSleep() 仍留在 index.html（不属于本块）。
   ⚠️ Classic Script（非 ESM）：HTML onclick / oninput 直接解析；
      运行期懒调用 js/bridge（sbLoadAll / sbSaveObj / sbRemoveObj / wbUuid）与 core/render.js。
      数据只读写唯一的 state.sleep（禁止第二状态树）。
   ========================================================================== */

/* =====================================================================
   睡眠屏交互（#screen-sleep）：概览 / 记录 / 日历 / 统计 / 云端
   规则：归属「开始日期」+ 自动跨午夜（结束<=开始自动 +24h）；一天允许多条，按天求和。
   ===================================================================== */
let spState = { calYM:null, statYM:null, selDate:null, editId:null };

function spPad(n){ return n < 10 ? '0' + n : '' + n; }
function spTodayStr(){ const d = new Date(); return d.getFullYear() + '-' + spPad(d.getMonth()+1) + '-' + spPad(d.getDate()); }
function spIso(d){ return d.getFullYear() + '-' + spPad(d.getMonth()+1) + '-' + spPad(d.getDate()); }
/* 时长（分钟）：结束<=开始 → 自动跨午夜 +24h（如 23:00→07:00 = 8h） */
function spDuration(start, end){
  const a = start.split(':').map(Number), b = end.split(':').map(Number);
  let s = a[0]*60 + a[1], e = b[0]*60 + b[1];
  if(e <= s) e += 24*60;
  return e - s;
}
/* 跨日期时长（分钟）：结合入睡/起床的 日期+时间；未跨日且 起床<=入睡 自动 +24h */
function spDuration2(startDate, start, endDate, end){
  const sd = new Date(startDate + 'T' + start);
  const ed = new Date((endDate || startDate) + 'T' + end);
  let mins = Math.round((ed - sd) / 60000);
  if(mins < 0) mins += 24*60;
  return mins;
}
function spFmtDur(min){
  min = Math.round(min);
  const h = Math.floor(min/60), m = min % 60;
  if(h && m) return h + '小时' + m + '分';
  if(h) return h + '小时';
  return m + '分钟';
}
function spFmtShort(min){ return (Math.round(min/6)/10) + 'h'; }   // 日历格：如 8.0h
function spAvgTime(arr){
  if(!arr.length) return '--:--';
  /* v5.12.5：跨午夜均值修正 —— 入睡/起床时刻常跨午夜（如 23:30 与次日 00:30）。
     若直接按「当天分钟数」取平均，00:30(=30) 会把 23:30(=1410) 拉到中午附近（错误的 12:00）；
     起床同理（07:30 记 450，与已 +24h 的 1890 混算 → 约 22:00）。
     现统一把「12:00 之前」的时刻视为次日（+24h）后再求平均，最后折回 0~24h。
     仅对已记录的时刻求平均：没有记录的日子不会以 0 参与计算。 */
  let tot = 0;
  arr.forEach(m => { tot += (m < 12*60 ? m + 24*60 : m); });
  let avg = Math.round(tot / arr.length);
  avg = ((avg % (24*60)) + 24*60) % (24*60);
  return spPad(Math.floor(avg/60)) + ':' + spPad(avg % 60);
}
/* v5.9.0：睡眠归属日期——凌晨 00:00~04:59 入睡的记录统一归「前一天」（如 15日04:00 入睡 → 计入 14 日晚睡眠）；
   05:00 及以后入睡才计入当天。仅改变「归属」（日历/统计/汇总/明细按此日期归档），不改记录真实日期·时间与时长计算。 */
function spAttrDate(date, start){
  if(!date || !start) return date;
  const h = parseInt(String(start).split(':')[0], 10);
  if(!(h >= 0 && h < 5)) return date;
  const d = new Date(date + 'T00:00:00');
  if(isNaN(d.getTime())) return date;
  d.setDate(d.getDate() - 1);
  return spIso(d);
}
function spDayRecs(date){ return (state.sleep.records||[]).filter(r => spAttrDate(r.date, r.start) === date); }
function spDayTotal(date){ return spDayRecs(date).reduce((s,r) => s + (r.minutes||0), 0); }

/* v5.5.2：昨夜睡眠时长 = 「昨天 19:00 ~ 今天 12:00」这个窗口内实际发生的睡眠时长求和。
   做法：把每条记录还原成真实的开始/结束时刻（结束 ≤ 开始则视为跨午夜 +24h），
   再与该窗口求交集、只累加落在窗口内的分钟数（按窗口裁剪），因此：
   · 23:00~07:30 的夜觉 → 8.5h 全计入；
   · 18:30~21:00 的早睡 → 只计 19:00~21:00 的 2h；
   · 11:00~14:00 的午觉 → 只计 11:00~12:00 的 1h；
   · 未填起床时间（入睡中）的记录不计入。 */
function spLastNightMin(){
  const now = new Date();
  const ws = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 19, 0, 0, 0).getTime();  /* 昨日 19:00 */
  const we = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime();       /* 今日 12:00 */
  if(!(we > ws)) return 0;
  let sum = 0;
  (state.sleep && state.sleep.records ? state.sleep.records : []).forEach(function(r){
    if(!r.date || !r.start || !r.end) return;                     /* 缺起床时间 → 无法计算 */
    const sd = new Date(r.date + 'T' + r.start);
    let ed = new Date((r.endDate || r.date) + 'T' + r.end);
    if(isNaN(sd.getTime()) || isNaN(ed.getTime())) return;
    if(ed.getTime() <= sd.getTime()) ed = new Date(ed.getTime() + 24*60*60*1000);   /* 跨午夜 */
    const a = Math.max(sd.getTime(), ws), b = Math.min(ed.getTime(), we);
    if(b > a) sum += (b - a) / 60000;
  });
  return Math.round(sum);
}
/* v5.30.0：首页入口卡用的「紧凑时长」（spFmtDur 输出「7小时32分」，卡片里放不下）
   → 7h 32m / 7h / 32m。仅显示用，不改任何时长计算。 */
function spFmtHM(min){
  min = Math.round(min);
  const h = Math.floor(min/60), m = min % 60;
  if(h && m) return h + 'h ' + m + 'm';
  if(h) return h + 'h';
  return m + 'm';
}
/* v5.30.0：首页「睡眠」入口卡摘要（纯函数：只读 state.sleep，不写 DOM / 不发网络 / 不改状态）
   卡片**不增高**：核心数据与辅助同在两行横向栏内 ——
   · value = 昨夜实际睡眠时长 —— 直接复用 spLastNightMin()，窗口口径完全一致（昨日19:00 ~ 今日12:00）
   · aux   = 完成度 + 与 8h 的差值（放在模块名一行右侧）
   · aux2  = 昨夜入睡 → 起床时刻（放在时长一行右侧；同一窗口裁剪后的真实时刻，与 value 同口径）
   · bar   = min(实际分钟 / 480, 1) × 100：480 分钟（8h）**只是首页视觉参考基准**，
             绝不是用户自定义目标（项目没有睡眠目标字段，本次也不新增）；
             上限固定 100%，实际睡再久也不会出现「超过 100%」的条。
   ⚠️ 无昨夜有效睡眠 → value「—」、aux2「昨夜 暂无记录」、条归零（不造默认数据）。
   ⚠️ 下面这段窗口 + 裁剪规则与 spLastNightMin 保持一致（改动其一时必须同步另一处）。 */
function spHomeSummary(){
  const SP_REF = 480;                       /* 8h 参考基准（视觉基准，非用户目标） */
  const min = spLastNightMin();
  const now = new Date();
  const ws = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 19, 0, 0, 0).getTime();
  const we = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime();
  let a0 = null, b0 = null;
  if(we > ws){
    (state.sleep && Array.isArray(state.sleep.records) ? state.sleep.records : []).forEach(function(r){
      if(!r.date || !r.start || !r.end) return;
      const sd = new Date(r.date + 'T' + r.start);
      let ed = new Date((r.endDate || r.date) + 'T' + r.end);
      if(isNaN(sd.getTime()) || isNaN(ed.getTime())) return;
      if(ed.getTime() <= sd.getTime()) ed = new Date(ed.getTime() + 24*60*60*1000);
      const a = Math.max(sd.getTime(), ws), b = Math.min(ed.getTime(), we);
      if(b > a){ if(a0 === null || a < a0) a0 = a; if(b0 === null || b > b0) b0 = b; }
    });
  }
  const hm = function(ms){ const d = new Date(ms); return spPad(d.getHours()) + ':' + spPad(d.getMinutes()); };
  const pct = Math.min(min / SP_REF, 1) * 100;
  let aux;
  if(!(min > 0)) aux = '以8h为参考';
  else if(min < SP_REF) aux = Math.round(pct) + '% · 距8h差' + (SP_REF - min) + 'm';
  else if(min === SP_REF) aux = '100% · 刚好8h';
  else aux = '100% · 超出' + (min - SP_REF) + 'm';
  return {
    value: min > 0 ? spFmtHM(min) : '—',
    aux: aux,
    /* 时刻左侧不加「昨夜」前缀：卡片已被限高，这一栏要与核心数据同行，宽度只够放时刻本身 */
    aux2: (a0 !== null) ? (hm(a0) + ' → ' + hm(b0)) : '暂无记录',
    bar: { pct: pct }
  };
}
function spMonthRecs(prefix){ return (state.sleep.records||[]).filter(r => { const d = spAttrDate(r.date, r.start); return d && d.indexOf(prefix) === 0; }); }

/* =====================================================================
   v5.26.0：主睡眠识别（平均入睡 / 平均起床只统计「主睡眠」）
   ---------------------------------------------------------------------
   目标：平均入睡、平均起床不统计午睡/短时睡眠，同时**必须兼容夜班用户** ——
        因此**不使用任何固定钟点窗口**判断「夜间睡眠」（21:00~次日12:00 之类会误伤
        04:00→11:30 这类夜班主睡眠），只按「时长 + 连续性」识别。
   规则：
     ① 每条记录仍是一个独立 Sleep Session，数据结构与保存方式完全不变；
     ② Session 时长 = 起床 − 入睡（结束 ≤ 开始自动 +24h，与 spDuration2 同规则）；
        没有起床时间 → 时长未知；
     ③ 时长 < 3h 的 Session 判定为短时睡眠/午睡 → 不参与平均入睡、也不参与平均起床；
     ④ 时长 ≥ 3h 的 Session 为主睡眠候选；无起床时间的 Session 时长未知，
        同样保留为候选（可参与平均入睡；因无起床时间自然不参与平均起床）；
     ⑤ 候选之间若「前一个起床 → 后一个入睡」间隔 ≤ 2h，视为连续，合并成同一个「睡眠簇」，
        簇时长 = 各成员时长之和（跨午夜、被拆成多条的同一觉会在此合回一次）；
     ⑥ 每个归属日取「总时长最长的簇」为该日主睡眠；归属沿用既有 spAttrDate 的 05:00 分界
        （v5.26.0 明确不改动归属规则：日历 / 近 7 日 / 明细日期一律照旧）；
     ⑦ 平均入睡 = 各日主睡眠「入睡时刻」的平均；平均起床 = 各日主睡眠「起床时刻」的平均。
   注：簇时长按「已知时长之和」参与比较；只含未起床 Session 的簇时长记 0，
       但当天若仅此一个候选，它仍会被选为该日主睡眠（保证「已入睡、尚未起床」也能进平均入睡）。
   ===================================================================== */
const SP_MAIN_MIN    = 180;   /* 主睡眠最小 Session 时长：3 小时（分钟） */
const SP_CLUSTER_GAP = 120;   /* 同一睡眠簇允许的最大间隔：2 小时（分钟） */

/* 记录 → 带绝对时刻的 Session（start/end 为毫秒时间戳；mins 为时长，未起床为 null） */
function spSessions(recs){
  const out = [];
  (recs || []).forEach(function(r){
    if(!r || !r.date || !r.start) return;
    const startStr = String(r.start).slice(0, 5);
    const sd = new Date(r.date + 'T' + startStr + ':00');
    if(isNaN(sd.getTime())) return;
    let endMs = null, mins = null, endStr = '';
    if(r.end){
      endStr = String(r.end).slice(0, 5);
      let ed = new Date((r.endDate || r.date) + 'T' + endStr + ':00');
      if(!isNaN(ed.getTime())){
        if(ed.getTime() <= sd.getTime()) ed = new Date(ed.getTime() + 24*60*60*1000);   /* 跨午夜 +24h */
        const m = Math.round((ed.getTime() - sd.getTime()) / 60000);
        if(m > 0){ endMs = ed.getTime(); mins = m; } else { endStr = ''; }              /* 无效时长 → 视为未填起床 */
      } else { endStr = ''; }
    }
    out.push({ date: r.date, start: sd.getTime(), end: endMs, mins: mins, startStr: startStr, endStr: endStr });
  });
  return out.sort(function(a, b){ return a.start - b.start; });
}

/* Session → 睡眠簇（先剔除「短时睡眠/午睡」，再把连续的候选合并） */
function spClusters(sessions){
  const cand = sessions.filter(function(s){ return s.mins == null || s.mins >= SP_MAIN_MIN; });
  const out = [];
  cand.forEach(function(s){
    const last = out[out.length - 1];
    /* 仅当上一簇有确定结束时刻、且间隔 ≤ 2h 时合并；无起床时间的 Session 只能作簇尾 */
    if(last && last.end != null && (s.start - last.end) / 60000 <= SP_CLUSTER_GAP){
      last.members.push(s);
      last.end = s.end;
      if(s.mins != null) last.mins += s.mins;
    } else {
      out.push({ members: [s], start: s.start, end: s.end, mins: (s.mins == null ? 0 : s.mins) });
    }
  });
  return out;
}

/* 每个归属日的「主睡眠」簇 → { 'YYYY-MM-DD': cluster } */
function spMainSleepByDay(recs){
  const map = {};
  spClusters(spSessions(recs)).forEach(function(c){
    const first = c.members[0];
    const day = spAttrDate(first.date, first.startStr);      /* 归属规则与全站一致（05:00 分界本版不改） */
    if(!day) return;
    const cur = map[day];
    if(!cur || c.mins > cur.mins) map[day] = c;              /* 取总时长最长的簇；等长取先出现者 */
  });
  return map;
}

/* 某月（prefix = 'YYYY-MM'）各日主睡眠的「入睡 / 起床」分钟数组，直接交给 spAvgTime 求平均 */
function spMainAvg(prefix){
  const bed = [], wake = [];
  const map = spMainSleepByDay(state.sleep && state.sleep.records ? state.sleep.records : []);
  Object.keys(map).forEach(function(day){
    if(String(day).indexOf(prefix) !== 0) return;
    const c = map[day], first = c.members[0], last = c.members[c.members.length - 1];
    const b = first.startStr.split(':').map(Number), bs = b[0]*60 + b[1];
    bed.push(bs);
    if(!last.endStr) return;                                 /* 未填起床 → 不参与平均起床 */
    const e = last.endStr.split(':').map(Number);
    let wm = e[0]*60 + e[1];
    if(wm <= bs) wm += 24*60;
    wake.push(wm);
  });
  return { bed: bed, wake: wake };
}

function spOneRecHTML(r){
  const hasEnd = !!r.end;
  const line = spEsc(r.start) + (hasEnd ? ' → ' + spEsc(r.end) : ' → 未填起床') + ' · ' + (hasEnd ? spFmtDur(r.minutes) : '入睡中') + (r.note ? ' · ' + spEsc(r.note) : '');
  const amt = hasEnd ? spFmtDur(r.minutes) : '⏳';
  const endTag = (r.endDate && r.endDate !== r.date) ? ' · 起床 ' + spEsc(r.endDate) : '';
  return '<div class="lg-rec" data-id="' + r.id + '"><span class="dot"></span>' +
    '<div class="ri"><div class="t">' + line + '</div>' +
    '<div class="s">' + (spAttrDate(r.date, r.start)||'') + ' · 睡眠' + endTag + '</div></div>' +
    '<span class="amt">' + amt + '</span>' +
    '</div>';
}
function spFillList(elId, recs, titleId, titlePrefix){
  const el = $(elId); if(!el) return;
  if(!recs.length){ el.innerHTML = '<div class="empty"><span class="empty-emoji">🌙</span><div class="empty-text">还没有睡眠记录</div></div>'; }
  else {
    el.innerHTML = recs.map(spOneRecHTML).join('');
    el.querySelectorAll('.lg-rec').forEach(c => c.onclick = () => spOpenRec(c.dataset.id));
  }
  const t = $(titleId); if(t) t.textContent = (titlePrefix||'') + (recs.length ? '（' + recs.length + ' 条）' : '');
}
/* 最近记录：全量按创建时间倒序取最近 5 条（最新在最上）；日历面板仍按选中日期过滤 */
function spRenderToday(){
  const all = (state.sleep.records||[]).slice().sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  const recs = all.slice(0, 5);
  spFillList('spOvList', recs, 'spOvTitle', '最近记录');
  spFillList('spDayList', recs, 'spDayTitle', '最近记录');
  if(spState.selDate) spFillList('spCalDayList', spDayRecs(spState.selDate), 'spCalDayTitle', '当日明细 · ' + spState.selDate);
}
function spRenderOverview(){
  const t = spTodayStr();
  const lastNightMin = spLastNightMin();   /* v5.5.2：昨夜睡眠 = 昨日19:00~今日12:00 窗口内的睡眠时长 */
  let sum7 = 0, cnt7 = 0;
  for(let i = 6; i >= 0; i--){ const d = new Date(); d.setDate(d.getDate() - i); const m = spDayTotal(spIso(d)); if(m > 0){ sum7 += m; cnt7++; } }
  const avg7 = cnt7 ? sum7 / cnt7 : 0;
  const prefix = t.slice(0,7);
  /* v5.12.6：概览 4 卡 = 昨夜睡眠 / 近7天日均 / 平均入睡 / 平均起床；
     v5.26.0：入睡与起床均值改为**只统计本月各日的「主睡眠」**（剔除午睡/短时睡眠，
             兼容夜班与跨午夜，见 spMainAvg / spClusters）；无起床时间的主睡眠只进平均入睡。 */
  const mb = spMainAvg(prefix);
  $('spOvToday').textContent = spFmtDur(lastNightMin);
  $('spOv7').textContent = spFmtDur(avg7);
  $('spOvBed').textContent = spAvgTime(mb.bed);
  $('spOvWake').textContent = spAvgTime(mb.wake);
}
function spDeleteRec(id){
  const rec = (state.sleep.records||[]).find(r => r.id === id);
  state.sleep.records = (state.sleep.records||[]).filter(r => r.id !== id);
  if(rec) sbRemoveObj('sleep', rec);                 // Phase 14：DAL 软删除
  spRenderToday(); spRenderCalendar(); spRenderStats(); spRenderOverview();
  toast('已删除');
}
function spSave(){
  if(!state.user){ toast('请先登录'); return; }
  const date = $('spDate').value || spTodayStr();
  const start = $('spStart').value;
  const end = $('spEnd').value;
  const endDate = $('spEndDate').value || '';
  if(!start){ toast('请填写入睡时间'); return; }
  let minutes = 0;
  if(end){
    minutes = spDuration2(date, start, endDate || date, end);
    if(minutes <= 0){ toast('睡眠时长需大于 0，请检查起床时间'); return; }
  }
  const rec = {
    id: wbUuid(),                                    // Phase 14：前端 UUID = Supabase 主键
    date: date, start: start, endDate: endDate, end: end, minutes: minutes,
    note: $('spNote').value.trim(), createdAt: new Date().toISOString(), _sbSaved: false
  };
  state.sleep.records.push(rec);
  /* 双轨时间：本阶段保存原始日期/时间字段；sleep_at/wake_at 留 NULL（时区策略未定） */
  sbSaveObj('sleep', rec, {record_date: rec.date, start_time: rec.start, end_time: end || null, end_date: endDate || null, duration_minutes: rec.minutes, note: rec.note});
  $('spNote').value = '';
  $('spEnd').value = ''; $('spEndDate').value = '';
  spState.selDate = date;
  spRenderToday(); spRenderCalendar(); spRenderStats(); spRenderOverview();
  toast(end ? '已保存 ✓' : '已保存（待起床）✓');
}
function spAutoSync(){
  const token = getGiteeToken();
  if(!token || !state.user) return;
  // v4.2.5 合并式同步：先拉云端与本地取并集（墓碑过滤），再上传合并后的全量 → 云端恒为所有设备并集
  tryPullSleep(false, false)
    .then(() => pushSleepData(state.user.name, new Date().toISOString()))
    .catch(() => {});
}
function spRenderCalendar(){
  const ym = spState.calYM;
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
    const ds = ym.y + '-' + spPad(ym.m) + '-' + spPad(d);
    const tot = spDayTotal(ds);
    const isToday = ds === spTodayStr();
    const isSel = ds === spState.selDate;
    html += '<div class="lg-cell' + (isToday ? ' today' : '') + (isSel ? ' sel' : '') + '" data-date="' + ds + '">' +
      '<div class="lg-d">' + d + '</div>' +
      (tot > 0 ? '<div class="lg-c sl">' + spFmtShort(tot) + '</div>' : '') +
    '</div>';
  });
  const grid = $('spCalGrid');
  grid.innerHTML = html;
  $('spCalTitle').textContent = ym.y + '年' + ym.m + '月';
  grid.querySelectorAll('.lg-cell[data-date]').forEach(c => c.onclick = () => {
    spState.selDate = c.dataset.date;
    $('spDate').value = c.dataset.date;
    const recs = spDayRecs(c.dataset.date);
    spRenderCalendar();
    spFillList('spCalDayList', recs, 'spCalDayTitle', '当日明细 · ');
  });
}
function spBarSVG(labels, arr, color, withLine, fitW){
  const n = labels.length;
  /* v4.3.4：图表放大重做——SVG 带固有宽度（width 属性）+ 容器横向滚动，
     不再用 preserveAspectRatio 整体压缩（31 天的月份曾把 9px 字压成 2px，完全看不清）；
     高度 180→240，字号 9→12/11，月份天数多时自动收窄每柱间距以减少滚动。
     v5.1.16：新增可选 fitW —— 传入容器可用宽度时，SVG 按该宽度自适应铺满（近7日无需横向滚动）。 */
  const perBar = n > 16 ? 26 : 40;
  const W = fitW ? Math.max(240, Math.round(fitW)) : Math.max(320, n * perBar), H = 240, padL = 50, padB = 42, padT = 28, padR = 10;   /* v5.9.0：顶部留白放大数值标注 */
  const cw = W - padL - padR, ch = H - padT - padB;
  const GOAL = 8 * 60;                             /* v5.1.18：8 小时目标线 */
  const max = Math.max(GOAL, 1, ...arr);           /* 纵轴至少 8h；若有超 8h 的记录则按实际最大值自适应 */
  const gw = cw / n;
  const fs = Math.max(9, Math.min(12, gw * 0.34));      /* v5.9.0：数值字号随柱间距自适应 */
  const lblC = wbDarken(color, .66);
  let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">';
  for(let i = 0; i <= 4; i++){
    const y = padT + ch * i / 4, v = Math.round(max * (1 - i / 4) / 6) / 10;
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#eee"/>';
    svg += '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="12" fill="#b0768f">' + v + '</text>';
  }
  /* v5.1.18：8h 目标虚线（平行于横轴）+ 右侧标注 */
  const gy = padT + ch * (1 - GOAL / max);
  svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#ff4d6d" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.9"/>';
  svg += '<text x="' + (W - padR) + '" y="' + (gy - 4) + '" text-anchor="end" font-size="10" font-weight="700" fill="#ff4d6d">目标 8h</text>';
  for(let i = 0; i < n; i++){
    const gx = padL + gw * i, bw = Math.min(gw * 0.66, 30);
    const x = gx + (gw - bw) / 2;
    const h = ch * (arr[i] || 0) / max;
    const mins = arr[i] || 0;
    svg += '<rect x="' + x + '" y="' + (padT + ch - h) + '" width="' + bw + '" height="' + h + '" rx="4" fill="' + color + '" title="' + labels[i] + '日 ' + spFmtDur(mins) + '"/>';
    if(mins > 0) svg += wbChartLabel(gx + gw / 2, padT + ch - h - 5, spFmtShort(mins), fs, lblC);   /* v5.9.0：柱顶直接标数值（小时） */
    let lb = labels[i]; if(lb && lb.length > 5) lb = lb.slice(0,5);
    svg += '<text x="' + (gx + gw / 2) + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#8a6a76">' + spEsc('' + lb) + '</text>';
  }
  /* v4.3.5：柱状图上覆盖趋势折线（深墨色 + 白心圆点，与粉色柱形成对比） */
  if(withLine){
    const pts = [];
    for(let i = 0; i < n; i++){
      const cx = padL + gw * i + gw / 2;
      const h = ch * (arr[i] || 0) / max;
      pts.push([cx, padT + ch - h]);
    }
    svg += '<polyline points="' + pts.map(p => p[0] + ',' + p[1]).join(' ') + '" fill="none" stroke="#5a3d4e" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>';
    pts.forEach(p => { svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#fff" stroke="#5a3d4e" stroke-width="2"/>'; });
  }
  svg += '</svg>';
  return svg;
}
/* v5.14.2：近 7 日统计窗口的最后一天 = 今天 or 昨天。
   今天若已有「12:00 之后开始、且已填起床（时长 > 0）」的睡眠（典型是午觉）→ 用今天，让当天数据能显示；
   否则（今天只有凌晨/上午记录、晚觉尚未发生）→ 用昨天，避免最后一根柱子恒为 0。
   注：只认「已填起床且时长 > 0」的记录，否则会出现"今天有柱子但柱高为 0"的反效果。 */
function spLast7End(){
  const today = spTodayStr();
  const hasDay = (state.sleep.records || []).some(function(r){
    if(!r || !r.start || !r.end) return false;                        /* 未填起床（进行中）不计 */
    if(!(r.minutes > 0)) return false;
    if(String(spAttrDate(r.date, r.start)) !== today) return false;   /* 必须归属今天 */
    return String(r.start).slice(0, 5) >= '12:00';                    /* 12:00 起（含）之后开始 */
  });
  const d = new Date();
  return hasDay ? d : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
}
function spRenderStats(){
  const ym = spState.statYM;
  $('spStatTitle').textContent = ym.y + '年' + ym.m + '月';
  const prefix = ym.y + '-' + spPad(ym.m);
  const byDay = {};
  let totalMin = 0;
  spMonthRecs(prefix).forEach(r => {
    if(!r.end || !r.start) return;              // 未填起床的「待起床」记录不计入统计
    const ad = spAttrDate(r.date, r.start);     // v5.9.0：按归属日期归档（凌晨入睡归前一天）
    byDay[ad] = (byDay[ad] || 0) + (r.minutes || 0);
    totalMin += (r.minutes || 0);
  });
  const daysWith = Object.keys(byDay).length;
  const avg = daysWith ? totalMin / daysWith : 0;
  /* v5.26.0：平均入睡 / 平均起床改用「各日主睡眠」口径（剔除午睡、合并连续片段、兼容夜班），
     与概览同源（spMainAvg）；「本月总时长 / 日均」仍按既有全量口径不变。 */
  const mb = spMainAvg(prefix);
  $('spStatTotal').textContent = spFmtDur(totalMin);
  $('spStatAvg').textContent = spFmtDur(avg);
  $('spStatBed').textContent = spAvgTime(mb.bed);
  $('spStatWake').textContent = spAvgTime(mb.wake);
  /* v4.3.5：横轴改为近 7 日（可跨月），数据按天直接统计；柱状图叠加趋势折线。
     v5.14.2：窗口「最后一天」不再固定为今天 —— 今天晚觉尚未发生，最后一根柱子恒为 0（像 bug）。
     规则（用户定义）：今天已有「12:00 之后开始且有完整时长」的睡眠记录（典型是午觉）→ 最后一天 = 今天；
                     否则 → 最后一天 = 昨天（即最后一根柱子是昨晚的睡眠）。 */
  const labels = [], arr = [];
  const endD = spLast7End();
  for(let i = 6; i >= 0; i--){
    const d = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() - i);
    const ds = spIso(d);
    labels.push((d.getMonth()+1) + '/' + d.getDate());
    arr.push(Math.round(spDayTotal(ds)));
  }
  const _chartEl = $('spStatChart');
  const _fitW = _chartEl ? (_chartEl.clientWidth - 24) : 0;   // 减 .lg-chart 左右 padding(12+12) → 近7日铺满、无需横向滚动
  if(_chartEl) _chartEl.innerHTML = spBarSVG(labels, arr, '#ff6b9d', true, _fitW > 0 ? _fitW : 0);
  const box = $('spStatDays');
  const days = Object.keys(byDay).sort();
  if(!days.length){ box.innerHTML = '<div class="empty"><span class="empty-emoji">📭</span><div class="empty-text">本月暂无记录</div></div>'; return; }
  const maxv = Math.max(1, ...days.map(d => byDay[d]));
  box.innerHTML = days.map(d => {
    const m = byDay[d]; const h = Math.max(2, 56 * m / maxv);
    return '<div class="lg-daybar" title="' + d + ' ' + spFmtDur(m) + '"><div class="bi"><i class="sl" style="height:' + h + 'px"></i></div><small>' + parseInt(d.slice(8), 10) + '</small></div>';
  }).join('');
}
/* ---------- Banner：HelloKitty 九宫格头像 + emoji 散射（与记账 lgRenderBanner 严格一致） ---------- */
function spRenderBanner(panel){
  const el = (typeof panel === 'string') ? $('spp-' + panel) : panel;
  if(!el) return;
  const banner = el.querySelector('.lg-banner'); if(!banner) return;
  const title = banner.dataset.title || '睡眠', sub = banner.dataset.sub || '';
  const h3 = banner.querySelector('h3'); if(h3) h3.textContent = title;
  const p = banner.querySelector('p'); if(p) p.textContent = sub;
  // 圆形头像：HelloKitty 九宫格随机 9 选 1（--lg-avatar-* 与记账同源，直接读 #screen-ledger 上的变量）
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
function spSwitch(panel){
  spState.panel = panel;   /* v5.4.6：记录当前面板，供云端数据到达后按需重渲染 */
  document.querySelectorAll('#spSide .lg-nav').forEach(b => b.classList.toggle('active', b.dataset.sp === panel));
  document.querySelectorAll('#screen-sleep .lg-panel').forEach(p => p.classList.toggle('active', p.id === 'spp-' + panel));
  const active = $('spp-' + panel);
  if(active) spRenderBanner(active);   // 每次切换模块重新随机 Kitty 头像 + emoji 散射（与记账一致）
  if(panel === 'stats') spRenderStats();
  else if(panel === 'calendar') spRenderCalendar();
  else if(panel === 'overview') spRenderOverview();
}
/* 云端按钮统一守卫（供内联 onclick 使用；先登录态后令牌，与记账一致） */
function spGuardSync(){
  if(!state.user){ toast('请先登录'); return false; }
  return true;   // v5.1.3：已无 Gitee 令牌依赖，仅校验登录态
}
function spPullCloud(){
  if(!state.user){ toast('请先登录'); return; }
  // v5.1.3：统一为 Supabase 手动下拉刷新（数据实时上传，无需 Gitee）
  sbLoadAll().then(() => { toast('已从云端刷新睡眠数据 ✓'); }).catch(e => toast('刷新失败：' + (e && e.message ? e.message : '未知错误')));
}
function spPushCloud(){
  if(!state.user){ toast('请先登录'); return; }
  sbLoadAll().then(() => { toast('已刷新云端睡眠数据 ✓'); }).catch(e => toast('刷新失败：' + (e && e.message ? e.message : '未知错误')));
}
function spSyncCloud(){
  if(!state.user){ toast('请先登录'); return; }
  return sbLoadAll().then(() => { toast('睡眠已刷新云端数据 ✓'); }).catch(e => toast('刷新失败：' + (e && e.message ? e.message : '未知错误')));
}
let spBound = false;
function spBind(){
  if(spBound) return; spBound = true;
  document.querySelectorAll('#spSide .lg-nav').forEach(b => b.onclick = () => spSwitch(b.dataset.sp));
  $('spSave').onclick = spSave;
  $('spCalPrev').onclick = () => { spState.calYM.m--; if(spState.calYM.m < 1){ spState.calYM.m = 12; spState.calYM.y--; } spRenderCalendar(); };
  $('spCalNext').onclick = () => { spState.calYM.m++; if(spState.calYM.m > 12){ spState.calYM.m = 1; spState.calYM.y++; } spRenderCalendar(); };
  $('spStatPrev').onclick = () => { spState.statYM.m--; if(spState.statYM.m < 1){ spState.statYM.m = 12; spState.statYM.y--; } spRenderStats(); };
  $('spStatNext').onclick = () => { spState.statYM.m++; if(spState.statYM.m > 12){ spState.statYM.m = 1; spState.statYM.y++; } spRenderStats(); };
  // 云端三按钮（头部⟳ / 上传 / 下拉）已改为 HTML 内联 onclick + spGuardSync，不再依赖此处绑定
}
/* ---------- 记录卡片点击：放大图窗 + 二次编辑 ---------- */
function spOpenRec(id){
  const rec = (state.sleep.records||[]).find(r => r.id === id);
  if(!rec){ return; }
  spState.editId = id;
  $('spEdDate').value = rec.date || spTodayStr();
  $('spEdStart').value = rec.start || '';
  $('spEdEndDate').value = rec.endDate || '';
  $('spEdEnd').value = rec.end || '';
  $('spEdNote').value = rec.note || '';
  spEdRefresh();
  $('spRecMask').style.display = 'flex';
}
function spCloseRec(){ $('spRecMask').style.display = 'none'; spState.editId = null; }
function spEdRefresh(){
  const start = $('spEdStart').value, end = $('spEdEnd').value;
  const date = $('spEdDate').value || spTodayStr();
  const endDate = $('spEdEndDate').value || '';
  const box = $('spEdDur'); if(!box) return;
  if(!start){ box.textContent = '请填写入睡时间'; return; }
  if(!end){ box.textContent = '入睡中（未填起床）'; return; }
  const m = spDuration2(date, start, endDate || date, end);
  const ad = spAttrDate(date, start);   /* v5.9.0：提示归属日期（凌晨入睡归前一天） */
  box.textContent = '时长：' + (m > 0 ? spFmtDur(m) : '无效，请检查起床时间') + (ad !== date ? '（归属 ' + ad + '）' : '');
}
function spSaveEdit(){
  const id = spState.editId; const rec = (state.sleep.records||[]).find(r => r.id === id);
  if(!rec){ spCloseRec(); return; }
  const date = $('spEdDate').value || spTodayStr();
  const start = $('spEdStart').value;
  const end = $('spEdEnd').value;
  const endDate = $('spEdEndDate').value || '';
  if(!start){ toast('请填写入睡时间'); return; }
  let minutes = 0;
  if(end){ minutes = spDuration2(date, start, endDate || date, end); if(minutes <= 0){ toast('睡眠时长需大于 0'); return; } }
  rec.date = date; rec.start = start; rec.endDate = endDate; rec.end = end; rec.minutes = minutes;
  rec.note = $('spEdNote').value.trim();
  sbSaveObj('sleep', rec, {record_date: rec.date, start_time: rec.start, end_time: rec.end || null, end_date: rec.endDate || null, duration_minutes: rec.minutes, note: rec.note});
  spRenderToday(); spRenderCalendar(); spRenderStats(); spRenderOverview();
  toast('已修改 ✓'); spCloseRec();
}
function spDeleteFromModal(){
  const id = spState.editId; if(!id) return;
  spDeleteRec(id); spCloseRec();
}
/* ---------- Phase 9（v5.25.0）：睡眠数据层 + 页面入口（自 index.html 主内联脚本逐字节迁出） ---------- */

function normalizeSleep(S){
  const d = defaultSleep();
  if(!S || typeof S !== 'object') return d;
  return { records: Array.isArray(S.records) ? S.records : [], deleted: Array.isArray(S.deleted) ? S.deleted : [] };
}

function sleepPath(){ return userDir(state.user.name) + 'sleep.json'; }

async function pushSleepData(username, updatedAt){
  const S = normalizeSleep(state.sleep);
  const payload = JSON.stringify({ updatedAt: updatedAt, records: S.records, deleted: S.deleted }, null, 2);
  await giteeWriteJSON(sleepPath(), payload, 'sync sleep ' + username + ' ' + updatedAt);
}
async function pullSleepData(overwrite){
  const remote = await giteeReadJSON(sleepPath());
  if(!remote) return false;
  const rs = Array.isArray(remote.records) ? remote.records : [];
  const rd = Array.isArray(remote.deleted) ? remote.deleted : [];
  if(overwrite){
    state.sleep = normalizeSleep({ records: rs, deleted: rd });   // 强制覆盖（启动/手动下拉取回）：以云端为准
    return true;
  }
  // 合并模式 v4.2.5：按 id 取并集（云端 + 本地全部保留，本地刚录入的不会被覆盖），
  // 并集后再按墓碑过滤（两台设备各自的删除在此统一生效，防止已删记录从另一台设备复活）
  const del = new Set([...(state.sleep.deleted||[]), ...rd].map(String));
  const map = new Map();
  (state.sleep.records||[]).forEach(r => { if(r && r.id != null && !del.has(String(r.id))) map.set(r.id, r); });
  rs.forEach(r => { if(r && r.id != null && !del.has(String(r.id))) if(!map.has(r.id)) map.set(r.id, r); });
  state.sleep = normalizeSleep({ records: Array.from(map.values()), deleted: [...del] });
  return true;
}
async function tryPullSleep(overwrite, doRefresh){
  if(doRefresh === undefined) doRefresh = true;   // 默认拉取后刷新界面；自动同步传 false 以免重置回概览
  let changed = false;
  try{ changed = await pullSleepData(overwrite); }catch(err){ return false; }
  if(changed && doRefresh){ saveState(); refreshAfterSync(); }
  return changed;
}

function gotoSleep(){ showScreen('screen-sleep'); renderSleep(); }
function renderSleep(){
  try{
    const screen = $('screen-sleep');
    // 随机选一张柔和粉色背景图铺满睡眠页（--lg-bg-1..5 与记账同源）
    const bgIdx = Math.floor(Math.random()*5) + 1;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--lg-bg-' + bgIdx).trim();
    if(screen) screen.style.backgroundImage = bg || 'linear-gradient(160deg,#fff0f6,#ffe3ee 60%,#ffd9ea)';
    if(!spState.calYM){ const d = new Date(); spState.calYM = { y:d.getFullYear(), m:d.getMonth()+1 }; }
    if(!spState.statYM){ const d = new Date(); spState.statYM = { y:d.getFullYear(), m:d.getMonth()+1 }; }
    if(!spState.selDate) spState.selDate = spTodayStr();
    $('spDate').value = spState.selDate;
    spBind();
    spSwitch('overview');
    spRenderToday();
    spRenderCalendar();
    spRenderStats();
  }catch(e){ console.error('renderSleep 异常：', e); }
}
