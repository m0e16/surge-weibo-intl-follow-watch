const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT = path.join(__dirname, "..", "scripts", "weibo_intl_follow_watch.js");

// 微博国际版 7.2.1 起，用户主页改为 GET /2/profile/userinfo，
// userInfo 位置从 body.userInfo 移到 body.header.data.userInfo。
const USERINFO_URL =
  "https://api.weibo.cn/2/profile/userinfo?aid=A&c=weicoabroad&dlang=zh-Hans-TW&featurecode=10000088&fid=other_10001&from=F&gsid=SECRET&lang=zh_CN&s=S&ua=UA&user_domain=10001&wm=3333_2001";

function userinfoBody({ uid = "10001", description = "原简介", following = false, block = 2 } = {}) {
  return {
    config: { immersive: 1 },
    channelInfo: { channels: [] },
    header: {
      data: {
        userInfo: {
          id: Number(uid),
          idstr: String(uid),
          screen_name: "被检测用户",
          description,
          friends_count: 40,
          following,
          following_state: following ? 1 : 2,
          block,
        },
      },
    },
    navigationBar: {},
  };
}

function cardlist(users, total = users.length) {
  return {
    cardlistInfo: { title_top: "他的好友", total },
    cards: users.length
      ? [{ card_type: 11, card_group: users.map(([id, name]) => ({ card_type: 10, user: { idstr: String(id), screen_name: name } })) }]
      : [{ card_style: 1, card_type: 11, openurl: "" }],
  };
}

async function runScenario({
  profileBody = userinfoBody(),
  blacklist = "20001;黑名单甲",
  cache = {},
  routes = {},
  argument = "mode=smart&max_pages=2&cache_hours=12&debug=false&jitter_ms=0",
  url = USERINFO_URL,
} = {}) {
  const writes = {};
  const requests = [];
  let doneValue;
  let doneResolve;
  const completed = new Promise((resolve) => (doneResolve = resolve));
  const store = { "weibo.followwatch.blacklist": blacklist, ...cache };

  const sandbox = {
    Set, Map, Promise, JSON, Date, Math, String, Number, Object, Array, RegExp, Error,
    encodeURIComponent, decodeURIComponent,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    console: { log() {} },
    $argument: argument,
    $request: { url, headers: { "User-Agent": "Weibo", "x-sessionid": "session" } },
    $response: { body: JSON.stringify(profileBody) },
    $persistentStore: {
      read(key) { return Object.prototype.hasOwnProperty.call(writes, key) ? writes[key] : store[key] || null; },
      write(value, key) { writes[key] = value; return true; },
    },
    $httpClient: {
      get(options, callback) {
        requests.push(options);
        const u = new URL(options.url);
        const key = `${u.searchParams.get("containerid")}|${u.searchParams.get("page") || "1"}`;
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
  const body = doneValue.body ? JSON.parse(doneValue.body) : null;
  return { body, requests, writes };
}

const military = "231051_-_followerstagrecomm_-_10001_-_1042015:tagCategory_007";
const society = "231051_-_followerstagrecomm_-_10001_-_1042015:tagCategory_060";
const all = "231051_-_followers_-_10001";

test("新接口 header.data.userInfo 能被识别并写回 UID 行", async () => {
  const result = await runScenario({
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([])) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([])) },
      [`${all}|1`]: { body: JSON.stringify(cardlist([["30001", "普通用户"]], 40)) },
    },
  });
  assert.equal(result.body.header.data.userInfo.description.includes("🆔 UID:10001"), true);
  assert.equal(result.body.config.immersive, 1, "其余字段必须原样保留");
  assert.equal(result.body.header.data.userInfo.screen_name, "被检测用户");
});

test("新接口下命中黑名单时拼接昵称", async () => {
  const result = await runScenario({
    routes: {
      [`${military}|1`]: { body: JSON.stringify(cardlist([["20001", "黑名单甲当前昵称"]], 1)) },
      [`${society}|1`]: { body: JSON.stringify(cardlist([])) },
    },
  });
  assert.match(result.body.header.data.userInfo.description, /🆔 UID:10001 · ⚠️ 命中1：黑名单甲当前昵称/);
});

test("新接口下已关注用户只显示 UID 且不发起关注扫描", async () => {
  const result = await runScenario({
    profileBody: userinfoBody({ following: true }),
    routes: { [`${all}|1`]: { body: JSON.stringify(cardlist([["20001", "黑名单甲"]], 40)) } },
  });
  assert.match(result.body.header.data.userInfo.description, /🆔 UID:10001/);
  assert.doesNotMatch(result.body.header.data.userInfo.description, /命中/);
  assert.equal(result.requests.length, 0);
});

test("新接口下已被拉黑的用户简介不被修改", async () => {
  const result = await runScenario({ profileBody: userinfoBody({ block: 1, description: "原简介" }) });
  assert.equal(result.body.header.data.userInfo.description, "原简介");
  assert.equal(result.requests.length, 0);
});

test("HTTP 200 但业务报错时不写入零命中缓存", async () => {
  const errorBody = JSON.stringify({ error: "need login", error_code: 21332 });
  const result = await runScenario({
    routes: {
      [`${military}|1`]: { body: errorBody },
      [`${society}|1`]: { body: errorBody },
      [`${all}|1`]: { body: errorBody },
    },
  });
  assert.doesNotMatch(result.body.header.data.userInfo.description, /命中|未命中/);
  assert.equal(result.writes["weibo.followwatch.cache.10001"], undefined);
});

test("刷新后旧接口 userInfo 仍然兼容", async () => {
  const legacy = { userInfo: { idstr: "10002", id: 10002, screen_name: "旧接口", description: "原简介", following: true } };
  const result = await runScenario({
    profileBody: legacy,
    url: "https://api.weibo.cn/2/profile?aid=A&c=weicoabroad&from=F&gsid=SECRET&s=S&ua=UA&user_domain=10002",
  });
  assert.match(result.body.userInfo.description, /🆔 UID:10002/);
  assert.equal(result.requests.length, 0);
});
