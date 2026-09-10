/* Wardrobe Data Access Layer 统一出口（Phase 5）
 * 命名空间：window.WBData —— 业务模块/未来小程序后端复用同一模型。
 * 依赖（按序加载）：config.js → supabase.js → errors.js → query.js →
 *                  auth/session.js → groups.js → clothgroups.js → clothes.js →
 *                  modules.js → 本文件。
 */
(function () {
  const F = window.WBModuleApis.makeCrudApi;

  /* 材料：legacy_id/name/category/abv/price/volume_ml（映射：cat→category、vol→volume_ml） */
  const materials = F({
    table: 'materials',
    createFields: ['name', 'category', 'abv', 'price', 'volume_ml', 'legacy_id'],
    updateFields: ['name', 'category', 'abv', 'price', 'volume_ml'],
    orderWhitelist: ['created_at', 'updated_at', 'name'],
    defaultOrder: 'created_at',
    requiredCreate: ['name']
  });

  /* 配方：totalVol→total_volume_ml、totalCost→total_cost、ts→created_at（迁移时） */
  const recipes = F({
    table: 'recipes',
    createFields: ['name', 'note', 'image_path', 'total_volume_ml', 'total_cost', 'abv', 'legacy_id'],
    updateFields: ['name', 'note', 'image_path', 'total_volume_ml', 'total_cost', 'abv'],
    orderWhitelist: ['created_at', 'updated_at', 'name'],
    defaultOrder: 'created_at',
    requiredCreate: ['name']
  });

  /* 配方明细：items[].matId→material_id、vol→quantity（原无单位默认 ml）；无 deleted_at 列 → noSoftDelete */
  const recipeItems = F({
    table: 'recipe_items',
    createFields: ['recipe_id', 'material_id', 'quantity', 'unit', 'sort_order'],
    updateFields: ['material_id', 'quantity', 'unit', 'sort_order'],
    orderWhitelist: ['created_at', 'sort_order'],
    defaultOrder: 'sort_order',
    requiredCreate: ['recipe_id', 'material_id', 'quantity'],
    noSoftDelete: true
  });

  /* 记账：type 取值 'inc'|'exp'（实际代码语义，见映射文档 §8）；cat→category */
  const ledger = F({
    table: 'ledger_records',
    createFields: ['record_date', 'type', 'amount', 'category', 'note', 'legacy_id'],
    updateFields: ['record_date', 'type', 'amount', 'category', 'note'],
    orderWhitelist: ['record_date', 'created_at', 'updated_at'],
    defaultOrder: 'record_date',
    requiredCreate: ['record_date', 'type', 'amount']
  });

  /* 预算：budgets{"YYYY-MM":n} → year/month/category(可空)/amount */
  const ledgerBudgets = F({
    table: 'ledger_budgets',
    createFields: ['year', 'month', 'category', 'amount', 'legacy_id'],
    updateFields: ['year', 'month', 'category', 'amount'],
    orderWhitelist: ['year', 'month', 'created_at'],
    defaultOrder: 'year',
    requiredCreate: ['year', 'month', 'amount']
  });

  /* 睡眠：date→record_date、start→start_time、end→end_time、endDate→end_date、
   * minutes→duration_minutes；sleep_at/wake_at 暂 NULL（时区策略未定，见映射文档 §10） */
  const sleep = F({
    table: 'sleep_records',
    createFields: ['record_date', 'start_time', 'end_time', 'end_date', 'duration_minutes', 'note', 'legacy_id'],
    updateFields: ['record_date', 'start_time', 'end_time', 'end_date', 'duration_minutes', 'note'],
    orderWhitelist: ['record_date', 'created_at'],
    defaultOrder: 'record_date',
    requiredCreate: ['record_date', 'start_time', 'end_time', 'duration_minutes']
  });

  /* 备忘：t→content、at→created_at（迁移时）；title 预留 */
  const memos = F({
    table: 'memos',
    createFields: ['title', 'content', 'legacy_id'],
    updateFields: ['title', 'content'],
    orderWhitelist: ['created_at', 'updated_at'],
    defaultOrder: 'created_at',
    requiredCreate: ['content']
  });

  /* 油费（v5.3.0）：record_date=加油日期、amount=金额、unit_price=单价、volume=升数、note=备注 */
  const fuel = F({
    table: 'fuel_records',
    createFields: ['record_date', 'amount', 'unit_price', 'volume', 'note', 'legacy_id'],
    updateFields: ['record_date', 'amount', 'unit_price', 'volume', 'note'],
    orderWhitelist: ['record_date', 'created_at', 'updated_at'],
    defaultOrder: 'record_date',
    requiredCreate: ['record_date', 'amount']
  });

  window.WBData = {
    clothes: window.WBClothes,
    groups: window.WBGroupsApi,
    clothGroups: window.WBClothGroups,
    materials: materials,
    recipes: recipes,
    recipeItems: recipeItems,
    ledger: ledger,
    ledgerBudgets: ledgerBudgets,
    sleep: sleep,
    memos: memos,
    fuel: fuel
  };

  /* 便捷调用：WBData.call(asyncFn) → { data, error } 统一返回结构 */
  window.WBData.call = function (fn) {
    return window.WBQuery.wrap(fn());
  };
})();
