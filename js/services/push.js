/* ============================================================
   生活象限 · Push / Reminder 服务（Phase 8 抽取 / v5.24.0）
   ------------------------------------------------------------
   本文件由 index.html 主内联脚本**逐字节迁出**（只移动，不重构）：
     · 段头注释（Web Push 通道职责边界说明，原 L3157–L3164）
     · 正文 25 个顶层符号（原 L3165–L3505）

   内容 = 两块：
     ① WBReminders + push*（通知权限 / 订阅端点上报与清理 / 我的页开关与自愈）
     ② CH_SPECS + ch*（提醒通道配置：读 / 写 / 删 / 测试）

   Classic Script：顶层 const / function 即全局词法绑定，保持原有裸全局名 ——
   未引入 ESM / IIFE / window 命名空间 / window.WBPush；
   markup 的 7 个 onclick 与 js/pages/mine.js 的 pushAutoHeal 调用方**零改动**。

   依赖（全部为运行期取用，本文件无 parse-time 外部依赖）：
     Core    ：$ · toast
     Config  ：WB_VAPID_PUBLIC_KEY · SUPABASE_URL（必须在 js/config.js 之后加载）
     Data    ：window.WBData · getSupabaseClient()（仅在函数体内调用）
     浏览器   ：Notification · navigator.serviceWorker · PushManager
     State / Auth / Router / Legacy / Storage / Page：0

   加载位置：js/bridge/legacy-sync.js → js/legacy/gitee-sync.js → **js/services/push.js** → js/fuel.js
   ============================================================ */

/* ─────────────────────────────────────────────────────────────────────
   提醒投递通道：Web Push 预留接口（Phase 1 只提供接口，不真正订阅 / 投递）
   Phase 2 启用（详见 supabase/functions/todo-reminder/README.md）：
     ① supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… WEBPUSH_SUBJECT=mailto:…
     ② 把 VAPID 公钥填进 js/config.js 的 WB_VAPID_PUBLIC_KEY
     ③ 部署 Edge Function，并按 supabase/todo-reminder-cron.sql 建 pg_cron 任务（每分钟）
   前端职责仅：申请通知权限 + 上报订阅端点；**到点投递完全在服务端**，不依赖页面存活。
   ───────────────────────────────────────────────────────────────────── */

const WBReminders = {
  supported(){
    return !!(typeof window !== 'undefined' && 'Notification' in window &&
              'serviceWorker' in navigator && 'PushManager' in window);
  },
  permission(){ return (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported'; },
  vapidKey(){
    try{ return (typeof WB_VAPID_PUBLIC_KEY === 'string') ? WB_VAPID_PUBLIC_KEY.trim() : ''; }catch(e){ return ''; }
  },
  enabled(){ return this.supported() && !!this.vapidKey(); },
  /* base64url 的 VAPID 公钥 → Uint8Array（PushManager.subscribe 要求） */
  _urlB64ToUint8(base64){
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for(let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },
  async requestPermission(){
    if(!this.supported()) return 'unsupported';
    try{ return await Notification.requestPermission(); }catch(e){ return 'denied'; }
  },
  async currentSubscription(){
    if(!this.supported()) return null;
    try{ const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); }
    catch(e){ return null; }
  },
  /* 上报订阅（endpoint 唯一 → 已存在则更新密钥）
     v5.13.7：返回 { ok, error } 而非 bool —— 原先 catch 直接吞掉异常，导致失败时只显示「未知原因」，无法定位。 */
  async syncSubscription(sub){
    if(!sub) return { ok: false, error: 'no-subscription' };
    const j = (typeof sub.toJSON === 'function') ? sub.toJSON() : {};
    const keys = j.keys || {};
    const endpoint = j.endpoint || sub.endpoint || '';
    const payload = { endpoint: endpoint, p256dh: keys.p256dh || '', auth: keys.auth || '',
                      user_agent: (navigator.userAgent || '').slice(0, 200) };
    if(!payload.endpoint || !payload.p256dh || !payload.auth) return { ok: false, error: 'incomplete-subscription' };
    const D = window.WBData;
    if(!D || !D.pushSubscriptions) return { ok: false, error: 'dal-missing' };
    try{
      const rows = await D.pushSubscriptions.list({ limit: 200 });
      const hit = (rows || []).filter(r => r.endpoint === payload.endpoint)[0];
      if(hit) await D.pushSubscriptions.update(hit.id, { p256dh: payload.p256dh, auth: payload.auth, user_agent: payload.user_agent });
      else await D.pushSubscriptions.create(payload);
      return { ok: true };
    }catch(e){
      const msg = (e && (e.message || e.error_description || e.details)) || String(e) || 'unknown';
      return { ok: false, error: msg };
    }
  },
  /* v5.13.7：删除本设备在服务端的订阅行（关闭提醒时清理；否则服务端仍向失效端点投递） */
  async removeSubscription(sub){
    if(!sub) return { ok: true };
    const j = (typeof sub.toJSON === 'function') ? sub.toJSON() : {};
    const endpoint = j.endpoint || sub.endpoint || '';
    const D = window.WBData;
    if(!endpoint || !D || !D.pushSubscriptions) return { ok: true };
    try{
      const rows = await D.pushSubscriptions.list({ limit: 200 });
      const hit = (rows || []).filter(r => r.endpoint === endpoint)[0];
      if(hit) await D.pushSubscriptions.remove(hit.id, { hardDelete: true });
      return { ok: true };
    }catch(e){ return { ok: false, error: (e && e.message) || String(e) }; }
  },
  /* 订阅并上报（Phase 2 由用户在设置里主动触发）；失败时把真实原因带回给 UI */
  async subscribe(){
    if(!this.enabled()) return { ok: false, reason: 'push-not-enabled' };
    const perm = await this.requestPermission();
    if(perm !== 'granted') return { ok: false, reason: perm || 'denied' };
    try{
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if(!sub){
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this._urlB64ToUint8(this.vapidKey()) });
      }
      const r = await this.syncSubscription(sub);
      if(!r.ok) return { ok: false, reason: 'save-failed: ' + (r.error || 'unknown'), subscription: sub };
      return { ok: true, subscription: sub };
    }catch(e){ return { ok: false, reason: (e && e.message) || 'subscribe-failed' }; }
  },
  /* v5.13.7：关闭 = 取消浏览器订阅 + 删除服务端订阅行（先取 endpoint，再 unsubscribe） */
  async unsubscribe(){
    const sub = await this.currentSubscription();
    let delErr = null;
    if(sub){ const r = await this.removeSubscription(sub); if(!r.ok) delErr = r.error; }
    try{ if(sub) await sub.unsubscribe(); }catch(e){}
    return { ok: !delErr, error: delErr };
  },
  statusText(){
    if(!this.supported()) return '当前浏览器不支持系统通知';
    if(!this.vapidKey()) return '系统级提醒推送尚未启用（Phase 2）';
    return '通知权限：' + this.permission();
  }
};
window.WBReminders = WBReminders;

/* =====================================================================
   v5.13.6（Phase 1·待办提醒）：我的页「系统提醒推送」开关
   ─────────────────────────────────────────────────────────────────────
   职责边界（严格按 Phase 划分）：
     · 本段只做两件事：① 申请/查看通知权限；② 上报/清理本设备的订阅端点。
     · **不做任何投递** —— 到点投递由 Phase 2 的 Edge Function + Phase 3 的 pg_cron 在服务端完成，
       不依赖页面存活，前端不使用 setTimeout。
     · 未配置 WB_VAPID_PUBLIC_KEY 时 WBReminders.enabled() 为 false：
       按钮置灰并提示「尚未启用」，且**不申请权限、不产生任何网络请求**。
   ===================================================================== */
function pushIsIOS(){
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function pushIsStandalone(){
  try{
    if(window.navigator.standalone === true) return true;    /* iOS「添加到主屏幕」后 */
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }catch(e){ return false; }
}
/* Android / iOS 环境提示：明确「能不能用、怎么才能用」 */
function pushEnvHint(){
  if(!WBReminders.supported())
    return '当前浏览器不支持系统级提醒（需要 HTTPS + Service Worker + PushManager）。\n建议换用手机 Chrome / Edge，或把本页「添加到主屏幕」后再打开。';
  if(pushIsIOS()){
    if(!pushIsStandalone())
      return 'iPhone / iPad：系统提醒必须先把本应用「添加到主屏幕」，再从桌面图标打开（iOS 16.4 及以上）。\nSafari 普通标签页不支持系统级推送。';
    return '已在主屏幕独立窗口运行 ✓\n若从未弹过通知授权，可到「设置 → 通知 → 生活象限」中允许通知。';
  }
  if(/Android/i.test(navigator.userAgent || ''))
    return '安卓：Chrome / Edge 均支持。\n若没有弹出授权，可到「系统设置 → 应用 → 通知」里允许本站通知。';
  return '桌面端：Chrome / Edge 支持；macOS 上的 Safari 16.4+ 亦支持。';
}
/* v5.13.7：本设备「是否真的存在浏览器订阅」才是可信状态。
   Notification.permission 只是"权限"，权限 granted ≠ 已订阅 → 原逻辑导致
   ①首次失败后再也无法重试（按钮被永久禁用）②点"关闭"后状态仍显示"已开启"。 */
let pushCachedSub = null;        /* 当前浏览器订阅对象（null = 本设备未订阅） */
let pushStateChecked = false;
async function refreshPushState(){
  try{ pushCachedSub = await WBReminders.currentSubscription(); }
  catch(e){ pushCachedSub = null; }
  pushStateChecked = true;
  return pushCachedSub;
}
function pushStatusLabel(){
  if(!WBReminders.supported()) return '当前设备不支持';
  const p = WBReminders.permission();
  if(p === 'denied') return '已被系统拒绝';
  if(pushCachedSub) return '已开启';
  if(p === 'granted') return '权限已允许，但本设备尚未订阅';
  return '未开启';
}
async function renderPushSheet(){
  const st = $('pushStatus'), hint = $('pushHint'), on = $('pushOnBtn'), off = $('pushOffBtn');
  const enabled = WBReminders.enabled();
  await refreshPushState();
  await chLoad();                 /* v5.13.8+：同步「手机提醒通道」状态 */
  const hasSub = !!pushCachedSub;
  const denied = WBReminders.permission() === 'denied';
  if(st){
    st.textContent = '当前状态：' + pushStatusLabel() +
      (WBReminders.supported() ? '（通知权限：' + WBReminders.permission() + '）' : '') +
      (enabled ? '' : '\n推送通道：尚未启用');
  }
  if(hint){
    hint.textContent = (enabled ? '' :
      '说明：系统级提醒推送尚未在本版本启用（需先完成服务端配置）。\n你现在仍可正常设置待办提醒时间，功能启用后立即生效。\n\n') + pushEnvHint();
  }
  /* 开启：仅在「通道可用 且 本设备未订阅 且 权限未被拒」时可用（修复"永久禁用"） */
  if(on){ on.disabled = !enabled || hasSub || denied; on.style.opacity = on.disabled ? '.5' : ''; }
  /* 关闭：仅在本设备确有订阅时可用 */
  if(off){ off.disabled = !WBReminders.supported() || !hasSub; off.style.opacity = off.disabled ? '.5' : ''; }
}
async function openPushSheet(){ await renderPushSheet(); openSheet('sheet-push'); }
async function pushEnable(){
  const r = await WBReminders.subscribe();
  await renderPushSheet(); refreshPushSubtitle();
  if(r.ok) toast('已开启系统提醒 ✓');
  else if(r.reason === 'push-not-enabled') toast('推送通道尚未启用');
  else if(r.reason === 'denied') toast('通知权限被拒绝，请到系统设置中允许');
  else if(r.reason === 'unsupported') toast('当前设备不支持系统通知');
  else toast('开启失败：' + (r.reason || '未知原因'));
}
async function pushDisable(){
  const r = await WBReminders.unsubscribe();
  await renderPushSheet(); refreshPushSubtitle();
  toast(r.ok ? '已关闭本设备的提醒推送' : ('关闭失败：' + (r.error || '未知原因')));
}
/* 我的页「系统提醒推送」行副标题（v5.13.7：以「是否已订阅」为准，而非仅看权限） */
function refreshPushSubtitle(){
  const el = $('mine-push-sub'); if(!el) return;
  const p = WBReminders.permission();
  let s;
  if(pushCachedSub) s = '已开启';
  else if(!WBReminders.supported()) s = '当前设备不支持';
  else if(p === 'denied') s = '已被系统拒绝';
  else if(p === 'granted') s = '未订阅（点此开启）';
  else s = '未开启';
  el.textContent = s + (WBReminders.enabled() ? '' : ' · 待启用');
}
/* v5.13.7 自愈：进入「我的」/启动时，若浏览器已有订阅但服务端没存（例如首次上报失败、或换账号），
   自动补报（syncSubscription 幂等：已存在则仅更新密钥，不会重复插入）。 */
async function pushAutoHeal(){
  try{
    if(!WBReminders.enabled()){ await refreshPushState(); refreshPushSubtitle(); return; }
    const sub = await refreshPushState();
    if(sub) await WBReminders.syncSubscription(sub);
    refreshPushSubtitle();
  }catch(e){}
}

/* =====================================================================
   v5.13.9：手机提醒通道（服务端直发 webhook）
   ─────────────────────────────────────────────────────────────────────
   为什么需要它：Web Push 依赖 Google FCM —— 大陆网络不可达、国产 ROM（如 OPPO 国行）
   不预装 GMS，实测 Android Chrome 报 `Registration failed - push service error`。
   故改用「服务端直发」：到点由 Edge Function 直接 POST 到国内可达的 IM 群机器人
   （企业微信 / 钉钉 / 飞书，均免费、无需实名；PushPlus 微信渠道需实名），
   以 App 通知的形式到达手机（可响铃），不依赖页面存活。
   凭证存 reminder_channels.target（RLS 仅本人可读）；前端**不回显**已保存的凭证。
   本应用只保留**一条**通道：保存新通道时会清掉其他通道行，避免重复提醒。
   ===================================================================== */
const CH_SPECS = {
  wecom: {
    name: '企业微信群机器人',
    label: 'Webhook 地址',
    ph: '粘贴 Webhook 地址（https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…）',
    help: '企业微信 → 消息页右上角 ＋ → 发起群聊 → 随便选一个成员（建完把他移出即可，机器人会保留）→ 进入该群 → 右上角 … → 群机器人 → 添加机器人 → 复制 Webhook 地址。免费、无需企业认证，限 20 条/分钟。'
  },
  dingtalk: {
    name: '钉钉群机器人',
    label: 'Webhook 地址',
    ph: '粘贴 Webhook 地址（https://oapi.dingtalk.com/robot/send?access_token=…）',
    help: '钉钉 → 发起群聊 → 随便选一个成员（建完把他移出即可，机器人会保留）→ 进群 → 右上角 … → 群设置 → 智能群助手 → 添加机器人 → 自定义 → 复制 Webhook。⚠️「安全设置」必须勾「自定义关键词」并填「提醒」（本应用消息含「【待办提醒】」）。'
  },
  feishu: {
    name: '飞书群机器人',
    label: 'Webhook 地址',
    ph: '粘贴 Webhook 地址（https://open.feishu.cn/open-apis/bot/v2/hook/…）',
    help: '飞书 → 新建群组 → 随便选一个成员（建完把他移出即可，机器人会保留）→ 进群 → 右上角 … → 设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 Webhook 地址。若要求安全设置，选「自定义关键词」填「提醒」。'
  },
  pushplus: {
    name: 'PushPlus 微信推送',
    label: 'PushPlus token',
    ph: '粘贴 PushPlus token（32 位）',
    help: 'PushPlus 的微信渠道目前需实名认证。若你已开通：微信关注 PushPlus 公众号 → 复制 token → 粘贴到上方保存。'
  }
};
let chRow = null;      /* 当前已配置的通道行（null = 未配置；本应用只保留一条通道） */

function chSelected(){ const el = $('chChannelSel'); return el ? el.value : 'wecom'; }
function chSpec(){ return CH_SPECS[chSelected()] || CH_SPECS.wecom; }
function chApplySpec(prefillPlaceholder){
  const sp = chSpec();
  const lb = $('chTargetLabel'), inp = $('chTargetInput'), help = $('chHelp');
  if(lb) lb.textContent = sp.label;
  if(inp) inp.placeholder = prefillPlaceholder ? '已保存（粘贴新值可覆盖）' : sp.ph;
  if(help) help.textContent = sp.help;
}
function chOnChannelChange(){
  const inp = $('chTargetInput'); if(inp) inp.value = '';
  chApplySpec(false);
  chRefreshState();
}
function chRefreshState(){
  const hint = $('chHint'), del = $('chDelBtn'), test = $('chTestBtn');
  const on = !!(chRow && chRow.enabled !== false);
  const nm = (chRow && CH_SPECS[chRow.channel]) ? CH_SPECS[chRow.channel].name : (chRow ? chRow.channel : '');
  if(hint) hint.textContent = on
    ? ('已配置「' + nm + '」：到点由服务端直接推送，不依赖本页面是否打开。\n换通道＝选好后粘贴新值保存；停用＝点「删除」。')
    : '未配置。配置后到点由服务端直接推送到手机，不需要打开本页面。';
  if(del) del.disabled = !chRow;
  if(test) test.disabled = !chRow;
}
async function chLoad(){
  try{
    const rows = await window.WBData.reminderChannels.list({ limit: 20 });
    chRow = (rows || [])[0] || null;
  }catch(e){ chRow = null; }
  if(chRow){
    const sel = $('chChannelSel');
    if(sel && CH_SPECS[chRow.channel]) sel.value = chRow.channel;
    const inp = $('chTargetInput'); if(inp) inp.value = '';     /* 安全：不回显已保存凭证 */
    chApplySpec(true);
  }else{
    chApplySpec(false);
  }
  chRefreshState();
  return chRow;
}
async function chSave(){
  const inp = $('chTargetInput'), btn = $('chSaveBtn');
  const ch = chSelected();
  const sp = chSpec();
  const target = inp ? String(inp.value || '').trim() : '';
  if(!target){ toast('请先粘贴' + sp.label); return; }
  if(ch !== 'pushplus' && !/^https:\/\//i.test(target)){ toast('Webhook 地址应以 https:// 开头'); return; }
  if(btn) btn.disabled = true;
  try{
    /* 只保留一条通道：清掉其他通道行，避免一条提醒被多个通道重复推送 */
    const rows = (await window.WBData.reminderChannels.list({ limit: 20 })) || [];
    for(let i = 0; i < rows.length; i++){
      if(rows[i].channel !== ch) await window.WBData.reminderChannels.remove(rows[i].id, { hardDelete: true });
    }
    const same = rows.filter(function(r){ return r.channel === ch; })[0];
    if(same) await window.WBData.reminderChannels.update(same.id, { target: target, label: sp.name, enabled: true });
    else await window.WBData.reminderChannels.create({ channel: ch, target: target, label: sp.name, enabled: true });
    if(inp) inp.value = '';                      /* 安全：不回显已保存的凭证 */
    await chLoad();
    toast('已保存，点「发送测试」验证一下');
  }catch(e){
    toast('保存失败：' + ((e && (e.message || e.details)) || e));
  }finally{ if(btn) btn.disabled = false; }
}
async function chDelete(){
  if(!chRow){ toast('尚未配置'); return; }
  try{
    await window.WBData.reminderChannels.remove(chRow.id, { hardDelete: true });
    const inp = $('chTargetInput'); if(inp) inp.value = '';
    await chLoad();
    toast('已删除提醒通道');
  }catch(e){ toast('删除失败：' + ((e && (e.message || e.details)) || e)); }
}
async function chTest(){
  const btn = $('chTestBtn'), old = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '发送中…'; }
  try{
    const sess = await getSupabaseClient().auth.getSession();
    const jwt = sess && sess.data && sess.data.session && sess.data.session.access_token;
    if(!jwt) throw new Error('未登录');
    const r = await fetch(SUPABASE_URL + '/functions/v1/todo-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
      body: JSON.stringify({ mode: 'test' })
    });
    const j = await r.json().catch(function(){ return {}; });
    if(j && j.ok){ toast('测试已发送，请查看手机通知 ✓'); }
    else{
      const first = (j && j.results && j.results[0]) || {};
      const det = first.error || (j && j.error) || ('HTTP ' + r.status);
      toast('测试失败：' + det);
    }
  }catch(e){ toast('测试失败：' + ((e && e.message) || e)); }
  finally{ if(btn){ btn.disabled = false; btn.textContent = old || '发送测试'; } }
}
