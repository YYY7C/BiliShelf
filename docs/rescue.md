# 失效视频补档（P0 设计）

> 目标：B 站上已经不可播放的稿件，尽量用「本地副本 / 公开存档」补回来。
> 边界：**充电专属、会员、付费稿件不补档**；不接第三方镜像站；不尝试解 DRM。

## 判定链

| 阶段 | 手段 | 判定 |
| --- | --- | --- |
| L0 | 本地 `videos` 表 | 已有 `bvid + page` 副本（present/trashed）→ `local`，不检索 |
| L1 | `x/web-interface/view` | `code=0` → `alive`；`rights.pay`/`is_upower_exclusive` → `paid`；`62004` → `reviewing`；`-404` → `dead` |
| L1.5 | `x/player/pagelist` | 对 `62002 / -403 / 62012 / 62013` 二次判定：`0` → `private`（记录还在），`-404` → `dead`（彻底没了） |
| L2 | Internet Archive 检索 | `identifier:(BiliBili-<bvid>*)` → `creator:"<UP>"` → `title:"<标题>"` |
| L3 | 候选二次校验 | 取条目的 `*.info.json` 读真实 `bvid/duration/uploader` 再打分 |
| L4 | 一对一分配 | 同一 IA 条目只能对应一个稿件，按分数从高到低贪心分配 |

> `62002 稿件不可见` 是个筐，**只有 pagelist 才能区分「审核中/私密」和「彻底删除」**。
> 实测本批失效全部是 pagelist `-404`，没有一条是审核中。

## 打分规则（`services/rescue/match.ts`）

| 因子 | 分值 |
| --- | --- |
| `info.json` 的 bvid 与目标一致 | 100（直接「确定」） |
| identifier / 标题里出现目标 bvid | 100（直接「确定」） |
| 时长差 ≤2s / ≤5s / ≤30s | +40 / +25 / +8 |
| 时长差 >30s | 淘汰 |
| 标题归一化后相等 / 互相包含 / Jaccard | +30 / +18 / ×20 |
| UP 名相等 / 包含 | +15 / +8 |
| 来自「按 UP 名检索」且 UP 名对得上 | +20 |
| 体积 <10MB 但时长 >5min（试看片段） | 淘汰 |
| 占位标题（`已失效视频` 等） | 不计分 |

分级：`≥90 确定` / `70–89 很可能` / `60–69 存疑` / `<60 丢弃`。
**所有候选都需要人工勾选下载**，不自动入队。

## IA 解析的三个坑（实测）

1. `info.json` 是 **B 站 view 接口原始返回**（`data.View.bvid/title/duration/owner.name`），不是 yt-dlp 格式；两种都要认。
2. 中文是 **latin1 乱码**，需要 `fixMojibake()`（UTF-8 字节被当 latin1 存）。
3. 同名文件有两份：`xxx_p1.mp4`（原始）与 `xxx_p1.ia.mp4`（转码派生物），**必须排除 `.ia.*`**；弹幕是 `-弹幕.ass` / `-弹幕.pb`，没有 xml。

## 网络

- IA 在国内直连超时（`UND_ERR_CONNECT_TIMEOUT`），必须走系统代理 → 使用 Electron `net.fetch`（Chromium 网络栈）。
- 给 `session.fetch` 传 `AbortSignal` 会导致请求直接失败，超时统一用 `Promise.race`。

## 接口（P0 只读）

```
sources:rescue-plan    { sourceId?, remoteItemIds?, limit?, verifyTop? } → 复核 + 检索，不写库
sources:rescue-search  { bvid, title?, duration?, upName?, verifyTop? }   → 单 BV 手动检索
sources:rescue-titles  { sourceId?, bvids? }                              → 用观看历史恢复标题
```

## 实测结论

- 绝大多数是真失效，少量本地已有副本；审核中/付费/存活极少
- IA identifier 几乎命中不到；按 UP 名召回能补到少量候选
- 整体可用补档率很低（详见 `logs/rescue-*.md`）

## P1 待做

1. 补档下载管线：16 路 Range / aria2c、md5 校验、入库（`origin='archive'`）、同步保护
2. 来源详情「寻找存档」入口 + 候选弹窗（手动勾选）
3. ~~本地副本自动修复~~（已完成：`rescued` 状态 + 启动/同步自动关联）

## 已实现（P0.5）

- `remote_items.state = 'rescued'`：B 站失效但本地已有副本，启动时与每次同步后自动修复，不会被失效扫描覆盖
- 来源清单「失效清单」弹窗：跨来源列出失效 / 已补档，支持过滤、跳转来源、在 B 站打开、手动「修复本地副本」
- 接口：`sources:rescue-list`、`sources:rescue-repair`
