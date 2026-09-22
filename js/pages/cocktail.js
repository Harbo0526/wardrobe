/* ==========================================================================
   生活象限 · pages/cocktail.js
   --------------------------------------------------------------------------
   调酒页（底部导航常驻 tab）的全部页面逻辑：混调 / 材料库 / 配方 / 备份。
   由 index.html 原样迁出（v5.14.7 / Phase 5，位置迁移，非重构）。

   ⚠️ 仍是 Classic Script（非 ESM）：顶层 function 声明即全局对象属性，
      因此 inline onclick 与动态 HTML 里的 ck* 调用无需任何 window.* 包装。

   ⚠️ 加载位置：主内联 <script> 之后。加载期只做事件绑定
      （$('ckX').onclick = …），不触发业务数据读写；
      其依赖 $ / toast（js/core）、openSheet / closeSheet（主脚本）此时均已就绪。

   仍留在 index.html 的依赖（本 Phase 明确不迁移，勿顺手搬动）：
     state（唯一来源）· CK_PANELS / ckMix / ckEditId（主脚本顶层 let/const，
     全局词法绑定，跨 classic script 可见）· ckRecImgPath / userDir /
     getGiteeToken / giteeFetch · sbSaveObj / sbRemoveObj（js/bridge、js/data）

   下方内容自 index.html **逐字节原样迁出**（原 L1969–2446）。
   ========================================================================== */

/* ---------- 调酒模块（内嵌为底部导航常驻 tab） ----------
   V2.5.0：去掉 iframe，调酒直接内嵌为衣橱的常驻页面。
   布局：左侧竖直功能卡片（调酒 / 材料库 / 配方 / 备份）+ 右侧主区随卡片切换。
   数据：直接读写 state.cocktail（随衣橱按账号隔离、统一云同步），不再有第二仓库 / 令牌。 */
const CK_PANELS = { mix:'ckp-mix', mat:'ckp-mat', rec:'ckp-rec', bak:'ckp-bak' };
let ckMix = [];          // 当前混调临时态 [{matId, vol}]，不持久化
let ckEditId = null;     // 材料弹层正在编辑的 id（null=新增）

function ckRoot(){ return state.cocktail; }
function ckUid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function ckEsc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function ckMoney(n){ return '¥' + (Math.round(n*100)/100).toFixed(2); }
function ckUnit(m){ return m.vol > 0 ? m.price/m.vol : 0; }
/* v5.30.0：首页「调酒」入口卡摘要（纯函数：只读 state.cocktail，不写 DOM / 不发网络 / 不改状态）
   · value = 配方数量（核心数据，大字号）；「个配方」由 HTML 直接写在核心数据右侧
   · aux   = 材料数量（放在模块名一行的右侧 —— 卡片不增高）
   设计结论：**数量型数据不使用任何图形** —— 点阵/双条既与数字重复表达同一信息，
   又不可扩展（配方数超过约 9 个就放不进小卡片文字区），故首页只报真实数量。
   ⚠️ 不调用 ckSeed()（它会写库注入示例材料），只读现有数据。 */
function ckHomeSummary(){
  const r = (state.cocktail && typeof state.cocktail === 'object') ? state.cocktail : null;
  const n = (r && Array.isArray(r.recipes)) ? r.recipes.length : 0;
  const m = (r && Array.isArray(r.materials)) ? r.materials.length : 0;
  return {
    value: String(n),
    aux: '材料 ' + m + ' 种'
  };
}
function ckMatById(id){ return ckRoot().materials.find(m => m.id === id) || null; }
function ckCatIcon(c){
  if(c === '基酒') return '<path d="M5 4h14l-7 8z"/><path d="M12 12v6"/>';
  if(c === '辅料') return '<path d="M12 3c4 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2-6 6-10z"/>';
  return '<rect x="4" y="4" width="16" height="16" rx="3"/>';
}
function ckSave(){ /* Phase 14：调酒内存变更经 sbSaveObj 实时同步 Supabase；此函数保留为兼容空操作 */ }
function openCkModal(id){ $(id).classList.add('show'); }
function closeCkModal(id){ $(id).classList.remove('show'); }

/* 左侧卡片 ↔ 右侧面板切换 */
function ckSwitch(key){
  document.querySelectorAll('#ckSide .ck-scard').forEach(b => b.classList.toggle('active', b.dataset.ck === key));
  Object.keys(CK_PANELS).forEach(k => $(CK_PANELS[k]).classList.toggle('active', k === key));
}
document.querySelectorAll('#ckSide .ck-scard').forEach(b => { b.onclick = () => ckSwitch(b.dataset.ck); });

/* 首次进入注入示例材料（Phase 14：仅当 Supabase 材料库为空时注入一次，并同步 DAL） */
function ckSeed(){
  const r = ckRoot();
  if(r.materials.length > 0) return;                 // 幂等：云端已有材料（含历史会话注入）则不再注入
  [ {name:'白朗姆酒', cat:'基酒', abv:40, price:68, vol:700},
    {name:'蓝橙力娇酒', cat:'基酒', abv:20, price:55, vol:500},
    {name:'桃汁', cat:'辅料', abv:0, price:12, vol:1000},
    {name:'鲜柠檬汁', cat:'辅料', abv:0, price:8, vol:200},
    {name:'糖浆', cat:'辅料', abv:0, price:15, vol:250}
  ].forEach(function(m){
    const mat = Object.assign({ id: wbUuid(), _sbSaved: false }, m);
    r.materials.push(mat);
    sbSaveObj('materials', mat, {name: mat.name, category: mat.cat, abv: mat.abv, price: mat.price, volume_ml: mat.vol});
  });
}

/* ---------- 材料库 ---------- */
function ckRenderMats(){
  const box = $('ckMatList'), r = ckRoot();
  if(!r.materials.length){
    box.innerHTML = '<div class="empty"><span class="empty-emoji">🧊</span><div class="empty-text">材料库还是空的，点右上角「新增」</div></div>';
  }else{
    box.innerHTML = r.materials.map(m =>
      '<div class="ck-mat">' +
        '<div class="ck-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ckCatIcon(m.cat) + '</svg></div>' +
        '<div class="ck-info"><div class="nm">' + ckEsc(m.name) + '</div>' +
          '<div class="sub">' + (m.cat === '基酒' ? ('酒精度 ' + m.abv + '% · ') : '') + m.vol + 'ml / ' + ckMoney(m.price) + ' · 单价 <b>' + ckMoney(ckUnit(m)) + '/ml</b></div></div>' +
        '<button class="ck-iconbtn ck-more" data-ckmore="' + m.id + '" aria-label="更多操作"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>' +
      '</div>').join('');
    box.querySelectorAll('[data-ckmore]').forEach(b => { b.onclick = (e) => { e.stopPropagation(); openMatMenu(b.dataset.ckmore); }; });
  }
  $('ckStatMat').textContent = r.materials.length;
  $('ckStatRec').textContent = r.recipes.length;
}
function ckDelMat(id){
  if(!confirm('确定删除该材料？')) return;
  const r = ckRoot();
  const del = r.materials.find(m => m.id === id);
  r.materials = r.materials.filter(m => m.id !== id);
  ckMix = ckMix.filter(x => x.matId !== id);
  if(del) sbRemoveObj('materials', del);
  ckRenderMats(); ckRenderMix();
}
// 材料操作菜单（三个点 → 编辑 / 删除）
let ckMenuId = null;
function openMatMenu(id){ ckMenuId = id; openSheet('sheet-mat-menu'); }
function ckEditFromMenu(){ closeSheet('sheet-mat-menu'); if(ckMenuId) ckOpenMat(ckMenuId); }
function ckDelFromMenu(){ closeSheet('sheet-mat-menu'); if(ckMenuId) ckDelMat(ckMenuId); }
function ckOpenMat(id){
  ckEditId = id || null;
  $('ckMatTitle').textContent = id ? '编辑材料' : '新增材料';
  const m = id ? ckMatById(id) : null;
  $('ckMName').value  = m ? m.name  : '';
  $('ckMCat').value   = m ? m.cat   : '基酒';
  $('ckMAbv').value   = m ? m.abv   : '';
  $('ckMPrice').value = m ? m.price : '';
  $('ckMVol').value   = m ? m.vol   : '';
  openCkModal('ckMatModal');
}
$('ckAddMat').onclick = () => ckOpenMat(null);
$('ckMatCancel').onclick = () => closeCkModal('ckMatModal');
$('ckMatSave').onclick = function(){
  const name  = $('ckMName').value.trim(),
        cat   = $('ckMCat').value,
        abv   = parseFloat($('ckMAbv').value) || 0,
        price = parseFloat($('ckMPrice').value) || 0,
        vol   = parseFloat($('ckMVol').value) || 0;
  if(!name){ toast('请填写名称'); return; }
  if(vol <= 0){ toast('总体积需大于0'); return; }
  if(abv < 0 || abv > 100){ toast('酒精度 0~100'); return; }
  const r = ckRoot();
  if(ckEditId){
    const m = ckMatById(ckEditId);
    if(m){ m.name = name; m.cat = cat; m.abv = abv; m.price = price; m.vol = vol; sbSaveObj('materials', m, {name: name, category: cat, abv: abv, price: price, volume_ml: vol}); }
  }else{
    const m = { id: wbUuid(), name: name, cat: cat, abv: abv, price: price, vol: vol, _sbSaved: false };
    r.materials.push(m);
    sbSaveObj('materials', m, {name: name, category: cat, abv: abv, price: price, volume_ml: vol});
  }
  closeCkModal('ckMatModal'); ckRenderMats(); ckRenderMix(); toast('已保存');
};
/* 「清空示例数据」按钮已于 V4.4.0 移除；ckSeed 的首次示例注入保留（可逐条手动删除）。 */

/* ---------- 混调（调酒主区） ---------- */
function ckCompute(){
  let tv = 0, tc = 0, al = 0;
  ckMix.forEach(x => {
    const m = ckMatById(x.matId); if(!m) return;
    tv += x.vol; tc += x.vol * ckUnit(m); al += x.vol * (m.abv/100);
  });
  // 酒精度以「目标体积（成品体积，含加冰融化的水）」为底计算，而非仅配方材料体积之和；
  // 未填目标体积、或目标体积不大于材料体积时，回退为材料体积之和，避免出现虚高酒精度。
  const target = parseFloat($('ckTargetVol').value) || 0;
  const denom = target > tv ? target : tv;   // 成品体积（含加冰融化的水）；未填则回退材料体积之和
  return { totalVol: tv, totalCost: tc, abv: denom > 0 ? al/denom*100 : 0, served: denom };
}
function ckTotals(){
  const c = ckCompute();
  $('ckPrice').textContent = ckMoney(c.totalCost);
  $('ckAbv').innerHTML = c.abv.toFixed(1) + '<small>%</small>';
  $('ckVol').innerHTML = Math.round(c.served) + '<small>ml</small>';
  $('ckWarn').classList.toggle('show', c.abv >= 20);
  ckRenderQuick();
}
function ckRenderMix(){
  const box = $('ckMixList'), empty = $('ckMixEmpty');
  if(!ckMix.length){
    box.innerHTML = '';
    empty.style.display = '';
  }else{
    empty.style.display = 'none';
    box.innerHTML = ckMix.map(x => {
      const m = ckMatById(x.matId); if(!m) return '';
      return '<div class="ck-mix">' +
        '<div class="nm">' + ckEsc(m.name) + '<small>' + (m.cat === '基酒' ? (m.abv + '% · ') : '') + ckMoney(ckUnit(m)) + '/ml</small></div>' +
        '<div class="vol"><input type="number" min="0" step="1" value="' + x.vol + '" data-cmv="' + m.id + '"></div>' +
        '<div class="cost" data-cmc="' + m.id + '">' + ckMoney(x.vol * ckUnit(m)) + '</div>' +
        '<button class="ck-iconbtn del" data-cmr="' + m.id + '" aria-label="移除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>';
    }).join('');
    box.querySelectorAll('[data-cmv]').forEach(inp => {
      inp.oninput = function(){
        const id = inp.dataset.cmv, v = parseFloat(inp.value) || 0;
        const it = ckMix.find(x => x.matId === id); if(it) it.vol = v;
        const m = ckMatById(id);
        const c = box.querySelector('[data-cmc="' + id + '"]');
        if(c && m) c.textContent = ckMoney(v * ckUnit(m));
        ckTotals();
      };
    });
    box.querySelectorAll('[data-cmr]').forEach(b => {
      b.onclick = function(){ ckMix = ckMix.filter(x => x.matId !== b.dataset.cmr); ckRenderMix(); };
    });
  }
  ckTotals();
}
function ckRenderPick(){
  const q = ($('ckPickSearch').value || '').trim().toLowerCase();
  const list = $('ckPickList');
  const shown = ckRoot().materials.filter(m => m.name.toLowerCase().indexOf(q) >= 0);
  if(!shown.length){ list.innerHTML = '<div class="empty"><div class="empty-text">没有匹配的材料</div></div>'; return; }
  list.innerHTML = shown.map(m =>
    '<div class="ck-mat" data-ckp="' + m.id + '" style="cursor:pointer;">' +
      '<div class="ck-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ckCatIcon(m.cat) + '</svg></div>' +
      '<div class="ck-info"><div class="nm">' + ckEsc(m.name) + '</div>' +
        '<div class="sub">' + (m.cat === '基酒' ? (m.abv + '% · ') : '') + ckMoney(ckUnit(m)) + '/ml</div></div>' +
      '<span style="color:var(--primary-deep);font-size:18px;">＋</span>' +
    '</div>').join('');
  list.querySelectorAll('[data-ckp]').forEach(row => {
    row.onclick = function(){
      const id = row.dataset.ckp, m = ckMatById(id);
      if(m && !ckMix.some(x => x.matId === id)) ckMix.push({ matId: id, vol: m.cat === '基酒' ? 45 : 50 });
      closeCkModal('ckPickModal'); ckRenderMix();
    };
  });
}
$('ckPickSearch').oninput = ckRenderPick;
$('ckAddMix').onclick = function(){
  if(!ckRoot().materials.length){ toast('请先到材料库添加材料'); return; }
  $('ckPickSearch').value = ''; ckRenderPick(); openCkModal('ckPickModal');
};
$('ckScale').onclick = function(){
  const target = parseFloat($('ckTargetVol').value) || 0;
  if(target <= 0){ toast('请输入目标体积'); return; }
  const cur = ckMix.reduce((s, x) => s + x.vol, 0);
  if(cur <= 0){ toast('请先添加材料'); return; }
  const f = target / cur;
  ckMix.forEach(x => { x.vol = Math.max(1, Math.round(x.vol * f)); });
  ckRenderMix(); toast('已缩放到 ' + Math.round(target) + 'ml');
};
$('ckClearMix').onclick = function(){ ckMix = []; ckEditingId = null; ckRenderMix(); };   // 清空同时退出二次编辑态

/* ---------- 配方 ---------- */
function ckRenderRecs(){
  const box = $('ckRecList'), r = ckRoot();
  if(!r.recipes.length){
    box.innerHTML = '<div class="empty"><span class="empty-emoji">📖</span><div class="empty-text">还没有保存的配方</div></div>';
    return;
  }
  // 卡片：左信息 + 右成品图；点击弹详情，长按弹操作菜单（调入/传图/编辑/删除全部收纳，V4.4.0）
  box.innerHTML = r.recipes.slice().reverse().map(rec =>
    '<div class="ck-mat ck-rec-card" data-ckrec="' + rec.id + '">' +
      '<div class="ck-info"><div class="nm">' + ckEsc(rec.name) + '</div>' +
        '<div class="sub">' + rec.totalVol + 'ml · <b>' + ckMoney(rec.totalCost) + '</b> · 酒精度 ' + (rec.abv || 0).toFixed(1) + '%' + (rec.note ? ' · 📝' : '') + '</div></div>' +
      (rec.img
        ? '<img class="ck-rec-thumb" src="' + rec.img + '" alt="' + ckEsc(rec.name) + '">'
        : '<div class="ck-rec-thumb ck-rec-thumb-ph">🍸</div>') +
    '</div>').join('');
  box.querySelectorAll('[data-ckrec]').forEach(el => { attachRecLongPress(el, el.dataset.ckrec); });
}

/* ---------- 配方卡：长按操作菜单 + 点击详情（与衣物卡长按同模式） ---------- */
let ckRecMenuId = null;      // 长按菜单当前对应的配方 id
let ckRecViewId = null;      // 详情弹窗当前展示的配方 id
let ckRecImgTargetId = null; // 待上传图片的目标配方 id
let ckEditingId = null;      // 二次编辑：正在编辑的配方 id（保存回原配方）

/* 为配方卡绑定长按手势：600ms 弹出操作菜单；短按弹详情，suppressClick 保证二者不冲突 */
function attachRecLongPress(el, recId){
  let timer = null, feedbackTimer = null, startX = 0, startY = 0, suppressClick = false;
  function cancel(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(feedbackTimer){ clearTimeout(feedbackTimer); feedbackTimer = null; }
    el.classList.remove('longpressing');
  }
  function begin(x, y){
    if(timer) return;
    startX = x; startY = y; suppressClick = false;
    feedbackTimer = setTimeout(function(){ el.classList.add('longpressing'); }, 480);
    timer = setTimeout(function(){
      timer = null; suppressClick = true;
      el.classList.remove('longpressing');
      openRecMenu(recId);
    }, 600);
  }
  function move(x, y){
    if(!timer) return;
    if(Math.abs(x-startX) > 10 || Math.abs(y-startY) > 10){ cancel(); }   // 视为滚动/取消
  }
  el.addEventListener('touchstart', function(e){
    const t = e.touches && e.touches[0];
    begin(t ? t.clientX : 0, t ? t.clientY : 0);
  }, {passive:true});
  el.addEventListener('touchmove', function(e){
    const t = e.touches && e.touches[0];
    if(t) move(t.clientX, t.clientY);
  }, {passive:true});
  el.addEventListener('touchend', function(){ cancel(); }, {passive:true});
  el.addEventListener('touchcancel', function(){ cancel(); }, {passive:true});
  el.addEventListener('mousedown', function(e){ begin(e.clientX, e.clientY); });
  el.addEventListener('mousemove', function(e){ move(e.clientX, e.clientY); });
  el.addEventListener('mouseup', function(){ cancel(); });
  el.addEventListener('mouseleave', function(){ cancel(); });
  el.addEventListener('click', function(){
    if(suppressClick){ suppressClick = false; return; }
    showRecipe(recId);
  });
}

/* 长按菜单：调入调酒台 / 上传图片 / 二次编辑 / 删除 */
function openRecMenu(id){
  const rec = ckRoot().recipes.find(x=>x.id===id);
  if(!rec) return;
  ckRecMenuId = id;
  openSheet('sheet-ck-rec-menu');
}
function ckRecMenuLoad(){ closeSheet('sheet-ck-rec-menu'); if(ckRecMenuId){ ckLoadRecipe(ckRecMenuId); } }
function ckRecMenuUpload(){
  closeSheet('sheet-ck-rec-menu');
  if(!ckRecMenuId) return;
  ckRecImgTargetId = ckRecMenuId;
  $('ckRecImgInput').click();
}
function ckRecMenuEdit(){ closeSheet('sheet-ck-rec-menu'); if(ckRecMenuId) ckEditRecipe(ckRecMenuId); }
function ckRecMenuDelete(){ closeSheet('sheet-ck-rec-menu'); if(ckRecMenuId) ckDeleteRecipe(ckRecMenuId); }

/* 删除配方：本地删除 + 联动删除云端图片文件（失败仅提示，不阻塞主流程） */
function ckDeleteRecipe(id){
  const r = ckRoot(), rec = r.recipes.find(x=>x.id===id);
  if(!rec) return;
  if(!confirm('删除配方「' + rec.name + '」？其图片与备注将一并删除。')) return;
  r.recipes = r.recipes.filter(x => x.id !== id);
  if(ckEditingId === id) ckEditingId = null;
  if(ckRecViewId === id){ ckRecViewId = null; closeCkModal('ckRecViewModal'); }
  sbRemoveObj('recipes', rec);                       // Phase 14：软删除配方
  if(typeof WBData.recipeItems.removeByRecipe === 'function'){
    WBData.recipeItems.removeByRecipe(id).catch(function(){ /* 关系清理失败不阻塞 */ });
  }
  ckRenderRecs(); ckRenderQuick();
  toast('配方已删除');
}

/* 点击配方卡 → 放大详情：大图 + 材料明细 + 成本/酒精度 + 可编辑备注 */
function showRecipe(id){
  const rec = ckRoot().recipes.find(x=>x.id===id);
  if(!rec) return;
  ckRecViewId = id;
  $('ckRecViewImgWrap').innerHTML = rec.img
    ? '<img src="' + rec.img + '" alt="' + ckEsc(rec.name) + '">'
    : '<div class="ck-rec-ph-big">🍸</div>';
  $('ckRecViewName').textContent = rec.name;
  $('ckRecViewMeta').textContent = '总体积 ' + rec.totalVol + 'ml · 成本 ' + ckMoney(rec.totalCost) + ' · 酒精度 ' + (rec.abv || 0).toFixed(1) + '%';
  $('ckRecViewItems').innerHTML = (rec.items || []).map(function(it){
    const m = ckMatById(it.matId);
    return '<div class="ck-item-row"><span>' + (m ? ckEsc(m.name) : '（材料已删除）') + '</span><b>' + it.vol + 'ml</b></div>';
  }).join('') || '<div class="ck-hint">该配方没有材料明细</div>';
  $('ckRecViewNote').value = rec.note || '';
  openCkModal('ckRecViewModal');
}
$('ckRecViewNoteSave').onclick = function(){
  const rec = ckRecViewId && ckRoot().recipes.find(x=>x.id===ckRecViewId);
  if(!rec) return;
  rec.note = $('ckRecViewNote').value.trim();
  sbSaveObj('recipes', rec, {note: rec.note});      // Phase 14：备注经 DAL 保存
  ckRenderRecs();
  closeCkModal('ckRecViewModal');
  toast('备注已保存');
};
/* 详情弹窗内换图：点大图或「更换图片」按钮均可 */
function ckRecViewPickImage(){
  if(!ckRecViewId) return;
  ckRecImgTargetId = ckRecViewId;
  $('ckRecImgInput').click();
}
$('ckRecViewImgWrap').onclick = ckRecViewPickImage;
$('ckRecViewImgBtn').onclick = ckRecViewPickImage;

/* 配方图片选择（系统选择器含相册/相机）：压缩 → 写入配方 → 下次同步上传云端独立 jpg */
$('ckRecImgInput').addEventListener('change', async function(e){
  const f = e.target.files && e.target.files[0];
  e.target.value = '';                       // 允许下次再选同一张图
  if(!f || !ckRecImgTargetId) return;
  const targetId = ckRecImgTargetId;
  ckRecImgTargetId = null;
  const rec = ckRoot().recipes.find(x=>x.id===targetId);
  if(!rec) return;
  try{
    toast('图片处理中…');
    const d = await compressImage(f);
    rec.img = d;
    rec.imgRemote = '';
    sbUploadCocktailImageFor(rec);           // Phase 14：dataURL → private Storage（upsert 覆盖）
    ckRenderRecs(); ckRenderQuick();
    if(ckRecViewId === targetId) showRecipe(targetId);   // 详情弹窗开着则刷新大图
    toast('图片已更新并上传云端');
  }catch(err){
    toast('图片处理失败：' + (err && err.message ? err.message : '未知错误'));
  }
});

/* 二次编辑：把配方载入调酒台 → 调整名称/用量/增删材料 → 点「保存为配方」写回原配方（保留图片与备注） */
function ckEditRecipe(id){
  const rec = ckRoot().recipes.find(x=>x.id===id);
  if(!rec) return;
  ckLoadRecipe(id);                          // 内部会退出其他编辑态，须在其后置值
  ckEditingId = id;
  toast('编辑「' + rec.name + '」：调整后点「保存为配方」写回原配方');
}
function ckRenderQuick(){
  const box = $('ckQuick'), r = ckRoot();
  if(!r.recipes.length){ box.innerHTML = '<div class="ck-hint">保存配方后会出现在这里，一键调入</div>'; return; }
  box.innerHTML = r.recipes.slice(-4).reverse().map(rec =>
    '<div class="chip" data-ckq="' + rec.id + '">🍹 ' + ckEsc(rec.name) + '</div>').join('');
  box.querySelectorAll('[data-ckq]').forEach(c => { c.onclick = () => ckLoadRecipe(c.dataset.ckq); });
}
$('ckSaveRecipe').onclick = function(){
  if(!ckMix.length){ toast('先添加材料再保存'); return; }
  if(ckCompute().totalVol <= 0){ toast('用量不能为0'); return; }
  $('ckRecName').value = ''; openCkModal('ckRecModal');
};
$('ckRecCancel').onclick = () => closeCkModal('ckRecModal');
$('ckRecSave').onclick = function(){
  const name = $('ckRecName').value.trim() || ('配方' + (ckRoot().recipes.length + 1));
  const c = ckCompute();
  /* 二次编辑：写回原配方（保留 id/图片/备注） */
  if(ckEditingId){
    const old = ckRoot().recipes.find(x=>x.id===ckEditingId);
    if(old){
      old.name = name;
      old.items = ckMix.map(x => ({ matId: x.matId, vol: x.vol }));
      old.totalVol = Math.round(c.served); old.totalCost = c.totalCost; old.abv = c.abv;
      sbSaveObj('recipes', old, {name: name, total_volume_ml: old.totalVol, total_cost: old.totalCost, abv: old.abv});
      if(typeof WBData.recipeItems.removeByRecipe === 'function'){
        WBData.recipeItems.removeByRecipe(old.id).then(function(){
          old.items.forEach(function(it, i){
            WBData.recipeItems.create({recipe_id: old.id, material_id: it.matId, quantity: it.vol, unit: 'ml', sort_order: i})
              .then(function(r){ if(r.error) throw r.error; }).catch(function(){});
          });
        }).catch(function(){});
      }
      ckEditingId = null;
      closeCkModal('ckRecModal'); ckRenderRecs(); ckRenderQuick();
      toast('配方已更新');
      return;
    }
    ckEditingId = null;
  }
  /* 新建配方 */
  const rec = {
    id: wbUuid(), name: name,
    items: ckMix.map(x => ({ matId: x.matId, vol: x.vol })),
    totalVol: Math.round(c.served), totalCost: c.totalCost, abv: c.abv, ts: Date.now(), _sbSaved: false
  };
  ckRoot().recipes.push(rec);
  sbSaveObj('recipes', rec, {name: name, total_volume_ml: Math.round(c.served), total_cost: c.totalCost, abv: c.abv});
  rec.items.forEach(function(it, i){
    WBData.recipeItems.create({recipe_id: rec.id, material_id: it.matId, quantity: it.vol, unit: 'ml', sort_order: i})
      .then(function(r){ if(r.error) throw r.error; }).catch(function(){ /* 单条失败不阻塞 UI */ });
  });
  closeCkModal('ckRecModal'); ckRenderRecs(); toast('配方已保存');
};
function ckLoadRecipe(id){
  const rec = ckRoot().recipes.find(x => x.id === id);
  if(!rec) return;
  ckMix = rec.items.filter(it => ckMatById(it.matId)).map(it => ({ matId: it.matId, vol: it.vol }));
  ckRenderMix(); ckSwitch('mix'); toast('已调入「' + rec.name + '」');
}

/* ---------- 备份 / 同步 ---------- */
$('ckSync').onclick = function(){ doSync(); };

/* 手动从云端拉取（仅调酒，完全不涉及衣物数据）
   用途：换设备后取回远程仓库的 cocktail.json，以远端为准覆盖本机材料库与配方。 */
async function ckPullFromCloud(){
  if(!state.user){ toast('请先登录'); return; }
  // v5.1.3：统一为 Supabase 手动下拉刷新（数据实时上传，无需 Gitee；按钮文案已改为「手动刷新云端」）
  try{
    await sbLoadAll();
    ckSwitch('mix'); ckRenderAll();
    toast('已从云端刷新调酒数据 ✓');
  }catch(err){
    toast('刷新失败：' + (err && err.message ? err.message : '未知错误'));
  }
}
$('ckPull').onclick = ckPullFromCloud;
$('ckExport').onclick = function(){
  const r = ckRoot();
  const data = { materials: r.materials, recipes: r.recipes, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '调酒备份_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click(); toast('已导出');
};
$('ckImport').onclick = () => $('ckImportFile').click();
$('ckImportFile').onchange = function(e){
  const f = e.target.files[0]; if(!f) return;
  const rd = new FileReader();
  rd.onload = function(){
    try{
      const d = JSON.parse(rd.result), r = ckRoot();
      if(Array.isArray(d.materials)) r.materials = r.materials.concat(d.materials.filter(m => m && m.name && m.vol > 0));
      if(Array.isArray(d.recipes))   r.recipes   = r.recipes.concat(d.recipes.filter(x => x && x.name));
      ckSave(); ckRenderAll();
      toast('已导入 ' + d.materials.length + ' 材料 / ' + d.recipes.length + ' 配方');
    }catch(err){ toast('文件格式错误'); }
  };
  rd.readAsText(f); e.target.value = '';
};
$('ckWipe').onclick = function(){
  if(!confirm('确定清空全部材料和配方？此操作不可恢复！')) return;
  const r = ckRoot(); r.materials = []; r.recipes = []; r.seeded = false;
  ckMix = []; ckSave(); ckRenderAll(); toast('已清空');
};

/* ---------- 统一渲染入口（进入 tab 时调用） ---------- */
function ckRenderAll(){ ckRenderMats(); ckRenderMix(); ckRenderRecs(); }
function renderCocktail(){ ckSeed(); ckSwitch('mix'); ckRenderAll(); }
