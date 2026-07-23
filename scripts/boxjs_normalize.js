/* BoxJS：校验并规范化微博关注黑名单。 */
const KEY = "weibo.followwatch.blacklist";
const raw = $persistentStore.read(KEY) || "";
const result = normalize(raw);
$persistentStore.write(result.text, KEY);
notify("关注黑名单检测", "黑名单校验完成", `有效 ${result.valid} 条，忽略 ${result.invalid} 条，重复 ${result.duplicate} 条`);
$done();

function normalize(value) {
  const lines = String(value).split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
  const seen = new Set();
  const output = [];
  let invalid = 0;
  let duplicate = 0;
  for (const line of lines) {
    const parts = line.split(/[,，\t|]/);
    const uid = String(parts.shift() || "").trim();
    if (!/^\d{5,20}$/.test(uid)) { invalid++; continue; }
    if (seen.has(uid)) { duplicate++; continue; }
    seen.add(uid);
    output.push(uid);
  }
  return { text: output.join("\n"), valid: output.length, invalid, duplicate };
}
function notify(title, subtitle, body) {
  try { $notification.post(title, subtitle, body); } catch (_) {}
}
