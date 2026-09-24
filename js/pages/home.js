/* ==========================================================================
   生活象限 · js/pages/home.js
   --------------------------------------------------------------------------
   Phase 5：Home page module（总首页 #screen-home：问候/统计卡 + 励志语录卡 + 备忘/待办卡）

   自 index.html 物理抽取（**逐字节原样迁移**）：原主内联脚本 L2329–L2466（138 行）。
   15 个成员 = 7 个函数 + 8 个绑定：
     函数：renderHome / quoteSeenKey / pickQuote / renderHomeQuote / loadQuoteLibrary /
           hardReload / homeScatter
     绑定：HOME_QUOTES · HOME_EMOJIS · QUOTE_MOOD_DATAURL · QUOTE_FALLBACK_IMG ·
           homeQuoteCurrent · homeQuoteFromCloud · homeQuotePool · homeQuoteLibTried

   v5.28.0 追加（首页焦点卡 Carousel，见文件末尾）：
     函数：homeHeroRender / homeHeroSet / homeHeroStartIndex / homeHeroBind /
           homeHeroLongPress / heroIsMinimal
     绑定：HERO_SLIDES · homeHeroIndex · homeHeroTouched · homeHeroBound · homeHeroSuppressClick
     ⚠️ 本模块**不实现任何日期算法**：时光数据与天数文案全部来自 js/pages/time.js +
        js/services/time.js（运行期懒调用，带 typeof 守卫）。
   v5.28.2 追加（简洁模式的「单条 + 上下滑动翻看」，见 homeHeroBind 之前）：
     函数：heroMiniKey / heroMiniSavedId / heroMiniItems / heroMiniRowH /
           heroMiniApplySaved / heroMiniCurrentId / heroMiniRemember / heroMiniOnScroll
     绑定：heroMiniRestoring · heroMiniScrollTimer
     · 状态存 localStorage（wb_time_mini_<账号>，视图状态、按账号隔离），
       **不复用云端 profiles.hero_pinned**，避免随手滚动覆盖用户显式设置的置顶。
   ⚠️ QUOTE_MOOD_DATAURL / QUOTE_FALLBACK_IMG 是 base64 内联图片（约 227KB），
      随块整体迁移，**未压缩 / 未拆分 / 未重编码**。

   ⚠️ 块内没有任何 parse-time 顶层语句（本候选最干净的一项）。

   ⚠️ 必须留在 index.html 的原位项（本模块不迁移、不复制）：
      · 宿主公共 UI：syncSpin / goHome / openSheet（含 sheet-group → renderGroupManage 分支）/
        closeSheet / closeSheetOnBg + iOS 键盘 IIFE
      · Router：navTo / showScreen / SCREENS / wbScreen / doAppBack / wb*Trap
      · Bubble：spawnHomeBubbles（Home 域，本轮按边界约定留 Host）
      · Auth / Persistence / Gitee / Sync / Push 全套

   ⚠️ 跨模块懒调用（保持原样，全部运行期）：
      Home → Host   ：state（读 7 / 写 0）· APP_VERSION · giteeReadJSON（语录库，legacy）
      Home → Core   ：$
      Home → Pages  ：applyAvatar(mine.js) · renderMemos(memo.js) · todoRender(todo.js)
      Host → Home   ：navTo / enterApp / goHome / refreshAfterSync → renderHome()
      Bridge → Home ：legacy-sync.js L305 / L382 → renderHome()（运行期直调）
      Pages → Home  ：js/pages/cloth.js L222 · js/pages/group.js L89/L107/L136 → renderHome()
   ⚠️ Classic Script（非 ESM）；renderHome / hardReload 仍为全局可解析标识符
      （hardReload 被 markup onclick="hardReload()" 调用）。
   ========================================================================== */
/* ---------- 5. 衣橱主页 ---------- */
function renderHome(){
  // 问候语
  const h = new Date().getHours();
  const greet = h<11 ? '早上好' : (h<14 ? '中午好' : (h<18 ? '午后好' : '晚上好'));
  $('home-greet').textContent = greet + '，' + (state.user ? state.user.name : '小绿');
  applyAvatar('home-avatar');
  $('home-date').textContent = new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});

  // 衣橱入口副标题：实时统计
  const he = $('he-cloth');
  if(he) he.textContent = state.clothes.length + ' 件衣物 · ' + state.groups.length + ' 个分组';

  /* v5.29.0：「时光」入口卡副标题不再在这里渲染 —— 原「N 个重要的日子」与焦点卡第 2 页
     （可滑动的时光事件列表）重复，现改为「最近一条的天数 + 年度进度条」，
     统一由 renderHomeSummaries() 处理（见文件末尾）。 */

  // 加菲猫首页：励志语（内建 → 云端语录库到达后更新一次）+ emoji 散射 + 备忘列表
  renderHomeQuote();
  loadQuoteLibrary();
  homeScatter();
  homeHeroRender();   /* v5.28.0：焦点卡 Carousel（第1页 励志语句 ←→ 第2页 时光）+ 圆点 */
  renderMemos();
  todoRender();   /* v5.9.2：待办清单（独立模块；内部已 try/catch，不影响首页其它渲染） */
  /* v5.29.0：功能入口卡「真实数据 + 微型可视化」（记账/睡眠/调酒/时光）
     —— 计算在各页面模块的 *HomeSummary()（纯函数）中，本函数只负责写 DOM。
     放在 todoRender() 之后：不依赖待办数据，只是沿用「先渲染既有卡片、再补数据卡」的顺序。 */
  renderHomeSummaries();

  // 页脚版本号（从 APP_VERSION 渲染，不写死在 HTML）
  var v = $('home-version');
  if(v) v.textContent = 'v' + APP_VERSION;
}

/* ---------- 总首页：励志卡 / 备忘卡（v4.3.0：云端语录库 + 意境图片跟随切换） ---------- */
const HOME_QUOTES = [
  { id: 'b1', mood: 'food',   zh: '生活就像意面，总能连在一起。', en: 'Life is like pasta - everything connects.' },
  { id: 'b2', mood: 'sleep',  zh: '今天的烦恼，先睡一觉再说。', en: 'Never put off till tomorrow what you can forget today.' },
  { id: 'b3', mood: 'food',   zh: '吃饱了才有力气做喜欢的事。', en: 'Eat well first, then chase your dreams.' },
  { id: 'b4', mood: 'love',   zh: '热爱可抵岁月漫长。', en: 'Love makes time pass slower.' },
  { id: 'b5', mood: 'strive', zh: '慢慢来，比较快。', en: 'Slow down and you will speed up.' },
  { id: 'b6', mood: 'self',   zh: '今天的你，已经很棒了。', en: 'You did great today. Keep it up.' },
  { id: 'b7', mood: 'life',   zh: '把日子过成自己喜欢的样子。', en: 'Make your days the way you love.' },
  { id: 'b8', mood: 'hope',   zh: '所有的美好都会如约而至。', en: 'All good things come in time.' }
];
const HOME_EMOJIS = ['🐱','😹','😼','😴','🍖','😋','🧀','⭐','🍊','💤','🐟','🍩'];
/* 意境 → 插画：语句带什么 mood 标签，卡片左侧圆图就切哪张（8 张与云端语录库 data/quotes.json 对应） */
/* GitHub Pages 部署只保留根目录文件（子目录 avatars/ 不部署 → 手机 404 空白），
   故意境图与基础橘猫头像一律以 base64 内联（与 app 内 Kitty 头像一致的做法） */
const QUOTE_MOOD_DATAURL = {
  sleep: "./assets/quote-sleep.jpg",
  food: "./assets/quote-food.jpg",
  love: "./assets/quote-love.jpg",
  strive: "./assets/quote-strive.jpg",
  morning: "./assets/quote-morning.jpg",
  self: "./assets/quote-self.jpg",
  life: "./assets/quote-life.jpg",
  hope: "./assets/quote-hope.jpg"
};
const QUOTE_FALLBACK_IMG = "./assets/quote-fallback-cat.jpg";
let homeQuoteCurrent = null;     // 当前语录（v4.3.1 修复：选句与渲染分离——启动期 renderHome 被同步链路多次调用，重绘只显示同一句，绝不重选）
let homeQuoteFromCloud = false;  // 当前语录是否已来自云端库（保证会话内最多切换一次）
let homeQuotePool = null;        // 云端语录库缓存（会话内）
let homeQuoteLibTried = false;   // 云端语录库每次启动只拉一次
function quoteSeenKey(){ return 'quote_seen_' + (state.user && state.user.name ? state.user.name : 'guest'); }
/* 不重复轮转：localStorage 记录已展示 id，优先选没展示过的；一轮展示完才重置历史 */
function pickQuote(pool){
  let seen = [];
  try{ seen = JSON.parse(localStorage.getItem(quoteSeenKey())||'[]'); }catch(e){}
  const seenSet = new Set(seen.map(String));
  const keyOf = q => (q.id != null ? 'i' + q.id : q.zh);
  let unseen = pool.filter(q => !seenSet.has(keyOf(q)));
  if(!unseen.length){ seenSet.clear(); unseen = pool.slice(); }
  const q = unseen[Math.floor(Math.random()*unseen.length)];
  seenSet.add(keyOf(q));
  try{ localStorage.setItem(quoteSeenKey(), JSON.stringify([...seenSet])); }catch(e){}
  return q;
}
function renderHomeQuote(){
  if(!homeQuoteCurrent){
    homeQuoteCurrent = pickQuote((homeQuotePool && homeQuotePool.length) ? homeQuotePool : HOME_QUOTES);
    homeQuoteFromCloud = !!(homeQuotePool && homeQuotePool.length);
  }
  // 重绘当前语录（不重选）——无论 renderHome 被调用多少次，画面上的语句保持稳定
  const zh = $('home-quote-zh'), en = $('home-quote-en');
  if(zh) zh.textContent = homeQuoteCurrent.zh;
  if(en) en.textContent = homeQuoteCurrent.en || '';
  const cat = document.querySelector('#screen-home .home-hero .cat');
  const moodUrl = (QUOTE_MOOD_DATAURL && QUOTE_MOOD_DATAURL[homeQuoteCurrent.mood]) || QUOTE_FALLBACK_IMG;
  if(cat && moodUrl) cat.style.backgroundImage = "url('" + moodUrl + "')";
}
/* 语录库：v5.0.x 起一律使用内置语录池。
   [Phase 17] 旧实现会从 Gitee data/quotes.json 拉取，属 Gitee 业务依赖，已停用；
   不引入新依赖、不改 schema；如需云端语录库，后续应改为 Supabase 表读取。 */
async function loadQuoteLibrary(){
  if(homeQuoteLibTried) return;
  homeQuoteLibTried = true;
  return;   // Phase 17：不再访问 Gitee，保留内置语录
  try{
    const remote = await giteeReadJSON('data/quotes.json');
    if(remote && Array.isArray(remote.quotes) && remote.quotes.length){
      homeQuotePool = remote.quotes;
      if(!homeQuoteFromCloud){
        homeQuoteCurrent = pickQuote(remote.quotes);   // 内建 → 云端，会话内唯一一次切换
        homeQuoteFromCloud = true;
      }
      renderHomeQuote();
    }
  }catch(e){ /* 静默失败，使用内置语录 */ }
}
/* 主页重启按钮（v4.2.5）：清空全部 SW 缓存 + 注销 Service Worker + 整页重载 = 重启程序/刷新缓存/检查更新 */
async function hardReload(){
  if(!confirm('重启程序并清理本地缓存？\n（云端数据不受影响，重启后自动重新加载最新版本）')) return;
  try{
    if('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if(navigator.serviceWorker){
      const regs = await navigator.serviceWorker.getRegistrations();
      regs.forEach(r => r.unregister());
    }
  }catch(e){}
  location.reload();
}
function homeScatter(){
  const grid = $('home-hero-emojis'); if(!grid) return;
  const box = grid.parentElement;
  const W = (box && box.clientWidth) || 320, H = (box && box.clientHeight) || 104;
  grid.innerHTML = '';
  const cols = 5, rows = 2, cw = W/cols, ch = H/rows;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const s = document.createElement('span');
      s.textContent = HOME_EMOJIS[Math.floor(Math.random()*HOME_EMOJIS.length)];
      const size = 14 + Math.random()*8;
      s.style.left = (c*cw + Math.random()*Math.max(4,cw-size)) + 'px';
      s.style.top = (r*ch + Math.random()*Math.max(4,ch-size)) + 'px';
      s.style.fontSize = size.toFixed(1)+'px';
      s.style.transform = 'rotate('+(Math.random()*24-12).toFixed(1)+'deg)';
      s.style.opacity = (0.25+Math.random()*0.2).toFixed(2);
      grid.appendChild(s);
    }
  }
}

/* 刷新按钮转圈包装（v4.2.2）：点击加 spinning 旋转，同步 Promise 结束（成功/失败）后恢复静止 */

/* ==========================================================================
   v5.28.0：首页焦点卡 Carousel
   --------------------------------------------------------------------------
   结构（静态 markup 在 index.html 的 .home-hero 内；本处只负责内容与交互）：
     .home-hero
       ├─ .hero-viewport（高度锁 82px = 原 .cat 的高度 → 卡片总高仍 112px，尺寸不变）
       │    └─ .hero-track → .hero-slide ×2：
       │         第 1 页 励志语句（.cat + .qt + .scat —— renderHomeQuote 的选择器一字未改）
       │         第 2 页 时光（.hero-time-list 内部上下滚动；横向手势仍归 Carousel）
       └─ .hero-dots（绝对定位在卡片自身的下内边距带里 → 不占高度、不遮内容）

   交互约束：
     · 左右滑动 / 点圆点 → **只在这两页之间切换**（绝不按事件拆页）
     · 第 2 页内部上下滑动浏览多个事件；横竖主轴判定，互不误触
     · 长按 600ms → 弹「设为 / 取消首页置顶」（仅普通模式；简洁模式无长按）
     · 简洁模式（html[data-theme="minimal"]）由 CSS 脱掉 Carousel 外壳（无横滑/无圆点/无长按），
       只显示「励志语句 + 一条最紧凑的时光信息」→ 主题切换**不需要**重渲染
     · 置顶只决定「下次进首页默认停在第几页 / 时光列表定位到哪条」（排序把置顶事件排到首位），
       **不改变页序**
   ========================================================================== */
const HERO_SLIDES = 2;
let homeHeroIndex = 0;
let homeHeroTouched = false;   /* 本次会话用户是否手动翻过页（翻过后不再自动跳到置顶页） */
let homeHeroBound = false;
let homeHeroSuppressClick = false;
/* v5.28.2：简洁模式「单条 + 上下滑动翻看」的视图状态 */
let heroMiniRestoring = false;      /* 程序性设置 scrollTop 期间，忽略 scroll 回调的写入 */
let heroMiniScrollTimer = null;     /* 滚动停止防抖句柄 */

function heroIsMinimal(){
  try{ return document.documentElement.getAttribute('data-theme') === 'minimal'; }catch(e){ return false; }
}
function homeHeroSet(n){
  n = Math.max(0, Math.min(HERO_SLIDES - 1, parseInt(n, 10) || 0));
  homeHeroIndex = n;
  const track = $('heroTrack');
  if(track){
    track.style.transition = '';
    track.style.transform = 'translate3d(' + (-n * 100) + '%,0,0)';
  }
  const dots = $('heroDots');
  if(dots){
    Array.prototype.forEach.call(dots.children, function(el, i){ el.className = (i === n) ? 'on' : ''; });
  }
}
/* 置顶决定的默认页：'time:<uuid>' → 第 2 页；'quote' / null → 第 1 页 */
function homeHeroStartIndex(){
  try{ return (typeof timeStartIndex === 'function') ? timeStartIndex() : 0; }catch(e){ return 0; }
}
function homeHeroRender(){
  try{
    const list = $('heroTimeList');
    if(list){
      list.innerHTML = (typeof timeHeroHTML === 'function')
        ? timeHeroHTML()
        : '<div class="tm-hero-empty"><span class="tm-hero-ic">🕰️</span><span class="tm-hero-mid"><span class="tm-hero-name">时光模块未加载</span></span></div>';
    }
    const dots = $('heroDots');
    if(dots && dots.children.length !== HERO_SLIDES){
      dots.innerHTML = '';
      for(let i = 0; i < HERO_SLIDES; i++){
        const b = document.createElement('i');
        b.setAttribute('data-hero-i', String(i));
        b.onclick = function(){ homeHeroTouched = true; homeHeroSet(i); };
        dots.appendChild(b);
      }
    }
    /* 用户手动翻页前，每次渲染都跟随「置顶」结果（数据到达前为第 1 页）；
       一旦手动翻页，本会话内不再自动跳页。 */
    homeHeroSet(homeHeroTouched ? homeHeroIndex : homeHeroStartIndex());
    homeHeroBind();
    heroMiniApplySaved();   /* v5.28.2：简洁模式恢复「上次滑动到的那一条」 */
  }catch(e){ /* 容错：不影响首页其它卡片 */ }
}
/* 长按 → 置顶：点在事件行上则置顶该事件，否则置顶当前页对应的卡片 */
function homeHeroLongPress(target){
  if(heroIsMinimal()) return;                              /* 简洁模式不提供长按置顶 */
  if(typeof timeOpenPinSheet !== 'function') return;
  let key = null;
  try{
    const row = (target && target.closest) ? target.closest('.tm-hero-item') : null;
    if(row && row.getAttribute('data-tm-id')) key = 'time:' + row.getAttribute('data-tm-id');
  }catch(e){}
  if(!key){
    const list = (typeof timeSorted === 'function') ? timeSorted() : [];
    key = (homeHeroIndex === 0) ? 'quote' : (list.length ? ('time:' + list[0].id) : null);
  }
  if(!key){ toast('先添加一条时光记录'); return; }
  homeHeroSuppressClick = true;
  setTimeout(function(){ homeHeroSuppressClick = false; }, 500);
  timeOpenPinSheet(key);
}
/* ==========================================================================
   v5.28.2：简洁模式「单条 + 上下滑动翻看」
   --------------------------------------------------------------------------
   目标：简洁模式仍然一次只显示**一条**时光信息，但可以上下滑动翻看其他日子；
        滑到某一条后记录下来，下次进入首页直接显示那一条。
   存储：localStorage（键 wb_time_mini_<账号名>，设备级、按账号隔离）。
        之所以不用云端字段：① 这是「视图状态」（同 wb_todo_collapsed / wb_fuel_collapsed 的约定）；
        ② 云端只有 profiles.hero_pinned，它的语义是「首页默认卡片 / 时光列表定位」，
           若复用会被滚动这类随手动作覆盖掉用户**显式设置**的置顶，故刻意分开。
   行高：与 CSS 的 --tm-mini-row 一致（运行时按真实渲染高度测量，CSS 改动自动跟随）。
   ========================================================================== */
function heroMiniKey(){
  const u = (state && state.user && state.user.name) ? state.user.name : 'guest';
  return 'wb_time_mini_' + u;
}
function heroMiniSavedId(){
  try{ return localStorage.getItem(heroMiniKey()) || null; }catch(e){ return null; }
}
function heroMiniItems(){
  const list = $('heroTimeList');
  return list ? list.querySelectorAll('.tm-hero-item') : [];
}
/* 单行高度：优先取真实渲染高度；退化时用视窗高度兜底（保证除数不为 0） */
function heroMiniRowH(list, items){
  let h = (items && items.length) ? items[0].getBoundingClientRect().height : 0;
  if(!(h > 0)) h = (list && list.clientHeight) || 0;
  return h > 0 ? h : 1;
}
/* 恢复：把列表滚到「上次记住的那一条」（找不到该条 → 回到第一条） */
function heroMiniApplySaved(){
  if(!heroIsMinimal()) return;
  const list = $('heroTimeList'); if(!list) return;
  const items = heroMiniItems(); if(!items.length) return;
  const saved = heroMiniSavedId();
  let idx = 0;
  if(saved){
    for(let i = 0; i < items.length; i++){
      if(String(items[i].getAttribute('data-tm-id')) === String(saved)){ idx = i; break; }
    }
  }
  heroMiniRestoring = true;
  list.scrollTop = idx * heroMiniRowH(list, items);
  setTimeout(function(){ heroMiniRestoring = false; }, 300);
}
/* 当前停在哪一条（按吸附位置四舍五入） */
function heroMiniCurrentId(){
  const list = $('heroTimeList'); if(!list) return null;
  const items = heroMiniItems(); if(!items.length) return null;
  const rowH = heroMiniRowH(list, items);
  let idx = Math.round(list.scrollTop / rowH);
  idx = Math.max(0, Math.min(items.length - 1, idx));
  return items[idx].getAttribute('data-tm-id') || null;
}
function heroMiniRemember(){
  const id = heroMiniCurrentId(); if(!id) return;
  try{ localStorage.setItem(heroMiniKey(), String(id)); }catch(e){}
}
/* 滚动中不写、停稳 200ms 再写一次（避免滑动过程里反复落盘）
   ⚠️ 只在简洁模式记录：普通模式的第 2 页是**自由滚动**的多行列表，
      scrollTop / 行高 得不到有意义的「当前第几条」，若也写入会污染简洁模式的记忆值。 */
function heroMiniOnScroll(){
  if(!heroIsMinimal()) return;
  if(heroMiniRestoring) return;
  if(heroMiniScrollTimer) clearTimeout(heroMiniScrollTimer);
  heroMiniScrollTimer = setTimeout(function(){
    heroMiniScrollTimer = null;
    heroMiniRemember();
  }, 200);
}
function homeHeroBind(){
  if(homeHeroBound) return;
  const vp = $('heroViewport'); if(!vp) return;
  homeHeroBound = true;

  let down = false, decided = 0, sx = 0, sy = 0, dx = 0;
  let lpTimer = null, lpFbTimer = null, lpTarget = null;

  function clearLp(){
    if(lpTimer){ clearTimeout(lpTimer); lpTimer = null; }
    if(lpFbTimer){ clearTimeout(lpFbTimer); lpFbTimer = null; }
    vp.classList.remove('longpressing');
  }
  vp.addEventListener('contextmenu', function(e){ e.preventDefault(); });   /* 长按不弹系统菜单 */
  vp.addEventListener('pointerdown', function(e){
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    down = true; decided = 0; dx = 0;
    sx = e.clientX; sy = e.clientY; lpTarget = e.target;
    clearLp();
    lpFbTimer = setTimeout(function(){ lpFbTimer = null; if(down) vp.classList.add('longpressing'); }, 480);
    lpTimer = setTimeout(function(){
      lpTimer = null;
      if(!down) return;
      clearLp();
      homeHeroLongPress(lpTarget);      /* 600ms 触发（落在需求要求的 600–800ms 区间） */
    }, 600);
  });
  vp.addEventListener('pointermove', function(e){
    if(!down) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if(Math.abs(mx) > 10 || Math.abs(my) > 10) clearLp();     /* 位移超限 → 取消长按 */
    if(heroIsMinimal()) return;                               /* 简洁模式无 Carousel，不做横滑 */
    if(decided === 0){
      if(Math.abs(mx) > Math.abs(my) + 6) decided = 1;         /* 横向 → Carousel 翻页 */
      else if(Math.abs(my) > Math.abs(mx) + 6) decided = 2;    /* 纵向 → 交给时光列表滚动 */
    }
    if(decided === 1){
      dx = mx;
      const track = $('heroTrack');
      if(track){
        track.style.transition = 'none';
        track.style.transform = 'translate3d(calc(' + (-homeHeroIndex * 100) + '% + ' + dx + 'px),0,0)';
      }
    }
  });
  function endDrag(){
    if(!down) return;
    down = false;
    clearLp();
    const track = $('heroTrack');
    if(track) track.style.transition = '';
    if(decided === 1 && track){
      if(dx <= -36){ homeHeroTouched = true; homeHeroSet(homeHeroIndex + 1); }
      else if(dx >= 36){ homeHeroTouched = true; homeHeroSet(homeHeroIndex - 1); }
      else homeHeroSet(homeHeroIndex);
      homeHeroSuppressClick = true;                            /* 滑动后的 click 不当作点按 */
      setTimeout(function(){ homeHeroSuppressClick = false; }, 80);
    }
    decided = 0; dx = 0;
  }
  vp.addEventListener('pointerup', endDrag);
  vp.addEventListener('pointercancel', endDrag);
  vp.addEventListener('pointerleave', endDrag);

  vp.addEventListener('click', function(e){
    if(homeHeroSuppressClick) return;
    const t = e.target;
    if(!t || !t.closest) return;
    if(t.closest('.tm-hero-empty')){        /* 空态：简洁模式直接新增；普通模式进时光页 */
      if(heroIsMinimal() && typeof timeOpenNew === 'function') timeOpenNew();
      else if(typeof gotoTime === 'function') gotoTime();
      return;
    }
    if(t.closest('.hero-slide-time')){ if(typeof gotoTime === 'function') gotoTime(); }
  });

  /* v5.28.2：简洁模式的单条吸附滚动 —— 记住滑到的那一条（停稳 200ms 后写入） */
  const tlist = $('heroTimeList');
  if(tlist && !tlist._miniBound){
    tlist._miniBound = true;
    tlist.addEventListener('scroll', heroMiniOnScroll, { passive: true });
  }

  /* 主题切换：形态切换由 CSS 完成，这里只把位移重新写回（避免 minimal→cute 残留 --n*100%），
     并在切到简洁模式时恢复「上次滑动到的那一条」。 */
  try{
    const mo = new MutationObserver(function(){
      homeHeroSet(homeHeroTouched ? homeHeroIndex : homeHeroStartIndex());
      heroMiniApplySaved();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }catch(e){ /* 无 MutationObserver 时：切换主题由下次 renderHome 兜底 */ }
}

/* ==========================================================================
   v5.30.0：功能入口卡「信息层级 + 有语义的进度」（**卡片高度不增高**）
   --------------------------------------------------------------------------
   职责边界：**计算全部在各页面模块的 *HomeSummary()（纯函数）里**，本段只做
             「取数 → 写文字 / 写图形」，不实现任何业务口径：
               ledger.js   lgHomeSummary()   → 本月结余 + 收支 + 储蓄率
               sleep.js    spHomeSummary()   → 昨夜时长 + 入睡→起床 + 8h 参考完成度
               cocktail.js ckHomeSummary()   → 配方数 / 材料数（无图形）
               time.js     timeHomeSummary() → 倒计时天数 + 时间流逝进度（已结束则灰显、无条）
   卡片内部结构（DOM 见 index.html 的 .gc-stack；两行横向栏 + 可选一根 4px 条）：
     .gc-r1 = 图标 + 模块名（小）…… 右侧 .gc-aux（完成度 / 收支 / 材料数 / 事件语义）
     .gc-r2 = .gc-value 核心数据（最大字号）…… 右侧 .gc-aux（入睡→起床）/ 小标签 / 环
     .gc-bar = 4px 条（**只有能说出分母时才出现**：睡眠＝相对 8h 参考基准；时光＝距离目标日期的时间流逝）
   ⚠️ 硬约束：卡片高度不得超过 v5.29.0 的实测基线（记账/调酒 71px、睡眠/时光 79px）——
      因此辅助信息一律放进两行的**右侧**，不新起一行；文字均带 ellipsis 兜底，
      内容再长也不会把卡片撑高。
   ⚠️ 规则：某个图形若说不出「它代表什么」就不要它 —— 调酒只给数字；
      时光「已结束」不保留已经失效的进度条（整条隐藏）。
   容错：每张卡各自 try/catch —— 任何模块缺失/出错都不影响首页其它卡片。
   ========================================================================== */
function homeSumText(id, txt){
  const el = $(id);
  if(el && txt != null) el.textContent = txt;
}
/* v5.33.4：首页**记账卡**专用的「本月收支」分色渲染 —— ↑入账（绿）/ ↓支出（红）。
   只改颜色呈现：字号、省略号兜底、卡片尺寸与其它卡片逻辑一律不动，色值由 CSS 按主题给。
   用 createElement + textContent（不拼 innerHTML）；空态沿用原有文案「本月还没有记录」。
   其它入口卡（睡眠 / 调酒 / 时光 / 衣橱 / 我的）仍走 homeSumText，行为完全不变。 */
function homeSumIe(id, incTxt, expTxt){
  const el = $(id);
  if(!el) return;
  if(incTxt == null || expTxt == null){ el.textContent = '本月还没有记录'; return; }
  el.textContent = '';
  const up = document.createElement('span');
  up.className = 'gc-up';
  up.textContent = incTxt;
  const down = document.createElement('span');
  down.className = 'gc-down';
  down.textContent = expTxt;
  el.appendChild(up);
  el.appendChild(document.createTextNode(' · '));
  el.appendChild(down);
}
/* 4px 条：bar = {pct} 或 {left,width}（均为百分比）；无分母（bar 为 null）→ 整条隐藏 */
function homeSumBar(id, bar){
  const el = $(id);
  if(!el) return;
  if(!bar){ el.style.display = 'none'; return; }
  el.style.display = '';
  const i = el.firstElementChild;
  if(!i) return;
  const left = (bar.pct != null) ? 0 : (bar.left || 0);
  const w = (bar.pct != null) ? bar.pct : (bar.width || 0);
  i.style.left = Math.max(0, Math.min(100, left)) + '%';
  i.style.width = Math.max(0, Math.min(100, w)) + '%';
}
/* 环：进度交给 CSS 的 conic-gradient（--ring-p）；无有效分母 → 隐藏环（不画假 0%） */
function homeSumRing(id, pct){
  const el = $(id);
  if(!el) return;
  if(pct === null || pct === undefined){ el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.setProperty('--ring-p', Math.max(0, Math.min(100, pct)) + '%');
}
/* 已结束（一次性事件）→ 整卡低饱和（视觉由 CSS 的 .gc-ended 负责，这里只切 class） */
function homeSumEnded(id, on){
  const el = $(id);
  const card = (el && el.closest) ? el.closest('.group-card') : null;
  if(card) card.classList.toggle('gc-ended', !!on);
}
function renderHomeSummaries(){
  /* ① 记账：本月结余（核心）+ 本月收支（模块名行右侧）+ 储蓄率环 */
  try{
    if(typeof lgHomeSummary === 'function'){
      const s = lgHomeSummary();
      homeSumText('he-ledger', s.value);
      /* v5.33.4：本月收支改分色渲染（↑入账绿 / ↓支出红）；结构相同、仅颜色不同 */
      homeSumIe('he-ledger-aux', s.auxInc, s.auxExp);
      homeSumRing('he-ledger-ring', s.ring);
    }
  }catch(e){ }
  /* ② 睡眠：昨夜时长（核心）+ 完成度（模块名行右侧）+ 入睡→起床（同行右侧）+ 4px 条 */
  try{
    if(typeof spHomeSummary === 'function'){
      const s = spHomeSummary();
      homeSumText('he-sleep', s.value);
      homeSumText('he-sleep-aux', s.aux);
      homeSumText('he-sleep-aux2', s.aux2);
      homeSumBar('he-sleep-bar', s.bar);
    }
  }catch(e){ }
  /* ③ 调酒：配方数（核心）+ 材料数（模块名行右侧）；按设计结论不加任何图形 */
  try{
    if(typeof ckHomeSummary === 'function'){
      const s = ckHomeSummary();
      homeSumText('he-cocktail', s.value);
      homeSumText('he-cocktail-aux', s.aux);
    }
  }catch(e){ }
  /* ④ 时光：倒计时天数（核心）+ 事件语义（模块名行右侧）+ 时间流逝进度 / 已结束灰显无条 */
  try{
    if(typeof timeHomeSummary === 'function'){
      const s = timeHomeSummary();
      homeSumText('he-time', s.value);
      homeSumText('he-time-aux', s.aux);
      homeSumBar('he-time-bar', s.bar);
      homeSumEnded('he-time', !!s.ended);
    }
  }catch(e){ }
}
