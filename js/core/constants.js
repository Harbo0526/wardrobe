/* ==========================================================================
   生活象限 · core/constants.js
   --------------------------------------------------------------------------
   只收录「无业务依赖」的全局常量：不读 state、不碰 DOM、不依赖 Supabase、
   不依赖初始化顺序、不依赖任何业务页面。

   ⚠️ 加载顺序：本文件必须在 index.html 的主内联 <script> **之前**加载
      （主脚本的顶层语句在解析期即会用到 core 符号，晚加载会触发 TDZ 报错）。

   下方内容由 tools/core-extract.cjs 自 index.html **逐字节原样迁出**
   （v5.14.5 / Phase 3，位置迁移，非重构）。
   复验：node tools/core-extract.cjs --verify
   ========================================================================== */

/* 本地存储按用户隔离：每个账号一个独立 key，避免同一浏览器多账号共用一份数据导致串号。
   - 未登录（游客）态：LS_KEY_GUEST
   - 登录后：wardrobe.v1.{用户名}
   旧单键 LS_KEY 仅用于一次性兼容迁移，不再作为读写主路径。 */
const LS_KEY = 'wardrobe.demo.v1';
const LS_KEY_GUEST = 'wardrobe.v1.guest';
const LS_KEY_LAST = 'wardrobe.v1.lastUser';   // 最近登录用户名：供刷新/重启后自动恢复会话
const LS_KEY_SESSION = 'wardrobe.v1.session';  // 仅存登录态 {user}（纯云端策略：衣物/图片/调酒等用户数据不落盘）

const WB_THEMES = ['cute', 'minimal'];
const THEME_LS_KEY = 'wardrobe.v1.theme';
