/* ============================================================================
 * 油费趋势前端模块
 * ----------------------------------------------------------------------------
 * 原则（必须遵守）：
 *  1. 前端只读 Supabase 中已处理好的公开数据，绝不调用第三方油价/原油/汇率 API。
 *  2. API Key / AI Key 一律不进前端（存在 Supabase Secrets，由 Edge Function 服务端使用）。
 *  3. 实际油价(fuel_prices) 与 AI 预测(fuel_predictions) 严格分离展示。
 *  4. 无可靠数据时显示「暂无可靠预测 / 数据源尚未更新」，绝不写死示例数据。
 *  5. 每日更新由 Supabase pg_cron → Edge Function 完成，前端不轮询第三方源。
 *  6. 数据粒度：当前数据源仅【省级】。城市仅作「用户所在地」标记，
 *     实际油价始终取「所属省份」的省级数据 region_code，绝不伪造城市级油价。
 * ==========================================================================*/
(function () {
  'use strict';

  var T = {
    prices: 'fuel_prices',
    history: 'fuel_price_history',
    pred: 'fuel_predictions',
    logs: 'fuel_update_logs',
    regions: 'regions'          // 行政区划基础表（可选；缺失时回退内置数据）
  };
  var LS_REGION = 'wb_fuel_region';   // {province, region_code, city}

  /* 省份 → GB/T 2260 稳定行政区划编码（region_code 权威值；与 Edge Function 保持一致） */
  var PROVINCE_CODE = {
    '北京': '110000', '天津': '120000', '河北': '130000', '山西': '140000', '内蒙古': '150000',
    '辽宁': '210000', '吉林': '220000', '黑龙江': '230000', '上海': '310000', '江苏': '320000',
    '浙江': '330000', '安徽': '340000', '福建': '350000', '江西': '360000', '山东': '370000',
    '河南': '410000', '湖北': '420000', '湖南': '430000', '广东': '440000', '广西': '450000',
    '海南': '460000', '重庆': '500000', '四川': '510000', '贵州': '520000', '云南': '530000',
    '西藏': '540000', '陕西': '610000', '甘肃': '620000', '青海': '630000', '宁夏': '640000',
    '新疆': '650000', '台湾': '710000', '香港': '810000', '澳门': '820000'
  };

  /* 内置回退：省份 → 城市列表（仅作「用户所在地」选项，非价格来源）。
     权威来源为 regions 表（存在时用其覆盖 city 列表）。 */
  var CITY_FALLBACK = {
    '北京': ['北京'], '天津': ['天津'], '上海': ['上海'], '重庆': ['重庆'],
    '河北': ['石家庄', '保定', '雄安新区', '唐山', '邯郸', '廊坊'],
    '山西': ['太原', '大同', '临汾'], '内蒙古': ['呼和浩特', '包头', '鄂尔多斯'],
    '辽宁': ['沈阳', '大连', '鞍山'], '吉林': ['长春', '吉林'], '黑龙江': ['哈尔滨', '大庆'],
    '江苏': ['南京', '苏州', '无锡', '徐州'], '浙江': ['杭州', '宁波', '温州', '嘉兴'],
    '安徽': ['合肥', '芜湖', '马鞍山'], '福建': ['福州', '厦门', '泉州'],
    '江西': ['南昌', '赣州'], '山东': ['济南', '青岛', '烟台', '潍坊'],
    '河南': ['郑州', '洛阳', '开封'], '湖北': ['武汉', '宜昌', '襄阳'],
    '湖南': ['长沙', '株洲', '岳阳'], '广东': ['广州', '深圳', '东莞', '佛山'],
    '广西': ['南宁', '柳州', '桂林'], '海南': ['海口', '三亚'],
    '四川': ['成都', '绵阳', '德阳'], '贵州': ['贵阳', '遵义'],
    '云南': ['昆明', '大理'], '西藏': ['拉萨'], '陕西': ['西安', '咸阳'],
    '甘肃': ['兰州', '天水'], '青海': ['西宁'], '宁夏': ['银川'],
    '新疆': ['乌鲁木齐', '克拉玛依'], '香港': ['香港'], '澳门': ['澳门'], '台湾': ['台北']
  };

  var DEFAULT_REGION = { province: '河北', region_code: '130000', city: '雄安新区' };
  var fuelRange = 30;

  var regionsLoaded = false;      // regions 表是否已尝试加载
  var regionCities = {};          // province -> [city...]（来自 regions 表）

  function client() {
    try { return (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null; }
    catch (e) { return null; }
  }
  function readLS() {
    try { return JSON.parse(localStorage.getItem(LS_REGION) || 'null'); } catch (e) { return null; }
  }
  function writeLS(o) {
    try { localStorage.setItem(LS_REGION, JSON.stringify(o)); } catch (e) {}
  }
  function codeOf(prov) { return PROVINCE_CODE[prov] || null; }
  function curRegion() {
    var r = readLS() || { province: DEFAULT_REGION.province, city: DEFAULT_REGION.city };
    if (!r.province) r.province = DEFAULT_REGION.province;
    if (!r.region_code) r.region_code = codeOf(r.province) || DEFAULT_REGION.region_code;
    if (typeof r.city !== 'string') r.city = '';
    return r;
  }

  /* ---------- 行政区划基础数据：优先 regions 表，缺失回退内置 ---------- */
  function loadRegions() {
    if (regionsLoaded) return Promise.resolve();
    var c = client(); if (!c) return Promise.resolve();
    return c.from(T.regions).select('region_code,province,city,parent_code,level').then(function (r) {
      if (r && !r.error && Array.isArray(r.data)) {
        r.data.forEach(function (x) {
          if (x && x.level === 'city' && x.province && x.city) {
            (regionCities[x.province] = regionCities[x.province] || []).push(x.city);
          }
          // 省份行如提供编码，则以表为权威
          if (x && x.level === 'province' && x.province && x.region_code) {
            PROVINCE_CODE[x.province] = String(x.region_code);
          }
        });
      }
      regionsLoaded = true;
    }).catch(function () { regionsLoaded = true; /* regions 表不存在 → 用内置回退 */ });
  }

  /* ---------- 选择器 ---------- */
  function fillProvinces() {
    var sel = document.getElementById('fuelProvince');
    if (!sel) return;
    sel.innerHTML = '';
    Object.keys(PROVINCE_CODE).forEach(function (p) {
      var o = document.createElement('option'); o.value = p; o.textContent = p; sel.appendChild(o);
    });
  }
  function citiesOf(prov) {
    if (regionCities[prov] && regionCities[prov].length) return regionCities[prov];
    return CITY_FALLBACK[prov] || [prov];
  }
  function fillCities(prov) {
    var sel = document.getElementById('fuelCity');
    if (!sel) return;
    sel.innerHTML = '';
    citiesOf(prov).forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    var op = document.createElement('option'); op.value = ''; op.textContent = '全省/直辖市'; sel.appendChild(op);
  }
  function syncRegionUI() {
    var r = curRegion();
    var ps = document.getElementById('fuelProvince');
    if (ps && ps.options.length === 0) fillProvinces();   // 首次渲染填充省份（修复历史「下拉框为空」bug）
    if (ps) { ps.value = r.province; fillCities(r.province); }
    var cs = document.getElementById('fuelCity');
    if (cs) cs.value = r.city || '';
    updateRegionLabel();
  }
  function updateRegionLabel() {
    var r = curRegion();
    var el = document.getElementById('fuelRegionLabel');
    if (el) el.textContent = r.province + (r.city ? ' · ' + r.city : '（全省）');
  }
  function saveRegion(prov, city) {
    var rc = codeOf(prov) || '';
    if (!rc) { return; }                     // 无稳定编码 → 不落库，避免脏 region_code
    writeLS({ province: prov, region_code: rc, city: city || '' });
  }
  window.onFuelProvinceChange = function () {
    var ps = document.getElementById('fuelProvince'); var prov = ps ? ps.value : '';
    fillCities(prov);
    var cs = document.getElementById('fuelCity'); if (cs) cs.value = '';
    updateRegionLabel();
    saveRegion(prov, '');
    renderFuelTrend();
  };
  window.onFuelCityChange = function () {
    var ps = document.getElementById('fuelProvince'); var prov = ps ? ps.value : '';
    var cs = document.getElementById('fuelCity'); var city = cs ? cs.value : '';
    updateRegionLabel();
    saveRegion(prov, city);                  // 城市仅作所在地标记，不改变查询省份
    renderFuelTrend();
  };

  window.setFuelRange = function (d) {
    fuelRange = d;
    var tabs = document.querySelectorAll('#fuelTabs .fuel-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', (+tabs[i].dataset.d) === d);
    renderFuelTrend();
  };

  window.gotoFuelTrend = function () {
    if (typeof showScreen === 'function') showScreen('screen-fuel-trend');
    renderFuelTrend();
  };

  /* ---------- 数据读取（仅公开读；油价始终按省级 region_code 查询） ---------- */
  function q(tbl) { return client().from(tbl); }
  function loadPrice(regionCode) {
    return q(T.prices).select('*').eq('region_code', regionCode).maybeSingle()
      .then(function (r) { return r.error ? null : r.data; });
  }
  function loadHist(regionCode, days) {
    var from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return q(T.history).select('*').eq('region_code', regionCode).gte('effective_date', from)
      .order('effective_date', { ascending: true })
      .then(function (r) { return r.error ? [] : (r.data || []); });
  }
  function loadPred() {
    return q(T.pred).select('*').order('prediction_date', { ascending: false }).limit(1).maybeSingle()
      .then(function (r) { return r.error ? null : r.data; });
  }
  function loadLog() {
    return q(T.logs).select('*').order('run_at', { ascending: false }).limit(1).maybeSingle()
      .then(function (r) { return r.error ? null : r.data; });
  }

  /* ---------- 渲染助手 ---------- */
  function money(v) { return (v == null || isNaN(v)) ? '--' : ('¥' + (Number(v)).toFixed(2)); }
  function d10(d) { return d ? ('' + d).slice(0, 10) : '--'; }
  function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function setHTML(id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; }

  function renderCurrent(p, region) {
    if (p) {
      setText('fuel92', money(p.price_92));
      setText('fuel95', money(p.price_95));
      // 明确粒度：省级数据（不伪造城市级）
      var srcRegion = p.price_source_region || p.province || region.province;
      setHTML('fuelCurrentMeta', '当前油价采用 ' + srcRegion + ' 省级数据（数据粒度：省级）' +
        '<br>数据来源：' + (p.source || '官方公开数据') +
        '<br>生效日期：' + d10(p.effective_date) +
        '<br>更新时间：' + d10(p.updated_at));
    } else {
      setText('fuel92', '--'); setText('fuel95', '--');
      setText('fuelCurrentMeta', '该地区暂无已核验的省级油价数据（数据源尚未更新或不可用）。');
    }
  }

  function renderNext(pred) {
    var el = document.getElementById('fuelNextAdjust');
    var meta = document.getElementById('fuelNextMeta');
    if (pred && pred.next_adjust_date) {
      var days = Math.ceil((new Date(pred.next_adjust_date) - new Date()) / 86400000);
      var dd = (isNaN(days) ? '--' : (days < 0 ? '已过期' : days + '天'));
      if (el) el.textContent = '下一次调价：' + d10(pred.next_adjust_date) + '（' + dd + '）';
      if (meta) meta.textContent = '调价窗口依据国内成品油调价机制（约每 10 个工作日）。';
    } else {
      if (el) el.textContent = '暂无可靠调价日期';
      if (meta) meta.textContent = '未能从可靠来源确认下一调价窗口，请以官方公告为准。';
    }
  }

  function renderPrediction(pred) {
    var box = document.getElementById('fuelPrediction');
    var reason = document.getElementById('fuelPredReason');
    if (!box) return;
    if (!pred || pred.prediction_direction === '暂无可靠预测' || !pred.prediction_direction) {
      box.innerHTML = '<span>暂无可靠预测</span>';
      if (reason) reason.textContent = '当前市场数据或历史样本不足，AI 未生成可信预测。';
      return;
    }
    var dir = pred.prediction_direction;            // 上涨 / 下跌 / 持平
    var cls = dir === '上涨' ? 'up' : (dir === '下跌' ? 'down' : '');
    var arrow = dir === '上涨' ? '↑' : (dir === '下跌' ? '↓' : '→');
    var chg = (pred.prediction_change == null) ? '' :
      (pred.prediction_change >= 0 ? '+' : '') + Number(pred.prediction_change).toFixed(2) + ' 元/L';
    var line1 = '下一轮预计：<span class="' + cls + '">' + arrow + ' ' + (chg || dir) + '</span>';
    var line2 = (pred.prediction_price_92 != null || pred.prediction_price_95 != null)
      ? ('<br>预计 92号：' + money(pred.prediction_price_92) + '　95号：' + money(pred.prediction_price_95))
      : '';
    var conf = pred.confidence ? ('<br>AI 预测可信度：' + pred.confidence) : '';
    box.innerHTML = line1 + line2 + conf;
    if (reason) reason.textContent = pred.reason || '';
  }

  function renderChart(hist) {
    var box = document.getElementById('fuelChart');
    var note = document.getElementById('fuelChartNote');
    if (!box) return;
    if (!hist || hist.length < 2) {
      box.innerHTML = '';
      if (note) note.textContent = '暂无足够历史数据绘制趋势（需至少 2 个正式调价记录）。';
      return;
    }
    var labels = [], a92 = [], a95 = [];
    var step = Math.max(1, Math.ceil(hist.length / 12));   // 稀疏标注，避免重叠
    hist.forEach(function (h, i) {
      labels.push((i % step === 0) ? ('' + h.effective_date).slice(5) : '');
      a92.push(h.price_92); a95.push(h.price_95);
    });
    var capW = (box.clientWidth || 340);
    if (capW < 280) capW = 280;
    var svg = lgLineSVG(labels, a92, a95, '#2f9e6b', '#d98a2b', capW);
    box.innerHTML = svg;
    if (note) note.innerHTML = '绿色=92号，橙色=95号（单位：元/L）。数据来自数据库正式调价记录（省级）。';
  }

  function renderAdvice(pred) {
    var el = document.getElementById('fuelAdvice');
    if (!el) return;
    var dir = pred ? pred.prediction_direction : null;
    if (!dir || dir === '暂无可靠预测') {
      el.textContent = '当前暂无可靠预测，建议以官方最终调价公告为准。';
    } else if (dir === '上涨') {
      el.textContent = '当前预计本轮油价上涨，如果近期有较多用车需求，可以考虑在调价前提前加油。';
    } else if (dir === '下跌') {
      el.textContent = '当前预计本轮油价下降，如果当前油量充足，可以考虑推迟加油。';
    } else {
      el.textContent = '当前预计调整幅度较小，无需为了油价变化专门提前加油。';
    }
  }

  function renderStatus(log) {
    var el = document.getElementById('fuelStatus');
    if (!el) return;
    if (!log) { el.textContent = '尚未获取到后端更新记录。'; return; }
    var t = log.run_at ? ('' + log.run_at).replace('T', ' ').slice(0, 16) : '--';
    if (log.status === 'failed') {
      el.textContent = '数据更新时间：' + t + '（数据源暂时未更新，已保留上一份有效数据）';
    } else {
      el.textContent = '数据更新时间：' + t + '（状态：' + (log.status || 'ok') + '）';
    }
  }

  /* ---------- 主渲染 ---------- */
  function doRender() {
    var r = curRegion();
    syncRegionUI();
    var rc = r.region_code;                       // 始终为省级 region_code

    // 空态先铺底
    setText('fuel92', '--'); setText('fuel95', '--');
    setText('fuelNextAdjust', '—'); setText('fuelPrediction', '—');
    setText('fuelAdvice', '—');

    var c = client();
    if (!c) {
      setText('fuelCurrentMeta', '无法连接数据服务，请稍后重试。');
      return;
    }
    Promise.all([loadPrice(rc), loadHist(rc, fuelRange), loadPred(), loadLog()])
      .then(function (res) {
        renderCurrent(res[0], r);
        renderChart(res[1]);
        renderNext(res[2]);
        renderPrediction(res[2]);
        renderAdvice(res[2]);
        renderStatus(res[3]);
      })
      .catch(function (e) {
        setText('fuelCurrentMeta', '读取油价数据出错：' + (e && e.message ? e.message : e));
      });
  }

  function renderFuelTrend() {
    // 先加载行政区划基础数据（regions 表，缺失则回退内置），再渲染
    return loadRegions().then(doRender).catch(doRender);
  }

  // 暴露给全局（gotoFuelTrend 已在上面声明）
  window.renderFuelTrend = renderFuelTrend;
})();
