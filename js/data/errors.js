/* Wardrobe 统一错误归一化（Phase 5）
 * 目标：UI 层不需要理解 Supabase SDK/PostgREST/Storage 的复杂错误结构。
 * 安全：任何归一化输出不得包含 access_token / password / Service Role Key。
 */
(function () {
  const CODES = {
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    NOT_FOUND: 'NOT_FOUND',
    UNIQUE_VIOLATION: 'UNIQUE_VIOLATION',
    FK_VIOLATION: 'FK_VIOLATION',
    NETWORK: 'NETWORK',
    TIMEOUT: 'TIMEOUT',
    STORAGE_UPLOAD: 'STORAGE_UPLOAD',
    STORAGE_DOWNLOAD: 'STORAGE_DOWNLOAD',
    STORAGE_DELETE: 'STORAGE_DELETE',
    VALIDATION: 'VALIDATION',
    AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
    AUTH_EMAIL_EXISTS: 'AUTH_EMAIL_EXISTS',
    AUTH_WEAK_PASSWORD: 'AUTH_WEAK_PASSWORD',
    AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
    AUTH_ERROR: 'AUTH_ERROR',
    UNKNOWN: 'UNKNOWN'
  };

  /* 清洗消息：剥离任何疑似 token 的长串 */
  function sanitizeMessage(msg) {
    if (typeof msg !== 'string') return '';
    return msg.replace(/[A-Za-z0-9\-_]{40,}/g, '[redacted]').slice(0, 300);
  }

  /*
   * normalizeSupabaseError(error, context)
   * 返回：{ code, message, status, details, context, originalCode }
   */
  function normalizeSupabaseError(err, context) {
    const out = {
      code: CODES.UNKNOWN,
      message: '未知错误',
      status: 0,
      details: null,
      context: context || null,
      originalCode: null
    };

    if (!err) {
      out.message = '未知错误（空错误对象）';
      return out;
    }

    /* WALValidationError（本 DAL 抛出） */
    if (err.wbCode && err.wbMessage) {
      out.code = err.wbCode;
      out.message = sanitizeMessage(err.wbMessage);
      out.status = err.wbStatus || 0;
      out.details = err.wbDetails || null;
      return out;
    }

    /* Storage 错误：{ statusCode, error, message, code } —— 必须先于 PostgREST 分支
     * （Storage 对象同时携带 code:'AccessDenied' 等，避免被误判为 PG 错误码） */
    if (err.statusCode && err.error) {
      const st = parseInt(err.statusCode, 10);
      out.status = st;
      out.originalCode = err.code || err.error;
      out.message = sanitizeMessage(err.message || err.error);
      if (st === 403 || err.code === 'AccessDenied') out.code = CODES.PERMISSION_DENIED;
      else if (st === 404 || err.code === 'NoSuchKey') out.code = CODES.NOT_FOUND;
      else out.code = CODES.STORAGE_UPLOAD; /* 由调用方按操作覆盖 */
      return out;
    }

    /* supabase-js StorageApiError / StorageUnknownError（__isStorageError 标记，
     * status/statusCode/code 属性）—— 常见于 storage.download() 失败 */
    if (err.__isStorageError) {
      const st = parseInt(err.statusCode, 10) || err.status || 0;
      out.status = st;
      out.originalCode = err.code || err.name || null;
      out.message = sanitizeMessage(err.message || String(err));
      if (st === 403) out.code = CODES.PERMISSION_DENIED;
      else if (st === 404) out.code = CODES.NOT_FOUND;
      else if (st === 401) out.code = CODES.NOT_AUTHENTICATED;
      /* 其余保持 UNKNOWN，由 mapStorageError 按 CRUD 语境归类为 STORAGE_* */
      return out;
    }

    /* Supabase Auth 错误（AuthApiError / __isAuthError）：
     * 登录失败统一 AUTH_INVALID_CREDENTIALS，不泄露"邮箱存在/不存在"差异 */
    if (err.__isAuthError || err.name === 'AuthApiError') {
      out.status = parseInt(err.status, 10) || 400;
      out.originalCode = err.code || err.name || null;
      out.message = sanitizeMessage(err.message || String(err));
      const c = err.code || '';
      const m = err.message || '';
      if (c === 'invalid_credentials' || m.indexOf('Invalid login credentials') >= 0) {
        out.code = CODES.AUTH_INVALID_CREDENTIALS;
      } else if (c === 'user_already_exists' || c === 'email_exists' || m.indexOf('already been registered') >= 0 || m.indexOf('already exists') >= 0) {
        out.code = CODES.AUTH_EMAIL_EXISTS;
      } else if (c === 'weak_password' || m.indexOf('Password should be at least') >= 0) {
        out.code = CODES.AUTH_WEAK_PASSWORD;
      } else if (c.indexOf('rate_limit') >= 0 || m.indexOf('rate limit') >= 0) {
        out.code = CODES.AUTH_RATE_LIMITED;
      } else if (out.status === 401) {
        out.code = CODES.NOT_AUTHENTICATED;
      } else {
        out.code = CODES.AUTH_ERROR;
      }
      return out;
    }

    /* supabase-js / PostgREST 错误：通常带 code/message/details/hint */
    const rawCode = err.code || err.error_code || null;
    const rawMsg = err.message || err.msg || (typeof err === 'string' ? err : '');
    out.originalCode = rawCode;
    out.message = sanitizeMessage(rawMsg) || out.message;

    if (rawCode) {
      if (rawCode === '42501' || rawCode === 'PGRST301' || rawCode === 'PGRST302') {
        out.code = rawCode === '42501' ? CODES.PERMISSION_DENIED : CODES.NOT_AUTHENTICATED;
        out.status = rawCode === '42501' ? 403 : 401;
      } else if (rawCode === 'PGRST116' || rawCode === '42P01') {
        out.code = rawCode === 'PGRST116' ? CODES.NOT_FOUND : CODES.UNKNOWN;
      } else if (rawCode === '23505') {
        out.code = CODES.UNIQUE_VIOLATION; out.status = 409;
      } else if (rawCode === '23503') {
        out.code = CODES.FK_VIOLATION; out.status = 409;
      } else if (rawCode === 'PGRST102' || rawCode === '22P02') {
        out.code = CODES.VALIDATION; out.status = 400;
      }
      return out;
    }

    /* 网络/fetch 错误 */
    if (err instanceof TypeError) {
      out.code = CODES.NETWORK;
      out.message = '网络错误：' + sanitizeMessage(err.message);
      return out;
    }
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      out.code = CODES.TIMEOUT;
      out.message = '请求超时';
      return out;
    }

    out.message = sanitizeMessage(err.message) || '未知错误';
    return out;
  }

  /* DAL 内部抛出的可识别错误 */
  function wbError(code, message, opts) {
    const e = new Error(message);
    e.wbCode = code;
    e.wbMessage = message;
    e.wbStatus = (opts && opts.status) || 0;
    e.wbDetails = (opts && opts.details) || null;
    return e;
  }

  window.WBErrors = { CODES: CODES, normalize: normalizeSupabaseError, wbError: wbError, sanitizeMessage: sanitizeMessage };
})();
