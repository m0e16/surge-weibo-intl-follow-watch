/* BoxJS：清理微博关注黑名单检测缓存。 */
const INDEX_KEY = "weibo.followwatch.cache_index";
let count = 0;
try {
  const keys = JSON.parse($persistentStore.read(INDEX_KEY) || "[]");
  if (Array.isArray(keys)) {
    for (const key of keys) {
      if ($persistentStore.write("", key)) count++;
    }
  }
} catch (_) {}
$persistentStore.write("[]", INDEX_KEY);
$persistentStore.write("0", "weibo.followwatch.last_scan_at");
try { $notification.post("关注黑名单检测", "检测缓存已清理", `清理 ${count} 条缓存`); } catch (_) {}
$done();
