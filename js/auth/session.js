/* Wardrobe Auth 会话模块（Phase 6）
 * 新认证唯一实现：全部走 Supabase Auth（唯一 client）+ 统一错误归一化。
 * - 密码只作为 SDK 调用参数，不写 localStorage、不写日志、不进错误对象；
 * - Auth 会话由 supabase-js 自行持久化（必要会话信息），业务数据仍不落盘；
 * - 旧 Gitee token（gitee_token）与本模块无任何交互，不构成身份来源。
 * 正式接入登录/注册 UI 属于前端切换阶段；本模块当前同时作为 DAL 身份来源与测试入口。
 */
(function () {
  const { CODES, wbError } = window.WBErrors;

  function sdk() { return getSupabaseClient(); }

  /* 会话代际（session generation）：每次登录成功 / 退出完成递增。
   * 所有用户相关的异步加载（头像、图片补图、业务数据）在开始与完成时使用代际 + user ID 双重校验，
   * 不匹配则丢弃结果，杜绝「登出 → 切号」后旧用户的下载/数据回写新用户 UI（会话串扰）。 */
  let sessionGen = 0;
  function bumpSessionGen() { return ++sessionGen; }

  /* 原始 session（supabase-js 格式）或 null */
  async function getSession() {
    const r = await sdk().auth.getSession();
    return (r && r.data && r.data.session) ? r.data.session : null;
  }

  /* 当前登录用户或 null */
  async function getCurrentUser() {
    const s = await getSession();
    return s ? s.user : null;
  }

  function isAuthenticated() {
    return getSession().then(function (s) { return !!s; });
  }

  async function requireUser() {
    const user = await getCurrentUser();
    if (!user) {
      throw wbError(CODES.NOT_AUTHENTICATED, '未登录：请先通过 Supabase Auth 登录', { status: 401 });
    }
    return user;
  }

  function onAuthStateChange(callback) {
    return sdk().auth.onAuthStateChange(function (event, session) {
      callback(event, session ? session.user : null);
    });
  }

  /* 注册。email confirmation 开启且首次注册时 session 为 null（正常）。
   * 返回 { user, session, needsConfirmation }；错误统一归一化。 */
  async function signUp(_ref) {
    const email = _ref.email, password = _ref.password, options = _ref.options;
    if (!email || email.indexOf('@') < 0) {
      throw wbError(CODES.VALIDATION, '注册：请输入有效邮箱', { status: 400 });
    }
    if (!password || password.length < 6) {
      throw wbError(CODES.VALIDATION, '注册：密码至少 6 位', { status: 400 });
    }
    const r = await sdk().auth.signUp({ email: email, password: password, options: options });
    if (r.error) { throw r.error; }
    const user = (r.data && r.data.user) || null;
    const session = (r.data && r.data.session) || null;
    return { user: user, session: session, needsConfirmation: !session && !!user };
  }

  /* 登录（email + password）。失败统一 AUTH_INVALID_CREDENTIALS，不区分账号不存在/密码错误。 */
  async function signIn(_ref) {
    const email = _ref.email, password = _ref.password;
    if (!email || !password) {
      throw wbError(CODES.VALIDATION, '登录：请输入邮箱与密码', { status: 400 });
    }
    const r = await sdk().auth.signInWithPassword({ email: email, password: password });
    if (r.error) { throw r.error; }
    bumpSessionGen();   // 登录成功：代际 +1，旧请求结果将被丢弃
    return r.data;
  }

  /* 退出：等待 Supabase signOut 完成并显式确认 session 已清除。
   * 单例 client 在 signOut 后内存 token 应被 SDK 清除；再调 setSession(null) 作双重保险，
   * 并递增代际，确保任何在途的用户级异步请求（头像 / 图片 / 数据）回写前被判定为过期。 */
  async function signOut() {
    const r = await sdk().auth.signOut();
    if (r.error) { throw r.error; }
    try { await sdk().auth.setSession(null); } catch (e) { /* 某些 SDK 版本 setSession(null) 不支持，忽略 */ }
    bumpSessionGen();   // 退出完成：代际 +1
    return { signedOut: true };
  }

  /* 重置邮件回跳白名单：仅允许本应用自身站点（当前 origin + 已知开发/生产地址）。
   * 不接受用户输入、不接受任意外部 URL。Phase 18：补充生产 project-site 两种形态。 */
  const REDIRECT_ALLOW = [
    location.origin + '/',
    'http://localhost:8080/',
    'http://127.0.0.1:8080/',
    'https://harbo0526.github.io/wardrobe/',
    'https://harbo0526.github.io/wardrobe',
    'https://harbo0526.github.io/index.html'
  ];
  function isAllowedRedirect(url) {
    const s = String(url || '');
    if (!/^https?:\/\//i.test(s)) { return false; }
    return REDIRECT_ALLOW.some(function (allow) { return s.indexOf(allow) === 0; });
  }

  /* 发送密码重置邮件（Supabase Auth）。默认回跳当前站点首页；
   * Phase 18：生产 GitHub Pages project site 默认回跳 /wardrobe（Redirect URLs 已含），避免依赖可能被改坏的 Site URL。 */
  async function resetPasswordForEmail(email, options) {
    if (!email || email.indexOf('@') < 0) {
      throw wbError(CODES.VALIDATION, '重置密码：请输入有效邮箱', { status: 400 });
    }
    const defaultRedirect = (location.hostname === 'harbo0526.github.io')
      ? (location.origin + '/wardrobe')
      : (location.origin + '/index.html');
    const wanted = (options && options.redirectTo) ? String(options.redirectTo) : defaultRedirect;
    if (!isAllowedRedirect(wanted)) {
      throw wbError(CODES.VALIDATION, '重置密码：redirectTo 不在允许的站点白名单内', { status: 400 });
    }
    const r = await sdk().auth.resetPasswordForEmail(email, { redirectTo: wanted });
    if (r.error) { throw r.error; }
    return { sent: true }; /* 不回传任何 token */
  }

  /* 设置/更新密码：必须持有有效 Auth session（未登录 = NOT_AUTHENTICATED） */
  async function updatePassword(newPassword) {
    const user = await getCurrentUser();
    if (!user) {
      throw wbError(CODES.NOT_AUTHENTICATED, '修改密码：需要有效的登录会话', { status: 401 });
    }
    if (!newPassword || newPassword.length < 6) {
      throw wbError(CODES.VALIDATION, '修改密码：新密码至少 6 位', { status: 400 });
    }
    const r = await sdk().auth.updateUser({ password: newPassword });
    if (r.error) { throw r.error; }
    return { updated: true };
  }

  /* 测试/开发辅助：密码登录（与 signIn 同一 SDK 调用，保留旧名以兼容 Phase 5 测试脚本） */
  async function signInWithPassword(email, password) {
    return signIn({ email: email, password: password });
  }

  window.WBSession = {
    getSession: getSession,
    getCurrentUser: getCurrentUser,
    isAuthenticated: isAuthenticated,
    requireUser: requireUser,
    onAuthStateChange: onAuthStateChange,
    signUp: signUp,
    signIn: signIn,
    signInWithPassword: signInWithPassword,
    signOut: signOut,
    resetPasswordForEmail: resetPasswordForEmail,
    updatePassword: updatePassword,
    getSessionGeneration: function () { return sessionGen; }
  };
})();
