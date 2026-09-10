/* Wardrobe 私有图片封装（Phase 5）
 * 私有 bucket 的 authenticated 访问：download() 用当前会话 JWT，禁止 getPublicUrl()。
 * 下载返回 Blob + objectURL；调用方负责 URL.revokeObjectURL() 释放（见返回说明）。
 * 覆盖语义：同路径上传 = 覆盖（与 v4.4.0 imgRemote 同路径 PUT 语义一致，已在盘点文档声明）。
 * 路径约定：WBStoragePaths.* 返回「完整路径」（含 bucket 名，存 DB image_path 用）；
 *          SDK 调用前必须转成「bucket 相对路径」（去掉首段 bucket 名）——统一由 toObjectPath 完成。
 */
(function () {
  const { CODES } = window.WBErrors;

  /* 完整路径 'clothes/{uid}/{cid}.jpg' → bucket 相对路径 '{uid}/{cid}.jpg' */
  function toObjectPath(fullPath) {
    const parts = fullPath.split('/');
    return parts.slice(1).join('/');
  }

  function bucketClient(bucket) {
    return getSupabaseClient().storage.from(bucket);
  }

  function mapStorageError(err, kind) {
    const n = window.WBErrors.normalize(err);
    if (n.code === CODES.UNKNOWN) {
      n.code = kind; /* STORAGE_UPLOAD / STORAGE_DOWNLOAD / STORAGE_DELETE */
    }
    /* 附加 wb 标记：调用方若再 normalize 一次（幂等），直接识别并保留语义 */
    n.wbCode = n.code;
    n.wbMessage = n.message;
    n.wbStatus = n.status;
    n.wbDetails = n.details;
    return n;
  }

  /* SDK download() 失败时 error 是 Blob（JSON 正文），需解析后归一化 */
  async function unwrapDownloadError(err, kind) {
    if (err && typeof err.arrayBuffer === 'function') {
      try {
        const j = JSON.parse(await new Response(err).text());
        return mapStorageError(j, kind);
      } catch (e) { /* fallthrough */ }
    }
    return mapStorageError(err, kind);
  }

  async function uploadClothImage(clothId, file, opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.clothImage(user.id, clothId, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('clothes').upload(toObjectPath(fullPath), file, {
        contentType: 'image/jpeg', upsert: true /* 同路径覆盖 = 更换图片语义 */
      });
      if (r.error) { throw r.error; }
      return { path: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_UPLOAD); }
  }

  async function uploadCocktailImage(recipeId, file, opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.cocktailImage(user.id, recipeId, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('cocktail').upload(toObjectPath(fullPath), file, { contentType: 'image/jpeg', upsert: true });
      if (r.error) { throw r.error; }
      return { path: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_UPLOAD); }
  }

  async function uploadAvatar(file, opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.avatar(user.id, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('avatars').upload(toObjectPath(fullPath), file, { contentType: 'image/jpeg', upsert: true });
      if (r.error) { throw r.error; }
      return { path: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_UPLOAD); }
  }

  /* download → { blob, objectUrl, path }；调用方用完必须 URL.revokeObjectURL(objectUrl) */
  async function downloadClothImage(clothId, opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.clothImage(user.id, clothId, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('clothes').download(toObjectPath(fullPath));
      if (r.error) { throw await unwrapDownloadError(r.error, CODES.STORAGE_DOWNLOAD); }
      const objectUrl = URL.createObjectURL(r.data);
      return { blob: r.data, objectUrl: objectUrl, path: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_DOWNLOAD); }
  }

  async function downloadCocktailImage(recipeId, opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.cocktailImage(user.id, recipeId, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('cocktail').download(toObjectPath(fullPath));
      if (r.error) { throw await unwrapDownloadError(r.error, CODES.STORAGE_DOWNLOAD); }
      const objectUrl = URL.createObjectURL(r.data);
      return { blob: r.data, objectUrl: objectUrl, path: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_DOWNLOAD); }
  }

  async function removeClothImage(clothId, opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.clothImage(user.id, clothId, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('clothes').remove([toObjectPath(fullPath)]);
      if (r.error) { throw r.error; }
      return { removed: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_DELETE); }
  }

  async function removeCocktailImage(recipeId, opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.cocktailImage(user.id, recipeId, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('cocktail').remove([toObjectPath(fullPath)]);
      if (r.error) { throw r.error; }
      return { removed: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_DELETE); }
  }

  async function downloadAvatar(opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.avatar(user.id, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('avatars').download(toObjectPath(fullPath));
      if (r.error) { throw await unwrapDownloadError(r.error, CODES.STORAGE_DOWNLOAD); }
      const objectUrl = URL.createObjectURL(r.data);
      return { blob: r.data, objectUrl: objectUrl, path: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_DOWNLOAD); }
  }

  async function removeAvatar(opts) {
    const user = await window.WBSession.requireUser();
    const fullPath = window.WBStoragePaths.avatar(user.id, (opts && opts.ext) || 'jpg');
    try {
      const r = await bucketClient('avatars').remove([toObjectPath(fullPath)]);
      if (r.error) { throw r.error; }
      return { removed: fullPath };
    } catch (e) { throw mapStorageError(e, CODES.STORAGE_DELETE); }
  }

  window.WBImages = {
    uploadClothImage: uploadClothImage,
    uploadCocktailImage: uploadCocktailImage,
    uploadAvatar: uploadAvatar,
    downloadClothImage: downloadClothImage,
    downloadCocktailImage: downloadCocktailImage,
    downloadAvatar: downloadAvatar,
    removeClothImage: removeClothImage,
    removeCocktailImage: removeCocktailImage,
    removeAvatar: removeAvatar
  };
})();
