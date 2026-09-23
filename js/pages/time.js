/* ==========================================================================
   生活象限 · js/pages/time.js
   --------------------------------------------------------------------------
   v5.28.0「时光」页面模块（Classic Script，无 import/export）。

   职责边界：
     · 时光页（#screen-time）的渲染：按「即将到来 / 持续中 / 已结束」分组
     · 新增 / 编辑 / 删除弹窗（复用既有 .wb-mask + .wb-modal + wbModalShow/Hide 范式）
     · 首页焦点卡「时光」内容的 HTML 供给（普通模式 = 可上下滚动的事件列表；
       简洁模式 = 一条最紧凑的日期信息）→ 首页只负责摆放与手势，不在此重复业务
     · 置顶（profiles.hero_pinned）的读写

   ⚠️ 一切日期与重复规则计算**只调用 js/services/time.js（window.WBTime）**，
      本文件不实现任何日期算法。
   ⚠️ 数据只读写唯一的 state.timeEvents（禁止第二状态树）；保存走 bridge 的
      sbSaveObj / sbRemoveObj，加载走 sbLoadAll 的 MODULE_LOAD（与 memo/todo/fuel 同构）。
   ⚠️ 派生值（已经 X 天 / 还有 X 天 / 下一次 / 已结束）全部实时计算，不落库、不缓存。
   ========================================================================== */

/* 事件模板（只是 UI 快捷方式，数据库不为任何类型单独建结构） */
const TIME_TEMPLATES = [
  { k: 'anniv',  icon: '💍', name: '纪念日' },
  { k: 'birth',  icon: '🎂', name: '生日' },
  { k: 'love',   icon: '❤️', name: '恋爱纪念' },
  { k: 'travel', icon: '✈️', name: '旅行' },
  { k: 'exam',   icon: '📚', name: '考试' },
  { k: 'job',    icon: '💼', name: '入职' },
  { k: 'move',   icon: '🏠', name: '搬家' },
  { k: 'goal',   icon: '🎯', name: '目标' },
  { k: 'custom', icon: '📅', name: '自定义' }
];
/* 模板 → 默认重复规则（纪念日/生日/恋爱纪念是年度重复；其余默认一次性） */
const TIME_TPL_REPEAT = { anniv: 'year', birth: 'year', love: 'year', travel: 'none', exam: 'none', job: 'none', move: 'none', goal: 'none', custom: 'none' };
const TIME_REPEAT_OPTS = [
  { k: 'none', t: '不重复' }, { k: 'day', t: '每天' }, { k: 'week', t: '每周' },
  { k: 'month', t: '每月' }, { k: 'year', t: '每年' }, { k: 'custom', t: '自定义' }
];
const TIME_ICONS = ['💍', '❤️', '🎂', '✈️', '📚', '💼', '🏠', '🎯', '📅', '🎓', '🌸', '🏆', '💰', '🚗', '🍼', '🌏', '⛰️', '🎵'];

const TIME_MODAL = { mask: 'timeEditMask', title: 'timeModalTitle', viewBox: 'timeViewBox', formBox: 'timeFormBox' };

let timeEditId = null;        /* 当前弹窗对应的事件 id（null = 新增） */
let timeTplKey = 'custom';    /* 当前选中的模板 */
let timeRepeat = 'none';      /* 当前选中的重复规则 */
let timeIcon = '📅';          /* 当前选中的图标 */
let timePinTarget = null;     /* 置顶菜单待操作的键：'quote' | 'time:<id>' */
/* v5.32.0：当前编辑表单里的「首页置顶」开关（true = 这条作为首页时光卡片默认展示对象）。
   新增时默认 false；打开已有事件编辑时按该事件的 isPinned 回显。 */
let timePinned = false;

function timeEsc(s) {
  if (typeof spEsc === 'function') return spEsc(s);
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

/* ---------- 存储层（懒初始化，登录前/模块缺失也能安全渲染） ---------- */
function timeStore() {
  if (!state.timeEvents || typeof state.timeEvents !== 'object' || !Array.isArray(state.timeEvents.records)) {
    state.timeEvents = { records: [], deleted: [] };
  }
  if (!Array.isArray(state.timeEvents.deleted)) state.timeEvents.deleted = [];
  return state.timeEvents;
}
function timeRecs() { return timeStore().records; }
function timeById(id) { return timeRecs().find(function (t) { return String(t.id) === String(id); }) || null; }
function timeToday() { return window.WBTime.today(); }
/* 排序：置顶优先 → 未结束优先 → 下一次发生日越近越前（已结束按最近结束在前） */
function timeSorted() { return window.WBTime.sortEvents(timeRecs(), timeToday()); }
function timeStateOf(ev) { return window.WBTime.stateOf(ev, timeToday()); }
/* 首页焦点卡置顶键：state.heroPinned = 'quote' | 'time:<uuid>' | null */
function timePinnedId() {
  var k = String((state && state.heroPinned) || '');
  return k.indexOf('time:') === 0 ? k.slice(5) : null;
}
function timeStartIndex() { return timePinnedId() ? 1 : 0; }

/* v5.30.0：首页「时光」入口卡摘要 = 倒计时 + 「时间流逝」进度（纯函数：只读 state.timeEvents，
   不写 DOM / 不发网络 / 不改状态）
   卡片**不增高**：核心数据与辅助同在两行横向栏内 ——
   · value = 还剩 / 已经 多少天（复用 WBTime.daysText，与焦点卡同一口径；已结束 → 已结束）
   · aux   = 事件语义（一次性：距离「旅行」；重复：下次还有 N 天）—— 放在模块名一行右侧
   · bar   = 「距离目标日期的时间已经过去了多少」，**按事件类型取真实区间**，不用固定分母：
       ① 一次性未来事件：记录日(created_at) → 目标日(date)
       ② 重复事件（每年/每月/每周/每 N 天/每 N 年）：上一次发生日 → 下一次发生日（本轮周期）
       ③ 已结束的一次性事件：**不显示进度条**（bar:null + ended:true → 卡片低饱和）
   ⚠️ 不新增任何字段：区间两端全部来自既有 date / repeat_* / created_at，日期运算全部复用 WBTime
      （addDays / addMonthsKeep / addYearsKeep / daysBetween），不另写一套日期算法。 */
function timeHomeSummary() {
  const T = window.WBTime;
  const today = timeToday();
  const list = timeRecs();
  /* v5.32.0：选择规则显式化 ——
       ① 用户置顶的那条优先（time_events.is_pinned，同时最多一条）；
       ② 没有任何置顶时，回落到**既有**的自动规则（WBTime.mostImportant = 排序后第一条：
          未结束优先 → 下一次发生日越近越前）。自动规则只能作为 fallback，永远不会覆盖用户主动设置的置顶。 */
  const pinned = list.find(function (e) { return !!e.isPinned; }) || null;
  const ev = pinned || (list.length ? T.mostImportant(list, today) : null);
  if (!ev) return { value: '—', aux: '记录重要的日子', bar: null, ended: false };
  const st = T.stateOf(ev, today);
  const title = ev.title || '这件事';

  /* 已结束的一次性事件：只显示状态，不给已经失效的倒计时保留进度条 */
  if (st.kind === 'ended') {
    return { value: '已结束', aux: '「' + title + '」', bar: null, ended: true };
  }

  /* a → b 这个区间里，「今天」走到了哪一段（0~1） */
  const progress = function (a, b) {
    const total = T.daysBetween(a, b);
    if (!(total > 0)) return 0;
    return Math.max(0, Math.min(1, T.daysBetween(a, today) / total)) * 100;
  };

  let pct = 0, aux = '';
  if (st.kind === 'upcoming') {
    /* 一次性未来事件：起点用该事件的「记录日」(created_at)；缺失时退化为「目标日前一年」作参考区间 */
    aux = '距离「' + title + '」';
    const start = T.toDate(ev.createdAt) || T.addDays(ev.date, -365);
    pct = progress(start, ev.date);
  } else {
    /* 重复事件：本轮 = 上一次发生日 → 下一次发生日（两端都用既有重复规则反推，2/29 等边界由 WBTime 处理） */
    const next = st.nextDate;
    const r = T.ruleOf(ev);
    let prev = null;
    if (next && r) {
      if (r.unit === 'day') prev = T.addDays(next, -r.interval);
      else if (r.unit === 'week') prev = T.addDays(next, -7 * r.interval);
      else if (r.unit === 'month') prev = T.addMonthsKeep(next, -r.interval);
      else prev = T.addYearsKeep(next, -r.interval);
    }
    aux = (st.daysLeft != null) ? ('下次还有 ' + st.daysLeft + ' 天') : '';
    pct = (prev && next) ? progress(T.toStr(prev), next) : 0;
  }
  return { value: T.daysText(ev, today).main, aux: aux, bar: { pct: pct }, ended: false };
}

/* ==========================================================================
   首页焦点卡「时光」内容供给
   ========================================================================== */

/* 普通模式：事件行（放在卡片内部的可上下滚动区；行高约 40px） */
function timeHeroRowHTML(ev, today) {
  const txt = window.WBTime.daysText(ev, today);
  const cls = (txt.cls === 'ended') ? ' ended' : '';
  return '<button class="tm-hero-item' + cls + '" type="button" data-tm-id="' + timeEsc(ev.id) + '">' +
    '<span class="tm-hero-ic">' + timeEsc(ev.icon || '📅') + '</span>' +
    '<span class="tm-hero-mid">' +
      '<span class="tm-hero-name">' + timeEsc(ev.title || '') + '</span>' +
      (txt.sub ? '<span class="tm-hero-sub">' + timeEsc(txt.sub) + '</span>' : '') +
    '</span>' +
    '<span class="tm-hero-days">' + timeEsc(txt.main) + '</span>' +
  '</button>';
}
/* 普通模式：整个「时光」页（第 2 页）的内部 HTML —— 事件多时靠内部上下滚动浏览 */
function timeHeroHTML() {
  const today = timeToday();
  const list = timeSorted();
  if (!list.length) {
    /* 同一份 DOM 服务两种模式（由 CSS 切换文案，避免按主题分支渲染）：
         普通模式 → 提示进入时光页添加
         简洁模式 → 「＋ 添加一个重要的日子」（点击直接进入新增） */
    return '<div class="tm-hero-empty">' +
        '<span class="tm-hero-ic">🕰️</span>' +
        '<span class="tm-hero-mid">' +
          '<span class="tm-hero-name"><span class="tm-ne-cute">还没有记录重要的日子</span>' +
            '<span class="tm-ne-mini">＋ 添加一个重要的日子</span></span>' +
          '<span class="tm-hero-sub tm-ne-cute">点这里进入「时光」添加</span>' +
        '</span>' +
      '</div>';
  }
  return list.map(function (ev) { return timeHeroRowHTML(ev, today); }).join('');
}
/* 简洁模式：只显示**当前最重要的一条**（无事件时提示添加） */
function timeMiniHTML() {
  const today = timeToday();
  const ev = window.WBTime.mostImportant(timeRecs(), today);
  if (!ev) {
    return '<button class="tm-mini-empty press" type="button" onclick="timeOpenNew()">＋ 添加一个重要的日子</button>';
  }
  const txt = window.WBTime.daysText(ev, today);
  const cls = (txt.cls === 'ended') ? ' ended' : '';
  return '<button class="tm-mini press' + cls + '" type="button" onclick="gotoTime()">' +
    '<span class="tm-mini-ic">' + timeEsc(ev.icon || '📅') + '</span>' +
    '<span class="tm-mini-name">' + timeEsc(ev.title || '') + '</span>' +
    '<span class="tm-mini-days">' + timeEsc(txt.main) +
      (txt.sub ? '<i>' + timeEsc(txt.sub) + '</i>' : '') + '</span>' +
  '</button>';
}
/* 简洁模式下是否有事件（首页据此决定「时光区」是否占位） */
function timeHasAny() { return timeRecs().length > 0; }

/* ==========================================================================
   时光页面
   ========================================================================== */
function gotoTime() {
  showScreen('screen-time');
  timeRenderPage();
}
function timeCardHTML(ev, today) {
  const txt = window.WBTime.daysText(ev, today);
  const st = txt.state;
  const cls = (txt.cls === 'ended') ? ' ended' : '';
  let sub;
  if (txt.cls === 'ended') sub = '一次性事件 · ' + window.WBTime.fmtDot(ev.date);
  else if (txt.cls === 'upcoming') sub = window.WBTime.fmtDot(ev.date) + ' · ' + window.WBTime.repeatLabel(ev);
  else sub = '起始 ' + window.WBTime.fmtDot(ev.date) + (txt.sub ? ' · ' + txt.sub : '');
  const dot = (st.nextDate && txt.cls !== 'ended')
    ? '<span class="tm-dot">下次 ' + window.WBTime.fmtDot(st.nextDate) + '</span>' : '';
  return '<button class="tm-card press' + cls + '" type="button" data-tm-id="' + timeEsc(ev.id) + '">' +
    '<span class="tm-ic">' + timeEsc(ev.icon || '📅') + '</span>' +
    '<span class="tm-mid">' +
      '<span class="tm-name">' + timeEsc(ev.title || '') +
        (ev.isPinned ? '<span class="tm-pin">📌</span>' : '') + '</span>' +
      '<span class="tm-sub">' + timeEsc(sub) + '</span>' +
    '</span>' +
    '<span class="tm-days">' + timeEsc(txt.main) + dot + '</span>' +
  '</button>';
}
function timeSecHTML(title, list, today) {
  if (!list.length) return '';
  return '<div class="tm-sec">' +
    '<div class="tm-sec-title">' + title + '<span class="tm-cnt">' + list.length + ' 条</span></div>' +
    list.map(function (ev) { return timeCardHTML(ev, today); }).join('') +
  '</div>';
}
function timeRenderPage() {
  const box = $('tmGroups'); if (!box) return;
  try {
    const today = timeToday();
    const all = timeSorted();
    if (!all.length) {
      box.innerHTML = '<div class="tm-empty">还没有记录重要的日子<br>点上方「＋ 添加时光」开始吧</div>';
      return;
    }
    const g = { upcoming: [], ongoing: [], ended: [] };
    all.forEach(function (ev) {
      const st = window.WBTime.stateOf(ev, today);
      g[st.kind === 'ended' ? 'ended' : (st.kind === 'upcoming' ? 'upcoming' : 'ongoing')].push(ev);
    });
    box.innerHTML = timeSecHTML('即将到来', g.upcoming, today) +
                    timeSecHTML('持续中', g.ongoing, today) +
                    timeSecHTML('已结束', g.ended, today);
    box.querySelectorAll('[data-tm-id]').forEach(function (el) {
      el.onclick = function () { timeOpenDetail(el.getAttribute('data-tm-id')); };
    });
  } catch (e) { /* 渲染容错，不阻塞其它页面 */ }
}
/* 数据变化后统一刷新：时光页 + 首页焦点卡 */
function timeRefreshAll() {
  try { timeRenderPage(); } catch (e) { }
  /* v5.29.0 修正：原调用 renderHomeHero() —— 该函数名不存在（首页实际函数是 js/pages/home.js 的
     homeHeroRender），typeof 守卫使它恒为 no-op，导致「时光页内 ⟳ / 保存 / 删除 / 首页长按置顶后，
     焦点卡时光列表不会立即重排」。此处按真实函数名修正（仅改这一处名字，不做其它重构）。 */
  try { if (typeof homeHeroRender === 'function') homeHeroRender(); } catch (e) { }
  /* v5.32.0：置顶变化后，首页「功能入口」里的时光卡也要同步（它走 renderHomeSummaries → timeHomeSummary）。
     加在这里是为了「在时光页改完置顶，回到首页之前卡片就已经是新值」，不依赖再次进入首页触发渲染。 */
  try { if (typeof renderHomeSummaries === 'function') renderHomeSummaries(); } catch (e) { }
}

/* ==========================================================================
   新增 / 编辑弹窗（详情↔编辑双态，新增与编辑复用同一个弹窗）
   ========================================================================== */
function timeShowBox(view) {
  const title = view ? '时光详情' : (timeEditId ? '✏️ 编辑时光' : '＋ 添加时光');
  wbModalShow(TIME_MODAL, view, title);
}
function timeBindChips() {
  const tpl = $('tmTpl');
  if (tpl) {
    tpl.innerHTML = TIME_TEMPLATES.map(function (t) {
      return '<button class="chip' + (t.k === timeTplKey ? ' active' : '') + '" type="button" data-tm-tpl="' + t.k + '">' +
        t.icon + ' ' + t.name + '</button>';
    }).join('');
    tpl.querySelectorAll('[data-tm-tpl]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-tm-tpl');
        timeTplKey = k;
        const t = TIME_TEMPLATES.filter(function (x) { return x.k === k; })[0];
        if (t) timeIcon = t.icon;
        timeRepeat = TIME_TPL_REPEAT[k] || 'none';
        timeBindChips(); timeSyncRepeatUI(); timeEditHint();
      };
    });
  }
  const rep = $('tmRepeat');
  if (rep) {
    rep.innerHTML = TIME_REPEAT_OPTS.map(function (o) {
      return '<button class="chip' + (o.k === timeRepeat ? ' active' : '') + '" type="button" data-tm-rep="' + o.k + '">' + o.t + '</button>';
    }).join('');
    rep.querySelectorAll('[data-tm-rep]').forEach(function (b) {
      b.onclick = function () {
        timeRepeat = b.getAttribute('data-tm-rep');
        timeBindChips(); timeSyncRepeatUI(); timeEditHint();
      };
    });
  }
  const ic = $('tmIconRow');
  if (ic) {
    ic.innerHTML = TIME_ICONS.map(function (e) {
      return '<button class="chip' + (e === timeIcon ? ' active' : '') + '" type="button" data-tm-icon="' + e + '">' + e + '</button>';
    }).join('');
    ic.querySelectorAll('[data-tm-icon]').forEach(function (b) {
      b.onclick = function () { timeIcon = b.getAttribute('data-tm-icon'); timeBindChips(); };
    });
  }
  /* v5.32.0：「首页置顶」分段控件（关闭 / 开启）—— 与上面几组同一套 .chip 外观 */
  const pin = $('tmPinRow');
  if (pin) {
    pin.innerHTML =
      '<button class="chip' + (!timePinned ? ' active' : '') + '" type="button" data-tm-pin="0">关闭</button>' +
      '<button class="chip' + (timePinned ? ' active' : '') + '" type="button" data-tm-pin="1">📌 开启</button>';
    pin.querySelectorAll('[data-tm-pin]').forEach(function (b) {
      b.onclick = function () { timePinned = (b.getAttribute('data-tm-pin') === '1'); timeBindChips(); };
    });
    timeSyncPinHint();
  }
}
/* v5.32.0：「首页置顶」的说明文案（随开关实时变化） */
function timeSyncPinHint() {
  const box = $('tmPinHint'); if (!box) return;
  box.textContent = timePinned
    ? '首页「时光」卡片固定显示这一条；保存时会自动取消其它事件的置顶（同时只会有一条）。'
    : '未置顶：首页「时光」卡片按现有规则自动选择（最近/最重要的一条）。';
}
/* 自定义周期的行显隐 + 规则文案 */
function timeSyncRepeatUI() {
  const row = $('tmCustomRow');
  if (row) row.style.display = (timeRepeat === 'custom') ? 'flex' : 'none';
  const hint = $('tmRepeatHint');
  if (hint) {
    const iv = Math.max(1, parseInt(($('tmEditInterval') ? $('tmEditInterval').value : '1'), 10) || 1);
    const unit = ($('tmEditUnit') && $('tmEditUnit').value) || 'day';
    hint.textContent = (timeRepeat === 'none')
      ? '一次性事件：到日期后归入「已结束」，记录会保留。'
      : ('重复规则：' + window.WBTime.repeatLabel({
          repeat_type: timeRepeat === 'custom' ? 'custom' : timeRepeat,
          repeat_interval: timeRepeat === 'custom' ? iv : 1,
          repeat_unit: timeRepeat === 'custom' ? unit : timeRepeat
        }) + '（重复事件永远不会变成「已结束」）');
  }
}
/* 表单实时预览（会算出「还有 / 已经多少天」与下一次发生日） */
function timeEditHint() {
  const box = $('tmEditHint'); if (!box) return;
  const date = $('tmEditDate') ? $('tmEditDate').value : '';
  if (!date) { box.textContent = ''; box.style.display = 'none'; return; }
  const iv = Math.max(1, parseInt(($('tmEditInterval') ? $('tmEditInterval').value : '1'), 10) || 1);
  const unit = ($('tmEditUnit') && $('tmEditUnit').value) || 'day';
  const draft = {
    date: date,
    repeat_type: (timeRepeat === 'custom' && !TIME_REPEAT_OPTS.some(function (o) { return o.k === 'custom'; })) ? 'none' : timeRepeat,
    repeat_interval: timeRepeat === 'custom' ? iv : 1,
    repeat_unit: timeRepeat === 'custom' ? unit : timeRepeat
  };
  const txt = window.WBTime.daysText(draft, timeToday());
  box.style.display = 'block';
  box.textContent = '预览：' + txt.main + (txt.sub ? ' · ' + txt.sub : '') +
    (txt.state.nextDate ? ' · 下一次 ' + window.WBTime.fmtDot(txt.state.nextDate) : '');
}
function timeOpenNew(tplKey) {
  timeEditId = null;
  const k = tplKey || 'custom';
  timeTplKey = k;
  const tpl = TIME_TEMPLATES.filter(function (t) { return t.k === k; })[0] || TIME_TEMPLATES[TIME_TEMPLATES.length - 1];
  timeIcon = tpl.icon;
  timeRepeat = TIME_TPL_REPEAT[tpl.k] || 'none';
  if ($('tmEditTitle')) $('tmEditTitle').value = '';
  if ($('tmEditDate')) $('tmEditDate').value = timeToday();
  if ($('tmEditNote')) $('tmEditNote').value = '';
  if ($('tmEditInterval')) $('tmEditInterval').value = '10';
  if ($('tmEditUnit')) $('tmEditUnit').value = 'day';
  timePinned = false;   /* v5.32.0：新增默认不置顶 —— 不会覆盖用户已有的置顶事件 */
  timeBindChips(); timeSyncRepeatUI(); timeEditHint();
  timeShowBox(false);
  const f = $('tmEditTitle');
  if (f) { try { f.focus(); } catch (e) { } }
}
function timeOpenDetail(id) {
  const ev = timeById(id); if (!ev) return;
  timeEditId = ev.id;
  if ($('timeViewBody')) $('timeViewBody').textContent = ev.title || '';
  const rows = $('timeViewRows');
  if (rows) {
    const txt = window.WBTime.daysText(ev, timeToday());
    let html = wbRowHTML('日期', window.WBTime.fmtDot(ev.date));
    html += wbRowHTML('重复', window.WBTime.repeatLabel(ev));
    html += wbRowHTML('状态', txt.main + (txt.sub ? '（' + txt.sub + '）' : ''));
    if (txt.state.nextDate) html += wbRowHTML('下一次', window.WBTime.fmtDot(txt.state.nextDate));
    if (ev.note) html += wbRowHTML('备注', ev.note);
    html += wbRowHTML('首页', ev.isPinned ? '已置顶 📌' : '未置顶');
    rows.innerHTML = html;
  }
  if ($('timeViewTime')) $('timeViewTime').textContent = '';
  timeShowBox(true);
}
function timeSwitchEdit() {
  const ev = timeEditId ? timeById(timeEditId) : null;
  if (ev) {
    timeIcon = ev.icon || '📅';
    timeRepeat = ev.repeatType || 'none';
    timeTplKey = 'custom';
    if ($('tmEditTitle')) $('tmEditTitle').value = ev.title || '';
    if ($('tmEditDate')) $('tmEditDate').value = ev.date || timeToday();
    if ($('tmEditNote')) $('tmEditNote').value = ev.note || '';
    if ($('tmEditInterval')) $('tmEditInterval').value = String(ev.repeatInterval || 1);
    if ($('tmEditUnit')) $('tmEditUnit').value = ev.repeatUnit || 'day';
    /* v5.32.0：回显「首页置顶」—— 按该事件真实的 isPinned，不做「每次都默认关闭」 */
    timePinned = !!ev.isPinned;
  }
  timeBindChips(); timeSyncRepeatUI(); timeEditHint();
  timeShowBox(false);
}
function timeCloseEdit() {
  wbModalHide(TIME_MODAL);
  timeEditId = null;
}
/* v5.32.0：置顶互斥 —— 取消「除 keepId 之外」所有已置顶事件（本机立即生效 + 逐条 await 写库）。
   为什么必须先取消再置新：DB 上有局部唯一索引 uq_time_events_pinned（同一用户最多一条 is_pinned=true），
   若先写新的再删旧的，服务端会报唯一冲突 —— 与下方 timeApplyPin 采用同一顺序。 */
async function timeClearPinsExcept(keepId) {
  const others = timeRecs().filter(function (e) { return !!e.isPinned && String(e.id) !== String(keepId); });
  for (var i = 0; i < others.length; i++) {
    const e = others[i];
    e.isPinned = false;                    /* 本机立即生效 → 首页马上按新规则选择 */
    try { await sbSaveObj('timeEvents', e, { is_pinned: false }); } catch (err) { /* 单条失败不阻塞，下次云端加载会校正 */ }
  }
}

async function timeSaveEdit() {
  const title = ($('tmEditTitle') ? $('tmEditTitle').value : '').trim();
  const date = $('tmEditDate') ? $('tmEditDate').value : '';
  if (!title) { toast('请填写事件名称'); return; }
  if (!date) { toast('请选择日期'); return; }
  let rType = timeRepeat, rIv = 1, rUnit = null;
  if (rType === 'custom') {
    rIv = Math.max(1, parseInt(($('tmEditInterval') ? $('tmEditInterval').value : '1'), 10) || 1);
    rUnit = (($('tmEditUnit') && $('tmEditUnit').value) || 'day');
  } else if (rType !== 'none') {
    rUnit = rType;
  }
  const note = ($('tmEditNote') ? $('tmEditNote').value : '').trim();
  const wantPin = !!timePinned;   /* v5.32.0：置顶由表单开关决定 */
  /* v5.32.0：payload 终于带上 is_pinned —— 原先只有 title / date / repeat 三个 / icon / note，
     编辑端根本无法设置置顶；这里是在**保留原字段**的基础上新增一项，不会因重建 payload 丢字段。 */
  const payload = {
    title: title, date: date, repeat_type: rType, repeat_interval: rIv,
    repeat_unit: rUnit, icon: timeIcon, note: note, is_pinned: wantPin
  };
  if (timeEditId) {
    const ev = timeById(timeEditId);
    if (!ev) { timeCloseEdit(); timeRefreshAll(); return; }
    if (wantPin) await timeClearPinsExcept(timeEditId);   /* 先取消旧的，再写本条 */
    ev.title = title; ev.date = date; ev.repeatType = rType;
    ev.repeatInterval = rIv; ev.repeatUnit = rUnit; ev.icon = timeIcon; ev.note = note;
    ev.isPinned = wantPin;
    sbSaveObj('timeEvents', ev, payload);
  } else {
    if (wantPin) await timeClearPinsExcept(null);          /* 新增时开置顶 → 先清掉旧的 */
    const t = {
      id: wbUuid(), title: title, date: date, repeatType: rType, repeatInterval: rIv,
      repeatUnit: rUnit, icon: timeIcon, note: note, isPinned: wantPin,
      createdAt: new Date().toISOString(), _sbSaved: false
    };
    timeRecs().push(t);
    sbSaveObj('timeEvents', t, payload);
  }
  timeCloseEdit(); timeRefreshAll(); toast('已保存 ✓');
}
function timeDeleteEdit() {
  const id = timeEditId; if (!id) return;
  if (!confirm('删除这条时光记录？')) return;
  timeCloseEdit();
  timeDelete(id);
}
function timeDelete(id) {
  const ev = timeById(id); if (!ev) return;
  const wasPinned = !!ev.isPinned || (timePinnedId() === String(id));
  const i = timeRecs().indexOf(ev);
  if (i >= 0) timeRecs().splice(i, 1);
  timeStore().deleted.push(id);
  sbRemoveObj('timeEvents', ev);
  if (wasPinned) timeApplyPin(null);
  timeRefreshAll();
  toast('已删除');
}

/* ==========================================================================
   首页焦点卡置顶（profiles.hero_pinned）
   --------------------------------------------------------------------------
   'quote'       → 下次进入首页默认停在「励志语句」页
   'time:<uuid>' → 下次进入首页默认停在「时光」页，并把列表定位到该事件
   null          → 回到默认第一页
   ※ 只影响「默认显示哪一页 / 定位到哪条」，**不改变 Carousel 的页序**
     （页序恒为 第1页 励志语句 → 第2页 时光）。

   ⚠️ v5.32.0：两个字段各管一件事，**不是同一个概念的两个副本**：
        profiles.hero_pinned   → 首页默认显示「励志语句」还是「时光」这一页
        time_events.is_pinned  → 进入「时光」后，首页时光卡片展示哪条纪念日
      · 长按首页时光卡设置置顶 = 两个一起写（设默认页 + 标记该事件），保持既有行为；
      · 时光编辑表单里的「首页置顶」**只写 time_events.is_pinned**，不动 hero_pinned
        （用户可能只想换展示哪条，而不想改默认停在哪一页）；
      · 两边都有唯一性保证：hero_pinned 只有一个值；is_pinned 由 DB 的
        uq_time_events_pinned 局部唯一索引兜底（同时最多一条）。
      若两边出现不一致，以 time_events.is_pinned 决定「展示哪条」，以 hero_pinned 决定「停在哪一页」。
   ========================================================================== */
function timeOpenPinSheet(key) {
  timePinTarget = key;
  const cur = String((state && state.heroPinned) || '');
  const isOn = (cur === key);
  if ($('tmPinTitle')) $('tmPinTitle').textContent = (key === 'quote') ? '励志语句卡' : '时光卡';
  if ($('tmPinOn')) $('tmPinOn').style.display = isOn ? 'none' : 'block';
  if ($('tmPinOff')) $('tmPinOff').style.display = isOn ? 'block' : 'none';
  openSheet('sheet-hero-pin');
}
function timePinOn() { closeSheet('sheet-hero-pin'); timeApplyPin(timePinTarget); }
function timePinOff() { closeSheet('sheet-hero-pin'); timeApplyPin(null); }
/* 把 is_pinned 同步到远端（顺序执行，避免局部唯一索引在「先插后删」时冲突） */
async function timeApplyPin(key) {
  const uid = (state.user && state.user.id) || null;
  const prevId = timePinnedId();
  const newId = (key && key.indexOf('time:') === 0) ? key.slice(5) : null;
  state.heroPinned = key || null;
  const ids = [prevId, newId].filter(function (v) { return !!v; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; });
  for (var i = 0; i < ids.length; i++) {
    const id = ids[i];
    const t = timeById(id); if (!t) continue;
    const on = (String(id) === String(newId));
    if (!!t.isPinned === on) continue;
    t.isPinned = on;
    try {
      await sbSaveObj('timeEvents', t, {
        title: t.title, date: t.date, repeat_type: t.repeatType,
        repeat_interval: t.repeatInterval, repeat_unit: t.repeatUnit,
        icon: t.icon, note: t.note, is_pinned: on
      });
    } catch (e) { /* 单条失败不阻塞：下次云端加载会以 profiles.hero_pinned 为准 */ }
  }
  if (uid) {
    try {
      const r = await getSupabaseClient().from('profiles').update({ hero_pinned: state.heroPinned }).eq('id', uid);
      if (r && r.error) throw r.error;
    } catch (e) { toast('置顶已在本机生效，云端同步稍后重试'); }
  }
  timeRefreshAll();
  toast(key ? '已设为首页置顶 ✓' : '已取消首页置顶');
}
/* 首页长按：目标键（'quote' 或 'time:<id>'） */
function timePinKeyForSlide(n) {
  if (n === 0) return 'quote';
  const list = timeSorted();
  return list.length ? ('time:' + list[0].id) : null;
}

/* ==========================================================================
   加载期绑定（脚本位于 body 末尾，DOM 已就绪）
   ========================================================================== */
(function timeInit() {
  ['tmEditDate', 'tmEditInterval', 'tmEditUnit'].forEach(function (id) {
    const el = $(id); if (!el) return;
    el.addEventListener('change', function () { timeSyncRepeatUI(); timeEditHint(); });
    el.addEventListener('input', function () { timeSyncRepeatUI(); timeEditHint(); });
  });
})();
