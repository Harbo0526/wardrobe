/* Wardrobe 衣物 Data Access（Phase 5）
 * 表：public.clothes；关系：public.cloth_groups（多对多，替代旧 group/groups 双字段）
 * 字段依据：supabase/migration/phase2-field-mapping.md §3
 * 兼容适配：list 结果可附加 _groupIds / group / groups（由适配层生成，
 *          非数据库字段；单值 group = sort_order 最小的分组，多关系不丢失）。
 */
(function () {
  const { CODES, wbError } = window.WBErrors;
  const Q = window.WBQuery;

  const TABLE = 'clothes';
  const CREATE_FIELDS = ['name', 'note', 'emoji', 'tint', 'category', 'brand', 'color', 'size', 'image_path', 'legacy_id'];
  const UPDATE_FIELDS = ['name', 'note', 'emoji', 'tint', 'category', 'brand', 'color', 'size', 'image_path'];
  const FORBIDDEN = ['id', 'user_id', 'created_at', 'updated_at', 'deleted_at'];
  const ORDER_WHITELIST = ['created_at', 'updated_at', 'name'];

  async function list(opts) {
    opts = opts || {};
    const page = Q.pageOptions(opts);
    let q = getSupabaseClient().from(TABLE).select('*').range(page.offset, page.offset + page.limit - 1);
    q = Q.applySoftDelete(q, opts);
    q = Q.applyOrder(q, opts, ORDER_WHITELIST, 'created_at');
    const r = await q;
    if (r.error) { throw r.error; }
    const rows = r.data || [];
    if (opts.withGroups !== false && rows.length > 0) {
      await attachGroupCompat(rows, opts);
    }
    return rows;
  }

  async function getById(id, opts) {
    Q.assertUuid(id, 'cloth');
    let q = getSupabaseClient().from(TABLE).select('*').eq('id', id).limit(1);
    q = Q.applySoftDelete(q, opts);
    const r = await q;
    if (r.error) { throw r.error; }
    const row = (r.data && r.data[0]) || null;
    if (row && (opts === undefined || !opts || opts.withGroups !== false)) {
      await attachGroupCompat([row], opts);
    }
    return row;
  }

  /* 批量查询关系，生成兼容字段（2 次请求，无 N+1） */
  async function attachGroupCompat(rows, opts) {
    const cg = window.WBClothGroups;
    const ids = rows.map(function (r) { return r.id; });
    const rels = await cg.listByClothIds(ids, opts);
    const byCloth = {};
    rels.forEach(function (rel) {
      (byCloth[rel.cloth_id] = byCloth[rel.cloth_id] || []).push(rel);
    });
    rows.forEach(function (row) {
      const relsOfRow = (byCloth[row.id] || []).slice().sort(function (a, b) {
        return (a.group_sort_order || 0) - (b.group_sort_order || 0);
      });
      row._groupIds = relsOfRow.map(function (rel) { return rel.group_id; });
      row.groups = row._groupIds.slice();           /* 兼容：多值 */
      row.group = row._groupIds.length > 0 ? row._groupIds[0] : null; /* 兼容：单值=排序第一个 */
    });
  }

  /* 从输入中剥离分组兼容通道字段（_groupIds/group/groups），其余走白名单 */
  function stripGroupInput(input) {
    const rest = Object.assign({}, input);
    delete rest._groupIds; delete rest.group; delete rest.groups;
    return rest;
  }

  async function create(input) {
    const user = await window.WBSession.requireUser();
    const FORBIDDEN_CREATE = FORBIDDEN.filter(function (f) { return f !== 'id'; });
    const groupIds = input && Array.isArray(input._groupIds) ? input._groupIds : null;
    const singleGroup = input && Object.prototype.hasOwnProperty.call(input, 'group') ? input.group : undefined;
    const fields = Q.pickFields(stripGroupInput(input), CREATE_FIELDS.concat('id'), FORBIDDEN_CREATE, 'cloth');
    if (fields.id !== undefined) { Q.assertUuid(fields.id, 'cloth'); }
    if (!fields.name || typeof fields.name !== 'string') {
      throw wbError(CODES.VALIDATION, 'cloth: name 必填且为字符串', { status: 400 });
    }
    fields.user_id = user.id;
    const r = await getSupabaseClient().from(TABLE).insert(fields).select().single();
    if (r.error) { throw r.error; }
    const row = r.data;
    /* 分组关系：优先 _groupIds 多值；兼容单值 group */
    let target = groupIds;
    if (!target && singleGroup !== undefined && singleGroup !== null) { target = [singleGroup]; }
    if (target && target.length > 0) {
      for (let i = 0; i < target.length; i++) {
        await window.WBClothGroups.attach(row.id, target[i]);
      }
    }
    return row;
  }

  async function update(id, patch) {
    await window.WBSession.requireUser();
    Q.assertUuid(id, 'cloth');
    const groupIds = patch && Array.isArray(patch._groupIds) ? patch._groupIds : undefined;
    const fields = Q.pickFields(stripGroupInput(patch), UPDATE_FIELDS, FORBIDDEN, 'cloth');
    if (Object.keys(fields).length > 0) {
      const r = await getSupabaseClient().from(TABLE).update(fields).eq('id', id).select().single();
      if (r.error) { throw r.error; }
    }
    if (groupIds !== undefined) {
      await window.WBClothGroups.replaceForCloth(id, groupIds);
    }
    return window.WBClothes.getById(id, { includeDeleted: true, withGroups: false });
  }

  /* 默认软删除。关系表为纯关联数据（无业务字段），软删除衣物时同步物理删除
   * 关系行（恢复衣物后由 UI 重新建立关系；关系本身不含需保留的信息）。
   * 该决策已记录于 phase5-data-access-inventory.md §软删除。 */
  async function remove(id, opts) {
    const user = await window.WBSession.requireUser();
    Q.assertUuid(id, 'cloth');
    if (opts && opts.hardDelete === true) {
      await window.WBClothGroups.detachAllForCloth(id);
      const r = await getSupabaseClient().from(TABLE).delete().eq('id', id);
      if (r.error) { throw r.error; }
      return { softDeleted: false };
    }
    const r = await getSupabaseClient().from(TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id).is('deleted_at', null).select().single();
    if (r.error) { throw r.error; }
    if (r.data) {
      await window.WBClothGroups.detachAllForCloth(id);
    }
    return { softDeleted: true, data: r.data };
  }

  /* 恢复衣物：软删标记清除；关系不自动恢复（需 UI/调用方重新 attach） */
  async function restore(id) {
    await window.WBSession.requireUser();
    Q.assertUuid(id, 'cloth');
    const r = await getSupabaseClient().from(TABLE)
      .update({ deleted_at: null })
      .eq('id', id).select().single();
    if (r.error) { throw r.error; }
    return r.data;
  }

  window.WBClothes = { list: list, getById: getById, create: create, update: update, remove: remove, restore: restore };
})();
