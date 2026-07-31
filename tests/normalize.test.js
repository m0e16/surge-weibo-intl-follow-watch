const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT = path.join(__dirname, "..", "scripts", "boxjs_normalize.js");

function runNormalize(value) {
  const writes = {};
  const notifications = [];
  const sandbox = {
    String,
    Set,
    Map,
    $persistentStore: {
      read() { return value; },
      write(next, key) { writes[key] = next; return true; },
    },
    $notification: { post(...args) { notifications.push(args); } },
    $done() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT, "utf8"), sandbox, { filename: SCRIPT });
  return { writes, notifications };
}

test("规范化名单保留分号后的昵称并去重", () => {
  const result = runNormalize("20001;账号甲\n20001;旧昵称\n20002\n无效内容");
  assert.equal(result.writes["weibo.followwatch.blacklist"], "20001;账号甲\n20002");
  assert.match(result.notifications[0][2], /有效 2 条，忽略 1 条，重复 1 条/);
});

test("重复 UID 的首条没有昵称时保留后续昵称", () => {
  const result = runNormalize("20001\n20001;后来补全的昵称");
  assert.equal(result.writes["weibo.followwatch.blacklist"], "20001;后来补全的昵称");
  assert.match(result.notifications[0][2], /重复 1 条/);
});

test("规范化名单兼容旧逗号格式并统一写成 UID;昵称", () => {
  const result = runNormalize("20001,账号甲\n20002，账号乙\n20003\t账号丙");
  assert.equal(result.writes["weibo.followwatch.blacklist"], "20001;账号甲\n20002;账号乙\n20003;账号丙");
});

test("规范化名单清理昵称中的换行分隔字符", () => {
  const result = runNormalize("20001;账号;别名");
  assert.equal(result.writes["weibo.followwatch.blacklist"], "20001;账号 别名");
});
