/* ==========================================================================
   生活象限 · js/services/time.js
   --------------------------------------------------------------------------
   v5.28.0「时光」：**日期与重复周期计算的唯一实现处**（服务层，纯函数）。

   为什么单独建这一层：
     项目此前没有公共日期工具 —— sleep / ledger / fuel / memo / todo 各自复制了
     一套 Pad+TodayStr（spPad/spIso、lgPad/lgIso、fuPad、memoPad2/memoDateKey、
     todoPad2/todoBizDate）。「时光」需要的能力（天数差、第 N 次发生日、下一次发生日、
     月/年推进并处理「月份天数不足」与「2/29」）远多于上述实现，若再复制一份必然分叉，
     故集中在本文件实现；页面（js/pages/time.js）与首页（js/pages/home.js）只调用它，
     不自行实现任何日期算法。

   统一约定：
     · 一切「日期」都是**本地日历日**，字符串形式 'YYYY-MM-DD'；
       ⇒ 绝不用 new Date('2027-03-15')（按 UTC 解析，东八区会退一天），
         一律 new Date(y, m-1, d) 本地构造。
     · 天数差按本地日历日计算（先归零时分秒），跨月/跨年/闰年均正确。
     · 派生值（daysSince / daysLeft / nextDate / ended…）**全部实时算，绝不落库**。
     · 2/29 年度事件的非闰年规则：下一次发生日取 **2/28**；
       但事件自身的 ev.date（初始日期）**永不改写**，始终保留 2/29。

   暴露：window.WBTime（Classic Script，无 import/export）
   ⚠️ 本文件无 parse-time 语句，纯函数定义 → 加载期无副作用。
   ========================================================================== */
(function () {
  'use strict';

  var UNITS = ['day', 'week', 'month', 'year'];
  var UNIT_LABEL = { day: '天', week: '周', month: '个月', year: '年' };
  var MS_PER_DAY = 86400000;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 'YYYY-MM-DD' | Date | 时间戳 → 本地 00:00 的 Date（非法返回 null） */
  function toDate(v) {
    if (v instanceof Date) {
      return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    if (v == null || v === '') return null;
    var s = String(v).slice(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);   /* 本地构造，非 UTC */
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function toStr(d) {
    var x = toDate(d); if (!x) return '';
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }
  /* 显示用点号格式：2027.03.15 */
  function fmtDot(v) {
    var d = toDate(v); if (!d) return '';
    return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }
  function today() { return toStr(new Date()); }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  /* m: 1-12 */
  function daysInMonth(y, m) {
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  /* b - a（单位：天，按本地日历日） */
  function daysBetween(a, b) {
    var A = toDate(a), B = toDate(b);
    if (!A || !B) return 0;
    return Math.round((B.getTime() - A.getTime()) / MS_PER_DAY);
  }
  function addDays(v, n) {
    var d = toDate(v); if (!d) return null;
    d.setDate(d.getDate() + n);
    return d;
  }
  /* 月推进：目标月天数不足时取当月最后一天（1/31 + 1 月 = 2/28 或 2/29） */
  function addMonthsKeep(v, n) {
    var d = toDate(v); if (!d) return null;
    var total = d.getFullYear() * 12 + d.getMonth() + n;
    var y = Math.floor(total / 12), m = ((total % 12) + 12) % 12;
    return new Date(y, m, Math.min(d.getDate(), daysInMonth(y, m + 1)));
  }
  /* 年推进：2/29 在非闰年落到 2/28（原始日期不改写，只影响「第 n 次发生日」） */
  function addYearsKeep(v, n) {
    var d = toDate(v); if (!d) return null;
    var y = d.getFullYear() + n, m = d.getMonth();
    return new Date(y, m, Math.min(d.getDate(), daysInMonth(y, m + 1)));
  }

  /* 重复规则规范化 → {unit, interval} 或 null（不重复）
     ⚠️ 事件对象有**两种字段形态**，本函数必须都能读（否则年度事件会被误判成一次性 → 已结束）：
        · 内存态（state.timeEvents，由 legacy-sync 映射 / time.js 构造）= camelCase
          repeatType / repeatInterval / repeatUnit
        · 表单草稿与 DAL 载荷（timeEditHint 预览、sbSaveObj）= snake_case
          repeat_type / repeat_interval / repeat_unit */
  function fieldOf(ev, camel, snake) {
    if (!ev) return undefined;
    if (ev[camel] !== undefined && ev[camel] !== null) return ev[camel];
    return ev[snake];
  }
  function isPinnedOf(ev) { return !!(ev && (ev.is_pinned || ev.isPinned)); }
  function ruleOf(ev) {
    if (!ev) return null;
    var t = fieldOf(ev, 'repeatType', 'repeat_type') || 'none';
    var ivRaw = fieldOf(ev, 'repeatInterval', 'repeat_interval');
    var iv = Math.max(1, parseInt(ivRaw, 10) || 1);
    if (t === 'none') return null;
    if (t === 'custom') {
      var u = String(fieldOf(ev, 'repeatUnit', 'repeat_unit') || '').toLowerCase();
      return UNITS.indexOf(u) < 0 ? null : { unit: u, interval: iv };
    }
    return UNITS.indexOf(t) < 0 ? null : { unit: t, interval: iv };
  }
  function hasRule(ev) { return !!ruleOf(ev); }

  /* 第 n 次发生日（n 从 0 起：n=0 即初始日） */
  function nthOccurrence(baseStr, rule, n) {
    var d0 = toDate(baseStr);
    if (!d0 || !rule) return null;
    var k = Math.max(0, parseInt(n, 10) || 0) * rule.interval;
    if (rule.unit === 'day')   return toStr(addDays(d0, k));
    if (rule.unit === 'week')  return toStr(addDays(d0, k * 7));
    if (rule.unit === 'month') return toStr(addMonthsKeep(d0, k));
    return toStr(addYearsKeep(d0, k));
  }

  /* 下一次发生日：>= 今天 的最早一次；无重复规则返回 null */
  function nextOccurrence(ev, todayStr) {
    var rule = ruleOf(ev);
    if (!rule) return null;
    var base = toDate(ev && ev.date);
    var t = toDate(todayStr || today());
    if (!base || !t) return null;
    if (base.getTime() >= t.getTime()) return toStr(base);

    var n;
    if (rule.unit === 'day')        n = Math.floor(daysBetween(base, t) / rule.interval);
    else if (rule.unit === 'week')  n = Math.floor(daysBetween(base, t) / (rule.interval * 7));
    else if (rule.unit === 'month') n = Math.floor(((t.getFullYear() - base.getFullYear()) * 12 + (t.getMonth() - base.getMonth())) / rule.interval);
    else                            n = Math.floor((t.getFullYear() - base.getFullYear()) / rule.interval);
    if (!isFinite(n) || n < 0) n = 0;

    var occ = nthOccurrence(ev.date, rule, n), guard = 0;
    while (occ && toDate(occ).getTime() < t.getTime() && guard++ < 5000) occ = nthOccurrence(ev.date, rule, ++n);
    guard = 0;
    while (n > 0 && guard++ < 5000) {   /* 估算可能偏大 → 回退到仍 >= 今天 的最早一次 */
      var prev = nthOccurrence(ev.date, rule, n - 1);
      if (prev && toDate(prev).getTime() >= t.getTime()) { n--; occ = prev; } else break;
    }
    return occ;
  }

  /* 事件状态（实时计算）
     kind: 'upcoming'（还没到 / 一次性未来）| 'ongoing'（已经发生 · 会再发生）| 'ended'（一次性已过去）
     只有「不重复」的事件才可能 ended；重复事件永不 ended。 */
  function stateOf(ev, todayStr) {
    var t = toDate(todayStr || today());
    var base = toDate(ev && ev.date);
    if (!t || !base) return { kind: 'upcoming', daysSince: 0, daysLeft: 0, nextDate: null, hasRule: false };
    var rule = ruleOf(ev);
    var daysSince = daysBetween(base, t);
    if (!rule) {
      if (daysSince > 0) return { kind: 'ended', daysSince: daysSince, daysLeft: null, nextDate: null, hasRule: false };
      return { kind: 'upcoming', daysSince: daysSince, daysLeft: Math.abs(daysSince), nextDate: toStr(base), hasRule: false };
    }
    var next = nextOccurrence(ev, todayStr);
    return {
      kind: daysSince < 0 ? 'upcoming' : 'ongoing',
      daysSince: daysSince,
      daysLeft: next ? daysBetween(t, next) : null,
      nextDate: next,
      hasRule: true
    };
  }

  /* 文案：已结束 / 还有 X 天 / 已经 X 天（+ 下次还有 X 天） */
  function daysText(ev, todayStr) {
    var st = stateOf(ev, todayStr);
    if (st.kind === 'ended') return { main: '已结束', sub: '', cls: 'ended', state: st };
    if (st.kind === 'upcoming') {
      if (!st.daysLeft) return { main: '就是今天', sub: '', cls: 'upcoming', state: st };
      return { main: '还有 ' + st.daysLeft + ' 天', sub: '', cls: 'upcoming', state: st };
    }
    return {
      main: '已经 ' + st.daysSince + ' 天',
      sub: (st.daysLeft != null ? '下次还有 ' + st.daysLeft + ' 天' : ''),
      cls: 'ongoing', state: st
    };
  }

  function repeatLabel(ev) {
    var t = fieldOf(ev, 'repeatType', 'repeat_type') || 'none';
    if (t === 'day') return '每天';
    if (t === 'week') return '每周';
    if (t === 'month') return '每月';
    if (t === 'year') return '每年';
    if (t !== 'custom') return '不重复';
    var r = ruleOf(ev);
    return r ? ('每 ' + r.interval + ' ' + UNIT_LABEL[r.unit]) : '不重复';
  }

  /* 排序比较器：① 置顶优先 ② 未结束优先（ongoing → upcoming → ended）
     ③ 未结束按「下一次发生日」升序；已结束按「最近结束」在前 */
  function cmp(a, b, todayStr) {
    var pa = isPinnedOf(a) ? 0 : 1, pb = isPinnedOf(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    var sa = stateOf(a, todayStr), sb = stateOf(b, todayStr);
    var wa = sa.kind === 'ended' ? 2 : (sa.kind === 'upcoming' ? 1 : 0);
    var wb = sb.kind === 'ended' ? 2 : (sb.kind === 'upcoming' ? 1 : 0);
    if (wa !== wb) return wa - wb;
    if (wa === 2) return String(b.date || '').localeCompare(String(a.date || ''));
    var na = sa.nextDate || a.date || '', nb = sb.nextDate || b.date || '';
    if (na !== nb) return String(na).localeCompare(String(nb));
    return String(a.date || '').localeCompare(String(b.date || ''));
  }
  function sortEvents(list, todayStr) {
    return (list || []).slice().sort(function (a, b) { return cmp(a, b, todayStr); });
  }
  /* 「最重要的一条」= 排序后的第一条（简洁模式只显示它） */
  function mostImportant(list, todayStr) { return sortEvents(list, todayStr)[0] || null; }

  window.WBTime = {
    /* 基础日期工具（本地日历日） */
    pad2: pad2, toDate: toDate, toStr: toStr, fmtDot: fmtDot, today: today,
    isLeap: isLeap, daysInMonth: daysInMonth, daysBetween: daysBetween,
    addDays: addDays, addMonthsKeep: addMonthsKeep, addYearsKeep: addYearsKeep,
    /* 重复规则引擎 */
    UNITS: UNITS, UNIT_LABEL: UNIT_LABEL,
    ruleOf: ruleOf, hasRule: hasRule,
    nthOccurrence: nthOccurrence, nextOccurrence: nextOccurrence,
    stateOf: stateOf, daysText: daysText, repeatLabel: repeatLabel,
    sortEvents: sortEvents, mostImportant: mostImportant
  };
})();
