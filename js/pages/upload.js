/* ==========================================================================
   生活象限 · js/pages/upload.js
   --------------------------------------------------------------------------
   Phase 5 候选 E：Upload page module（上传/编辑衣物 #screen-upload：图片选择 → 压缩 → 分组 → 提交）

   自 index.html 物理抽取（**逐字节原样迁移**）：20 个成员 = 16 个函数 + 4 个绑定
   （uploadPresetGroup · pendingImage · upSelectedGroups · editingId）；
   另含 2 条**加载期监听注册**语句（albumInput / cameraInput 的 change 监听）—— 原样迁移，
   未改成 DOMContentLoaded / initUpload，也未改变初始化时机。

   ⚠️ 必须留在 index.html 的原位项（本模块只调用、不复制）：
      · 云路径与持久化层：clothImgPath / ckRecImgPath / giteeFetch / userDir
      · 共享分组 helper：clothGroups / groupName / groupEmoji / countInGroup / currentGroupId
      · 宿主：openSheet / closeSheet / showScreen / loadState / saveState

   ⚠️ 跨页懒调用（保持原样）：
      Upload → Group   ：goBackFromUpload / submitUpload → openGroup
      Upload → Cloth   ：uploadClothImage → clothImgPath
      Upload → Cocktail：uploadCocktailImage → ckRecImgPath；Cocktail → Upload：cocktail.js → compressImage
   ⚠️ Classic Script（非 ESM）；数据只读写唯一 state.clothes / state.groups / state.user。
   ========================================================================== */

let uploadPresetGroup = null;

/* 上传页：搜索选择分组（点搜索结果仅设置选择，不跳转页面） */
function renderUpGroupSearch(kw){
  const box = $('upgroup-search-list');
  const q = (kw || '').trim().toLowerCase();
  box.innerHTML = '';
  if(!q){
    box.innerHTML = '<div class="empty"><span class="empty-emoji">🔍</span><div class="empty-text">输入关键词搜索分组</div></div>';
    return;
  }
  const matched = state.groups.filter(g => (g.name || '').toLowerCase().indexOf(q) >= 0);
  if(!matched.length){
    box.innerHTML = '<div class="empty"><span class="empty-emoji">🍃</span><div class="empty-text">没有匹配的分组</div></div>';
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
      closeSheet('sheet-upgroup-search');
      $('upGroupSearch').value = '';
      addUpGroup(g.id);
    };
    box.appendChild(row);
  });
}
function openUpGroupSearch(){
  renderUpGroupSearch($('upGroupSearch').value);
  openSheet('sheet-upgroup-search');
}

/* 分组详情右上 +：带分组跳上传 */
function openUploadWithGroup(){
  openUpload(currentGroupId===0 ? null : currentGroupId);
}

/* ---------- 7. 上传页 ---------- */
let pendingImage = null;       // 压缩后的 dataURL（所见即存储；null 表示无图，允许提交走占位）
let upSelectedGroups = [];
let editingId = null;          // 编辑模式：当前正在编辑的衣物 id（null 表示新增）

function openUpload(presetGroup, editCloth){
  // 编辑模式：记录待编辑衣物，预填表单；否则清空进入新增态
  editingId = editCloth ? editCloth.id : null;
  $('up-name').value = editCloth ? (editCloth.name||'') : '';
  $('up-note').value = editCloth ? (editCloth.note||'') : '';
  pendingImage = editCloth ? (editCloth.img||null) : null;
  // 清空文件输入 value，允许重复选择同一文件
  $('albumInput').value = '';
  $('cameraInput').value = '';
  // 提交按钮复位
  const sb = $('up-submit');
  if(sb){ sb.disabled = false; sb.textContent = '保存到衣橱'; }
  // 编辑态标题
  const t = document.querySelector('#screen-upload .screen-head .title');
  if(t) t.textContent = editCloth ? '编辑衣物' : '上传新衣物';
  uploadPresetGroup = (editCloth ? (editCloth.groups && editCloth.groups.length ? editCloth.groups[0] : editCloth.group) : presetGroup) || null;
  upSelectedGroups = editCloth
    ? (editCloth.groups && editCloth.groups.length ? editCloth.groups.slice() : (editCloth.group!=null ? [editCloth.group] : []))
    : (presetGroup!=null ? [presetGroup] : []);
  if(editCloth && editCloth.img){
    showPreviewImg(editCloth.img, '');
  }else{
    $('upload-preview').innerHTML = '<span id="preview-placeholder">选择照片后，这里会显示预览</span>';
  }

  // 分组 chips（多选 toggle，与搜索结果、已选卡片联动）
  let chips = '';
  state.groups.forEach(g=>{
    const act = upSelectedGroups.includes(g.id) ? ' active' : '';
    chips += '<button type="button" class="chip press' + act + '" data-gid="' + g.id + '" onclick="selectUpGroup(\'' + g.id + '\')"><span class="chip-emoji">' + g.emoji + '</span>' + g.name + '</button>';
  });
  $('up-chips').innerHTML = chips || '<span style="color:var(--ink-faint);font-size:13px;">请先在「分组管理」创建分组</span>';
  renderUpGroupChosen();
  const ups = $('upGroupSearch'); if(ups) ups.value = '';

  showScreen('screen-upload');
}
function selectUpGroup(gid){
  const i = upSelectedGroups.indexOf(gid);
  if(i>=0) upSelectedGroups.splice(i,1); else upSelectedGroups.push(gid);
  renderUpGroupChosen(); updateUpChips();
}
/* 搜索结果点选：加入已选（不重复），关闭弹窗并清空搜索框 */
function addUpGroup(gid){
  if(!upSelectedGroups.includes(gid)){ upSelectedGroups.push(gid); renderUpGroupChosen(); updateUpChips(); }
}
/* 已选分组卡片渲染：一字型排列，每张带 × 删除 */
function renderUpGroupChosen(){
  const box = $('upGroupChosen');
  if(!box) return;
  box.innerHTML = '';
  upSelectedGroups.forEach(gid=>{
    const g = state.groups.find(x=>x.id===gid);
    if(!g) return;
    const chip = document.createElement('span');
    chip.className = 'up-chip';
    const em = document.createElement('span'); em.className = 'chip-emoji'; em.textContent = g.emoji || '👕';
    const nm = document.createElement('span'); nm.textContent = g.name;
    const x = document.createElement('span'); x.className = 'up-chip-x'; x.textContent = '×';
    x.onclick = function(e){ e.stopPropagation(); removeUpGroup(gid); };
    chip.appendChild(em); chip.appendChild(nm); chip.appendChild(x);
    box.appendChild(chip);
  });
}
function removeUpGroup(gid){
  const i = upSelectedGroups.indexOf(gid);
  if(i>=0) upSelectedGroups.splice(i,1);
  renderUpGroupChosen(); updateUpChips();
}
function updateUpChips(){
  document.querySelectorAll('#up-chips .chip').forEach(c=>{
    c.classList.toggle('active', upSelectedGroups.includes(Number(c.dataset.gid)));
  });
}

/* 真实选图：相册 / 相机 双通道（替代原模拟选图逻辑） */
function handleImageSelected(file, source){
  if(!file) return;
  if(!file.type || !file.type.startsWith('image/')){
    toast('请选择图片文件');
    return;
  }

  // 1) 原始对象 URL 立即预览，快速反馈
  const rawUrl = URL.createObjectURL(file);
  showPreviewImg(rawUrl, source);
  toast('已从' + source + '选好照片，正在处理…');

  // 2) 压缩中 loading：禁用提交按钮 + 文案
  const sb = $('up-submit');
  if(sb){ sb.disabled = true; sb.textContent = '处理中…'; }

  // 3) 异步压缩，成功才替换为压缩结果（所见即存储）
  compressImage(file).then(dataURL=>{
    pendingImage = dataURL;
    URL.revokeObjectURL(rawUrl);
    showPreviewImg(dataURL, source);
    if(sb){ sb.disabled = false; sb.textContent = '保存到衣橱'; }
    toast('已从' + source + '选好照片 ✓');
  }).catch(()=>{
    pendingImage = null;
    URL.revokeObjectURL(rawUrl);
    $('upload-preview').innerHTML = '<span id="preview-placeholder">图片处理失败，请重试</span>';
    if(sb){ sb.disabled = false; sb.textContent = '保存到衣橱'; }
    toast('图片处理失败，请重试');
  });
}

/* 预览区：显示 <img>（原始 or 压缩后 dataURL）+ 来源角标 */
function showPreviewImg(src, source){
  const badge = source
    ? '<span class="preview-badge" style="background:' + (source==='相机' ? 'var(--accent)' : 'var(--primary)') + ';">已通过' + source + '选择</span>'
    : '';
  $('upload-preview').innerHTML =
    '<div class="preview-filled">' +
      '<img src="' + src + '" alt="衣物预览">' +
      badge +
    '</div>';
}

/* 压缩图片：最长边 800px，JPEG 0.72；>300KB 自动降质 0.6→0.5，仍超则保持 0.5 结果。返回 Promise<dataURL> */
function compressImage(file){
  return new Promise((resolve, reject)=>{
    const MAX_EDGE = 800;
    const MAX_BYTES = 300 * 1024;

    function drawAndCompress(img, cleanup){
      try{
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if(!w || !h){ throw new Error('无法读取图片尺寸'); }
        const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);

        let out = null;
        [0.72, 0.6, 0.5].some(q=>{
          out = canvas.toDataURL('image/jpeg', q);
          // base64 长度 ≈ 字节数 × 1.33
          return out.length * 3 / 4 <= MAX_BYTES;
        });
        resolve(out);
      }catch(err){ reject(err); }
      finally{ if(cleanup){ try{ cleanup(); }catch(e){} } }
    }

    // 优先 createImageBitmap：自动按 EXIF 方向解码（保证手机拍照方向正确）
    function loadViaImage(){
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = ()=>{ URL.revokeObjectURL(url); drawAndCompress(img, null); };
      img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    }

    if(typeof createImageBitmap === 'function'){
      createImageBitmap(file, {imageOrientation:'from-image'}).then(
        bmp => drawAndCompress(bmp, ()=>bmp.close()),
        ()=>loadViaImage()
      ).catch(err=>reject(err));
    }else{
      loadViaImage();
    }
  });
}

/* 文件输入 change 绑定：相册 / 相机 → 统一处理 */
$('albumInput').addEventListener('change', function(e){
  const f = e.target.files && e.target.files[0];
  if(f) handleImageSelected(f, '相册');
});
$('cameraInput').addEventListener('change', function(e){
  const f = e.target.files && e.target.files[0];
  if(f) handleImageSelected(f, '相机');
});

function goBackFromUpload(){
  if(state.user){
    // 回到进入上传页之前所在的衣橱分组（而非首页）
    if(currentGroupId && currentGroupId!==0 && state.groups.some(g=>g.id===currentGroupId)){
      openGroup(currentGroupId);
    }else if(state.groups.length){
      openGroup(state.groups[0].id);
    }else{
      openGroup(0);
    }
  }else{
    showScreen('screen-auth');
  }
}

function submitUpload(e){
  e.preventDefault();
  const name = $('up-name').value.trim();
  if(!name){ toast('请填写衣物名称'); return false; }
  if(!upSelectedGroups.length){ toast('请至少选择一个分组'); return false; }

  const note = $('up-note').value.trim();

  // 编辑模式：更新既有衣物（Phase 14：经 DAL 更新 + 图片 upsert 到 Storage）
  if(editingId){
    const idx = state.clothes.findIndex(x=>x.id===editingId);
    if(idx < 0){ toast('未找到要编辑的衣物'); return false; }
    const prev = state.clothes[idx];
    const primaryG = upSelectedGroups[0];
    const updated = {
      id: prev.id,
      name: name,
      group: primaryG,
      groups: upSelectedGroups.slice(),
      note: note,
      img: pendingImage || prev.img,                // 新图或保留原显示
      imgRemote: prev.imgRemote || prev._image_path || null,
      emoji: groupEmoji(primaryG),
      tint: TINT_MAP[groupEmoji(primaryG)] || '#EAF5EC',
      _sbSaved: prev._sbSaved,
      _image_path: prev._image_path || null
    };
    state.clothes.splice(idx, 1, updated);
    sbSaveObj('clothes', updated, {name: name, note: note, emoji: updated.emoji, tint: updated.tint, _groupIds: upSelectedGroups.slice()});
    WBData.clothGroups.replaceForCloth(updated.id, upSelectedGroups.slice()).catch(function(){});
    sbUploadClothImageFor(updated);                 // dataURL 图 → Storage upsert；无新图不动作
    pendingImage = null;
    editingId = null;
    $('albumInput').value = '';
    $('cameraInput').value = '';
    $('upload-preview').innerHTML = '<span id="preview-placeholder">选择照片后，这里会显示预览</span>';
    toast('已更新衣物 ✓');
    openGroup(upSelectedGroups[0]);
    return false;
  }

  // 新增模式（Phase 14：前端 UUID = Supabase 主键；图片经 private Storage）
  const cloth = {
    id: wbUuid(),
    name: name,
    group: upSelectedGroups[0],
    groups: upSelectedGroups.slice(),
    note: note,
    img: pendingImage || null,                    // 无图允许提交，走占位
    emoji: groupEmoji(upSelectedGroups[0]),
    tint: TINT_MAP[groupEmoji(upSelectedGroups[0])] || '#EAF5EC',
    _sbSaved: false
  };

  state.clothes.unshift(cloth);
  sbSaveObj('clothes', cloth, {name: name, note: note, emoji: cloth.emoji, tint: cloth.tint, _groupIds: upSelectedGroups.slice()});
  sbUploadClothImageFor(cloth);

  // 上传成功：清空待存图、重置文件输入与预览区
  pendingImage = null;
  $('albumInput').value = '';
  $('cameraInput').value = '';
  $('upload-preview').innerHTML = '<span id="preview-placeholder">选择照片后，这里会显示预览</span>';

  toast('已存入衣橱 ✓');
  openGroup(upSelectedGroups[0]);
  return false;
}

/* 上传单张衣物照片为独立文件：先查存在取 sha → PUT 更新 / POST 创建 */
async function uploadClothImage(c){
  const path = clothImgPath(c.id);
  const content = dataURLToBase64(c.img);
  const message = 'upload cloth ' + c.id + ' ' + new Date().toISOString();
  let sha = null;
  try{
    const existing = await giteeFetch(path, 'GET');
    if(existing && !Array.isArray(existing) && existing.sha) sha = existing.sha;
  }catch(err){
    if(String(err.message).indexOf('404') === -1) throw err;
  }
  const body = { content: content, message: message, branch: GITEE_BRANCH };
  if(sha) body.sha = sha;
  await giteeFetch(path, sha ? 'PUT' : 'POST', body);
}

/* 上传单张配方图片为独立文件（与衣物照片同模式）：同 id 重复上传 = PUT 覆盖旧图 */
async function uploadCocktailImage(rec){
  const path = ckRecImgPath(rec.id);
  const content = dataURLToBase64(rec.img);
  const message = 'upload cocktail image ' + rec.id + ' ' + new Date().toISOString();
  let sha = null;
  try{
    const existing = await giteeFetch(path, 'GET');
    if(existing && !Array.isArray(existing) && existing.sha) sha = existing.sha;
  }catch(err){
    if(String(err.message).indexOf('404') === -1) throw err;
  }
  const body = { content: content, message: message, branch: GITEE_BRANCH };
  if(sha) body.sha = sha;
  await giteeFetch(path, sha ? 'PUT' : 'POST', body);
}
