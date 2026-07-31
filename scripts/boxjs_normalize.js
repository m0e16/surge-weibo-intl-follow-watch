/* BoxJS：校验并规范化微博关注黑名单。 */
const KEY = "weibo.followwatch.blacklist";
const raw = $persistentStore.read(KEY) || "";
const result = normalize(raw);
$persistentStore.write(result.text, KEY);
notify("关注黑名单检测", "黑名单校验完成", `有效 ${result.valid} 条，忽略 ${result.invalid} 条，重复 ${result.duplicate} 条`);
$done();

function normalize(value) {
  const lines = String(value).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const seen = new Map();
  const output = [];
  let invalid = 0;
  let duplicate = 0;
  for (const line of lines) {
    const match = line.match(/^([^;；,，\t|]+)(?:[;；,，\t|](.*))?$/);
    const uid = String((match && match[1]) || "").trim();
    if (!/^\d{5,20}$/.test(uid)) { invalid++; continue; }
    const name = cleanName((match && match[2]) || "");
    if (seen.has(uid)) {
      duplicate++;
      const index = seen.get(uid);
      if (name && !output[index].name) output[index].name = name;
      continue;
    }
    seen.set(uid, output.length);
    output.push({ uid, name });
  }
  const text = output.map((item) => item.uid + (item.name ? ";" + item.name : "")).join("\n");
  return { text, valid: output.length, invalid, duplicate };
}
function cleanName(value) {
  return String(value || "").replace(/[\r\n;；]+/g, " ").replace(/\s+/g, " ").trim();
}
function notify(title, subtitle, body) {
  try { $notification.post(title, subtitle, body); } catch (_) {}
}
