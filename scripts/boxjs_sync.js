/* BoxJS 数据维护脚本：校验并规范化黑名单，或清理检测缓存。 */
const BLACKLIST_KEY = "weibo.followwatch.blacklist";
const CACHE_INDEX_KEY = "weibo.followwatch.cache_index";
const action = String(typeof $argument === "undefined" ? "normalize" : $argument).toLowerCase();

if (action === "clear-cache") {
  let count = 0;
  try {
    const keys = JSON.parse($persistentStore.read(CACHE_INDEX_KEY) || "[]");
    for (const key of keys) {
      if ($persistentStore.write("", key)) count++;
    }
  } catch (_) {}
  $persistentStore.write("[]", CACHE_INDEX_KEY);
  $persistentStore.write("0", "weibo.followwatch.last_scan_at");
  notify("关注黑名单检测", "检测缓存已清理", `清理 ${count} 条缓存`);
  $done();
} else {
  const raw = $persistentStore.read(BLACKLIST_KEY) || "";
  const result = normalize(raw);
  $persistentStore.write(result.text, BLACKLIST_KEY);
  notify("关注黑名单检测", "黑名单校验完成", `有效 ${result.valid} 条，忽略 ${result.invalid} 条，重复 ${result.duplicate} 条`);
  $done();
}

function normalize(raw) {
  const lines = String(raw).split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
  const seen = new Set();
  const output = [];
  let invalid = 0;
  let duplicate = 0;
  for (const line of lines) {
    const parts = line.split(/[,，\t|]/);
    const uid = String(parts.shift() || "").trim();
    const name = parts.join(" ").trim();
    if (!/^\d{5,20}$/.test(uid)) { invalid++; continue; }
    if (seen.has(uid)) { duplicate++; continue; }
    seen.add(uid);
    output.push(uid + (name ? "," + name : ""));
  }
  return { text: output.join("\n"), valid: output.length, invalid, duplicate };
}
function notify(title, subtitle, body) {
  try { $notification.post(title, subtitle, body); } catch (_) {}
}
