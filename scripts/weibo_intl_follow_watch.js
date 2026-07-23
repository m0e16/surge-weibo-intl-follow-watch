/*
 * 微博国际版 / 轻享版：关注黑名单检测
 * 拦截 /2/profile，低频查询目标用户的军事、社会时事分类；没有分类时按配置回退普通关注列表。
 * 黑名单由 BoxJS 写入 weibo.followwatch.blacklist，一行格式：UID,显示名称
 */

const STORE = {
  blacklist: "weibo.followwatch.blacklist",
  lastScanAt: "weibo.followwatch.last_scan_at",
  cachePrefix: "weibo.followwatch.cache.",
};
const MARKER_RE = /\n?⚠️ 黑名单命中\d+(?:：[^\n]*)?(?: \[[^\n]*\])?/g;
const CATEGORY_CODES = ["007", "060"]; // 军事、社会时事
const DEFAULTS = {
  mode: "smart", // category | smart | full
  max_pages: 2,
  cache_hours: 24,
  min_interval: 45,
  jitter_ms: 900,
  request_timeout: 5,
  show_names: true,
  max_names: 3,
  show_zero: false,
  debug: false,
};

const config = parseArguments(typeof $argument === "undefined" ? "" : $argument);
const requestUrl = ($request && $request.url) || "";

main().catch((error) => {
  log("unexpected error: " + safeError(error));
  $done({});
});

async function main() {
  let profile;
  try {
    profile = JSON.parse(responseBody());
  } catch (_) {
    return $done({});
  }
  const user = profile && profile.userInfo;
  const uid = String((user && (user.idstr || user.id)) || "");
  if (!uid || !user) return $done({});

  const parsedBlacklist = parseBlacklist($persistentStore.read(STORE.blacklist) || "");
  if (!parsedBlacklist.items.length) {
    log("blacklist is empty");
    return $done({});
  }

  const cacheKey = STORE.cachePrefix + uid;
  const cached = readJSON(cacheKey);
  if (
    cached &&
    Number(cached.expires_at) > Date.now() &&
    cached.blacklist_version === parsedBlacklist.version
  ) {
    applyResult(profile, cached);
    return $done({ body: JSON.stringify(profile) });
  }

  // 全局冷却避免连续浏览主页时对微博产生自动化请求突发。
  const lastScanAt = Number($persistentStore.read(STORE.lastScanAt) || 0);
  if (config.min_interval > 0 && Date.now() - lastScanAt < config.min_interval * 1000) {
    log("global cooldown, skip uid=" + uid);
    return $done({});
  }
  $persistentStore.write(String(Date.now()), STORE.lastScanAt);

  const baseUrl = buildBaseCardlistUrl(requestUrl);
  if (!baseUrl) return $done({});

  const found = new Map();
  let successfulRequests = 0;
  let categoryUsers = 0;

  // 故意顺序请求并加入抖动，不进行突发并发。
  for (const code of CATEGORY_CODES) {
    await randomDelay(config.jitter_ms);
    const container = `231051_-_followerstagrecomm_-_${uid}_-_1042015:tagCategory_${code}`;
    const page = await fetchCardlist(baseUrl, container, 1);
    if (!page.ok) continue;
    successfulRequests++;
    categoryUsers += page.users.length;
    collectMatches(page.users, parsedBlacklist.byUid, found);
  }

  const shouldFallback =
    config.mode === "full" ||
    (config.mode === "smart" && categoryUsers === 0);

  if (shouldFallback) {
    const container = `231051_-_followers_-_${uid}`;
    for (let pageNo = 1; pageNo <= config.max_pages; pageNo++) {
      await randomDelay(config.jitter_ms ? config.jitter_ms + 250 : 0);
      const page = await fetchCardlist(baseUrl, container, pageNo);
      if (!page.ok) break;
      successfulRequests++;
      collectMatches(page.users, parsedBlacklist.byUid, found);
      if (!page.users.length) break;
      if (found.size === parsedBlacklist.items.length) break;
    }
  }

  // 两个分类都失败时不写“零命中”，避免网络异常导致误判。
  if (!successfulRequests) return $done({});

  const names = Array.from(found.values()).map((x) => x.name);
  const result = {
    expires_at: Date.now() + config.cache_hours * 3600 * 1000,
    blacklist_version: parsedBlacklist.version,
    count: found.size,
    names,
    scope: shouldFallback ? "可见关注" : "军事/时事分类",
  };
  $persistentStore.write(JSON.stringify(result), cacheKey);
  rememberCacheKey(cacheKey);
  applyResult(profile, result);
  log(`uid=${uid} scope=${result.scope} matches=${result.count}`);
  $done({ body: JSON.stringify(profile) });
}

function parseArguments(raw) {
  const out = Object.assign({}, DEFAULTS);
  const text = String(raw || "").trim();
  const pairs = text.split(/[&,]/);
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const key = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!Object.prototype.hasOwnProperty.call(out, key)) continue;
    if (["show_names", "show_zero", "debug"].includes(key)) out[key] = /^(1|true|yes|on)$/i.test(value);
    else if (["max_pages", "cache_hours", "min_interval", "jitter_ms", "request_timeout", "max_names"].includes(key)) {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
    } else out[key] = value;
  }
  out.mode = ["category", "smart", "full"].includes(out.mode) ? out.mode : DEFAULTS.mode;
  out.max_pages = clamp(Math.floor(out.max_pages), 1, 10);
  out.cache_hours = clamp(out.cache_hours, 1, 168);
  out.min_interval = clamp(out.min_interval, 0, 300);
  out.jitter_ms = clamp(out.jitter_ms, 0, 3000);
  out.request_timeout = clamp(out.request_timeout, 2, 10);
  out.max_names = clamp(Math.floor(out.max_names), 0, 10);
  return out;
}

function parseBlacklist(raw) {
  const text = String(raw || "").trim();
  let source = [];
  if (text.charAt(0) === "[") {
    try { source = JSON.parse(text); } catch (_) { source = []; }
  } else {
    source = text.split(/\r?\n|;/).filter(Boolean);
  }
  const byUid = new Map();
  for (const entry of source) {
    let uid = "";
    let name = "";
    if (typeof entry === "string") {
      const parts = entry.split(/[,，\t|]/);
      uid = String(parts.shift() || "").trim();
      name = parts.join(" ").trim();
    } else if (entry && typeof entry === "object") {
      uid = String(entry.uid || entry.id || entry.idstr || "").trim();
      name = String(entry.name || entry.screen_name || "").trim();
    }
    if (!/^\d{5,20}$/.test(uid)) continue;
    byUid.set(uid, { uid, name: name || uid });
  }
  const items = Array.from(byUid.values()).sort((a, b) => a.uid.localeCompare(b.uid));
  // 版本值不含认证信息；兼容旧缓存测试时保留规范化文本形式。
  const version = items.map((x) => `${x.uid},${x.name}`).join("\n");
  return { items, byUid, version };
}

function buildBaseCardlistUrl(profileUrl) {
  const query = parseQuery(profileUrl);
  const allowed = ["aid", "c", "from", "gsid", "lang", "s", "ua", "v_p"];
  const params = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(query, key)) params[key] = query[key];
  }
  if (!params.v_p) params.v_p = "59";
  params.count = "20";
  return { origin: "https://api.weibo.cn/2/cardlist", params };
}

function fetchCardlist(base, container, page) {
  const params = Object.assign({}, base.params, {
    containerid: container,
    page: String(page),
  });
  if (page > 1) params.since_id = "(null)";
  const url = base.origin + "?" + Object.keys(params)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(params[key]))
    .join("&");
  const headers = {};
  const inputHeaders = ($request && $request.headers) || {};
  for (const key of Object.keys(inputHeaders)) {
    if (/^(user-agent|x-sessionid|accept|accept-language)$/i.test(key)) headers[key] = inputHeaders[key];
  }
  return new Promise((resolve) => {
    $httpClient.get({ url, headers, timeout: config.request_timeout }, (error, response, body) => {
      const status = Number(response && (response.status || response.statusCode));
      if (error || status < 200 || status >= 300) return resolve({ ok: false, users: [] });
      try {
        const obj = typeof body === "string" ? JSON.parse(body) : body;
        resolve({ ok: true, users: extractUsers(obj) });
      } catch (_) {
        resolve({ ok: false, users: [] });
      }
    });
  });
}

function extractUsers(obj) {
  const out = [];
  const seen = new Set();
  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object") return;
    if (value.user && typeof value.user === "object") {
      const uid = String(value.user.idstr || value.user.id || "");
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        out.push({ uid, name: String(value.user.screen_name || value.user.name || uid) });
      }
    }
    Object.keys(value).forEach((key) => walk(value[key]));
  }
  walk(obj);
  return out;
}

function collectMatches(users, blacklist, found) {
  for (const user of users) {
    const hit = blacklist.get(user.uid);
    if (hit) found.set(user.uid, { uid: user.uid, name: hit.name || user.name || user.uid });
  }
}

function applyResult(profile, result) {
  const user = profile.userInfo;
  const original = String(user.description || "").replace(MARKER_RE, "").trimEnd();
  if (!result.count && !config.show_zero) {
    user.description = original;
    return;
  }
  let label = result.count ? `⚠️ 黑名单命中${result.count}` : "⚠️ 黑名单未命中";
  if (result.count && config.show_names && config.max_names > 0) {
    const names = (result.names || []).slice(0, config.max_names);
    if (names.length) label += "：" + names.join("、") + ((result.names || []).length > names.length ? "等" : "");
  }
  user.description = original ? original + "\n" + label : label;
}

function parseQuery(url) {
  const out = {};
  const q = String(url || "").split("?")[1];
  if (!q) return out;
  for (const pair of q.split("#")[0].split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const rawKey = i < 0 ? pair : pair.slice(0, i);
    const rawValue = i < 0 ? "" : pair.slice(i + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      out[key] = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch (_) {}
  }
  return out;
}
function responseBody() {
  if ($response.body == null) return "";
  return typeof $response.body === "string" ? $response.body : JSON.stringify($response.body);
}
function readJSON(key) {
  try { return JSON.parse($persistentStore.read(key) || "null"); } catch (_) { return null; }
}
function rememberCacheKey(key) {
  const indexKey = "weibo.followwatch.cache_index";
  let keys = [];
  try { keys = JSON.parse($persistentStore.read(indexKey) || "[]"); } catch (_) {}
  if (!Array.isArray(keys)) keys = [];
  if (!keys.includes(key)) {
    keys.push(key);
    if (keys.length > 500) keys = keys.slice(-500);
    $persistentStore.write(JSON.stringify(keys), indexKey);
  }
}
function randomDelay(base) {
  if (!base) return Promise.resolve();
  const delay = Math.floor(base * (0.7 + Math.random() * 0.6));
  return new Promise((resolve) => setTimeout(resolve, delay));
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function safeError(error) { return error && error.message ? error.message : String(error || "unknown"); }
function log(message) {
  if (!config.debug) return;
  try { console.log("[weibo-follow-watch] " + message); } catch (_) {}
}
