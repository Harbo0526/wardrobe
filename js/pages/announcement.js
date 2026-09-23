/* ==========================================================================
   生活象限 · js/pages/announcement.js
   --------------------------------------------------------------------------
   Phase 5 收尾：Announcement page module（公告 #annModal / 我的→发布公告 / 关于）

   自 index.html 物理抽取（**逐字节原样迁移**）：原主内联脚本 L3390–L3507（118 行），
   19 个成员 = 15 个函数 + 4 个绑定
   （ANN_SEEN_PREFIX · ANN_DEFAULT · annShownThisSession · annPendingSeen）。
   块内**没有任何 parse-time 顶层语句**，DOM 访问全部在函数体内 → 纯运行时依赖。

   ⚠️ 必须留在 index.html 的原位项（本模块只调用、不复制）：
      · 宿主状态写入：loadUserWorkspace / resetToGuest 内各一处
        annShownThisSession = false（跨脚本写全局词法 let 绑定，保持原样不动）
      · Persistence / Auth / Gitee / Sync / Push / Router / Nav / Home / Theme：全部未动

   ⚠️ 跨模块懒调用（保持原样，全部运行期）：
      Mine → Announcement：renderMine → annIsAdmin / annRenderHistory /（pub.onclick = annPublish）
      Bridge → Announcement：maybeShowAnnouncement（typeof 守卫，见 legacy-sync.js L326）
      Announcement → Host：state（state.announcements / state.user）+ APP_VERSION
      Announcement → Core/Bridge：$ / toast / lgEsc / sbSaveObj / sbRemoveObj / wbUuid
      数据访问继续走既有 DAL（bridge），**未新建公告 Service**。
   ⚠️ Classic Script（非 ESM）；let/const 保持顶层 lexical binding，未改成 window.*。
   ========================================================================== */
/* =====================================================================
   v5.6.0：公告（announcements）
   · 数据源 = Supabase public.announcements（读：所有登录用户；写：仅 profiles.role='admin'）
     —— 数据库 RLS 强制，前端入口只是体验层，别人伪造请求也写不进去。
   · 启动自动弹：有「未读」公告才弹（同一次会话只弹一次）；关闭即把 id 记到本机 → 之后不再弹。
   · 「我的 → 关于生活象限」点开：最近三条公告（底部带版本信息）。
   · 「我的 → 📢 发布公告」：仅管理员可见（发布 / 查看历史 / 删除）。
   ===================================================================== */
const ANN_SEEN_PREFIX = 'wardrobe.v1.annSeen.';   /* 本机已读公告 id（UI 偏好，非业务数据） */
const ANN_DEFAULT = { id: 'local-welcome', title: '欢迎', body: '欢迎使用 Harbo 生活象限', at: null };
let annShownThisSession = false;                  /* 同一次会话只自动弹一次（手动刷新不再弹） */
let annPendingSeen = [];                          /* 本次自动弹窗关闭后要标记已读的公告 id */

function annSeenKey(){ return ANN_SEEN_PREFIX + encodeURIComponent((state.user && state.user.name) || 'guest'); }
function annSeenSet(){
  try{ const r = JSON.parse(localStorage.getItem(annSeenKey()) || '[]'); return Array.isArray(r) ? r : []; }catch(e){ return []; }
}
function annMarkSeen(ids){
  try{
    const s = annSeenSet();
    (ids || []).forEach(function(id){ if(id && s.indexOf(id) < 0) s.push(id); });
    localStorage.setItem(annSeenKey(), JSON.stringify(s.slice(-80)));   /* 只留最近 80 条，避免无限增长 */
  }catch(e){}
}
/* 公告列表：以云端为准；云端为空时回退内置默认公告（保证「默认欢迎」始终可见） */
function annAll(){
  return (state.announcements && state.announcements.length) ? state.announcements.slice() : [ANN_DEFAULT];
}
function annFmtTime(at){
  if(!at) return '';
  const d = new Date(at); if(isNaN(d.getTime())) return '';
  const p = function(n){ return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/* 正文一律转义后按纯文本渲染（支持换行，不解析 HTML/Markdown → 防 XSS） */
function annItemsHTML(list){
  return list.map(function(a){
    return '<div class="ann-item">' +
      (a.title ? '<div class="ann-t">' + lgEsc(a.title) + '</div>' : '') +
      (a.at ? '<div class="ann-time">' + annFmtTime(a.at) + '</div>' : '') +
      '<div class="ann-text">' + lgEsc(a.body) + '</div>' +
    '</div>';
  }).join('');
}
function annFootHTML(){ return '<div class="ann-foot">生活象限 v' + APP_VERSION + ' · 轻量免费 PWA · 数据自主可控</div>'; }
/* 打开公告弹层（limit = 显示条数，默认最近三条） */
function openAnnSheet(limit){
  const box = $('annModalBody'); if(!box) return;
  const list = annAll().slice(0, limit || 3);
  $('annModalTitle').textContent = '📢 公告';
  box.innerHTML = (list.length ? annItemsHTML(list) : '<div class="ann-empty">暂无公告</div>') + annFootHTML();
  $('annModal').classList.add('show');
}
function closeAnnModal(){
  if(annPendingSeen.length){ annMarkSeen(annPendingSeen); annPendingSeen = []; }
  const m = $('annModal'); if(m) m.classList.remove('show');
}
/* 启动自动弹：有未读公告才弹；关闭后按「公告 id」记已读，新公告会再次弹出 */
function maybeShowAnnouncement(){
  if(annShownThisSession) return;
  const seen = annSeenSet();
  const unread = annAll().filter(function(a){ return a.id && seen.indexOf(a.id) < 0; });
  if(!unread.length) return;
  annShownThisSession = true;
  annPendingSeen = unread.map(function(a){ return a.id; });
  const box = $('annModalBody'); if(!box) return;
  $('annModalTitle').textContent = '📢 公告';
  box.innerHTML = annItemsHTML(unread.slice(0, 3)) + annFootHTML();
  $('annModal').classList.add('show');
}
/* ---- 管理员：发布 / 历史 / 删除（非 admin 连入口都不渲染） ---- */
function annIsAdmin(){ return !!(state.user && state.user.role === 'admin'); }
function annRenderHistory(){
  const box = $('annHisList'); if(!box) return;
  const list = state.announcements || [];
  const t = $('annHisTitle'); if(t) t.textContent = '历史公告' + (list.length ? '（' + list.length + '）' : '');
  if(!list.length){ box.innerHTML = '<div class="ann-empty">还没有发布过公告</div>'; return; }
  box.innerHTML = list.map(function(a){
    return '<div class="ann-his"><div class="ann-his-main">' +
      '<div class="ann-his-t">' + lgEsc((a.title ? a.title + ' · ' : '') + (annFmtTime(a.at) || '')) + '</div>' +
      '<div class="ann-his-b">' + lgEsc(a.body) + '</div></div>' +
      '<button class="ann-del press" data-anndel="' + a.id + '" title="删除">✕</button></div>';
  }).join('');
  box.querySelectorAll('[data-anndel]').forEach(function(b){
    b.onclick = function(ev){ ev.stopPropagation(); annDelete(b.getAttribute('data-anndel')); };
  });
}
function annPublish(){
  if(!state.user){ toast('请先登录'); return; }
  if(!annIsAdmin()){ toast('仅管理员可发布公告'); return; }
  const title = ($('annTitle').value || '').trim();
  const body = ($('annBody').value || '').trim();
  if(!body){ toast('请输入公告正文'); return; }
  const rec = { id: wbUuid(), title: title, body: body, version: APP_VERSION,
                at: new Date().toISOString(), _sbSaved: false };
  state.announcements = state.announcements || [];
  state.announcements.unshift(rec);
  sbSaveObj('announcements', rec, { title: rec.title, body: rec.body, version: rec.version, published_at: rec.at });
  $('annTitle').value = ''; $('annBody').value = '';
  annRenderHistory();
  toast('公告已发布 ✓');
}
function annDelete(id){
  if(!annIsAdmin()){ toast('仅管理员可删除公告'); return; }
  const rec = (state.announcements || []).find(function(a){ return a.id === id; });
  if(!rec) return;
  if(!confirm('删除这条公告？删除后所有用户都不再看到。')) return;
  state.announcements = (state.announcements || []).filter(function(a){ return a.id !== id; });
  try{ sbRemoveObj('announcements', rec); }catch(e){}
  annRenderHistory();
  toast('公告已删除');
}

/* v5.6.0：点「关于生活象限」→ 弹出最近三条公告（版本信息在弹层底部） */
function showAbout(){
  openAnnSheet(3);
}

/* v5.32.4（首屏启动专项 B）：本模块已改为 FIRST_USABLE_HOME 后由 bootFast 空闲加载。
   若 sbLoadAll 完成时本模块尚未就绪，legacy-sync 会置 window.__wbAnnPending = true；
   这里在加载完成后主动消费一次，保证公告不因延后加载而丢失。
   正常路径（模块先于数据加载完）不会置 pending → 不重复弹窗；
   pending 置位后也只消费一次（置 false），maybeShowAnnouncement 内部仍有
   「有未读才弹 / 同一会话只弹一次」的原有判定。 */
if (window.__wbAnnPending) {
  window.__wbAnnPending = false;
  try { maybeShowAnnouncement(); } catch (e) { /* 容错，不影响其它功能 */ }
}
