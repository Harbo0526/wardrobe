/* Wardrobe Storage 路径统一生成（Phase 5）
 * 路径模板（与 Phase 4 Storage RLS 严格对应，第一段必须 = 当前用户 UUID）：
 *   clothes/{user_id}/{cloth_id}.jpg
 *   cocktail/{user_id}/{recipe_id}.jpg
 *   avatars/{user_id}/avatar.jpg
 * 禁止业务代码自行拼接用户目录；全部经本模块生成并校验。
 */
(function () {
  const { CODES, wbError } = window.WBErrors;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EXT_WHITELIST = ['jpg', 'jpeg', 'png', 'webp'];

  function assertUuidComponent(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw wbError(CODES.VALIDATION, 'storage path: ' + label + ' 不能为空', { status: 400 });
    }
    if (!UUID_RE.test(value)) {
      throw wbError(CODES.VALIDATION, 'storage path: ' + label + ' 必须是合法 UUID', { status: 400 });
    }
    return value.toLowerCase();
  }

  function assertExtension(ext) {
    const e = (ext || 'jpg').toLowerCase().replace(/^\./, '');
    if (EXT_WHITELIST.indexOf(e) < 0) {
      throw wbError(CODES.VALIDATION, 'storage path: 扩展名 .' + e + ' 不在白名单 [' + EXT_WHITELIST.join(',') + ']', { status: 400 });
    }
    return e;
  }

  /* 双重防御：拒绝 ..、反斜杠、URL 编码绕过、多余分隔符（即使 UUID 校验已过） */
  function assertSafeName(name) {
    if (name.indexOf('..') >= 0 || name.indexOf('\\') >= 0 ||
        name.indexOf('%2e') >= 0 || name.indexOf('%2E') >= 0 ||
        name.indexOf('//') >= 0) {
      throw wbError(CODES.VALIDATION, 'storage path: 名称含非法序列', { status: 400 });
    }
    return name;
  }

  function clothImage(userId, clothId, ext) {
    const u = assertUuidComponent(userId, 'userId');
    const c = assertUuidComponent(clothId, 'clothId');
    const e = assertExtension(ext);
    const name = u + '/' + c + '.' + e;
    assertSafeName(name);
    return 'clothes/' + name;
  }

  function cocktailImage(userId, recipeId, ext) {
    const u = assertUuidComponent(userId, 'userId');
    const r = assertUuidComponent(recipeId, 'recipeId');
    const e = assertExtension(ext);
    const name = u + '/' + r + '.' + e;
    assertSafeName(name);
    return 'cocktail/' + name;
  }

  function avatar(userId, ext) {
    const u = assertUuidComponent(userId, 'userId');
    const e = assertExtension(ext);
    const name = u + '/avatar.' + e;
    assertSafeName(name);
    return 'avatars/' + name;
  }

  window.WBStoragePaths = {
    clothImage: clothImage,
    cocktailImage: cocktailImage,
    avatar: avatar,
    EXT_WHITELIST: EXT_WHITELIST,
    assertUuidComponent: assertUuidComponent,
    assertSafeName: assertSafeName
  };
})();
