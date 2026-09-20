/* ==========================================================================
   生活象限 · core/theme.js
   --------------------------------------------------------------------------
   Phase 3 续：Theme（UI 风格）全局基础设施 —— 两套视觉、一套业务与数据。

   自 index.html 物理抽取（**逐字节原样迁移**）：原主内联脚本 L1983–L2011（29 行，
   含原「2.1 UI 风格主题」段头注释）。
   6 个函数（0 个顶层绑定）：getTheme · applyTheme · setTheme · renderThemeUI ·
                            openThemeSheet · initTheme

   ⚠️ 依赖（保持原样）：
      · Core：WB_THEMES / THEME_LS_KEY（js/core/constants.js，**未复制到此文件**）・$ / toast（utils.js）
      · Host：openSheet（仅 openThemeSheet 内一处，运行期调用；openSheet 仍留在 index.html）
      · 不读 state / 不写 saveState / 不碰 Supabase / 不依赖 Router 与 Auth

   ⚠️ 必须留在 index.html 的原位项（**防 FOUC 硬边界**）：
      · <body> 起始处的「防闪主题」inline <script>（原 L87–L95）依旧内联、依旧早于全部外部脚本，
        且依旧使用硬编码字面量 'wardrobe.v1.theme'（此时 constants.js 尚未加载）——本次**未移动、未改动**。
      · init IIFE 中的 try{ initTheme(); }catch(e){}（启动链，Host → Theme 单向，运行期）
      · markup inline onclick：setTheme('cute') / setTheme('minimal') / openThemeSheet()（未改动）

   ⚠️ 加载顺序：core 组内 constants → utils → overlays → render → **theme** → 主内联脚本。
      本文件无 parse-time 语句，故无 TDZ 风险；视觉由 css/theme.css 的 html[data-theme=…] 全权控制，
      本模块只负责 setAttribute / localStorage / 面板选中态。
   ⚠️ Classic Script（非 ESM，无 import/export）。
   ========================================================================== */
/* ---------- 2.1 UI 风格主题（v5.8.0：一套业务与数据 + 两套视觉） ----------
   机制：<html data-theme="cute|minimal">，由 CSS 全权控制视觉 → 切换不需要刷新、
   不重渲染、不触碰任何业务状态；动态生成的内容（弹窗/日历/搜索/明细）同样自动跟随。
   持久化：localStorage（设备级，登录前也生效），复用既有 wardrobe.v1.* 命名；
   首屏由 <body> 起始处的内联脚本提前应用，避免「闪主题」。 */
function getTheme(){
  try{ const t = localStorage.getItem(THEME_LS_KEY); return WB_THEMES.indexOf(t) >= 0 ? t : 'cute'; }catch(e){ return 'cute'; }
}
function applyTheme(t, persist){
  if(WB_THEMES.indexOf(t) < 0) t = 'cute';
  try{ document.documentElement.setAttribute('data-theme', t); }catch(e){}
  if(persist){ try{ localStorage.setItem(THEME_LS_KEY, t); }catch(e){} }
  renderThemeUI();
}
function setTheme(t){
  applyTheme(t, true);
  toast(t === 'minimal' ? '已切换为「极简简约」✓' : '已切换为「活力卡通」✓');
}
/* 同步「我的」页副标题与选择面板选中态（元素不存在时静默跳过） */
function renderThemeUI(){
  const t = getTheme();
  const sub = $('mine-theme-sub');
  if(sub) sub.textContent = (t === 'minimal' ? '极简简约' : '活力卡通');
  document.querySelectorAll('[data-theme-opt]').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-theme-opt') === t);
  });
}
function openThemeSheet(){ renderThemeUI(); openSheet('sheet-theme'); }
function initTheme(){ applyTheme(getTheme(), false); }
