/* ============================================================
   电子衣橱 · Service Worker（PWA 离线缓存）
   缓存策略：
   - 页面导航(index.html)：网络优先，失败回缓存 → 更新即时生效 + 断网可开
   - 同源静态资源(manifest/icons)：缓存优先
   - Gitee API 等跨域请求：完全不缓存（含令牌、数据须实时）
   注意：CACHE_NAME 必须与 APP_VERSION 同步升级，否则用户拿不到新版
   ============================================================ */
const CACHE_NAME = 'wardrobe-v2.1.3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* 安装：预缓存 app shell，立即接管 */
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(c){ return c.addAll(APP_SHELL); })
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
