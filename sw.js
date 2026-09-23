/* ============================================================
   电子衣橱 · Service Worker（PWA 离线缓存）
   缓存策略：
   - 页面导航(index.html)：网络优先，失败回缓存 → 更新即时生效 + 断网可开
   - 同源静态资源(manifest/icons)：缓存优先
   - Gitee API 等跨域请求：完全不缓存（含令牌、数据须实时
   注意：CACHE_NAME 必须与 APP_VERSION 同步升级，否则用户拿不到新版
   ============================================================ */
const CACHE_NAME = 'wardrobe-v5.33.0';
/* v5.13.13：头像本地缓存（首页/我的页头像；由 index.html 通过 CacheStorage 写入）。
   ⚠ 这是「用户数据缓存」，不是 app shell 的版本缓存 —— activate 清理旧版本时必须保留它，
   否则每次版本更新都会把它清掉，头像又得重新下载（白白浪费流量）。名字须与 index.html 的 AVATAR_CACHE 一致。 */
const AVATAR_CACHE = 'wardrobe-avatar-v1';
// Phase 14：js/ 模块（DAL/Auth/Storage/bridge）纳入预缓存；Supabase API 跨域请求不缓存（fetch 拦截器对跨域直接放行）
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',   /* cocktail.html 已移除：V2.5.0 起调酒内嵌进 index.html，不再作为独立页面缓存 */
  './home-bg.jpg',     /* v5.6.2：首页背景图（PNG→JPEG，4.38MB→345KB，离线可用） */
  /* v5.32.2（首屏启动专项）：原 base64 内联图片外置为独立文件（ledger.css 14 张 + home.js 9 张）。
     它们仍需离线可用，故纳入 app shell 预缓存；首屏本身不请求这些文件
     （CSS 变量里的 url() 与语录卡背景图都按需加载），预缓存发生在 SW install 阶段 */
  './assets/lg-avatar-1.png', './assets/lg-avatar-2.png', './assets/lg-avatar-3.png',
  './assets/lg-avatar-4.png', './assets/lg-avatar-5.png', './assets/lg-avatar-6.png',
  './assets/lg-avatar-7.png', './assets/lg-avatar-8.png', './assets/lg-avatar-9.png',
  './assets/lg-bg-1.jpg', './assets/lg-bg-2.jpg', './assets/lg-bg-3.jpg',
  './assets/lg-bg-4.jpg', './assets/lg-bg-5.jpg',
  './assets/quote-sleep.jpg', './assets/quote-food.jpg', './assets/quote-love.jpg',
  './assets/quote-strive.jpg', './assets/quote-morning.jpg', './assets/quote-self.jpg',
  './assets/quote-life.jpg', './assets/quote-hope.jpg', './assets/quote-fallback-cat.jpg',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  /* Phase 2（v5.14.4）：CSS 已抽离为独立文件，纳入 app shell 预缓存
     （顺序不影响缓存命中；与 index.html 的 <link> 顺序保持一致，便于人工核对） */
  './css/variables.css',
  './css/reset.css',
  './css/layout.css',
  './css/components.css',
  './css/common.css',
  './css/pages/auth.css',
  './css/pages/home.css',
  './css/pages/cloth.css',
  './css/pages/group.css',
  './css/pages/upload.css',
  './css/pages/mine.css',
  './css/pages/cocktail.css',
  './css/pages/ledger.css',
  './css/pages/sleep.css',
  './css/pages/todo.css',
  './css/pages/fuel.css',
  './css/pages/time.css',   /* v5.28.0：时光页样式 */
  './css/overrides.css',
  './css/theme.css',
  /* Phase 3（v5.14.5）：公共常量与工具函数抽出为 core 模块，一并预缓存
     （两者必须在 index.html 主内联脚本之前加载，离线时缺任一都会让 App 起不来） */
  './js/core/constants.js',
  './js/core/utils.js',
  './js/core/overlays.js',
  './js/core/render.js',
  /* Phase 3 续（v5.22.0）：UI 风格主题（core 组，早于主脚本；注意「防闪主题」inline script
     仍留在 index.html <body> 起始处，必须先于本文件执行，二者读写同一个 localStorage key） */
  './js/core/theme.js',
  /* Phase 5（v5.14.7）：页面业务模块（调酒页），来自原主脚本；离线必须可加载 */
  './js/pages/cocktail.js',
  './js/pages/fuel.js',
  './js/pages/memo.js',
  './js/pages/todo.js',
  './js/pages/sleep.js',
  /* Phase 5 候选 E（v5.17.0）：记账/衣橱/分组/上传页面模块（来自原主脚本），离线必须可加载 */
  './js/pages/ledger.js',
  './js/pages/cloth.js',
  './js/pages/group.js',
  './js/pages/upload.js',
  /* Phase 5 候选 F（v5.18.0）：「我的」页模块（来自原主脚本），离线必须可加载 */
  './js/pages/mine.js',
  /* Phase 5 收尾（v5.19.0）：公告页模块（来自原主脚本），离线必须可加载 */
  './js/pages/announcement.js',
  /* Phase 5 收尾（v5.20.0）：左侧导航排序模块（来自原主脚本，含 2 条加载期语句） */
  './js/pages/nav.js',
  /* Phase 5（v5.21.0）：总首页模块（来自原主脚本，含 base64 意境图常量） */
  './js/pages/home.js',
  /* v5.28.0：时光页模块（页面 + 新增/编辑弹窗 + 首页焦点卡取数）——离线必须可加载 */
  './js/pages/time.js',
  './js/config.js',
  './js/data/supabase.js',
  './js/data/errors.js',
  './js/data/query.js',
  './js/data/groups.js',
  './js/data/clothgroups.js',
  './js/data/clothes.js',
  './js/data/modules.js',
  './js/data/index.js',
  './js/auth/session.js',
  './js/auth/index.js',
  './js/storage/paths.js',
  './js/storage/images.js',
  './js/storage/index.js',
  './js/bridge/legacy-sync.js',
  /* Phase 7（v5.23.0）：Legacy Gitee Transport（配置常量 + token + giteeFetch + JSON 读写）从
     index.html 主内联脚本隔离到此文件（ROLLBACK-ONLY，已被 giteeFetch 首行守卫硬阻断）。
     注意：bridge 与页面模块仍会以裸标识符运行期调用它，故必须离线可加载 */
  './js/legacy/gitee-sync.js',
  /* Phase 8（v5.24.0）：Push / Reminder 服务（WBReminders + push* + CH_SPECS + ch*）从
     index.html 主内联脚本隔离到此文件（Classic Script）。markup 的 7 个 onclick 与
     js/pages/mine.js 的 pushAutoHeal 仍是运行期裸全局调用，故必须离线可加载 */
  /* v5.28.0：时光服务层（日期与重复周期计算的唯一实现处）——离线必须可加载 */
  './js/services/time.js',
  './js/services/push.js'
  /* 注：励志卡图片（8 张意境插画 + 基础橘猫）自 v4.3.3 起以 base64 内联在 index.html 内，
     不再作为独立文件预缓存——GitHub Pages 部署只保留根目录文件，子目录 avatars/ 不会被部署（手机 404）。 */
];

/* 安装：预缓存 app shell（**不立即接管**，见下方 v5.32.1 说明）
   v4.3.2：弃用 addAll（一损俱损——清单内任一文件拉取失败会导致整个 SW 安装失败，
   手机弱网下 SW 卡死在旧版本：新功能/图片永远不更新）。改为逐文件容错预缓存，
   单个失败仅跳过，运行时「缓存优先」策略会在网络可用时自动补上。
   ────────────────────────────────────────────────────────────────────────────
   v5.32.1（本专项）：安装完成**不再**调用 self.skipWaiting()（原先在 waitUntil 末尾）。
   为什么：skipWaiting 会让新 SW 在「用户正开着旧页面」的情况下强行激活，再配合下面
   activate 里的 clients.claim() 抢走页面控制权 → 页面立刻收到 controllerchange →
   index.html（旧逻辑）执行 location.reload() → **正在使用的 App 被整页硬重启**，
   要重新下载 1.94MB 的 index.html 并重跑整条启动链，表现就是
   「每次发版后一段时间打开：白屏 → 等待 → 才进首页」（iPhone / Safari 上尤其明显）。
   去掉 skipWaiting 后的生命周期：
     有新版本 → 后台 download → install（本清单装填完成 = 新 Cache 准备完毕）
     → **停在安装完成后的 waiting 状态，绝不打断当前页面**
     → 等当前页面关闭（iPhone 上＝App 退到后台被系统回收 / 下次重新打开）后才 activate
     → activate 时新 Cache 已完整，此时删旧 Cache 才安全（不会出现「旧的删了、新的没齐」）。
   ⚠️ 有意为之的代价：更新不会在当次打开时立刻生效，最快要下次打开。
      用户若需立刻取新版，走「我的 → 重启程序」（js/pages/home.js 的 hardReload()）。
   ────────────────────────────────────────────────────────────────────────────
   注意：install 完成 ⇒ 新 Cache 已按上述容错策略装填完毕，这是「允许新版本生效」的闸门；
   若个别文件拉取失败，只会让该文件的离线副本缺失（联网时自动补拉），
   绝不会让一个「还没准备好」的新版本去顶掉正在运行的旧版本。 */
/* v5.32.1：install 时记录「本次是否首次安装」——判断依据是此刻 registration.active：
   为 null ⇒ 之前没有任何 SW 接管过页面（首次安装）；非空 ⇒ 属于「旧版本 → 新版本」更新。
   activate 里据此决定是否 clients.claim()（见下）。
   ⚠️ 默认值取 **true**（＝先按「首次安装」处理）：iOS/Safari 会在任意时刻回收 SW 线程，
   万一 install 已完成、activate 还没跑就被回收，SW 全局作用域会重建、本变量归位默认值；
   此时若默认是 false，首次安装的页面就会失去接管（离线要到下次打开才生效）。
   取 true 是安全的：clients.claim() **只接管尚未被任何 SW 控制的 client**，
   绝不会从旧 SW 手里抢走正在使用的页面（能抢走页面的只有 skipWaiting，已去掉）。 */
var _wbFirstInstall = true;
self.addEventListener('install', function(e){
  _wbFirstInstall = !self.registration.active;
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(c){
        return Promise.all(APP_SHELL.map(function(u){
          return c.add(u).catch(function(){ /* 单文件失败不拖垮安装 */ });
        }));
      })
  );
});

/* 激活：清理旧版本缓存（⚠ 必须保留 AVATAR_CACHE，见文件顶部说明）
   v5.32.1（本专项）：clients.claim() 由「无条件执行」改为「**仅首次安装时执行**」。
   为什么：claim() 会把新 SW 的控制权**强加到还开着的页面**上 → 触发 controllerchange
   → 页面（旧逻辑）整页 reload ⇒ 这就是发版后白屏的直接触发点。分两种情况：
     · 首次安装：此时页面上还没有任何 controller，claim() 是**必须**的 —— 否则当前这次
       打开的页面始终不受 SW 接管，离线缓存、Push 订阅都要等下次打开才生效。
     · 版本更新：SW 只有在「它所控制的旧页面全部关闭」后才会 activate（因为已去掉
       skipWaiting），所以 activate 时旧页面本来就不在了；而新开的页面在导航阶段就会由
       新 SW 接管，不需要 claim —— 反而若 claim，可能在页面加载中途换掉 controller。
   删旧 Cache 的时机不变（仍在 activate）：此时 install 已跑完 ⇒ 新 Cache 已装填完毕，
   满足「新版本完整可用之前，不破坏旧版本的可用缓存」。 */
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME && k !== AVATAR_CACHE; })
          .map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ if(_wbFirstInstall) return self.clients.claim(); })
  );
});

/* 请求拦截 */
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // 跨域（Gitee API 等）：不缓存，交给浏览器直连
  if (url.origin !== location.origin) return;

  // 页面导航：网络优先（保证更新即时生效），失败回退缓存（离线可开）
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(c){ c.put('./index.html', copy); });
        return res;
      }).catch(function(){
        return caches.match('./index.html');
      })
    );
    return;
  }

  // 同源静态资源：缓存优先，未命中再拉取并入库
  e.respondWith(
    caches.match(req).then(function(hit){
      if (hit) return hit;
      return fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(c){ c.put(req, copy); });
        return res;
      });
    })
  );
});

/* ============================================================
   v5.9.2：Web Push 接收端（待办提醒）
   ────────────────────────────────────────────────────────────
   架构：PWA + Service Worker + Web Push + Supabase Edge Function + pg_cron
     · 到点投递由服务端（Edge Function，pg_cron 每分钟触发）完成，
       **不依赖页面是否打开**；前端全程不使用 setTimeout 等页面存活方案。
     · 本 SW 只负责「收」：收到 push → 弹系统通知；点通知 → 聚焦 / 打开 App。
   Phase 1：接口已就位但服务端尚未部署，因此这里不会被触发，
   也不影响既有「网络优先 + 缓存优先」的离线逻辑。
   ============================================================ */
self.addEventListener('push', function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  var title = d.title || '待办提醒';
  var opts = {
    body: d.body || '你有一条待办到时间了',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || ('todo-' + (d.id || Date.now())),   /* 同一条待办重复推送只保留一条通知 */
    renotify: false,
    data: { url: d.url || './index.html', id: d.id || null }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

/* 点击通知：优先聚焦已打开的窗口，其次新开 */
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
