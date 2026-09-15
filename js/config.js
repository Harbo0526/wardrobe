/* Wardrobe Supabase 前端配置（Phase 1）
 * 本文件只允许保存公开凭证：Project URL + anon/publishable key。
 * 严禁将 SUPABASE_SERVICE_ROLE_KEY 写入本文件或任何前端代码。
 * 注意：GitHub Pages 发布时须将 js/ 目录一并上传（记录到 Phase 14 部署清单）。
 */
/* v5.4.6：js/ 层版本号——启动时与页面 APP_VERSION 比对，
   防止「只更新 index.html / sw.js、js/ 目录停留在旧版」造成功能静默失效
   （历史故障：线上油费 UI 在但 DAL/bridge 无 fuel 模块，保存抛错被吞、记录重开即消失）。
   每次升版本须与 APP_VERSION / CACHE_NAME 同版更新。 */
const WB_JS_VERSION = '5.13.5';

const SUPABASE_URL = 'https://frhcnjztlxevafmuapql.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oH8-xK9R5LbWHoAfoyWigQ_6vfrjJnT';

/* v5.9.2 待办提醒 · Web Push 公钥（公开凭证，放前端安全）
   Phase 1 留空 → 前端不申请通知权限、不发起订阅，提醒只做「落库 + 展示」；
   Phase 2 启用推送：把 `npx web-push generate-vapid-keys` 生成的 Public Key 填到这里，
   并按 supabase/functions/todo-reminder/README.md 部署 Edge Function + pg_cron。 */
const WB_VAPID_PUBLIC_KEY = '';
