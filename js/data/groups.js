/* Wardrobe 分组 Data Access（Phase 5）
 * 表：public.groups（uuid 主键；user_id 由会话注入；deleted_at 软删除）
 * 字段依据：supabase/migration/phase2-field-mapping.md §2
 */
(function () {
  const { CODES, wbError } = window.WBErrors;
  const Q = window.WBQuery;

  const TABLE = 'groups';
  const CREATE_FIELDS = ['name', 'emoji', 'legacy_id', 'sort_order'];
  const UPDATE_FIELDS = ['name', 'emoji', 'sort_order'];
  const FORBIDDEN = ['id', 'user_id', 'created_at', 'updated_at', 'deleted_at'];
  const ORDER_WHITELIST = ['created_at', 'updated_at', 'name', 'sort_order'];

  async function list(opts) {
    opts = opts || {};
    const page = Q.pageOptions(opts);
    let q = getSupabaseClient().from(TABLE).select('*').range(page.offset, page.offset + page.limit - 1);
    q = Q.applySoftDelete(q, opts);
    q = Q.applyOrder(q, opts, ORDER_WHITELIST, 'sort_order');
    const r = await q;
    if (r.error) { throw r.error; }
    return r.data;
  }

  async function getById(id, opts) {
    Q.assertUuid(id, 'group');
    let q = getSupabaseClient().from(TABLE).select('*').eq('id', id).limit(1);
    q = Q.applySoftDelete(q, opts);
    const r = await q;
    if (r.error) { throw r.error; }
    return (r.data && r.data[0]) || null;
  }

  async function create(input) {
    const user = await window.WBSession.requireUser();
    const FORBIDDEN_CREATE = FORBIDDEN.filter(function (f) { return f !== 'id'; });
    const fields = Q.pickFields(input, CREATE_FIELDS.concat('id'), FORBIDDEN_CREATE, 'group');
    if (fields.id !== undefined) { Q.assertUuid(fields.id, 'group'); }
    if (!fields.name || typeof fields.name !== 'string') {
      throw wbError(CODES.VALIDATION, 'group: name 必填且为字符串', { status: 400 });
    }
    fields.user_id = user.id; /* 唯一合法来源：当前认证会话；RLS 终审 */
    const r = await getSupabaseClient().from(TABLE).insert(fields).select().single();
    if (r.error) { throw r.error; }
    return r.data;
  }

  async function update(id, patch) {
    await window.WBSession.requireUser();
    Q.assertUuid(id, 'group');
    const fields = Q.pickFields(patch, UPDATE_FIELDS, FORBIDDEN, 'group');
    if (Object.keys(fields).length === 0) {
      throw wbError(CODES.VALIDATION, 'group: update 至少包含一个可更新字段', { status: 400 });
    }
    const r = await getSupabaseClient().from(TABLE).update(fields).eq('id', id).select().single();
    if (r.error) { throw r.error; }
    return r.data;
  }

  /* 默认软删除；opts.hardDelete=true 时物理删除（会级联删除 cloth_groups 关系行） */
  async function remove(id, opts) {
    await window.WBSession.requireUser();
    Q.assertUuid(id, 'group');
    if (opts && opts.hardDelete === true) {
      const r = await getSupabaseClient().from(TABLE).delete().eq('id', id);
      if (r.error) { throw r.error; }
      return { softDeleted: false };
    }
    const r = await getSupabaseClient().from(TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id).is('deleted_at', null).select().single();
    if (r.error) { throw r.error; }
    return { softDeleted: true, data: r.data };
  }

  async function restore(id) {
    await window.WBSession.requireUser();
    Q.assertUuid(id, 'group');
    const r = await getSupabaseClient().from(TABLE)
      .update({ deleted_at: null })
      .eq('id', id).select().single();
    if (r.error) { throw r.error; }
    return r.data;
  }

  window.WBGroupsApi = { list: list, getById: getById, create: create, update: update, remove: remove, restore: restore };
})();
