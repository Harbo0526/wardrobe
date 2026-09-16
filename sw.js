/* ============================================================
   电子衣橱 · Service Worker（PWA 离线缓存）
   缓存策略：
   - 页面导航(index.html)：网络优先，失败回缓存 → 更新即时生效 + 断网可开
   - 同源静态资源(manifest/icons)：缓存优先
   - Gitee API 等跨域请求：完全不缓存（含令牌、数据须实时
   注意：CACHE_NAME 必须与 APP_VERSION 同步升级，否则用户拿不到新版
   ============================================================ */
const CACHE_NAME = 'wardrobe-v5.13.9';
// Phase 14：js/ 模块（DAL/Auth/Storage/bridge）纳入预缓存；Supabase API 跨域请求不缓存（fetch 拦截器对跨域直接放行）
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',   /* cocktail.html 已移除：V2.5.0 起调酒内嵌进 index.html，不再作为独立页面缓存 */
  './home-bg.jpg',     /* v5.6.2：首页背景图（PNG→JPEG，4.38MB→345KB，离线可用） */
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
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
  './js/bridge/legacy-sync.js'
  /* 注：励志卡图片（8 张意境插画 + 基础橘猫）自 v4.3.3 起以 base64 内联在 index.html 内，
     不再作为独立文件预缓存——GitHub Pages 部署只保留根目录文件，子目录 avatars/ 不会被部署（手机 404）。 */
];

/* 安装：预缓存 app shell，立即接管
   v4.3.2：弃用 addAll（一损俱损——清单内任一文件拉取失败会导致整个 SW 安装失败，
   手机弱网下 SW 卡死在旧版本：新功能/图片永远不更新）。改为逐文件容错预缓存，
   单个失败仅跳过，运行时「缓存优先」策略会在网络可用时自动补上。 */
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(c){
        return Promise.all(APP_SHELL.map(function(u){
          return c.add(u).catch(function(){ /* 单文件失败不拖垮安装 */ });
        }));
      })
      .then(function(){ return self.skipWaiting(); })
  );
});

/* 激活：清理旧版本缓存 */
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; })
          .map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ return self.clients.claim(); })
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
