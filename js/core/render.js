/* ==========================================================================
   生活象限 · core/render.js
   --------------------------------------------------------------------------
   只收录「跨页面共享」的纯渲染 helper：HTML 转义、详情字段行、SVG 图表标注/格式化。
   全部为纯函数：不读 state、不碰业务数据、不依赖任何页面函数、不依赖 Supabase。

   ⚠️ 仍是 Classic Script（非 ESM）：顶层 function 声明即全局对象属性，
      inline onclick 与动态 HTML 侧无需任何 window.* 包装。

   ⚠️ 加载位置：core 组，紧跟 js/core/overlays.js、位于主内联 <script> 之前
      （constants.js → utils.js → overlays.js → render.js → 主内联脚本）。
      实测这些 helper 在主脚本解析期 0 次被调用，加载期无副作用。

   ⚠️ lgEsc 与 spEsc 目前字节级相同，但**不得合并、重命名或互相替代**：
      两者分属 Ledger / Sleep 的既有语义，合并属于重构（本阶段禁止）。

   内部依赖（同批迁入，故依赖落在本文件内）：wbRowHTML → spEsc；wbChartLabel → lgEsc。

   下方内容自 index.html **逐字节原样迁出**（含各自专属注释），原行号：
     wbRowHTML L2740–2744 · lgEsc L5221 · wbChartLabel L7205–7210 ·
     wbMoneyShort L7211–7217 · wbDarken L7218–7224 · spEsc L7349
   ========================================================================== */

function spEsc(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function lgEsc(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* 通用「字段行」（详情弹窗用）：k=标签、v=值（已转义或受控 HTML）、cls=可选样式类 */
function wbRowHTML(k, v, cls){
  return '<div class="wb-row"><span class="k">' + spEsc(k) + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' +
    (v == null || v === '' ? '—' : v) + '</span></div>';
}

/* v5.9.0：图表数值标注公共助手——白描边(paint-order:stroke)保证文字叠在柱体/线条上仍清晰 */
function wbChartLabel(x, y, text, fs, fill){
  return '<text x="' + (+x).toFixed(1) + '" y="' + (+y).toFixed(1) + '" text-anchor="middle" font-size="' + fs +
    '" font-weight="700" fill="' + fill + '" stroke="#fff" stroke-width="' + (fs * 0.26).toFixed(1) +
    '" paint-order="stroke" stroke-linejoin="round">' + lgEsc('' + text) + '</text>';
}

/* 金额紧凑显示：≥1000 → 1.2k；≥100 → 取整；否则最多 1 位小数（压缩标注宽度、降低重叠） */
function wbMoneyShort(v){
  v = Number(v) || 0; const a = Math.abs(v);
  if(a >= 1000) return (Math.round(v / 100) / 10) + 'k';
  if(a >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

/* 颜色压暗：给数值标注用，保证在浅色底上可读（柱/线仍用原色） */
function wbDarken(hex, f){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if(!m) return hex || '#33463a';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
