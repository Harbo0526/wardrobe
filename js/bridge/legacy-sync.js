/* Wardrobe 前端切换桥接层（Phase 14）
 * 职责：
 *  1) 登录后用 DAL 加载全部模块 → 适配进旧 UI 的内存 state（字段名转换）
 *  2) 旧 UI 保存/删除点的单条 DAL 同步（create 用客户端 UUID，id 与 DB 一致）
 *  3) 图片经 private Storage DAL 上传/异步补齐
 * 旧 Gitee 同步函数（pushUserData 等）在本层不被调用，仅作为回滚代码保留。
 */
(function () {
  const { CODES, wbError } = window.WBErrors;

  window.wbUuid = function () {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  };

  function toastErr(e, fallback) {
    try { const n = window.WBErrors.normalize(e); toast(n.message || fallback); }
    catch (_) { toast(fallback); }
  }

  /* v5.4.6：模块缺失守卫。历史故障：线上 js/ 目录停留在旧版（DAL 无 fuel 模块），
     sbSaveObj 取到 undefined 后同步抛出 TypeError，异常逃出 onclick 被浏览器吞掉 →
     用户以为"已保存"，实际从未上云，重开程序记录即消失。现改为显式提示 + 安全返回，绝不静默。 */
  function requireApi(module, action) {
    const api = window.WBData && window.WBData[module];
    if (!api || typeof api[action] !== 'function') {
      const m = '前端脚本版本过旧：缺少「' + module + '」模块，本次操作未同步云端。请刷新页面；若仍不行，说明 js/ 目录未随版本部署';
      try { console.error('[脚本版本] ' + m); } catch (e) {}
      try { toast(m); } catch (e) {}
      return null;
    }
    return api;
  }

  /* 新对象（id=客户端 UUID）→ create；已同步对象（_sbSaved）→ update。
   * payload 为 DB 字段名（不含 id）；失败 toast 不阻塞内存 UI。 */
  window.sbSaveObj = function (module, localObj, payload) {
    if (!localObj || !localObj.id) return Promise.resolve();
    const api = requireApi(module, 'create');
    if (!api) return Promise.resolve();
    const p = Object.assign({}, payload); delete p.id; delete p.user_id;
    const isNew = !localObj._sbSaved;
    let pr;
    try {
      pr = isNew ? api.create(Object.assign({ id: localObj.id }, p)) : api.update(localObj.id, p);
    } catch (e) {   /* 同步异常（参数/校验）同样不得逃出调用栈 */
      toastErr(e, '云端保存失败');
      return Promise.resolve();
    }
    return Promise.resolve(pr).then(function (r) {
      if (r.error) throw r.error;
      localObj._sbSaved = true;
    }).catch(function (e) { toastErr(e, '云端保存失败'); });
  };

  window.sbRemoveObj = function (module, localObj) {
    if (!localObj || !localObj.id) return Promise.resolve();
    const api = requireApi(module, 'remove');
    if (!api) return Promise.resolve();
    let pr;
    try {
      pr = api.remove(localObj.id);
    } catch (e) {
      toastErr(e, '云端删除失败');
      return Promise.resolve();
    }
    return Promise.resolve(pr).then(function (r) {
      if (r.error) throw r.error;
      if (localObj) localObj._sbSaved = false;
    }).catch(function (e) { toastErr(e, '云端删除失败'); });
  };

  window.dataUrlToBlob = function (dataUrl) {
    const arr = dataUrl.split(',');
    const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    const u8 = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
    return new Blob([u8], { type: mime });
  };

  /* v5.6.7 新用户空分组 → 播种 5 个初始化分组；v5.14.1 修复「版本更新后莫名多出一批初始化分组」。
     ------------------------------------------------------------------
     旧实现为什么出错：唯一开关是「localStorage 标记 + 当前 state.groups 为空」——
       ① 用户在浏览器里「清除站点数据」（更新版本时的常规操作）→ 标记就没了；
       ② 更关键：sbLoadAll() 是**按模块容错**的，**分组模块加载失败/超时时 gl=[]**，
          于是 state.groups 变成空数组，被误判成「新用户空分组」→ 直接往云端灌 5 个分组；
       ③ localStorage 不跨设备，换手机/换浏览器同理。
     现在改为三重闸门，任何一条不满足都**绝不播种**：
       ① okEmpty：必须「分组模块本次加载成功」且服务端确实返回 0 条（由调用方显式传入）；
       ② profiles.groups_seeded（v5.14.1 新增，服务端权威）：同账号全设备只播种一次；
       ③ 本机 localStorage 标记（快路径，省一次网络往返）。
     失败/读不到标记一律「不播种」——宁可让极少数真新用户看到空分组页，也绝不重复灌数据。 */
  var DEFAULT_GROUPS = [
    { name: '上衣', emoji: '👕' },
    { name: '下装', emoji: '👖' },
    { name: '球鞋', emoji: '👟' },
    { name: '外套', emoji: '🧥' },
    { name: '连衣裙', emoji: '👗' }
  ];
  async function seedDefaultGroups(okEmpty) {
    if (!okEmpty) return;                                          /* 闸门①：模块没加载成功 / 服务端非空 */
    if (state.groups && state.groups.length) return;                /* 已有分组则跳过 */
    var uid = (state.user && state.user.id) || null;
    if (!uid) return;
    var flagKey = 'wardrobe.v1.seededGroups.' + uid;
    try { if (localStorage.getItem(flagKey)) return; } catch (e) {}  /* 闸门③：本机已播过 */
    try {
      var db = window.getSupabaseClient ? window.getSupabaseClient()
             : (typeof getSupabaseClient === 'function' ? getSupabaseClient() : null);
      if (!db) return;
      /* 闸门②：服务端权威标记（读不到 → 宁可不播种） */
      var p = await db.from('profiles').select('groups_seeded').eq('id', uid).maybeSingle();
      if (!p || p.error) return;
      if (p.data && p.data.groups_seeded) {
        try { localStorage.setItem(flagKey, '1'); } catch (e) {}     /* 服务端已播过 → 只补本机标记 */
        return;
      }
      /* 先把服务端标记写为 true 再播种：万一中途失败，也只是少几个分组，绝不会重复播种 */
      var u = await db.from('profiles').update({ groups_seeded: true }).eq('id', uid);
      if (!u || u.error) return;
      try { localStorage.setItem(flagKey, '1'); } catch (e) {}
    } catch (e) { return; }                                         /* 任何异常 → 不播种 */
    try {
      DEFAULT_GROUPS.forEach(function (d, i) {
        var g = { id: wbUuid(), name: d.name, emoji: d.emoji, _sbSaved: false };
        state.groups.push(g);
        sbSaveObj('groups', g, { name: d.name, emoji: d.emoji, sort_order: i });
      });
    } catch (e) { /* 容错 */ }
  }

  /* ============ 登录后全量加载（新用户 = 空账户） ============ */
  window.sbLoadAll = async function () {
    const D = window.WBData;
    // 会话隔离：记录开始时的代际 + user ID；加载完成（含网络往返）后若不仍匹配则丢弃结果，
    // 避免「登出 → 切号」后旧用户的业务数据回写新用户 UI。
    const gen = WBSession.getSessionGeneration();
    const uid = (state.user && state.user.id) || null;
    toast('正在加载云端数据…');
    /* v5.4.6：按模块容错加载——单个模块查询失败/模块缺失不再让整批数据变空。
       （历史故障：部署遗漏导致 Promise.all 整体 reject → 全部模块都显示为空数据。） */
    const MODULE_LOAD = [
      ['衣橱分组', 'groups'], ['衣物', 'clothes'], ['调酒材料', 'materials'], ['调酒配方', 'recipes'],
      ['配方明细', 'recipeItems'], ['记账', 'ledger'], ['记账预算', 'ledgerBudgets'],
      ['睡眠', 'sleep'], ['备忘', 'memos'], ['油费', 'fuel'], ['公告', 'announcements'],
      ['待办', 'todos'],  /* v5.9.2：待办清单（独立模块；按模块容错，缺失/失败不影响其它模块） */
      ['时光', 'timeEvents']   /* v5.28.0：时光（事件 + 初始日期 + 重复规则；派生天数实时计算） */
    ];
    const failedModules = [];
    /* v5.14.1：只有「分组模块本次真的成功返回」才允许播种初始化分组（必须区别于「失败返回空数组」） */
    let groupsOk = false;
    const res = await Promise.all(MODULE_LOAD.map(function (m) {
      const label = m[0], mod = m[1];
      const api = D && D[mod];
      if (!api || typeof api.list !== 'function') {
        failedModules.push(label + '（模块缺失）');
        return Promise.resolve([]);
      }
      return Promise.resolve()
        .then(function () { return api.list({ limit: 500 }); })
        .then(function (rows) {
          if (mod === 'groups') groupsOk = true;    /* 成功拿到结果（哪怕是空数组） */
          return rows;
        })
        .catch(function (e) {
          failedModules.push(label);
          console.warn('[云端加载] ' + label + ' 失败：', e);
          return [];
        });
    }));
    if (failedModules.length) {
      const m = '部分模块云端加载失败：' + failedModules.join('、') + '（其余数据正常）';
      console.warn('[云端加载] ' + m);
      toast(m);
    }
    const gl = res[0], cl = res[1], mats = res[2], recs = res[3], ritems = res[4], led = res[5], bud = res[6], slp = res[7], mem = res[8], fue = res[9], ann = res[10], tdo = res[11], tme = res[12];

    /* 分组（id 即 UUID，旧 UI 的内联调用点已加引号适配） */
    state.groups = gl.map(function (x) {
      return { id: x.id, name: x.name, emoji: x.emoji || '👕', _sbSaved: true };
    });

    /* 衣物：旧字段适配；图片异步经 Storage 补齐（objectURL 仅本次会话） */
    state.clothes = cl.map(function (x) {
      const gids = x._groupIds || [];
      return {
        id: x.id, name: x.name, group: gids[0] || null, groups: gids,
        note: x.note || '', img: null, imgRemote: x.image_path || null,
        _image_path: x.image_path || null, emoji: x.emoji || '👕', tint: x.tint || '#EAF5EC',
        _sbSaved: true
      };
    });

    /* 调酒：材料/配方/配方材料关系（字段名转换 cat→category、vol→volume_ml、totalVol→total_volume_ml） */
    state.cocktail = {
      seeded: true,
      materials: mats.map(function (x) {
        return { id: x.id, name: x.name, cat: x.category || '', abv: Number(x.abv) || 0, price: Number(x.price) || 0, vol: Number(x.volume_ml) || 0, _sbSaved: true };
      }),
      recipes: recs.map(function (x) {
        return { id: x.id, name: x.name, items: [], totalVol: Number(x.total_volume_ml) || 0, totalCost: Number(x.total_cost) || 0, abv: Number(x.abv) || 0, ts: x.created_at ? Date.parse(x.created_at) : Date.now(), note: x.note || '', imgRemote: x.image_path || null, img: null, _image_path: x.image_path || null, _sbSaved: true };
      })
    };
    const matOk = {};
    state.cocktail.materials.forEach(function (m) { matOk[m.id] = true; });
    ritems.forEach(function (it) {
      const rec = state.cocktail.recipes.find(function (r) { return r.id === it.recipe_id; });
      if (rec && matOk[it.material_id]) rec.items.push({ matId: it.material_id, vol: Number(it.quantity) || 0 });
    });

    /* 记账（type 内存/DB 同为 inc|exp；cat→category） */
    state.ledger = { records: [], seeded: true, budgets: {}, deleted: [], _budgetIds: {} };
    led.forEach(function (x) {
      const legacy = x.legacy_id || '';
      state.ledger.records.push({
        id: x.id, date: x.record_date, type: x.type, amount: Number(x.amount) || 0,
        cat: x.category || '', note: x.note || '', createdAt: x.created_at, _sbSaved: true,
        /* v5.5.0：由油费同步生成的记账记录在 legacy_id 里带 'fuel:<油费id>'，
           读回时还原为 fuelId，删除油费记录时据此联动删除该笔支出。 */
        fuelId: legacy.indexOf('fuel:') === 0 ? legacy.slice(5) : undefined
      });
    });
    bud.forEach(function (x) {
      const key = x.year + '-' + String(x.month).padStart(2, '0');
      state.ledger.budgets[key] = Number(x.amount) || 0;
      state.ledger._budgetIds[key] = x.id;
    });

    /* 睡眠（双轨字段：record_date/start_time/end_time/end_date/duration_minutes；sleep_at/wake_at 暂 NULL） */
    state.sleep = {
      records: slp.map(function (x) {
        return { id: x.id, date: x.record_date, start: (x.start_time || '').slice(0, 5), end: (x.end_time || '').slice(0, 5), endDate: x.end_date || undefined, minutes: x.duration_minutes || 0, note: x.note || '', createdAt: x.created_at, _sbSaved: true };
      }), deleted: []
    };

    /* 油电费（v5.3.0 油费 / v5.26.0 加充电）：record_date/amount/unit_price/volume/kind/note
       kind 缺失（v5.26.0 之前写入的历史行，理论上已被迁移回填）→ 兜底 'fuel' */
    state.fuel = {
      records: fue.map(function (x) {
        return { id: x.id, date: x.record_date, amount: Number(x.amount) || 0,
                 price: (x.unit_price == null ? null : Number(x.unit_price)),
                 vol: (x.volume == null ? null : Number(x.volume)),
                 kind: (x.kind === 'charge' ? 'charge' : 'fuel'),
                 note: x.note || '', createdAt: x.created_at, _sbSaved: true };
      }), deleted: []
    };

    /* 备忘（at 语义保存在 legacy_id；title=标题；_id 供删除/编辑定位）
       v5.13.12：提醒字段与 todos 同构 —— reminderAt/reminderStatus 前端写，
                 reminderSentAt 服务端回写（前端只读） */
    state.memos = {
      memos: mem.map(function (x) {
        return { t: x.content || '', title: x.title || '',
                 at: Number(x.legacy_id) || Date.parse(x.created_at) || Date.now(),
                 reminderAt: x.reminder_at || null,
                 reminderStatus: x.reminder_status || 'none',
                 reminderSentAt: x.reminder_sent_at || null,
                 _id: x.id, _sbSaved: true };
      }).filter(function (m) { return !isNaN(m.at); }).sort(function (a, b) { return b.at - a.at; }),
      deleted: []
    };

    /* v5.6.0 公告：全局共享（所有登录用户可读）；按发布时间倒序，最新在前 */
    state.announcements = (ann || []).map(function (x) {
      return { id: x.id, title: x.title || '', body: x.body || '', version: x.version || '',
               at: x.published_at || x.created_at || null, _sbSaved: true };
    }).filter(function (a) { return !!a.body; });
    state.announcements.sort(function (a, b) {
      return String(b.at || '').localeCompare(String(a.at || ''));
    });

    /* v5.9.2 待办清单（独立模块）：type='daily'|'temporary'、business_date=每日待办业务日期、
       done/done_at=完成状态与时间；提醒字段 reminder_at/reminder_status 由前端写、
       reminder_sent_at 由服务端回写（前端只读）。 */
    state.todos = {
      records: (tdo || []).map(function (x) {
        return {
          id: x.id,
          type: x.type || 'temporary',
          content: x.content || '',
          businessDate: x.business_date || null,
          templateId: x.template_id || null,
          done: !!x.done,
          doneAt: x.done_at || null,
          reminderAt: x.reminder_at || null,
          reminderStatus: x.reminder_status || 'none',
          reminderSentAt: x.reminder_sent_at || null,
          createdAt: x.created_at || '',
          _sbSaved: true
        };
      }),
      deleted: []
    };

    /* v5.28.0「时光」：事件 + 初始日期 + 重复规则。
       派生值（daysSince / daysLeft / nextDate / ended）**不落库、不缓存**，
       一律由 js/services/time.js 按 date + repeat_* + 今天实时计算。 */
    state.timeEvents = {
      records: (tme || []).map(function (x) {
        return {
          id: x.id,
          title: x.title || '',
          date: x.date || '',
          repeatType: x.repeat_type || 'none',
          repeatInterval: Number(x.repeat_interval) || 1,
          repeatUnit: x.repeat_unit || null,
          icon: x.icon || '📅',
          note: x.note || '',
          isPinned: !!x.is_pinned,
          createdAt: x.created_at || '',
          _sbSaved: true
        };
      }),
      deleted: []
    };

    /* 会话隔离：加载耗时较长，完成时若已切换用户则丢弃整批结果（不写 state / 不渲染 / 不补图） */
    if (gen !== WBSession.getSessionGeneration() || !state.user || state.user.id !== uid) return;

    /* v5.28.0：首页焦点卡置顶（profiles.hero_pinned = 'quote' | 'time:<uuid>' | null）。
       必须是**独立读取**：它不属于 sbLoadAll 的业务模块装载表，失败也不能影响其它模块；
       且必须在下面 renderHome() 之前拿到值，否则首页会先渲染成默认页再跳页（可见闪动）。 */
    try {
      const pr = await getSupabaseClient().from('profiles').select('hero_pinned').eq('id', uid).maybeSingle();
      state.heroPinned = (pr && pr.data && pr.data.hero_pinned) || null;
    } catch (e) {
      state.heroPinned = null;   /* 读取失败 → 回到默认第一页（励志语句），不报错打断加载 */
    }

    /* v5.6.7 / v5.14.1：仅当「分组模块本次加载成功」且「服务端确实 0 条」才播种初始化分组。
       加载失败时 gl=[] 绝不能被当成「新用户空分组」（旧实现据此反复灌数据，是本 bug 根因）。 */
    try { seedDefaultGroups(groupsOk && gl.length === 0).catch(function () { }); } catch (e) { /* 容错 */ }

    /* 渲染 */
    try {
      renderHome();
      renderGroupManage();
      renderGroupChips();
      renderMemos();
      if (typeof ckRenderAll === 'function') ckRenderAll();
    } catch (e) { /* 渲染容错，不阻塞 */ }

    /* v5.4.6：按需刷新当前可见面板——若用户在云端加载完成前就切到记账/睡眠（含油费）面板，
       该面板会停留在加载前的旧数据（表现为"刚保存的记录不见了"）。数据到达后按当前面板重渲染一次。 */
    try {
      const cur = document.querySelector('.screen.active');
      const sid = cur ? cur.id : '';
      if (sid === 'screen-ledger' && typeof lgSwitch === 'function') {
        lgSwitch(typeof lgState !== 'undefined' && lgState.panel ? lgState.panel : 'overview');
      } else if (sid === 'screen-sleep' && typeof spSwitch === 'function') {
        spSwitch(typeof spState !== 'undefined' && spState.panel ? spState.panel : 'overview');
      }
    } catch (e) { /* 渲染容错，不阻塞 */ }

    /* v5.6.0：公告自动弹（有未读公告才弹、同一次会话只弹一次；放在其它渲染之后，避免被遮挡） */
    try {
      if (typeof maybeShowAnnouncement === 'function') maybeShowAnnouncement();
    } catch (e) { /* 容错，不阻塞 */ }

    hideLegacyCloudUI();
    /* 异步补图（衣物 + 配方；objectURL 仅本次会话有效） */
    sbPullImages();
    toast('云端数据已加载 ✓');
  };

  /* 停用旧 Gitee 同步入口（保留 DOM 供回滚，主流程不可见/不可点） */
  window.hideLegacyCloudUI = function () {
    ['ckSync', 'ckPull', 'lgHeaderSync', 'spHeaderSync', 'lgPullCloudBtn', 'lgPushCloudBtn', 'clHeaderSync', 'clPullBtn', 'clPushBtn'].forEach(function (id) {
      const b = document.getElementById(id);
      if (b) { b.hidden = true; b.onclick = null; }
    });
    const tb = document.querySelector('.token-block'); if (tb) tb.hidden = true;
  };

  /* 私有图片异步补齐（有 image_path 且本地无 img）。
   * 会话隔离：回写前校验代际 + user ID，旧用户的图片下载结果（可能在切号后到达）一律丢弃并释放 objectURL，
   * 禁止旧用户私有图片闪现到新用户 UI。 */
  window.sbPullImages = function () {
    const gen = WBSession.getSessionGeneration();
    const uid = (state.user && state.user.id) || null;
    state.clothes.forEach(function (c) {
      if (!c._image_path || c.img || c._imgLoading) return;
      c._imgLoading = true;
      window.WBImages.downloadClothImage(c.id).then(function (r) {
        if (gen !== WBSession.getSessionGeneration() || !state.user || state.user.id !== uid) {
          try { URL.revokeObjectURL(r.objectUrl); } catch (e) {}
          return; /* 过期结果：丢弃 */
        }
        c.img = r.objectUrl;
        c._objectUrl = r.objectUrl;
        rerenderAfterImage();
      }).catch(function () { c._imgLoading = false; });
    });
    (state.cocktail && state.cocktail.recipes ? state.cocktail.recipes : []).forEach(function (r) {
      if (!r._image_path || r.img || r._imgLoading) return;
      r._imgLoading = true;
      window.WBImages.downloadCocktailImage(r.id).then(function (res) {
        if (gen !== WBSession.getSessionGeneration() || !state.user || state.user.id !== uid) {
          try { URL.revokeObjectURL(res.objectUrl); } catch (e) {}
          return; /* 过期结果：丢弃 */
        }
        r.img = res.objectUrl;
        r._objectUrl = res.objectUrl;
        rerenderAfterImage();
      }).catch(function () { r._imgLoading = false; });
    });
  };

  function rerenderAfterImage() {
    try {
      const active = document.querySelector('.screen.active');
      const id = active ? active.id : '';
      if (id === 'screen-home') renderHome();
      else if (id === 'screen-cloth') { renderGroupChips(); }
      else if (id === 'screen-cocktail' && typeof ckRenderRecs === 'function') ckRenderRecs();
    } catch (e) { /* 容错 */ }
  }

  /* 保存衣物图片：dataURL → Storage（upsert 覆盖 = 更换图片语义） */
  window.sbUploadClothImageFor = function (cloth) {
    if (!cloth || !cloth.img || cloth.img.indexOf('data:') !== 0) return Promise.resolve();
    return window.WBImages.uploadClothImage(cloth.id, window.dataUrlToBlob(cloth.img))
      .then(function (r) {
        cloth._image_path = r.path;
        cloth.imgRemote = r.path;
        return window.WBData.clothes.update(cloth.id, { image_path: r.path });
      })
      .then(function (r) { if (r.error) throw r.error; cloth._sbSaved = true; })
      .catch(function (e) { toastErr(e, '图片上传失败'); });
  };
  window.sbUploadCocktailImageFor = function (recipe) {
    if (!recipe || !recipe.img || recipe.img.indexOf('data:') !== 0) return Promise.resolve();
    return window.WBImages.uploadCocktailImage(recipe.id, window.dataUrlToBlob(recipe.img))
      .then(function (r) {
        recipe._image_path = r.path;
        recipe.imgRemote = r.path;
        return window.WBData.recipes.update(recipe.id, { image_path: r.path });
      })
      .then(function (r) { if (r.error) throw r.error; recipe._sbSaved = true; })
      .catch(function (e) { toastErr(e, '图片上传失败'); });
  };
})();
