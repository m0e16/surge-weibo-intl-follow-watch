const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const moduleText = fs.readFileSync(path.join(__dirname, "..", "Weibo_intl_follow_watch.sgmodule"), "utf8");

test("Surge 模块参数使用官方 query-string 语法", () => {
  const line = moduleText.split(/\r?\n/).find((x) => x.startsWith("#!arguments="));
  assert.ok(line);
  const query = line.slice("#!arguments=".length);
  const params = new URLSearchParams(query);
  const expected = ["mode", "max_pages", "cache_hours", "min_interval", "jitter_ms", "show_names", "max_names", "show_zero", "debug"];
  assert.deepEqual([...params.keys()], expected);
  assert.equal(params.get("mode"), "smart");
});

test("Surge 模块参数通过百分号占位符传入脚本", () => {
  const scriptLine = moduleText.split(/\r?\n/).find((x) => x.startsWith("微博关注黑名单检测 ="));
  assert.ok(scriptLine);
  for (const key of ["mode", "max_pages", "cache_hours", "min_interval", "jitter_ms", "show_names", "max_names", "show_zero", "debug"]) {
    assert.match(scriptLine, new RegExp(`${key}=%${key}%`));
  }
  assert.doesNotMatch(scriptLine, /\{\{\{/);
});
