const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const moduleText = fs.readFileSync(path.join(__dirname, "..", "Weibo_intl_follow_watch.sgmodule"), "utf8");

test("Surge 模块多参数使用逗号分隔的名称冒号默认值语法", () => {
  const line = moduleText.split(/\r?\n/).find((x) => x.startsWith("#!arguments="));
  assert.ok(line);
  const declaration = line.slice("#!arguments=".length);
  const params = declaration.split(",").map((item) => {
    const i = item.indexOf(":");
    return [item.slice(0, i), item.slice(i + 1)];
  });
  const expected = ["mode", "max_pages", "cache_hours", "min_interval", "jitter_ms", "show_names", "max_names", "show_zero", "debug"];
  assert.deepEqual(params.map(([key]) => key), expected);
  assert.equal(Object.fromEntries(params).mode, "smart");
  assert.equal(Object.fromEntries(params).max_pages, "5");
  assert.doesNotMatch(declaration, /&/);
});

test("Surge 模块参数通过三花括号占位符传入脚本", () => {
  const scriptLine = moduleText.split(/\r?\n/).find((x) => x.startsWith("微博关注黑名单检测 ="));
  assert.ok(scriptLine);
  for (const key of ["mode", "max_pages", "cache_hours", "min_interval", "jitter_ms", "show_names", "max_names", "show_zero", "debug"]) {
    assert.ok(scriptLine.includes(`${key}={{{${key}}}}`));
  }
  assert.doesNotMatch(scriptLine, /%mode%/);
});
