# 微博国际版关注黑名单检测

进入微博国际版/轻享版用户主页时，检查该用户可见关注中是否存在 BoxJS 黑名单 UID，并把命中结果追加到个人简介。

## 扫描策略

默认 `smart`：

1. 顺序请求“军事”(007)和“社会时事”(060)分类，各一页。
2. 分类未覆盖全部黑名单 UID 时，顺序回退普通关注列表，默认最多 5 页。
3. 每次附加请求前加入随机延迟；不同目标用户的新检测默认至少间隔 45 秒。
4. 结果缓存 24 小时。缓存命中不产生附加请求。
5. 网络失败时保持原简介，不伪造“零命中”。

这是降低账号风控风险的保守策略，但任何自动请求都无法保证零风险。请勿把 `max_pages` 调得过高，也不建议关闭冷却和抖动。

## 安装

Surge 模块：

```text
https://raw.githubusercontent.com/m0e16/surge-weibo-intl-follow-watch/main/Weibo_intl_follow_watch.sgmodule
```

需要为 `api.weibo.cn` 启用 MITM。

## 黑名单

持久化键：

```text
weibo.followwatch.blacklist
```

匹配始终只使用 UID。BoxJS 中每行填写 `UID` 或 `UID;昵称`，例如：

```text
1234567890;测试昵称
2345678901
```

正常扫描实际命中某个 UID 后，脚本会把关注列表接口返回的当前 `screen_name` 被动补全到名单；已有旧昵称也会更新。没有在扫描中遇到的 UID 保持原样，不会为补昵称增加额外微博请求。运行“校验并规范化名单”可兼容旧逗号格式、去重，并统一整理为 `UID;昵称`。

BoxJS 订阅：

```text
https://raw.githubusercontent.com/m0e16/surge-weibo-intl-follow-watch/main/boxjs.json
```

也可在 Surge 的脚本列表中手动运行“校验名单”与“清理缓存”。

## 模块参数

- `mode=category`：仅扫描军事、社会时事分类。
- `mode=smart`：分类未覆盖全部黑名单时回退普通关注列表，默认。
- `mode=full`：分类之后总是追加扫描普通关注列表。
- `max_pages=5`：普通列表最多扫描页数，范围 1–10。
- `cache_hours=24`：结果缓存时间。
- `min_interval=45`：不同目标的新检测最小间隔秒数。
- `jitter_ms=900`：每次附加请求前的随机延迟基数。
- `show_names=true`：显示命中昵称。
- `max_names=3`：最多显示几个昵称。
- `show_zero=false`：是否在简介显示零命中。
- `debug=false`：调试日志。

## 已知限制

- 微博只公开部分关注且分类可能不准确，因此“未命中”不代表完整关注列表绝对没有黑名单用户。
- 除已拉黑用户外，每个可拦截的用户主页简介后都会显示 `🆔 UID:...`。完成检测后同一行显示 `· ⚠️ 命中N：昵称` 或（启用 `show_zero` 时）`· ⚠️ 未命中`。
- 若主页响应显示该用户已被我拉黑（`block=1`），完全不改简介；若已被我关注（`following=true` / `following_state=1`），只显示 UID。两种情况均不发起关注黑名单检测请求。
- 跳过状态不会缓存；解除拉黑或取消关注后重新进入主页会恢复检测。
- 全局冷却期间打开一个未缓存的主页，会显示 `🆔 UID:... · ⏳ 待检测` 并跳过检测；稍后重新进入即可。
- 初次检测会给主页加载增加约数秒延迟，后续缓存命中会立即返回。
- 只有真机 Surge + 微博 App 能最终验证简介布局、接口风控和认证参数复用。

## 接口兼容性

微博国际版 7.2.1（`WeiboOverseas/7.2.1`）起，用户主页头部数据从 `GET /2/profile` 改为 `GET /2/profile/userinfo`，且 `userInfo` 从 `body.userInfo` 移到 `body.header.data.userInfo`。脚本同时匹配两个接口并兼容两种结构，旧版本回退时仍然有效。

`/2/cardlist`（关注分类与普通关注列表）未受影响。

## 本地测试

```bash
npm test
npm run check
```

测试使用模拟 Surge 运行时，不含真实 Cookie、GSID 或 HAR 数据。
