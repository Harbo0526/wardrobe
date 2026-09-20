/* ==========================================================================
   生活象限 · js/pages/mine.js
   --------------------------------------------------------------------------
   Phase 5 候选 F：Mine page module（我的页 #screen-mine + 用户名 + 头像 + 同步状态）

   自 index.html 物理抽取（**逐字节原样迁移**）：原主内联脚本 L2796–L3223（428 行），
   30 个成员 = 24 个函数 + 6 个绑定
   （_avatarObj · avViewCtl · AVATAR_CACHE · AVATAR_CACHE_PREFIX · AVATAR_MAX_EDGE ·
    AVATAR_QUALITY）；另含 2 条**加载期监听注册**语句
   （avatarAlbumInput / avatarCameraInput 的 change 监听）—— 原样迁移，未改成
   DOMContentLoaded / initMine，也未改变初始化时机。

   ⚠️ 必须留在 index.html 的原位项（本模块只调用、不复制）：
      · Auth / Identity：enterApp / doLogin / doRegister / doLogout / restoreSession /
        autoPullOnLaunch / init IIFE / WBAuth / WBSession（启动链，本轮未迁移）
      · Persistence：loadState / saveState / default* / normalize* / 路径工具 / Gitee
      · Push / Reminder：WBReminders / push*（renderMine → pushAutoHeal 保持原样）/ CH_SPECS / ch*
      · 宿主：openSheet / closeSheet / syncSpin / navTo / showScreen / APP_VERSION / $ / toast
      · 公告：annIsAdmin / annPublish / annRenderHistory / openAnnSheet（showAbout 本轮不迁）

   ⚠️ 跨页懒调用（保持原样，全部运行期）：
      Host → Mine：navTo / refreshAfterSync / doSync / doLogout / renderHome / pullProfile
      Mine → Host：pushAutoHeal / ann* / openSheet / closeSheet / navTo
      Mine → Data/Auth/Storage/Bridge：getSupabaseClient / WBAuth / WBSession / WBImages /
                                      WBErrors / window.dataUrlToBlob
   ⚠️ Classic Script（非 ESM）；state 仍以裸标识符读写唯一 state.user / state.lastSync。
   ========================================================================== */
/* ---------- 10. 我的页 / 同步 / 退出 ---------- */
function renderMine(){
  const u = state.user || {name:'小绿', createdAt:new Date().toISOString()};
  applyAvatar('mine-avatar');
  $('mine-name').textContent = u.name;
  const d = new Date(u.createdAt);
  //$('mine-meta').textContent = '加入于 ' + d.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}) + ' · ' + state.clothes.length + ' 件衣物';

  // 版本页脚（与首页页脚一致，读 APP_VERSION，不写死在 HTML）
  var v = $('mine-version');
  if(v) v.textContent = 'v' + APP_VERSION;
  // 关于行版本（统一读 APP_VERSION，避免硬编码失同步）
  var av = $('about-ver');
  if(av) av.textContent = 'v' + APP_VERSION + ' · 轻量免费 PWA · 远程仓库 云同步';

  // v5.13.6（Phase 1）：系统提醒推送行副标题；v5.13.7：改为 pushAutoHeal（探测真实订阅 + 缺行自动补报）
  try{ pushAutoHeal(); }catch(e){}

  // v5.6.0：公告发布卡片仅管理员可见（真正的写入权限由数据库 RLS 卡死，此处只是入口显隐）
  var annCard = $('mine-ann-card');
  if(annCard){
    if(annIsAdmin()){
      annCard.style.display = '';
      var pub = $('annPublish'); if(pub) pub.onclick = annPublish;
      annRenderHistory();
    }else{
      annCard.style.display = 'none';
    }
  }
}

/* ---------- 10.2 用户名（display_name，可任意修改） ----------
 * 数据源 = profiles.display_name（非唯一，可任意改，无重名冲突）。
 * handle_new_user 触发器已为新用户建档（display_name = metadata.display_name 或邮箱前缀）；
 * enterApp() 统一 await→fire refreshUserName() 补全，避免刷新后被邮箱前缀覆盖。 */
async function refreshUserName(){
  try{
    const u = await WBAuth.getCurrentUser();
    if(!u || !state.user) return;
    const { data, error } = await getSupabaseClient().from('profiles')
      .select('display_name, username, role').eq('id', u.id).maybeSingle();
    if(error || !data) return;            // 静默失败，保留邮箱前缀兜底
    const dn = (data.display_name || data.username || '').trim();
    if(dn) state.user.name = dn;
    /* v5.6.0：把 profiles.role 同步到内存（'admin' 才显示公告发布入口） */
    if(data.role) state.user.role = data.role;
    renderMine();
  }catch(e){ /* 不影响主流程 */ }
}
function openDisplayNameEditor(){
  const inp = $('dn-input');
  if(inp && state.user) inp.value = state.user.name || '';
  openSheet('sheet-displayname');
  if(inp) setTimeout(function(){ try{ inp.focus(); }catch(e){} }, 50);
}
async function saveDisplayName(){
  const inp = $('dn-input');
  const nn = (inp && inp.value || '').trim();
  if(!nn){ toast('用户名不能为空'); return false; }
  if(nn.length > 24){ toast('用户名最多 24 个字符'); return false; }
  try{
    const user = await WBAuth.requireUser();           // 校验已登录本人
    const { error } = await getSupabaseClient().from('profiles')
      .update({ display_name: nn, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if(error){ toast('保存失败：' + (error.message || '未知错误')); return false; }
    state.user.name = nn;
    renderMine();
    closeSheet('sheet-displayname');
    toast('用户名已更新 ✓');
  }catch(e){
    toast('保存失败：' + (e && e.message ? e.message : '未知错误'));
  }
  return false;
}

/* ---------- 10.5 头像（Supabase private avatars bucket + profiles.avatar_path 持久） ----------
 * 头像图片只存 avatars/{user_id}/avatar.jpg（private + Storage RLS，authenticated download）；
 * 数据库仅保存路径（avatar_path），不存 Base64；当前头像 URL 仅放内存 _avatarObj，
 * 不写 localStorage、不访问 Gitee；登出/刷新自动释放 objectURL。
 * 旧 Gitee 头像逻辑（pushProfile/pullProfile）仅保留为回滚代码，本函数不再调用。 */
const _avatarObj = { url: null, path: null };   // 仅内存；登出时释放
function currentAvatar(){ return _avatarObj.url || null; }
function releaseAvatarUrl(){ if(_avatarObj.url){ try{ URL.revokeObjectURL(_avatarObj.url); }catch(e){} } _avatarObj.url = null; _avatarObj.path = null; }
function applyAvatar(elId){
  const el = $(elId);
  if(!el) return;
  const av = currentAvatar();
  if(av){ el.innerHTML = '<img src="' + av + '" alt="头像">'; }
  else{ el.textContent = (state.user ? state.user.name : '绿').charAt(0); }
}
function renderAvatarAll(){ applyAvatar('mine-avatar'); applyAvatar('home-avatar'); }
/* 点击「我的页」头像 → 放大预览 + 可选更换 */
function openAvatarEditor(){
  const av = currentAvatar();
  const big = $('avatar-big');
  big.innerHTML = av ? '<img src="' + av + '" alt="头像">' : ((state.user ? state.user.name : '绿').charAt(0));
  const rm = $('avatar-remove');
  if(rm) rm.style.display = av ? '' : 'none';
  openSheet('sheet-avatar');
}
/* v5.13.0：首页右上角头像 → 头像放大弹窗（仅查看；「我的」入口在弹窗内，不涉及头像设置流程） */
function openAvatarView(){
  const av = currentAvatar();
  const img = $('avatar-view-img');
  if(img){
    if(av){
      img.src = av;
      img.style.display = 'block';
      img.onload = function(){ if(avViewCtl) avViewCtl.reset(); };   /* 图片尺寸就绪后重新按实际大小限制平移 */
    }else{
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  }
  const letter = $('avatar-view-letter');
  if(letter){
    letter.textContent = (state.user ? state.user.name : '绿').charAt(0);
    letter.style.display = av ? 'none' : 'flex';
  }
  const nm = $('avatar-view-name');
  if(nm) nm.textContent = (state.user && state.user.name) ? state.user.name : '未登录';
  const ctl = bindAvatarView();
  if(ctl) ctl.reset();          /* v5.13.1：每次打开复位为 1x 居中 */
  openSheet('sheet-avatar-view');
}
function avatarViewGoMine(){
  closeSheet('sheet-avatar-view');
  navTo(4);
}
/* v5.13.2：头像「原图」全屏查看的手势 —— 双指捏合缩放 / 单指拖动平移，查看局部细节。
   触摸：双指缩放（1x~4x，以两指中点为锚点，手指下的位置不跑）+ 单指拖动 + 双击 1x↔2.5x 切换；
   桌面：滚轮缩放 + 双击缩放。平移范围按「图片实际显示尺寸 vs 视口」计算：
   图片（已缩放）比视口小的方向不允许拖动，保证不会把图片拖出屏幕。
   手势只在 #avatar-view-stage 上监听（打开时懒绑定一次），不影响其它元素与页面滚动。 */
let avViewCtl = null;
function bindAvatarView(){
  if(avViewCtl) return avViewCtl;
  const box = $('avatar-view-stage'); if(!box) return null;
  const st = { s:1, tx:0, ty:0, ds:0, s0:1, tx0:0, ty0:0, x0:0, y0:0, drag:false, tap:0 };
  function im(){ const el = $('avatar-view-img'); return (el && el.style.display !== 'none') ? el : null; }
  function paint(){ const el = im(); if(el) el.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.s + ')'; }
  function clampPan(){
    const el = im();
    if(!el){ st.tx = 0; st.ty = 0; return; }
    const bw = el.clientWidth || 1, bh = el.clientHeight || 1;          /* img 盒子 = stage 尺寸 */
    const nw = el.naturalWidth || bw, nh = el.naturalHeight || bh;
    const k = Math.min(bw / nw, bh / nh);                              /* contain 的实际显示比例 */
    const mx = Math.max(0, (nw * k * st.s - bw) / 2);
    const my = Math.max(0, (nh * k * st.s - bh) / 2);
    st.tx = Math.max(-mx, Math.min(mx, st.tx));
    st.ty = Math.max(-my, Math.min(my, st.ty));
  }
  /* 触点相对容器中心的坐标（用于「以手指为锚点缩放」与滚轮缩放） */
  function localXY(t){
    const r = box.getBoundingClientRect();
    return { x: (t.clientX - r.left) - r.width / 2, y: (t.clientY - r.top) - r.height / 2 };
  }
  function zoomAt(ns, cx, cy){
    ns = Math.max(1, Math.min(4, ns));
    const k = ns / st.s;
    st.tx = cx - k * (cx - st.tx);
    st.ty = cy - k * (cy - st.ty);
    st.s = ns;
    if(st.s <= 1.001){ st.s = 1; st.tx = 0; st.ty = 0; }
    clampPan(); paint();
  }
  function reset(){ st.s = 1; st.tx = 0; st.ty = 0; st.ds = 0; st.drag = false; paint(); }
  function toggle(){ if(st.s > 1.02) reset(); else zoomAt(2.5, 0, 0); }

  box.addEventListener('touchstart', function(e){
    const ts = e.touches;
    if(ts.length === 1){
      st.drag = true; st.x0 = ts[0].clientX; st.y0 = ts[0].clientY; st.tx0 = st.tx; st.ty0 = st.ty;
      const now = Date.now();
      if(now - st.tap < 280){ st.tap = 0; st.drag = false; toggle(); } else { st.tap = now; }
    }else if(ts.length === 2){
      st.drag = false;
      st.ds = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1;
      st.s0 = st.s; st.tx0 = st.tx; st.ty0 = st.ty;
    }
  }, { passive:true });

  box.addEventListener('touchmove', function(e){
    const ts = e.touches;
    if(ts.length === 2 && st.ds > 0){
      e.preventDefault();                                 /* 阻止浏览器自身的双指缩放 */
      const d = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1;
      const c = localXY({ clientX: (ts[0].clientX + ts[1].clientX) / 2, clientY: (ts[0].clientY + ts[1].clientY) / 2 });
      st.s = st.s0; st.tx = st.tx0; st.ty = st.ty0;        /* 以本次手势起点为基准，避免累积误差 */
      zoomAt(st.s0 * d / st.ds, c.x, c.y);
    }else if(st.drag && ts.length === 1 && st.s > 1.001){
      e.preventDefault();
      st.tx = st.tx0 + (ts[0].clientX - st.x0);
      st.ty = st.ty0 + (ts[0].clientY - st.y0);
      clampPan(); paint();
    }
  }, { passive:false });

  box.addEventListener('touchend', function(e){
    if(e.touches.length === 0){ st.drag = false; st.ds = 0; }
    else if(e.touches.length === 1){                      /* 双指松开剩一指 → 接着拖动 */
      st.drag = true; st.x0 = e.touches[0].clientX; st.y0 = e.touches[0].clientY;
      st.tx0 = st.tx; st.ty0 = st.ty; st.ds = 0;
    }
  }, { passive:true });

  box.addEventListener('wheel', function(e){
    e.preventDefault();
    const c = localXY(e);
    zoomAt(st.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), c.x, c.y);
  }, { passive:false });

  box.addEventListener('dblclick', function(e){
    e.preventDefault();
    const c = localXY(e);
    if(st.s > 1.02) reset(); else zoomAt(2.5, c.x, c.y);
  });

  avViewCtl = { reset: reset };
  return avViewCtl;
}
/* ===== v5.13.13：头像本地缓存（CacheStorage） =====
   为什么：头像已按「原图画质」保存（单张 1–3MB），而它每次打开 App 都要下载一次；
          本地缓存后开 App 直接命中本地 → 零流量、秒显示。
   失效机制：缓存条目的 x-wb-ver 绑定 profiles.updated_at（trg_profiles_updated_at 保证
            「换头像」必然改变该值）→ 换头像后自动失效并重新下载；缓存键含 uid → 换账号天然隔离。
   实现用 CacheStorage（HTTPS 下可用；原生支持存 Blob，无需 base64。失败一律静默降级为不缓存）。 */
const AVATAR_CACHE = 'wardrobe-avatar-v1';
const AVATAR_CACHE_PREFIX = '/__wb_avatar/';
async function avatarCacheMatch(uid, ver){
  try{
    if(!('caches' in window)) return null;
    const c = await caches.open(AVATAR_CACHE);
    const r = await c.match(AVATAR_CACHE_PREFIX + uid);
    if(!r) return null;
    if(String(r.headers.get('x-wb-ver') || '') !== String(ver || '')) return null;   /* 版本不符 → 视为未命中 */
    return await r.blob();
  }catch(e){ return null; }
}
async function avatarCachePut(uid, ver, blob){
  try{
    if(!('caches' in window) || !blob) return;
    const c = await caches.open(AVATAR_CACHE);
    await c.put(AVATAR_CACHE_PREFIX + uid,
      new Response(blob, { headers: { 'Content-Type': 'image/jpeg', 'x-wb-ver': String(ver || '') } }));
  }catch(e){}
}
async function avatarCacheDel(uid){
  try{
    if(!('caches' in window) || !uid) return;
    const c = await caches.open(AVATAR_CACHE);
    await c.delete(AVATAR_CACHE_PREFIX + uid);
  }catch(e){}
}
/* 登录后加载头像：profiles.avatar_path →（优先本地缓存）→ authenticated download → 内存显示。
 * 失败静默，占位不阻断。
 * 会话隔离：开始前记录 gen + uid；DB 查询后、缓存/下载完成后均二次校验，不匹配则丢弃结果，
 * 杜绝「登出 → 切号」后旧用户的头像回写新用户 UI（会话串扰）。 */
async function loadMyAvatar(){
  const gen = WBSession.getSessionGeneration();
  const uid = (state.user && state.user.id) || null;
  const u = await WBAuth.getCurrentUser();
  if(!u || gen !== WBSession.getSessionGeneration() || !state.user || state.user.id !== uid) return;
  try{
    const p = await getSupabaseClient().from('profiles').select('avatar_path,updated_at').eq('id', u.id).maybeSingle();
    if(gen !== WBSession.getSessionGeneration() || !state.user || state.user.id !== uid){ return; }
    if(!(p.data && p.data.avatar_path)){ releaseAvatarUrl(); avatarCacheDel(u.id); renderAvatarAll(); return; }
    const ver = String(p.data.updated_at || '');
    /* ① 先查本地缓存：命中则零下载、零等待 */
    const cached = await avatarCacheMatch(u.id, ver);
    if(cached){
      if(gen !== WBSession.getSessionGeneration() || !state.user || state.user.id !== uid) return;
      releaseAvatarUrl();
      _avatarObj.url = URL.createObjectURL(cached); _avatarObj.path = p.data.avatar_path;
      renderAvatarAll();
      return;
    }
    /* ② 未命中 → 下载，并写回缓存供下次使用 */
    const r = await WBImages.downloadAvatar();   // avatars/{uid}/avatar.jpg
    if(gen !== WBSession.getSessionGeneration() || !state.user || state.user.id !== uid){ try{ URL.revokeObjectURL(r.objectUrl); }catch(e){} return; }
    avatarCachePut(u.id, ver, r.blob);
    releaseAvatarUrl();
    _avatarObj.url = r.objectUrl; _avatarObj.path = r.path;
    renderAvatarAll();
  }catch(e){ /* 无对象/网络失败 → 保持占位，不阻断主流程 */ }
}
/* 更新 profiles.avatar_path（仅路径；不含图片正文）
   返回新的 updated_at（供头像缓存版本号使用；trg_profiles_updated_at 会刷新它） */
async function updateProfileAvatar(pathOrNull){
  const u = await WBAuth.getCurrentUser();
  if(!u) return null;
  const r = await getSupabaseClient().from('profiles')
    .update({ avatar_path: pathOrNull }).eq('id', u.id).select('updated_at').maybeSingle();
  if(r.error) throw r.error;
  return (r.data && r.data.updated_at) || null;
}
/* ===== v5.13.13：头像按「原图画质」保存（不再缩到 320×320）=====
   · 输出边长 = 原图最小边（居中裁方），仅当超过 AVATAR_MAX_EDGE 时截到上限 ——
     上限是必要的：手机 canvas 有最大尺寸限制，超大图会分配失败 → 头像空白甚至崩标签页。
   · JPEG 质量 0.95：0.95→1.0 体积近乎翻倍而肉眼无可辨差异。
   · 为什么仍然「重新编码」而不是直接上传原文件：
     ① iPhone 相册原图多为 HEIC，安卓 Chrome 无法显示 → 直传会导致头像空白；
     ② 重新编码顺带规范化 EXIF 旋转（createImageBitmap 的 imageOrientation:'from-image'）。 */
const AVATAR_MAX_EDGE = 2560;
const AVATAR_QUALITY = 0.95;
/* 输出边长：原图最小边，封顶 AVATAR_MAX_EDGE（1:1 方图，圆形由 CSS 裁） */
function avatarOutSide(w, h){
  const side = Math.min(w, h);
  return Math.max(1, Math.min(side, AVATAR_MAX_EDGE));
}
/* canvas → JPEG Blob（优先 toBlob：避免大图 base64 往返的额外内存与耗时） */
function canvasToBlob(c, quality){
  return new Promise(function(resolve, reject){
    if(typeof c.toBlob === 'function'){
      c.toBlob(function(b){ b ? resolve(b) : reject(new Error('图片编码失败')); }, 'image/jpeg', quality);
    }else{
      try{ resolve(window.dataUrlToBlob(c.toDataURL('image/jpeg', quality))); }catch(e){ reject(e); }
    }
  });
}
/* 头像图片处理：按人物中心裁成正方形 → 输出原图边长（封顶 2560）、JPEG 0.95 → 返回 Blob */
function avatarFromFile(file){
  return new Promise(function(resolve, reject){
    if(typeof createImageBitmap === 'function'){
      createImageBitmap(file, {imageOrientation:'from-image'}).then(
        function(bmp){
          const side = Math.min(bmp.width, bmp.height);
          const out = avatarOutSide(bmp.width, bmp.height);
          const c = document.createElement('canvas');
          c.width = c.height = out;
          c.getContext('2d').drawImage(bmp, (bmp.width-side)/2, (bmp.height-side)/2, side, side, 0, 0, out, out);
          bmp.close();
          canvasToBlob(c, AVATAR_QUALITY).then(resolve, reject);
        },
        function(){ resolve(avatarCropViaImage(URL.createObjectURL(file))); }
      ).catch(function(){ resolve(avatarCropViaImage(URL.createObjectURL(file))); });
    }else{
      resolve(avatarCropViaImage(URL.createObjectURL(file)));
    }
  });
}
function avatarCropViaImage(src){
  return new Promise(function(resolve, reject){
    const img = new Image();
    img.onload = function(){
      try{
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const out = avatarOutSide(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = c.height = out;
        c.getContext('2d').drawImage(img, (img.naturalWidth-side)/2, (img.naturalHeight-side)/2, side, side, 0, 0, out, out);
        URL.revokeObjectURL(src);
        canvasToBlob(c, AVATAR_QUALITY).then(resolve, reject);
      }catch(err){ URL.revokeObjectURL(src); reject(err); }
    };
    img.onerror = function(){ URL.revokeObjectURL(src); reject(new Error('图片读取失败')); };
    img.src = src;
  });
}
function handleAvatarFile(file){
  if(!file) return;
  if(!file.type || file.type.indexOf('image/') !== 0){ toast('请选择图片文件'); return; }
  if(!state.user){ toast('请先登录'); return; }
  const uid = state.user.id;
  toast('正在处理头像…');                 /* 原图画质 + 上传需要一两秒，给个反馈 */
  avatarFromFile(file).then(function(blob){
    (async function(){
      try{
        const up = await WBImages.uploadAvatar(blob);      // avatars/{uid}/avatar.jpg（upsert 覆盖）
        const ver = await updateProfileAvatar(up.path);    // DB 仅存路径；返回新的 updated_at
        if(ver) avatarCachePut(uid, ver, blob);            // 立刻写本地缓存 → 下次开 App 零下载
        releaseAvatarUrl();
        _avatarObj.url = URL.createObjectURL(blob);        // 内存显示；登出即释放，不落盘
        _avatarObj.path = up.path;
        renderAvatarAll();
        openAvatarEditor();
        const kb = blob.size / 1024;
        toast('头像已更新 ✓（' + (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB') + '）');
      }catch(err){
        const n = WBErrors.normalize(err);
        toast('头像上传失败：' + (n.message || '请重试'));
      }
    })();
  }).catch(function(err){
    toast('头像处理失败：' + (err && err.message ? err.message : '请重试'));
  });
}
function removeAvatar(){
  if(!state.user) return;
  const uid = state.user.id;
  (async function(){
    try{
      await WBImages.removeAvatar();      // Storage 删除
      await updateProfileAvatar(null);    // 清 DB 路径
      avatarCacheDel(uid);                // 清本地缓存
      releaseAvatarUrl();
      renderAvatarAll();
      openAvatarEditor();
      toast('已移除头像');
    }catch(err){
      const n = WBErrors.normalize(err);
      toast('移除头像失败：' + (n.message || '请重试'));
    }
  })();
}
$('avatarAlbumInput').addEventListener('change', function(e){
  const f = e.target.files && e.target.files[0];
  if(f) handleAvatarFile(f);
});
$('avatarCameraInput').addEventListener('change', function(e){
  const f = e.target.files && e.target.files[0];
  if(f) handleAvatarFile(f);
});

function renderSyncStatus(){
  const el = $('sync-status');
  if(state.lastSync){
    const t = new Date(state.lastSync);
    const label = isNaN(t.getTime())
      ? state.lastSync
      : t.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    el.innerHTML = '<span class="dot"></span>上次同步：' + label;
  }else{
    el.innerHTML = '<span class="dot"></span>尚未同步，数据仅保存在本设备';
  }
}
