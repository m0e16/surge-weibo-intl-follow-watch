# 微博国际版关注黑名单检测

进入微博国际版/轻享版用户主页时，检查该用户可见关注中是否存在 BoxJS 黑名单 UID，并把命中结果追加到个人简介。

## 扫描策略

默认 `smart`：

1. 顺序请求“军事”(007)和“社会时事”(060)分类，各一页。
2. 两个分类都没有用户时，说明该用户可能没有分类，顺序回退普通关注列表前 2 页。
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

每行一位博主：

```text
1234567890,博主甲
2345678901,博主乙
```

昵称可省略。脚本只使用 UID 匹配，昵称仅用于展示。

BoxJS 订阅：

```text
https://raw.githubusercontent.com/m0e16/surge-weibo-intl-follow-watch/main/boxjs.json
```

也可在 Surge 的脚本列表中手动运行“校验名单”与“清理缓存”。

## 模块参数

- `mode=category`：仅扫描军事、社会时事分类。
- `mode=smart`：分类为空时回退普通关注列表，默认。
- `mode=full`：分类之后总是追加扫描普通关注列表。
- `max_pages=2`：普通列表最多扫描页数，范围 1–10。
- `cache_hours=24`：结果缓存时间。
- `min_interval=45`：不同目标的新检测最小间隔秒数。
- `jitter_ms=900`：每次附加请求前的随机延迟基数。
- `show_names=true`：显示命中昵称。
- `max_names=3`：最多显示几个昵称。
- `show_zero=false`：是否在简介显示零命中。
- `debug=false`：调试日志。

## 已知限制

- 微博只公开部分关注且分类可能不准确，因此“未命中”不代表完整关注列表绝对没有黑名单用户。
- 全局冷却期间打开一个未缓存的主页，会保持原简介并跳过检测；稍后重新进入即可。
- 初次检测会给主页加载增加约数秒延迟，后续缓存命中会立即返回。
- 只有真机 Surge + 微博 App 能最终验证简介布局、接口风控和认证参数复用。

## 本地测试

```bash
npm test
npm run check
```

测试使用模拟 Surge 运行时，不含真实 Cookie、GSID 或 HAR 数据。
