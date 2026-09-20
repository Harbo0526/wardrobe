/* Wardrobe Supabase 前端配置（Phase 1）
 * 本文件只允许保存公开凭证：Project URL + anon/publishable key。
 * 严禁将 SUPABASE_SERVICE_ROLE_KEY 写入本文件或任何前端代码。
 * 注意：GitHub Pages 发布时须将 js/ 目录一并上传（记录到 Phase 14 部署清单）。
 */
/* v5.4.6：js/ 层版本号——启动时与页面 APP_VERSION 比对，
   防止「只更新 index.html / sw.js、js/ 目录停留在旧版」造成功能静默失效
   （历史故障：线上油费 UI 在但 DAL/bridge 无 fuel 模块，保存抛错被吞、记录重开即消失）。
   每次升版本须与 APP_VERSION / CACHE_NAME 同版更新。 */
const WB_JS_VERSION = '5.27.0';

const SUPABASE_URL = 'https://frhcnjztlxevafmuapql.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oH8-xK9R5LbWHoAfoyWigQ_6vfrjJnT';

/* v5.9.2 待办提醒 · Web Push 公钥（公开凭证，放前端安全）
   v5.13.6（Phase 1）：已填入真实 Public Key —— 前端据此在「我的 → 系统提醒推送」申请通知权限并上报订阅端点。
   私钥（VAPID_PRIVATE_KEY）**只**存 Supabase secrets，严禁写入本文件或任何前端/仓库文件。
   注意：只填公钥不会产生任何推送 —— 到点投递还需 Phase 2 部署 Edge Function、Phase 3 建 pg_cron 任务。
   参考：supabase/functions/todo-reminder/README.md */
const WB_VAPID_PUBLIC_KEY = 'BCOJIvG8i70WHyO9MftbKsCsDarUVOl3NAeH1DXwgHpXx5SJze16OFrsZtfBmVauwZ5FuysbJfcVnq6cIMSQpXI';
