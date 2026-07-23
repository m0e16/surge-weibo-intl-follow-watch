const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "boxjs.json"), "utf8"));

test("BoxJS 订阅使用根对象并包含 apps 数组", () => {
  assert.equal(Array.isArray(data), false);
  assert.equal(typeof data.id, "string");
  assert.equal(typeof data.name, "string");
  assert.ok(Array.isArray(data.apps));
  assert.equal(data.apps.length, 1);
});

test("黑名单 textarea 位于 app.settings 而不是 keys", () => {
  const app = data.apps[0];
  assert.ok(Array.isArray(app.keys));
  assert.ok(app.keys.every((key) => typeof key === "string"));
  assert.ok(Array.isArray(app.settings));
  const setting = app.settings.find((x) => x.id === "weibo.followwatch.blacklist");
  assert.ok(setting);
  assert.equal(setting.type, "textarea");
  assert.equal(setting.autoGrow, true);
  assert.ok(Number.isInteger(setting.rows));
});

test("可运行脚本使用 BoxJS scripts schema", () => {
  const scripts = data.apps[0].scripts;
  assert.ok(Array.isArray(scripts));
  assert.ok(scripts.length >= 1);
  assert.ok(scripts.every((x) => typeof x.name === "string" && /^https:\/\//.test(x.script)));
  assert.ok(scripts.every((x) => !("argument" in x)));
});
