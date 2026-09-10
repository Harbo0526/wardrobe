/* Wardrobe 后续模块统一接口（Phase 5 骨架）
 * 通过泛型工厂为调酒/记账/睡眠/备忘建立与衣橱一致的 CRUD 边界。
 * 【重要】本阶段仅为接口层：未接入 UI、未导入 Gitee 数据、未执行真实业务写入。
 * 字段白名单依据：supabase/migration/phase2-field-mapping.md。
 */
(function () {
  const { CODES, wbError } = window.WBErrors;
  const Q = window.WBQuery;

  /*
   * makeCrudApi({ table, createFields, updateFields, orderWhitelist, defaultOrder, requiredCreate })
   * 统一约定：软删除默认过滤（includeDeleted 放开）、强制分页、排序白名单、
   * create 自动注入 user_id、update 禁改 id/user_id/created_at/deleted_at。
   */
  function makeCrudApi(cfg) {
    const FORBIDDEN = ['id', 'user_id', 'created_at', 'updated_at', 'deleted_at'];

    async function list(opts) {
      opts = opts || {};
      const page = Q.pageOptions(opts);
      let q = getSupabaseClient().from(cfg.table).select('*').range(page.offset, page.offset + page.limit - 1);
      if (!cfg.noSoftDelete) { q = Q.applySoftDelete(q, opts); }   /* 关系表等无 deleted_at 列的表跳过软删过滤 */
      q = Q.applyOrder(q, opts, cfg.orderWhitelist, cfg.defaultOrder);
      const r = await q;
      if (r.error) { throw r.error; }
      return r.data;
    }

    async function getById(id, opts) {
      Q.assertUuid(id, cfg.table);
      let q = getSupabaseClient().from(cfg.table).select('*').eq('id', id).limit(1);
      q = Q.applySoftDelete(q, opts);
      const r = await q;
      if (r.error) { throw r.error; }
      return (r.data && r.data[0]) || null;
    }

    async function create(input) {
      const user = await window.WBSession.requireUser();
      /* Phase 14：允许调用方传入客户端生成的 UUID 作为主键（本地内存 id 与 DB id 一致） */
      const FORBIDDEN_CREATE = FORBIDDEN.filter(function (f) { return f !== 'id'; });
      const fields = Q.pickFields(input, cfg.createFields.concat('id'), FORBIDDEN_CREATE, cfg.table);
      if (fields.id !== undefined) { Q.assertUuid(fields.id, cfg.table); }
      (cfg.requiredCreate || []).forEach(function (f) {
        if (fields[f] === undefined || fields[f] === null) {
          throw wbError(CODES.VALIDATION, cfg.table + ': ' + f + ' 必填', { status: 400 });
        }
      });
      fields.user_id = user.id;
      const r = await getSupabaseClient().from(cfg.table).insert(fields).select().single();
      if (r.error) { throw r.error; }
      return r.data;
    }

    async function update(id, patch) {
      await window.WBSession.requireUser();
      Q.assertUuid(id, cfg.table);
      const fields = Q.pickFields(patch, cfg.updateFields, FORBIDDEN, cfg.table);
      if (Object.keys(fields).length === 0) {
        throw wbError(CODES.VALIDATION, cfg.table + ': update 至少包含一个可更新字段', { status: 400 });
      }
      const r = await getSupabaseClient().from(cfg.table).update(fields).eq('id', id).select().single();
      if (r.error) { throw r.error; }
      return r.data;
    }

    async function remove(id, opts) {
      await window.WBSession.requireUser();
      Q.assertUuid(id, cfg.table);
      if (opts && opts.hardDelete === true) {
        const r = await getSupabaseClient().from(cfg.table).delete().eq('id', id);
        if (r.error) { throw r.error; }
        return { softDeleted: false };
      }
      const r = await getSupabaseClient().from(cfg.table)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id).is('deleted_at', null).select().single();
      if (r.error) { throw r.error; }
      return { softDeleted: true, data: r.data };
    }

    async function restore(id) {
      await window.WBSession.requireUser();
      Q.assertUuid(id, cfg.table);
      const r = await getSupabaseClient().from(cfg.table)
        .update({ deleted_at: null }).eq('id', id).select().single();
      if (r.error) { throw r.error; }
      return r.data;
    }

    return { list: list, getById: getById, create: create, update: update, remove: remove, restore: restore };
  }

  window.WBModuleApis = { makeCrudApi: makeCrudApi };
})();
