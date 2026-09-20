/* ============================================================
   电子衣橱 · Legacy Gitee Transport（Phase 7 隔离 / v5.23.0）
   ------------------------------------------------------------
   ⚠ ROLLBACK-ONLY：本文件是 v4.4.0 之前「Gitee 云同步」的唯一网络出口。
   自 v5.0.x 起业务数据 / 图片 / 头像全部走 Supabase，本层已在 giteeFetch 首行被硬阻断。

   内容来源：从 index.html 主内联脚本**逐字节迁出**（只移动，不重构）——
     · Gitee 云同步配置常量 ×6
     · getGiteeToken / setGiteeToken / maskToken
     · giteeFetch（唯一出口 + 硬阻断守卫）
     · giteeReadJSON / giteeWriteJSON

   Classic Script：顶层 function / const 即全局 lexical binding，
   页面模块（upload / ledger / memo / sleep / home）与 Host 编排（doSync 等）继续以
   裸标识符调用；不引入 ESM / IIFE / window 命名空间，不改任何调用方。

   依赖方向：
     Legacy → Core   base64Encode / base64Decode（核心里既有，未复制）
     Legacy → Host   无（本文件不读写 state / DOM / saveState / loadState）
     Legacy → Page   无
     Page   → Legacy 5 个页面模块运行期调用（迁移前即为 Page → Host，仅是容器换了）

   加载位置：js/bridge/legacy-sync.js 之后、js/fuel.js 之前
   （所有调用均发生在运行期，晚于本文件加载）。
   ============================================================ */

/* ---------- Gitee 云同步配置（真实可用） ----------
   令牌不入代码：存 localStorage（gitee_token），首次使用时在「我的」页填写一次。 */
const GITEE_OWNER  = 'harboh';
const GITEE_REPO   = 'wardrobe';
const GITEE_BRANCH = 'master';
const GITEE_TOKEN_KEY = 'gitee_token';
const GITEE_API    = 'https://gitee.com/api/v5';
const GITEE_SYNC_COOLDOWN = 3000;   // 同步按钮冷却，防连点触发 Gitee 免费版限流

function getGiteeToken(){ try{ return localStorage.getItem(GITEE_TOKEN_KEY) || ''; }catch(e){ return ''; } }

function setGiteeToken(token){ try{ localStorage.setItem(GITEE_TOKEN_KEY, token); return true; }catch(e){ return false; } }
function maskToken(token){
  if(!token) return '填一次存本机';
  return token.length <= 4 ? '••••' : token.slice(0,4) + '••••';
}

/* ---------- Gitee API 通用封装 ----------
   注意：令牌必须放 URL query（?access_token=），放 Authorization 头会被 CORS 预检拦截；
   Gitee 预检仅放行 content-type 头。写入文件：POST=创建，PUT=更新（带 sha）。 */
/* [ROLLBACK-ONLY · Phase 17 起硬阻断] 旧 Gitee API 唯一出口。
   v5.0.x 起业务数据/图片/头像全部走 Supabase，本函数是"任何 Gitee 业务请求"的唯一必经点，
   故在此单点硬阻断：即使本地残留旧令牌、即使旧同步代码被误调用，也绝不发出 gitee.com 请求。
   回滚到 v4.4.0-gitee-backup 时可移除本守卫恢复旧链路。 */
async function giteeFetch(path, method, body){
  if(window.__WB_DISABLE_GITEE__ !== false) throw new Error('Gitee 业务依赖已停用（v5.0.x 数据源为 Supabase）');
  const token = getGiteeToken();
  if(!token) throw new Error('未配置 Gitee 令牌');
  const url = GITEE_API + '/repos/' + GITEE_OWNER + '/' + GITEE_REPO + '/contents/' + path
    + '?access_token=' + encodeURIComponent(token);
  const opts = {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if(body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try{
    res = await fetch(url, opts);
  }catch(err){
    throw new Error('网络错误，请检查网络连接');
  }
  const text = await res.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch(e){}
  if(!res.ok){
    const raw = (data && (data.message || data.error)) ? (data.message || data.error) : ('HTTP ' + res.status);
    if(res.status === 401) throw new Error('令牌无效或被拒绝（401），请检查 Gitee 令牌');
    if(res.status === 404) throw new Error('资源不存在（404），请确认仓库 harboh/wardrobe 存在');
    throw new Error('同步请求失败：' + raw);
  }
  return data;
}

/* 通用：读取云端 JSON 文件（不存在或 Gitee 返回 [] → null） */
async function giteeReadJSON(path){
  let data;
  try{
    data = await giteeFetch(path, 'GET');
  }catch(err){
    if(String(err.message).indexOf('404') !== -1) return null;
    throw err;
  }
  if(Array.isArray(data) || !data || !data.content) return null;
  return JSON.parse(base64Decode(data.content));
}
/* 通用：写入云端 JSON（content 为字符串，便于自定义缩进排版）；
   存在取 sha → PUT，不存在 → POST（Gitee 对已存在文件 POST 会返回 400「文件名已存在」） */
async function giteeWriteJSON(path, content, message){
  let sha = null;
  try{
    const existing = await giteeFetch(path, 'GET');
    if(existing && !Array.isArray(existing) && existing.sha) sha = existing.sha;
  }catch(err){
    if(String(err.message).indexOf('404') === -1) throw err;
  }
  const body = { content: base64Encode(content), message: message, branch: GITEE_BRANCH };
  if(sha) body.sha = sha;
  return await giteeFetch(path, sha ? 'PUT' : 'POST', body);
}
