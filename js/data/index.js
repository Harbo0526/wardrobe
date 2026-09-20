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
   * minutes→duration_minutes；sleep_at/wake_at 暂 NULL（时区策略未定，见映射文档 §10）
   * v5.14.3：end_time 不再是必填 —— 允许「只填入睡时间」（尚未起床）先入库，
   *   睡醒后回明细补填起床时间（对同一行 UPDATE）。进行中记录 duration_minutes 写 0，
   *   且不计入任何统计（应用层按 !r.end 跳过）。 */
  const sleep = F({
    table: 'sleep_records',
    createFields: ['record_date', 'start_time', 'end_time', 'end_date', 'duration_minutes', 'note', 'legacy_id'],
    updateFields: ['record_date', 'start_time', 'end_time', 'end_date', 'duration_minutes', 'note'],
    orderWhitelist: ['record_date', 'created_at'],
    defaultOrder: 'record_date',
    requiredCreate: ['record_date', 'start_time', 'duration_minutes']
  });

  /* 备忘：t→content、at→legacy_id（兼作备忘日期，v5.7.0 起允许编辑）；title=标题
   * v5.13.12：提醒字段与 todos 同构 —— reminder_at / reminder_status 前端可写；
   *           reminder_sent_at 归服务端回写 → 刻意排除在 create/update 白名单外，前端不可伪造。 */
  const memos = F({
    table: 'memos',
    createFields: ['title', 'content', 'legacy_id', 'reminder_at', 'reminder_status'],
    updateFields: ['title', 'content', 'legacy_id', 'reminder_at', 'reminder_status'],
    orderWhitelist: ['created_at', 'updated_at'],
    defaultOrder: 'created_at',
    requiredCreate: ['content']
  });

  /* 油费（v5.3.0）：record_date=加油日期、amount=金额、unit_price=单价、volume=升数、note=备注 */
  /* 油电费：v5.26.0 起同一张表承载「加油」与「充电」，用 kind 区分
   *   （fuel = 加油：volume 升 / unit_price 元每升；charge = 充电：volume kWh / unit_price 元每度）。
   *   历史行无 kind → 迁移时已回填 'fuel'，本层再兜底为 'fuel'。 */
  const fuel = F({
    table: 'fuel_records',
    createFields: ['record_date', 'amount', 'unit_price', 'volume', 'kind', 'note', 'legacy_id'],
    updateFields: ['record_date', 'amount', 'unit_price', 'volume', 'kind', 'note'],
    orderWhitelist: ['record_date', 'created_at', 'updated_at'],
    defaultOrder: 'record_date',
    requiredCreate: ['record_date', 'amount']
  });

  /* 公告（v5.6.0）：user_id=发布者（仅 profiles.role='admin' 的账号可写，RLS 兜底）；
   * title 可空、body 必填、version 记发布时的 APP_VERSION；读：所有登录用户可读全部 */
  const announcements = F({
    table: 'announcements',
    createFields: ['title', 'body', 'version', 'published_at'],
    updateFields: ['title', 'body', 'version', 'published_at'],
    orderWhitelist: ['published_at', 'created_at'],
    defaultOrder: 'published_at',
    requiredCreate: ['body']
  });

  /* 待办（v5.9.2）：type='daily'|'temporary'；business_date=每日待办的业务日期（每天 02:00 切换）；
   * done/done_at=完成状态与完成时间；
   * 提醒字段（Phase 1 建表即预留、Phase 2 由 Edge Function + pg_cron 服务端投递）：
   *   reminder_at=提醒时间、reminder_status='none'|'pending'|'sent'|'failed'|'cancelled'；
   *   reminder_sent_at 归服务端回写 → 刻意排除在 create/update 白名单外，前端不可伪造。
   * 投递不依赖页面存活（前端不使用 setTimeout）。 */
  const todos = F({
    table: 'todos',
    createFields: ['type', 'content', 'business_date', 'done', 'done_at',
                   'reminder_at', 'reminder_status', 'sort_order', 'legacy_id', 'template_id'],
    updateFields: ['type', 'content', 'business_date', 'done', 'done_at',
                   'reminder_at', 'reminder_status', 'sort_order', 'template_id'],
    orderWhitelist: ['business_date', 'created_at', 'updated_at', 'sort_order'],
    defaultOrder: 'created_at',
    requiredCreate: ['type', 'content']
  });

  /* Push 订阅（v5.9.2 预留，Phase 2 启用）：一行 = 一台设备的 Web Push 端点；
   * 无 deleted_at 列（订阅失效直接物理删除）→ noSoftDelete */
  const pushSubscriptions = F({
    table: 'push_subscriptions',
    createFields: ['endpoint', 'p256dh', 'auth', 'user_agent'],
    updateFields: ['p256dh', 'auth', 'user_agent'],
    orderWhitelist: ['created_at', 'updated_at'],
    defaultOrder: 'created_at',
    requiredCreate: ['endpoint', 'p256dh', 'auth'],
    noSoftDelete: true
  });

  /* 待办提醒投递通道（v5.13.8）：一行 = 某用户的一条直发通道。
   * channel='pushplus' → target 填 PushPlus token（微信推送，大陆可用、免装 App）；
   * channel='wecom'    → target 填企业微信群机器人 webhook URL。
   * target 属**密钥类数据**（可用来给该用户发消息）→ RLS 仅本人可读写；
   * 服务端 todo-reminder 用 service_role 读取并投递；DB 侧 unique(user_id, channel) 防重复投递。
   * 无 deleted_at 列（停用改 enabled=false，删除即物理删除）→ noSoftDelete */
  const reminderChannels = F({
    table: 'reminder_channels',
    createFields: ['channel', 'target', 'label', 'enabled'],
    updateFields: ['target', 'label', 'enabled'],
    orderWhitelist: ['created_at', 'updated_at'],
    defaultOrder: 'created_at',
    requiredCreate: ['channel', 'target'],
    noSoftDelete: true
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
    fuel: fuel,
    announcements: announcements,
    todos: todos,
    pushSubscriptions: pushSubscriptions,
    reminderChannels: reminderChannels
  };

  /* 便捷调用：WBData.call(asyncFn) → { data, error } 统一返回结构 */
  window.WBData.call = function (fn) {
    return window.WBQuery.wrap(fn());
  };
})();
