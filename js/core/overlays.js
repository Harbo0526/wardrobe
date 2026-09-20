/* ==========================================================================
   生活象限 · core/overlays.js
   --------------------------------------------------------------------------
   只收录「跨页面通用弹窗（Modal）框架」：不读 state、不碰业务数据、
   不含任何业务分支、不依赖任何页面函数、不依赖 Supabase。

   契约（页面侧提供 cfg，本模块只负责显隐）：
     cfg = { mask: 遮罩元素 id, title: 标题元素 id,
             viewBox: 详情容器 id, formBox: 表单容器 id }
   调用方：备忘录 / 记账 / 待办 / 油费 各自的 *_MODAL 常量仍留在 index.html（业务归属）。

   ⚠️ 加载顺序：必须在 index.html 的主内联 <script> 之前（与 core/constants.js、
      core/utils.js 同组）；本文件顶层无副作用、不访问 DOM。
      内联 onclick 未使用本模块（0 处），故无需挂 window；
      classic script 的顶层 function 声明本身即是全局对象属性，运行期调用可直接解析。

   下方内容由 tools/core-extract.cjs 自 index.html **逐字节原样迁出**
   （v5.14.6 / Phase 4，位置迁移，非重构）。
   复验：node tools/core-extract.cjs --verify
   ========================================================================== */

/* ================= v5.7.2：明细「放大查看 + 二次编辑」通用弹窗框架 =================
   备忘录 / 油费记录 / 记账明细 共用同一套 DOM（.wb-mask / .wb-modal）与同一套显隐逻辑，
   每个功能只需给出 4 个元素 id 的 cfg（mask / title / viewBox / formBox），避免出现多套操作方式。 */
function wbModalBox(cfg, view){
  const v = $(cfg.viewBox), f = $(cfg.formBox);
  if(v) v.style.display = view ? 'block' : 'none';
  if(f) f.style.display = view ? 'none' : 'block';
}
function wbModalShow(cfg, view, titleText){
  const m = $(cfg.mask); if(!m) return;
  const t = $(cfg.title); if(t && titleText != null) t.textContent = titleText;
  wbModalBox(cfg, view);
  m.style.display = 'flex';
}
function wbModalHide(cfg){ const m = $(cfg.mask); if(m) m.style.display = 'none'; }
