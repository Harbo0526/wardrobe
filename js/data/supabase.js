/* Wardrobe 统一 Supabase client（Phase 1 建立，Phase 5 扩展）
 * 全项目唯一初始化点：业务模块一律通过 getSupabaseClient() 获取，
 * 禁止在 UI 代码或业务模块中重复初始化、禁止散落 supabase.from()。
 */
let _sbClient = null;

function isSupabaseConfigured() {
  return typeof SUPABASE_URL === 'string' && SUPABASE_URL.length > 0
    && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 0;
}

function getSupabaseClient() {
  if (_sbClient) return _sbClient;
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase 未配置（缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY）');
  }
  if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase JS SDK 未加载（检查 CDN script 引入）');
  }
  _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _sbClient;
}

/* 连通性探测（auth health 端点，轻量） */
async function checkSupabaseConnection() {
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/health', { headers: { apikey: SUPABASE_ANON_KEY } });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, error: (e && e.message) ? e.message : String(e) };
  }
}

/* Phase 1 连通自检（保留） */
(function () {
  try {
    getSupabaseClient();
    window.WB_SUPABASE_OK = true;
    console.log('[Supabase] client 初始化成功');
    checkSupabaseConnection().then(function (r) {
      window.WB_SUPABASE_CONNECTED = r.ok;
      console.log('[Supabase] 项目连通探测: ' + (r.ok ? 'PASS' : 'FAIL ' + r.status));
    });
  } catch (e) {
    window.WB_SUPABASE_OK = false;
    console.error('[Supabase] client 初始化失败:', e);
  }
})();
