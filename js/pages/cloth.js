/* ==========================================================================
   生活象限 · js/pages/cloth.js
   --------------------------------------------------------------------------
   Phase 5 候选 E：Cloth page module（衣橱 #screen-cloth：概览 / 衣物列表 / 分组筛选 / 云端）

   自 index.html 物理抽取（**逐字节原样迁移**）：24 个成员 = 20 个函数 + 4 个绑定
   （clBound/clState · delPendingId · clothMenuId）。

   ⚠️ 必须留在 index.html 的原位项（本模块只调用、不复制）：
      · 共享分组 helper：clothGroups / belongsTo / groupName / groupEmoji / countInGroup / currentGroupId
      · 宿主 UI：syncSpin / openSheet / closeSheet / closeSheetOnBg
      · 云路径与持久化层：clothImgPath / userDir / giteeFetch / loadState / saveState

   ⚠️ 跨页懒调用（保持原样，未改任何动态 onclick）：
      Cloth → Group ：renderClothList / renderGroupChips / confirmDeleteCloth / renderGroupSearch → openGroup
      Cloth → Upload：renderGrid / editClothFromMenu → openUpload
      Cloth → Sleep ：clSwitch → spRenderBanner
   ⚠️ Classic Script（非 ESM）；数据只读写唯一 state.clothes / state.groups。
   ========================================================================== */

/* ---------- 衣橱子页面（v4.1.0：左侧导航 概览/衣物/云端 + 右侧功能页，粉色 HelloKitty 风格） ---------- */
let clBound = false, clState = { panel:'overview' };
function gotoCloth(){ showScreen('screen-cloth'); renderCloth(); }
function renderCloth(){
  if(!clBound){
    clBound = true;
    document.querySelectorAll('#clSide .lg-nav').forEach(b => b.onclick = () => clSwitch(b.dataset.cl));
  }
  clSwitch(clState.panel || 'overview');
}
function clSwitch(panel){
  clState.panel = panel;
  document.querySelectorAll('#clSide .lg-nav').forEach(b => b.classList.toggle('active', b.dataset.cl === panel));
  document.querySelectorAll('#screen-cloth .lg-panel').forEach(p => p.classList.toggle('active', p.id === 'clp-' + panel));
  const active = $('clp-' + panel);
  if(active) spRenderBanner(active);   // 复用睡眠的 Kitty 头像 + emoji 散射 Banner（读取 #screen-ledger 的 --lg-avatar-*）
  if(panel === 'overview') renderClothOverview();
  else if(panel === 'list') renderClothList();
}
function renderClothOverview(){
  $('cl-stats').innerHTML = '共 <b>' + state.clothes.length + '</b> 件衣物 · <b>' + state.groups.length + '</b> 个分组';
  renderGrid(state.clothes, 'cl-grid');
}
function renderClothList(){
  $('cl-groups').innerHTML = state.groups.map(g=>{
    const cnt = countInGroup(g.id);
    return '<button class="group-card press" onclick="openGroup(\'' + g.id + '\')">' +
      '<span class="gc-emoji">' + g.emoji + '</span>' +
      '<span class="gc-info">' +
        '<span class="gc-name">' + g.name + '</span>' +
        '<span class="gc-count">' + cnt + ' 件</span>' +
      '</span>' +
    '</button>';
  }).join('');
}

/* v5.12.7：分组「增 / 改 / 删」后立即刷新衣物屏与分组详情的分组相关视图，
   否则必须切页（重新进入衣物屏）才能看到新分组。 */
function refreshClothGroups(){
  if($('cl-stats')) renderClothOverview();   /* 衣物·概览：衣物数 / 分组数 */
  if($('cl-groups')) renderClothList();      /* 衣物·衣物：分组卡片列表 */
  if($('group-chips')) renderGroupChips();   /* 分组详情：左侧分组导航 */
}
async function clRefresh(){
  if(!state.user){ toast('请先登录'); return; }
  try{
    await sbLoadAll();   // Supabase：重新下拉全部模块云端数据（自动上传已实时进行，此按钮仅做手动刷新）
    toast('已刷新云端数据 ✓');
  }catch(e){
    const n = WBErrors.normalize(e);
    toast('刷新失败：' + (n.message || '请重试'));
  }
}

function renderGrid(items, containerId, emptyHtml){
  const el = $(containerId);
  if(!items.length){
    el.innerHTML = emptyHtml || '<div class="empty" style="grid-column:1/-1;"><span class="empty-emoji">🌿</span><span class="empty-text">衣橱空空，去上传第一件衣物吧</span><button class="btn btn-primary press" onclick="openUpload(null)">去上传</button></div>';
    return;
  }
  el.innerHTML = items.map(c=>{
    const g = groupName(c.group);
    // 有真实图片 → 照片铺满；无图 → 保留 emoji+色块占位（一处修改，主页/分组视图共用）
    const thumb = c.img
      ? '<div class="cloth-thumb has-img"><img src="' + c.img + '" alt="' + c.name + '" loading="lazy"></div>'
      : '<div class="cloth-thumb" style="background:' + (c.tint||'#EAF5EC') + '">' + (c.emoji||'👕') + '</div>';
    return '<button class="cloth-card press" data-id="' + c.id + '">' +
      thumb +
      '<div class="cloth-name">' + c.name + '</div>' +
      '<div class="cloth-note">' + (c.note ? c.note : '') + '</div>' +   // 正面不显示分组，仅备注（分组进详情看）
      '<span class="cloth-more" data-more="' + c.id + '" title="更多操作">⋮</span>' +
    '</button>';
  }).join('');
  // 长按删除 + 短按轻提示 + 右下角「三个点」菜单：渲染后统一绑定（主页/分组共用，一处生效）
  el.querySelectorAll('.cloth-card').forEach(card=>{
    attachClothLongPress(card, card.dataset.id);      // Phase 14：id 为 UUID 字符串
  });
  el.querySelectorAll('.cloth-more').forEach(more=>{
    // 阻止触摸/按下事件冒泡到卡片，避免触发卡片长按/短按；注意这里不能 preventDefault，
    // 否则会吞掉浏览器合成后续的 click 事件，导致「三个点」菜单点不出来
    ['touchstart','mousedown'].forEach(evt=>{
      more.addEventListener(evt, function(e){
        e.stopPropagation();
      }, {passive:true});
    });
    // 独立点击 → 打开衣物操作菜单（阻止冒泡以免触发卡片短按）
    more.addEventListener('click', function(e){
      e.stopPropagation();
      openClothMenu(more.dataset.more);               // Phase 14：UUID 字符串
    });
  });
}

/* 点击衣物卡 → 放大详情：看清照片与备注全貌 */
function showCloth(id){
  const c = state.clothes.find(x=>x.id===id);
  if(!c) return;
  const g = groupName(c.group);
  // 图片区：有图则大图；无图则 emoji 占位大块
  $('cd-media').innerHTML = c.img
    ? '<img src="' + c.img + '" alt="' + c.name + '">'
    : '<span class="cd-emoji">' + (c.emoji||'👕') + '</span>';
  $('cd-name').textContent = c.name;
  $('cd-meta').textContent = '分组：' + g;   // 分组信息仅在详情展示
  const noteEl = $('cd-note');
  if(c.note){
    noteEl.innerHTML = '<div class="cd-note-label">备注</div>';
    noteEl.appendChild(document.createTextNode(c.note));
  }else{
    noteEl.textContent = '该衣物暂无备注';
  }
  openSheet('sheet-cloth-view');
}

/* ---------- 长按删除衣物 ---------- */
let delPendingId = null;   // 待删除衣物 id（sheet-del 确认用）

/* 为衣物卡绑定长按手势：600ms 弹出删除确认；短按仍走 showCloth，二者不冲突 */
function attachClothLongPress(el, clothId){
  let timer = null;
  let feedbackTimer = null;
  let startX = 0, startY = 0;
  let suppressClick = false;

  function cancel(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(feedbackTimer){ clearTimeout(feedbackTimer); feedbackTimer = null; }
    el.classList.remove('longpressing');
  }
  function begin(x, y){
    if(timer) return;
    startX = x; startY = y;
    suppressClick = false;
    // 约 480ms 给轻微视觉反馈，600ms 触发删除确认
    feedbackTimer = setTimeout(function(){ el.classList.add('longpressing'); }, 480);
    timer = setTimeout(function(){
      timer = null;
      suppressClick = true;             // 阻止随后的 click 触发 showCloth
      el.classList.remove('longpressing');
      openDelSheet(clothId);
    }, 600);
  }
  function move(x, y){
    if(!timer) return;
    if(Math.abs(x-startX) > 10 || Math.abs(y-startY) > 10){ cancel(); } // 视为滚动/取消
  }

  // 触屏
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
  // 桌面
  el.addEventListener('mousedown', function(e){ begin(e.clientX, e.clientY); });
  el.addEventListener('mousemove', function(e){ move(e.clientX, e.clientY); });
  el.addEventListener('mouseup', function(){ cancel(); });
  el.addEventListener('mouseleave', function(){ cancel(); });
  // 短按 → showCloth；长按后 suppressClick 拦截
  el.addEventListener('click', function(){
    if(suppressClick){ suppressClick = false; return; }
    showCloth(clothId);
  });
}

/* 打开删除确认 Sheet（长按触发） */
function openDelSheet(id){
  const c = state.clothes.find(x=>x.id===id);
  if(!c) return;
  delPendingId = id;
  const g = groupName(c.group);
  const thumb = c.img
    ? '<div class="del-thumb"><img src="' + c.img + '" alt=""></div>'
    : '<div class="del-thumb" style="background:' + (c.tint||'#EAF5EC') + '">' + (c.emoji||'👕') + '</div>';
  $('del-item').innerHTML = thumb +
    '<div class="del-info">' +
      '<div class="del-name">' + c.name + '</div>' +
      '<div class="del-group">' + g + (c.note ? ' · ' + c.note : '') + '</div>' +
    '</div>';
  openSheet('sheet-del');
}

/* 确认删除（Phase 14：DAL 软删除；Gitee 图片联动已停用） */
function confirmDeleteCloth(id){
  const c = state.clothes.find(x=>x.id===id);
  if(!c) return false;
  const name = c.name;
  const prevClothes = state.clothes;
  state.clothes = state.clothes.filter(x=>x.id!==id);
  sbRemoveObj('clothes', c);
  closeSheet('sheet-del');
  delPendingId = null;
  toast('已删除「' + name + '」');
  // 按当前页面刷新
  const cur = SCREENS.find(s=>$(s).classList.contains('active')) || 'screen-home';
  if(cur==='screen-group'){ openGroup(currentGroupId); }
  else if(cur==='screen-home'){ renderHome(); }
  return false;
}

/* ---------- 衣物操作菜单（三个点 → 编辑/删除） ---------- */
let clothMenuId = null;   // 当前操作菜单对应的衣物 id

/* 点击「三个点」→ 打开操作菜单（编辑/删除） */
function openClothMenu(id){
  const c = state.clothes.find(x=>x.id===id);
  if(!c) return;
  clothMenuId = id;
  const g = groupName(c.group);
  const thumb = c.img
    ? '<div class="cm-thumb"><img src="' + c.img + '" alt=""></div>'
    : '<div class="cm-thumb" style="background:' + (c.tint||'#EAF5EC') + '">' + (c.emoji||'👕') + '</div>';
  $('cm-item').innerHTML = thumb +
    '<div class="cm-info">' +
      '<div class="cm-name">' + c.name + '</div>' +
      '<div class="cm-group">' + g + (c.note ? ' · ' + c.note : '') + '</div>' +
    '</div>';
  openSheet('sheet-cloth-menu');
}

/* 菜单「编辑」→ 复用上传页，预填该衣物数据进入编辑态 */
function editClothFromMenu(){
  const c = state.clothes.find(x=>x.id===clothMenuId);
  closeSheet('sheet-cloth-menu');
  if(!c) return;
  openUpload(c.group, c);   // 传入现有衣物 → 编辑模式
}

/* 菜单「删除」→ 复用删除确认 Sheet */
function delClothFromMenu(){
  closeSheet('sheet-cloth-menu');
  openDelSheet(clothMenuId);
}

/* ---------- 6. 分组详情 ---------- */
/* 分组详情页：分组切换 chips（仅各分组，当前高亮；无分组时显示占位提示，非 chip） */
function renderGroupChips(){
  if(!state.groups.length){
    $('group-chips').innerHTML = '<div class="rail-empty">暂无分组<br>点右上角＋创建</div>';
    return;
  }
  let h = '';
  state.groups.forEach(g=>{
    h += '<button class="rail-item' + (String(currentGroupId)===String(g.id) ? ' active' : '') + ' press" onclick="openGroup(\'' + g.id + '\')">' +
      '<span class="rail-emoji">' + g.emoji + '</span>' +
      '<span class="rail-name">' + g.name + '</span>' +
    '</button>';
  });
  $('group-chips').innerHTML = h;
}

/* ---------- 分组搜索（V2.7.0）----------
   输入关键词 → 实时匹配分组名称 → 弹窗列出结果 → 点选后关闭弹窗并打开该分组。
   列表用 DOM API + textContent 构建，分组名含特殊字符也不会破坏结构或造成注入。 */
function renderGroupSearch(kw, showAll){
  const box = $('group-search-panel');
  if(!box) return;
  const q = (kw || '').trim().toLowerCase();
  box.innerHTML = '';
  if(!q && !showAll){ box.hidden = true; return; }
  const matched = q
    ? state.groups.filter(g => (g.name || '').toLowerCase().indexOf(q) >= 0)
    : state.groups.slice();
  if(!matched.length){
    box.innerHTML = '<div class="empty"><span class="empty-emoji">🍃</span><div class="empty-text">' + (q ? '没有匹配的分组' : '还没有分组，先去创建吧') + '</div></div>';
    box.hidden = false;
    return;
  }
  matched.forEach(g => {
    const row = document.createElement('div');
    row.className = 'row press';
    const emoji = document.createElement('span');
    emoji.className = 'chip-emoji'; emoji.textContent = g.emoji || '👕';
    const main = document.createElement('div'); main.className = 'row-main';
    const title = document.createElement('div'); title.className = 'row-title'; title.textContent = g.name;
    const sub = document.createElement('div'); sub.className = 'row-sub';
    sub.textContent = countInGroup(g.id) + ' 件衣物';
    main.appendChild(title); main.appendChild(sub);
    const chev = document.createElement('span'); chev.className = 'row-chev'; chev.textContent = '›';
    row.appendChild(emoji); row.appendChild(main); row.appendChild(chev);
    row.onclick = function(){
      closeGroupSearchPanel();
      $('groupSearch').value = '';
      openGroup(g.id);
    };
    box.appendChild(row);
  });
  box.hidden = false;
}
function openGroupSearch(){
  // 点放大镜：空输入时列出全部分组，便于直接切换
  renderGroupSearch($('groupSearch').value, true);
}
function onGroupSearchInput(){
  // 输入即匹配；清空则收起面板
  renderGroupSearch($('groupSearch').value, false);
}
function closeGroupSearchPanel(){
  const p = $('group-search-panel');
  if(p){ p.hidden = true; p.innerHTML = ''; }
}
