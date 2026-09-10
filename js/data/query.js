/* Wardrobe 统一查询约定（Phase 5）
 * 统一：软删除过滤 / 分页 / 排序白名单 / 字段白名单 / 返回结构。
 * 依赖：js/data/errors.js（WBErrors）、js/data/supabase.js（getSupabaseClient）。
 */
(function () {
  const { CODES, wbError } = window.WBErrors;

  const DEFAULT_LIMIT = 100;
  const MAX_LIMIT = 500;

  /* 分页参数校验：所有列表查询强制显式分页，防全量下载 */
  function pageOptions(opts) {
    opts = opts || {};
    let limit = parseInt(opts.limit, 10);
    if (isNaN(limit) || limit <= 0) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    let offset = parseInt(opts.offset, 10);
    if (isNaN(offset) || offset < 0) offset = 0;
    return { limit: limit, offset: offset };
  }

  /* 软删除过滤：默认 deleted_at IS NULL；仅 includeDeleted:true 时放开 */
  function applySoftDelete(q, opts) {
    if (!(opts && opts.includeDeleted === true)) {
      q = q.is('deleted_at', null);
    }
    return q;
  }

  /* 排序白名单：orderBy 必须在白名单内，禁止任意列名 */
  function applyOrder(q, opts, whitelist, defaultOrder) {
    const o = opts || {};
    const col = (o.orderBy && whitelist.indexOf(o.orderBy) >= 0) ? o.orderBy : defaultOrder;
    const asc = o.ascending === true;
    return q.order(col, { ascending: asc });
  }

  /* 字段白名单校验：
   * - input 中的未知字段 → VALIDATION 错误（不静默丢弃）
   * - forbidden 字段（id/user_id/created_at/updated_at/deleted_at）→ VALIDATION 错误
   * 返回仅含白名单字段的对象。 */
  function pickFields(input, allowed, forbidden, entityName) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw wbError(CODES.VALIDATION, entityName + ': 输入必须是对象', { status: 400 });
    }
    const out = {};
    const unknown = [];
    Object.keys(input).forEach(function (k) {
      if (forbidden.indexOf(k) >= 0) {
        throw wbError(CODES.VALIDATION, entityName + ': 字段 "' + k + '" 不允许由调用方设置', { status: 400 });
      }
      if (allowed.indexOf(k) >= 0) { out[k] = input[k]; } else { unknown.push(k); }
    });
    if (unknown.length > 0) {
      throw wbError(CODES.VALIDATION, entityName + ': 未知字段 [' + unknown.join(', ') + ']（未静默丢弃，请修正输入）', { status: 400 });
    }
    return out;
  }

  /* id 校验：必须是 UUID */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function assertUuid(id, entityName) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw wbError(CODES.VALIDATION, entityName + ': id 必须是合法 UUID', { status: 400 });
    }
    return id;
  }

  /* 统一返回结构：{ data, error } —— error 为归一化错误或 null */
  function wrap(promise) {
    return promise.then(
      function (data) { return { data: data, error: null }; },
      function (err) { return { data: null, error: window.WBErrors.normalize(err) }; }
    );
  }

  window.WBQuery = {
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    MAX_LIMIT: MAX_LIMIT,
    pageOptions: pageOptions,
    applySoftDelete: applySoftDelete,
    applyOrder: applyOrder,
    pickFields: pickFields,
    assertUuid: assertUuid,
    wrap: wrap
  };
})();
