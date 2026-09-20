/* ==========================================================================
   生活象限 · js/pages/group.js
   --------------------------------------------------------------------------
   Phase 5 候选 E：Group page module（分组管理：sheet-group 面板 + 分组新建/重命名/删除）

   自 index.html 物理抽取（**逐字节原样迁移**）：10 个成员 = 7 个函数 + 3 个绑定
   （GM_EMOJI_POOL · gmEmoji · renamingId）。

   ⚠️ 必须留在 index.html 的原位项（本模块只调用、不复制）：
      · openSheet / closeSheet / closeSheetOnBg + iOS 键盘 IIFE —— 其中
        sheet-group 分支对 renderGroupManage 的调用保持原样，迁后为 host → Group 懒调用
      · 共享分组 helper：clothGroups / belongsTo / groupName / groupEmoji / countInGroup / currentGroupId

   ⚠️ 跨页懒调用（保持原样）：
      Group → Cloth ：openGroup → renderGroupChips / renderGrid；addGroup / saveRename / confirmDelete → refreshClothGroups
      Upload → Group：goBackFromUpload / submitUpload → openGroup（反向）
   ⚠️ Classic Script（非 ESM）；数据只读写唯一 state.groups。
   ========================================================================== */

function openGroup(gid){
  currentGroupId = gid;
  renderGroupChips();
  if(gid===0 || gid==='0'){
    // 空态兜底：无任何分组时进入「我的衣橱」空态（不再展示「全部衣物」）
    $('group-title').textContent = '我的衣橱';
    $('group-badge').textContent = '🧺';
  }else{
    const g = state.groups.find(x=>String(x.id)===String(gid));
    if(!g){ toast('分组不存在'); return; }
    $('group-title').textContent = g.name;
    $('group-badge').textContent = g.emoji;
  }
  uploadPresetGroup = (gid===0 || gid==='0') ? null : gid;
  if(gid===0 || gid==='0'){
    renderGrid([], 'group-grid', '<div class="empty" style="grid-column:1/-1;"><span class="empty-emoji">🧺</span><span class="empty-text">衣橱空空，去创建分组并上传吧</span><button class="btn btn-primary press" onclick="openSheet(\'sheet-group\')">去创建分组</button></div>');
  }else{
    renderGrid(state.clothes.filter(c=>belongsTo(c,gid)), 'group-grid');
  }
  showScreen('screen-group');
}

/* ---------- 8. 分组管理 Sheet ---------- */
const GM_EMOJI_POOL = ['👕','👖','👟','🏀','🧥','🧢','👗','👜','🧣','👒','🥾','🎽'];
let gmEmoji = '👕';
let renamingId = null;

function renderGroupManage(){
  renamingId = null;
  gmEmoji = '👕';
  $('gm-name').value = '';

  // emoji 选择器
  $('gm-emoji').innerHTML = GM_EMOJI_POOL.map(e=>{
    return '<button class="emoji-opt press' + (e===gmEmoji?' active':'') + '" onclick="pickGmEmoji(\'' + e + '\',this)">' + e + '</button>';
  }).join('');

  // 分组列表
  $('gm-list').innerHTML = state.groups.map(g=>{
    const cnt = countInGroup(g.id);
    return '<div class="gm-row" data-gid="' + g.id + '">' +
      '<span class="gm-emoji">' + g.emoji + '</span>' +
      (renamingId===g.id
        ? '<input class="input" style="height:40px;flex:1;" value="' + g.name + '" id="rename-input-' + g.id + '">'
        : '<span class="gm-name">' + g.name + '</span>') +
      '<span class="gm-count">' + cnt + '件</span>' +
      (renamingId===g.id
        ? '<button class="gm-act press" style="color:var(--success);" onclick="saveRename(\'' + g.id + '\')">保存</button>'
        : '<button class="gm-act press" onclick="startRename(\'' + g.id + '\')">重命名</button>') +
      '<button class="gm-act del press" id="del-' + g.id + '" onclick="confirmDelete(\'' + g.id + '\')">删除</button>' +
    '</div>';
  }).join('');
}

function pickGmEmoji(e, el){
  gmEmoji = e;
  document.querySelectorAll('#gm-emoji .emoji-opt').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
}

function addGroup(){
  const name = $('gm-name').value.trim();
  if(!name){ toast('请输入分组名称'); return; }
  const id = wbUuid();                                   // Phase 14：前端 UUID = Supabase 主键
  const gNew = {id, name, emoji:gmEmoji};
  state.groups.push(gNew);
  sbSaveObj('groups', gNew, {name: name, emoji: gmEmoji, sort_order: state.groups.length});
  renderGroupManage();
  refreshClothGroups();   /* v5.12.7：立即刷新衣物屏分组视图，无需切页 */
  renderHome();
  toast('已添加分组「' + name + '」✓');
}

function startRename(gid){
  renamingId = gid;
  renderGroupManage();
  const inp = $('rename-input-' + gid);
  if(inp){ inp.focus(); inp.select(); }
}
function saveRename(gid){
  const inp = $('rename-input-' + gid);
  const name = inp ? inp.value.trim() : '';
  if(!name){ toast('名称不能为空'); return; }
  const g = state.groups.find(x=>x.id===gid);
  if(g){ g.name = name; sbSaveObj('groups', g, {name: name}); }
  renderGroupManage();
  refreshClothGroups();   /* v5.12.7：立即刷新衣物屏分组视图，无需切页 */
  renderHome();
  toast('已重命名 ✓');
}

/* 删除分组：两次点击确认（第一次变红为确认态） */
function confirmDelete(gid){
  const btn = $('del-' + gid);
  if(btn.dataset.armed !== '1'){
    btn.dataset.armed = '1';
    btn.textContent = '确认删除？';
    toast('再点一次确认删除该分组');
    return;
  }
  // 分组内衣物移出该分组：从 groups 数组移除，回退到其余分组（或首个分组 / 未分组）
  const affected = state.clothes.filter(c => clothGroups(c).indexOf(gid) >= 0);
  const fallback = state.groups.find(g=>g.id!==gid);
  state.clothes.forEach(c=>{
    const gs = clothGroups(c).filter(x=>x!==gid);
    c.groups = gs;
    c.group = gs.length ? gs[0] : (fallback ? fallback.id : 0);
  });
  state.groups = state.groups.filter(g=>g.id!==gid);
  sbRemoveObj('groups', {id: gid});                                  // Phase 14：分组软删除
  affected.forEach(c => {                                            // 同步受影响衣物的新分组关系
    if(c._sbSaved) WBData.clothGroups.replaceForCloth(c.id, clothGroups(c)).catch(function(){});
  });
  if(currentGroupId===gid) currentGroupId = state.groups.length ? state.groups[0].id : 0;
  renderGroupManage();
  refreshClothGroups();   /* v5.12.7：立即刷新衣物屏分组视图，无需切页 */
  renderHome();
  toast('已删除分组');
}
