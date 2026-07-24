const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT = path.join(__dirname, "..", "scripts", "weibo_intl_follow_watch.js");

function profile(uid = "10001", description = "原简介", friendsCount = 40) {
  return {
    userInfo: {
      id: Number(uid),
      idstr: String(uid),
      screen_name: "被检测用户",
      description,
      friends_count: friendsCount,
    },
  };
}

function profileWithState({ uid = "10001", description = "原简介", following = false, block = 2 } = {}) {
  const body = profile(uid, description);
  body.userInfo.following = following;
  body.userInfo.block = block;
  return body;
}

function cardlist(users, total = users.length, title = "他的好友") {
  return {
    cardlistInfo: { title_top: title, total },
    cards: users.length
      ? [{ card_type: 11, card_group: users.map(([id, name]) => ({ card_type: 10, user: { idstr: String(id), screen_name: name } })) }]
      : [{ card_style: 1, card_type: 11, openurl: "" }],
  };
}

async function runScenario({
  profileBody = profile(),
  blacklist = "20001,黑名单甲\n20002,黑名单乙",
  cache = {},
  routes = {},
  argument = "mode=smart&max_pages=2&cache_hours=12&debug=false&jitter_ms=0",
}) {
  const writes = {};
  const requests = [];
  let doneValue;
  let doneResolve;
  const completed = new Promise((resolve) => (doneResolve = resolve));
  const store = {
    "weibo.followwatch.blacklist": blacklist,
    ...cache,
  };

  const sandbox = {
    Set,
    Map,
    Promise,
    JSON,
    Date,
    Math,
    String,
    Number,
    Object,
    Array,
    RegExp,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    console: { log() {} },
    $argument: argument,
    $request: {
      url: "https://api.weibo.cn/2/profile?aid=A&c=weicoabroad&from=F&gsid=SECRET&s=S&ua=UA&user_domain=10001",
      headers: { "User-Agent": "Weibo", "x-sessionid": "session" },
    },
    $response: { body: JSON.stringify(profileBody) },
    $persistentStore: {
      read(key) { return Object.prototype.hasOwnProperty.call(writes, key) ? writes[key] : store[key] || null; },
      write(value, key) { writes[key] = value; return true; },
    },
    $httpClient: {
      get(options, callback) {
        requests.push(options);
        const u = new URL(options.url);
        const container = u.searchParams.get("containerid");
        const page = u.searchParams.get("page") || "1";
        const key = `${container}|${page}`;
        const response = routes[key] || { status: 200, body: JSON.stringify(cardlist([])) };
        callback(null, { status: response.status || 200, headers: {} }, response.body);
      },
    },
    $notification: { post() {} },
    $done(value) { doneValue = value || {}; doneResolve(); },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT, "utf8"), sandbox, { filename: SCRIPT });
  await Promise.race([
    completed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("script timeout")), 2000)),
  ]);
  return { body: JSON.parse(doneValue.body), requests, writes };
}

const military = "231051_-_followerstagrecomm_-_10001_-_1042015:tagCategory_007";
const society = "231051_-_followerstagrecomm_-_10001_-_1042015:tagCategory_060";
const all = "231051_-_followers_-_10001";

test("分类存在时顺序扫描军事和社会时事并按 UID 命中", async () => {
  const result = await runScenario({
    blacklist: "20001",
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([["20001", "黑名单甲"]], 1, "他喜欢的军事博主")) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([["30001", "普通用户"]], 1, "他喜欢的社会时事博主")) },
    },
  });
  assert.match(result.body.userInfo.description, /🆔 UID:10001 · ⚠️ 命中1：黑名单甲/);
  assert.doesNotMatch(result.body.userInfo.description, /UID:10001\n⚠️/);
  assert.equal(result.requests.length, 2);
  assert.deepEqual(result.requests.map((x) => new URL(x.url).searchParams.get("containerid")).sort(), [military, society].sort());
});

test("没有分类时 smart 模式回退扫描普通关注列表", async () => {
  const result = await runScenario({
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([])) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([])) },
      [`${all}|1`]: { body: JSON.stringify(cardlist([["30001", "普通用户"]], 40)) },
      [`${all}|2`]: { body: JSON.stringify(cardlist([["20002", "黑名单乙"]], 40)) },
    },
  });
  assert.match(result.body.userInfo.description, /⚠️ 命中1：黑名单乙/);
  assert.equal(result.requests.length, 4);
});

test("有分类但分类未命中时 smart 模式仍扫描普通关注列表", async () => {
  const result = await runScenario({
    blacklist: "20002",
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([["30001", "军事普通用户"]], 1)) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([["30002", "时事普通用户"]], 1)) },
      [`${all}|1`]: { body: JSON.stringify(cardlist([["20002", "黑名单乙当前昵称"]], 40)) },
    },
  });
  assert.match(result.body.userInfo.description, /命中1：黑名单乙当前昵称/);
  assert.equal(result.requests.length, 3);
});

test("未命中且关闭 show_zero 时仍在简介显示主页 UID", async () => {
  const result = await runScenario({
    blacklist: "20001",
    argument: "mode=category&max_pages=2&cache_hours=12&debug=false&jitter_ms=0&show_zero=false",
  });
  assert.equal(result.body.userInfo.description, "原简介\n🆔 UID:10001");
});

test("开启 show_zero 时 UID 与未命中状态显示在同一行", async () => {
  const result = await runScenario({
    blacklist: "20001",
    argument: "mode=category&max_pages=2&cache_hours=12&debug=false&jitter_ms=0&show_zero=true",
  });
  assert.equal(result.body.userInfo.description, "原简介\n🆔 UID:10001 · ⚠️ 未命中");
});

test("已拉黑用户完全不改简介且不发检测请求", async () => {
  const result = await runScenario({ profileBody: profileWithState({ block: 1 }) });
  assert.equal(result.requests.length, 0);
  assert.equal(result.body.userInfo.description, "原简介");
});

test("已关注用户只显示 UID 且不发检测请求", async () => {
  const result = await runScenario({ profileBody: profileWithState({ following: true, block: 2 }) });
  assert.equal(result.requests.length, 0);
  assert.equal(result.body.userInfo.description, "原简介\n🆔 UID:10001");
});

test("解除拉黑后的主页不使用拉黑状态缓存并重新检测", async () => {
  const cacheKey = "weibo.followwatch.cache.10001";
  const result = await runScenario({
    profileBody: profileWithState({ following: false, block: 2 }),
    cache: {
      [cacheKey]: JSON.stringify({
        expires_at: Date.now() + 3600000,
        blacklist_version: "20001\n20002",
        profile_state: "blocked",
        count: 0,
        names: [],
      }),
    },
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([["20001", "当前昵称"]])) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([])) },
    },
  });
  assert.ok(result.requests.length >= 2);
  assert.match(result.body.userInfo.description, /命中1：当前昵称/);
});

test("命中展示关注接口返回的当前昵称而不是 BoxJS 旧昵称", async () => {
  const result = await runScenario({
    blacklist: "20001,旧昵称",
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([["20001", "当前昵称"]])) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([])) },
    },
  });
  assert.match(result.body.userInfo.description, /命中1：当前昵称/);
  assert.doesNotMatch(result.body.userInfo.description, /旧昵称/);
});

test("安全策略限制请求数量并使用顺序分页而不是突发并发", async () => {
  const result = await runScenario({
    argument: "mode=full&max_pages=2&cache_hours=12&debug=false&jitter_ms=0",
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([])) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([])) },
      [`${all}|1`]: { body: JSON.stringify(cardlist([["30001", "普通用户"]], 100)) },
      [`${all}|2`]: { body: JSON.stringify(cardlist([["30002", "普通用户2"]], 100)) },
    },
  });
  assert.equal(result.requests.length, 4);
  assert.deepEqual(result.requests.slice(2).map((x) => new URL(x.url).searchParams.get("page")), ["1", "2"]);
  assert.ok(result.requests.every((x) => x.timeout <= 5));
});

test("缓存命中时不发网络请求且不重复附加标记", async () => {
  const cacheKey = "weibo.followwatch.cache.10001";
  const cached = JSON.stringify({
    expires_at: Date.now() + 3600000,
    blacklist_version: "20001\n20002",
    count: 1,
    names: ["黑名单甲"],
    scope: "分类",
  });
  const result = await runScenario({
    profileBody: profile("10001", "原简介\n⚠️ 黑名单命中9：旧结果"),
    cache: { [cacheKey]: cached },
  });
  assert.equal(result.requests.length, 0);
  assert.equal((result.body.userInfo.description.match(/⚠️/g) || []).length, 1);
  assert.match(result.body.userInfo.description, /命中1/);
});

test("请求失败时保持原简介，不伪造零命中", async () => {
  const error = { status: 500, body: "{}" };
  const result = await runScenario({ routes: { [`${military}|1`]: error, [`${society}|1`]: error } });
  assert.equal(result.body.userInfo.description, "原简介\n🆔 UID:10001");
});

test("日志和持久化缓存不包含认证参数", async () => {
  const result = await runScenario({
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([["20001", "黑名单甲"]])) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([])) },
    },
  });
  const serialized = JSON.stringify(result.writes);
  assert.doesNotMatch(serialized, /SECRET|gsid|session/);
});
