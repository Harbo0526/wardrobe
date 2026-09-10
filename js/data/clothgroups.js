/* Wardrobe 衣物-分组关系 Data Access（Phase 5）
 * 表：public.cloth_groups（复合主键 cloth_id+group_id；user_id 冗余；无软删除——
 *     关系行是纯关联数据，物理删除不损失业务信息，该决策已记录于盘点文档）
 * 所有权：RLS 同时校验自身 user_id + clothes/groups 归属（Phase 3 已建）。
 */
(function () {
  const { CODES, wbError } = window.WBErrors;
  const Q = window.WBQuery;

  const TABLE = 'cloth_groups';

  /* 按 cloth_id 批量查关系（附带分组 sort_order 供兼容排序，1 次请求） */
  async function listByClothIds(clothIds, opts) {
    if (!Array.isArray(clothIds) || clothIds.length === 0) return [];
    let q = getSupabaseClient()
      .from(TABLE)
      .select('cloth_id, group_id, created_at, groups:group_id(name, emoji, sort_order, deleted_at)');
    q = q.in('cloth_id', clothIds);
    if (!(opts && opts.includeDeleted === true)) {
      q = q.is('groups.deleted_at', null); /* 已软删除的分组不出现在兼容关系里 */
    }
    const r = await q;
    if (r.error) { throw r.error; }
    return (r.data || []).map(function (row) {
      return {
        cloth_id: row.cloth_id,
        group_id: row.group_id,
        created_at: row.created_at,
        group_name: row.groups ? row.groups.name : null,
        group_emoji: row.groups ? row.groups.emoji : null,
        group_sort_order: row.groups ? row.groups.sort_order : 0
      };
    });
  }

  async function listByCloth(clothId, opts) {
    Q.assertUuid(clothId, 'cloth');
    return listByClothIds([clothId], opts);
  }

  async function listByGroup(groupId, opts) {
    Q.assertUuid(groupId, 'group');
    let q = getSupabaseClient().from(TABLE).select('*').eq('group_id', groupId);
    const r = await q;
    if (r.error) { throw r.error; }
    return r.data || [];
  }

  async function attach(clothId, groupId) {
    const user = await window.WBSession.requireUser();
    Q.assertUuid(clothId, 'cloth');
    Q.assertUuid(groupId, 'group');
    const r = await getSupabaseClient().from(TABLE)
      .insert({ cloth_id: clothId, group_id: groupId, user_id: user.id })
      .select().single();
    if (r.error) { throw r.error; }
    return r.data;
  }

  async function detach(clothId, groupId) {
    await window.WBSession.requireUser();
    Q.assertUuid(clothId, 'cloth');
    Q.assertUuid(groupId, 'group');
    const r = await getSupabaseClient().from(TABLE)
      .delete()
      .eq('cloth_id', clothId).eq('group_id', groupId);
    if (r.error) { throw r.error; }
    return { detached: true };
  }

  /* 删除某衣物的全部关系（软删除衣物时由 clothes.remove 调用） */
  async function detachAllForCloth(clothId) {
    await window.WBSession.requireUser();
    Q.assertUuid(clothId, 'cloth');
    const r = await getSupabaseClient().from(TABLE).delete().eq('cloth_id', clothId);
    if (r.error) { throw r.error; }
    return { detachedAll: true };
  }

  /* 原子化替换某衣物的分组集合：diff 后只增删差异行 */
  async function replaceForCloth(clothId, groupIds) {
    await window.WBSession.requireUser();
    Q.assertUuid(clothId, 'cloth');
    if (!Array.isArray(groupIds)) {
      throw wbError(CODES.VALIDATION, 'cloth_groups.replaceForCloth: groupIds 必须是数组', { status: 400 });
    }
    groupIds.forEach(function (g) { Q.assertUuid(g, 'group'); });
    const current = await listByClothIds([clothId], { includeDeleted: true });
    const currentSet = {};
    current.forEach(function (rel) { currentSet[rel.group_id] = true; });
    const targetSet = {};
    groupIds.forEach(function (g) { targetSet[g] = true; });
    for (let i = 0; i < groupIds.length; i++) {
      if (!currentSet[groupIds[i]]) { await attach(clothId, groupIds[i]); }
    }
    for (let i = 0; i < current.length; i++) {
      if (!targetSet[current[i].group_id]) { await detach(clothId, current[i].group_id); }
    }
    return { replaced: true, groupIds: groupIds };
  }

  window.WBClothGroups = {
    listByClothIds: listByClothIds,
    listByCloth: listByCloth,
    listByGroup: listByGroup,
    attach: attach,
    detach: detach,
    detachAllForCloth: detachAllForCloth,
    replaceForCloth: replaceForCloth
  };
})();
