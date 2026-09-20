/* ==========================================================================
   生活象限 · core/utils.js
   --------------------------------------------------------------------------
   只收录「无业务依赖」的公共工具函数：不读 state、不碰业务页面 DOM、
   不依赖 Supabase、不依赖初始化顺序、不依赖函数名在 index.html 中的位置。

   ⚠️ 加载顺序：本文件必须在 index.html 的主内联 <script> **之前**加载。
      主脚本里有约 25 处「解析期顶层语句」直接调用 $()（例如
      $('ckAddMat').onclick = ...），若本文件晚于主脚本加载，
      会抛 ReferenceError: Cannot access '$' before initialization（整个 App 崩）。

   下方内容由 tools/core-extract.cjs 自 index.html **逐字节原样迁出**
   （v5.14.5 / Phase 3，位置迁移，非重构）。
   复验：node tools/core-extract.cjs --verify
   ========================================================================== */

const $ = id => document.getElementById(id);

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove('show'), 1800);
}

function base64Encode(str){ return btoa(unescape(encodeURIComponent(str))); }

function base64Decode(b64){ return decodeURIComponent(escape(atob(b64))); }

function parseTs(v){
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function isDataURL(v){ return typeof v === 'string' && v.indexOf('data:') === 0; }

function dataURLToBase64(dataUrl){
  const idx = String(dataUrl).indexOf(',');
  return idx >= 0 ? String(dataUrl).slice(idx + 1) : String(dataUrl);
}

function mergeById(localArr, remoteArr){
  const seen = new Set();
  const merged = [];
  (remoteArr || []).forEach(x=>{ if(x && x.id != null){ merged.push(x); seen.add(x.id); } });
  (localArr || []).forEach(x=>{
    if(x && x.id != null && !seen.has(x.id)){ merged.push(x); seen.add(x.id); }
  });
  return merged;
}
