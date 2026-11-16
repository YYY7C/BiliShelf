# AI 自动打标功能设计方案

> 状态：**已实现（v0.3.0）**；本文档保留为设计记录，最终实现以代码与 [AI 自动打标](../ai-tagging.md) 为准。
> 目标版本：v0.3.0
>
> 实现备注：
>
> - 标签方案不绑定 Provider；每次打标批次使用当前默认 Provider。
> - 自定义协议增加了 OpenAI / Anthropic / Gemini 兼容模式；纯模板模式不支持 tool calling。
> - AI 标签写入 `metadata.json` 的 `aiTags`，不写入 NFO。
> - 审核页使用虚拟滚动 + 行内编辑；通过后标签才进入侧栏「本地标签」。
> - 打标质量仍需用真实第三方 VLM / ACRCloud 凭据验证。
> 编写日期：2026-11-14
> 相关模块：主进程 AI 服务、SQLite 迁移、IPC、渲染层 AI 打标页、标签审核页、侧栏本地标签

---

## 0. 一句话方案

在 BiliShelf 中新增一套**独立于原始标签**的 AI 打标体系：用封面 + 可配置数量的视频帧调用 VLM，按「标签方案」生成带分类和置信度的 AI 标签；模型可在音乐/舞蹈类视频中通过 function calling 调用 ACRCloud 识别 BGM；结果进入**标签审核页**，批量通过后才成为「本地标签」，参与搜索与筛选，并写入 `metadata.json` 的 `aiTags` 字段保证可重建。

---

## 1. 背景与目标

B 站官方标签普遍存在：与视频内容不符、过于宽泛、缺少人物/服饰/BGM 等结构化信息、不同 UP 主用法不一致。现有 BiliShelf 的标签体系（`tags` / `video_tags`）只做来源、UP 主、平台标签和手动标签，无法按画面内容检索。

本功能要解决：

1. **内容级标签**：按画面中的人物形象、服饰、动作、场景、风格、情绪等生成标签。
2. **BGM 识别**：对音乐/舞蹈类视频，让模型判断是否调用 ACRCloud，结合 B 站原始标签确认曲名、艺术家、流派。
3. **库级标签体系**：让 AI 先总结整个素材库，生成一套通用的分类、关注点和提示词模板，避免每个视频各标各的。
4. **可审核**：AI 结果不直接污染现有标签，进入审核页，批量通过后才生效。
5. **可迁移**：审核通过的 AI 标签写入 sidecar，重建索引不丢失。

### 非目标（v1 不做）

- 不做视频内语音转写/字幕生成（BGM 走 ACRCloud，不做 ASR）。
- 不做音频指纹自建库、不做本地音乐识别模型。
- 不做自动定时打标、不做下载完成自动打标（已确认仅手动触发）。
- 不把 AI 标签写入 NFO（已确认只写 DB + `metadata.json`）。
- 不做跨库/云端标签同步。
- 不做多用户/团队协作审核。

---

## 2. 已确认的产品决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | VLM 接入范围 | OpenAI 兼容 + Anthropic Messages + Google Generative AI + 自定义协议；自定义协议支持 OpenAI/Anthropic/Gemini 兼容端点（工具调用可用），纯模板模式不支持工具 |
| 2 | BGM / 音频 | 不把音频直接发给 VLM；把 ACRCloud 做成主进程工具，由模型通过 function calling 决定是否调用；同时把 B 站原始标签作为 BGM 线索 |
| 3 | AI 标签与原始标签 | 完全独立存储；审核通过后进入「本地标签」，参与搜索/筛选；不混入普通标签 |
| 4 | 自动触发 | 仅手动发起 |
| 5 | 标签结构 | 分类 + 扁平标签（如 `服饰 / JK制服`），分类用于分组，标签本身可检索 |
| 6 | 标签方案作用域 | 全局默认方案 + 可为单个来源（收藏夹）覆盖 |
| 7 | 结果入库 | 先进入审核页；大列表展示原始标签、AI 标签、抽帧缩略图；支持逐标签/逐视频/批量通过 |
| 8 | 抽帧默认 | 1 张封面 + 3 帧，均匀取帧；帧永久缓存，维护里可清理 |
| 9 | 库级分析 | 默认采样 24 条，可手动配置参与分析的素材 |
| 10 | 打标范围 | 仅已下载且可播放的视频（`status = 'present'` 且文件存在） |
| 11 | 持久化 | DB + `metadata.json` 的 `aiTags` 字段；不写 NFO |
| 12 | ACRCloud 标签 | 曲名 + 艺术家 + 流派都生成标签 |

---

## 3. 总体架构

```
┌────────────────────────────── Renderer ──────────────────────────────┐
│ Sidebar「AI 打标」入口                                                │
│ AiTaggingView                                                         │
│  ├─ 概览                                                              │
│  ├─ 打标任务（批次、进度、暂停/取消/重试）                            │
│  ├─ 标签审核（大列表：原始标签 + 抽帧 + AI 标签 + 批量通过）          │
│  ├─ 标签方案（全局默认 + 来源覆盖；关注点/分类/提示词模板）           │
│  ├─ 模型与工具（Provider Profile、ACRCloud、抽帧/队列参数）           │
│  └─ 库级分析（采样 → 文本聚类 + 视觉校验 → 保存为方案）              │
│ Sidebar「本地标签」分组（审核通过的 AI 标签）                         │
│ Inspector「AI 标签」分区（按分类分组、置信度、来源）                  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ IPC（preload 白名单）
┌──────────────────────────────────▼───────────────────────────────────┐
│ Main                                                                    │
│  db/ai.ts            AI 方案/批次/运行/标签/审核查询                    │
│  services/ai/config  加密的 Provider / ACRCloud 配置（userData）        │
│  services/ai/providers  OpenAI / Anthropic / Gemini / Custom 适配器     │
│  services/ai/frames   封面、视频帧、音频片段抽取 + 缓存                 │
│  services/ai/prompt   模板渲染、JSON 解析、标签归一化                   │
│  services/ai/acrcloud ACRCloud 签名、识别、缓存                         │
│  services/ai/tagging  批次队列、并发、重试、取消、恢复                  │
│  services/ai/analysis 库级采样、文本聚类、视觉校验、方案生成            │
│  protocol.ts          bilishelf://ai/<runId>/<index> 提供抽帧图片        │
│  services/library.ts  sidecar aiTags 写入/重建                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 目录与文件规划

新增：

```
src/main/db/ai.ts
src/main/services/ai/config.ts
src/main/services/ai/providers.ts
src/main/services/ai/providers/openai.ts
src/main/services/ai/providers/anthropic.ts
src/main/services/ai/providers/gemini.ts
src/main/services/ai/providers/custom.ts
src/main/services/ai/frames.ts
src/main/services/ai/prompt.ts
src/main/services/ai/normalize.ts
src/main/services/ai/acrcloud.ts
src/main/services/ai/tagging.ts
src/main/services/ai/analysis.ts
src/renderer/src/components/ai/AiTaggingView.tsx
src/renderer/src/components/ai/AiOverview.tsx
src/renderer/src/components/ai/AiQueueView.tsx
src/renderer/src/components/ai/AiReviewView.tsx
src/renderer/src/components/ai/AiReviewRow.tsx
src/renderer/src/components/ai/AiFrameStrip.tsx
src/renderer/src/components/ai/AiProfileView.tsx
src/renderer/src/components/ai/AiProfileEditor.tsx
src/renderer/src/components/ai/AiModelSettings.tsx
src/renderer/src/components/ai/AiAnalysisView.tsx
src/renderer/src/components/ai/AiStartModal.tsx
src/renderer/src/lib/ai.ts
```

修改：

```
src/main/db/migrations.ts          迁移 9
src/main/db/videos.ts              aiTag 筛选、FTS、VideoItem.aiTags
src/main/ipc.ts                    AI IPC handler + zod
src/main/index.ts                  AI 队列启动/恢复
src/main/paths.ts                  cache/ai 目录
src/main/protocol.ts               bilishelf://ai/<runId>/<index>
src/main/services/library.ts       sidecar aiTags
src/main/services/maintenance.ts   清理 AI 抽帧/音频缓存
src/shared/types.ts                AI 类型、LibraryQuery.aiTag、VideoItem.aiTags
src/shared/ipc.ts                  通道 + BilishelfApi.ai
src/preload/index.ts               ai API
src/renderer/src/App.tsx           视图、事件、状态
src/renderer/src/lib/store.ts      View 'ai'、filters.aiTag
src/renderer/src/lib/bridge.ts     演示模式 AI mock
src/renderer/src/components/Sidebar.tsx
src/renderer/src/components/TopBar.tsx
src/renderer/src/components/Inspector.tsx
src/renderer/src/components/ui.tsx TextArea
src/renderer/src/styles.css        AI 页/分类色
```

---

## 4. 页面与交互设计

### 4.1 导航与入口

- 左侧栏在「来源清单」「下载任务」之后新增 `AI 打标`，图标 `Sparkles`，右侧显示待审核数量徽标。
- `View` 扩展为 `'library' | 'sources' | 'tasks' | 'ai'`。
- TopBar 在 `view === 'ai'` 时显示标题「AI 打标」和副标题「按画面内容生成标签，审核通过后进入本地标签」。
- 设置弹窗不新增 AI 页签；模型/ACRCloud 配置统一放在 AI 页的「模型与工具」，避免两处配置漂移。

### 4.2 AI 打标页

顶部子页签（横向，类似设置弹窗的左侧导航）：

```
概览 | 打标任务 | 标签审核 (12) | 标签方案 | 模型与工具 | 库级分析
```

右侧固定「开始打标」按钮。页面整体沿用现有深色面板、`rounded-lg`、12px 字号、粉色/蓝色强调色。

#### 概览

- 统计卡：已打标视频数、待审核标签数、已通过标签数、失败任务数、累计 tokens。
- 「最近任务」列表：批次、方案、模型、完成/失败数、时间。
- 「快速开始」：选择方案 + 范围 → 开始打标。
- 若未配置 Provider/方案，显示引导卡片（去配置 / 去创建方案）。

#### 打标任务

- 批次列表：状态、进度条、总数/完成/失败、方案、模型、创建时间。
- 操作：暂停、继续、取消、重试失败项。
- 运行明细抽屉：阶段（抽帧/请求/工具/解析）、抽帧缩略图、原始响应、工具调用、错误、tokens。
- 「开始打标」弹窗：
  - 范围：当前筛选结果 / 选中视频 / 整个素材库 / 指定来源。
  - 方案：默认方案或来源覆盖方案；可手动改。
  - 选项：仅未打标、强制重跑、限制数量（默认不限制）。
  - 预估：请求数、图片数、约 tokens。
  - 隐私提示：会把封面/抽帧上传到配置的模型服务；调用 ACRCloud 时会上传 15 秒音频片段。

### 4.3 标签审核页（重点）

用户要求：**大列表展示所有视频打标结果，带原始标签 + AI 标签 + 视频截取缩略图，可以批量通过**。

布局：

```
┌ AI 打标 ──────────────────────────────────────────────────────────────────┐
│ 概览   打标任务   标签审核 12   标签方案   模型与工具   库级分析          │
├───────────────────────────────────────────────────────────────────────────┤
│ [待审核 12] [已通过 240] [已拒绝 8] [全部]    方案: 全部 ▾  来源: 全部 ▾  │
│ 搜索标题/标签…   置信度 ≥ 0.5 ──────●──────   [全选] [批量通过] [批量拒绝]│
├───────────────────────────────────────────────────────────────────────────┤
│ ☑  [封面 96×54]  标题：xxxxx                              待审核           │
│                  UP 主 · 来源 · 03:24 · 3 帧 · 方案A · 模型名 · 12:31     │
│                                                                           │
│    原始标签   [平台] 舞蹈  [平台] 宅舞  [自动] UP主名  [手动] 参考         │
│                                                                           │
│    抽取帧     [00:12]  [00:45]  [01:20]        （点击放大 / 跳转播放）     │
│                                                                           │
│    AI 标签    人物   [长发 0.91 ☑] [双马尾 0.88 ☑]                        │
│               服饰   [JK制服 0.94 ☑] [过膝袜 0.72 ☐]                      │
│               动作   [舞蹈 0.96 ☑]                                        │
│               BGM    [《曲名》- 歌手 0.99 ACR] [电子流行 0.85 ☑]          │
│                                                                           │
│    [通过所选] [拒绝所选] [重跑] [展开 JSON]                               │
├───────────────────────────────────────────────────────────────────────────┤
│ ☑  [封面] 下一条…                                                         │
└───────────────────────────────────────────────────────────────────────────┘
```

交互细节：

- 使用 `@tanstack/react-virtual` 虚拟列表，默认每页 50 条，滚动加载。
- 行选择框：选中整行所有待审核标签；标签单独勾选可覆盖。
- 默认勾选规则：置信度 ≥ 方案 `minConfidence`（默认 0.5）的待审核标签默认勾选；低于阈值的默认不勾选但仍显示。
- 「批量通过」只处理当前筛选结果中已勾选的行；「全部通过」处理当前筛选结果的所有待审核标签（二次确认）。
- 标签 chip 显示：分类、名称、置信度、来源徽标（`VLM` / `ACR` / `B站` / `推断`）。
- 标签可内联编辑：点击 chip 弹出小面板，可改名称/分类/置信度、删除；也可「添加标签」。
- 通过后 chip 变绿；拒绝后置灰/删除线，可恢复。
- 抽帧点击打开灯箱：大图 + 时间点 + 「在播放器中打开」（播放器跳到该时间点）。
- 顶部筛选：审核状态、方案、来源、搜索（标题/UP/标签）、最低置信度。
- 空状态：没有待审核时显示「全部审核完了」+ 去发起打标。
- 审核页只展示 `ai_runs.status='done'` 的运行；失败运行在「打标任务」里查看。

### 4.4 标签方案

左侧方案列表，右侧编辑器：

```
┌ 方案列表 240px ─────┬─ 方案编辑器 ──────────────────────────────────────┐
│ ● 默认方案（全局）   │ 名称 [舞蹈/人物]    范围 [全局 ▾]   [设为默认]     │
│   舞蹈收藏夹（来源） │ 关注点 [人物形象] [服饰] [BGM] [+ 自定义]          │
│   + 新建方案         │ 分类体系：人物 / 服饰 / 动作 / 场景 / 风格 / BGM… │
│                      │ 系统提示词 [textarea]                             │
│                      │ 用户模板 [textarea]  变量：[插入 ▾]  [预览]       │
│                      │ 输出约束：最多 12 个标签  最低置信度 0.5          │
│                      │ [从库分析生成] [复制] [删除]                      │
└──────────────────────┴───────────────────────────────────────────────────┘
```

方案字段：

- 名称、描述、范围（全局/来源）、是否默认。
- 关注点（chips，可增删）：人物形象、服饰、动作、场景、风格、BGM、情绪、菜系、烹饪方法、器材、构图等。
- 分类体系：分类名 + 描述 + 示例标签；可增删排序。
- 系统提示词、用户模板；变量帮助与「预览渲染结果」。
- 输出约束：最多标签数、最低置信度、语言、是否允许 ACRCloud、是否使用 B 站原始标签。
- 来源覆盖：一个来源最多一个覆盖方案；未覆盖时使用全局默认。

变量：

```
{{title}} {{upName}} {{duration}} {{sourceName}} {{description}}
{{originalTags}} {{bgmHint}} {{focus}} {{taxonomy}}
{{maxTags}} {{minConfidence}} {{language}} {{frameTimestamps}} {{schema}}
```

### 4.5 模型与工具

#### Provider Profile

列表卡片：名称、协议徽标、模型、baseURL、Key 状态、能力标签（视觉/工具/JSON）、默认标记、测试按钮。

新增/编辑弹窗：

- 协议：`OpenAI 兼容` / `Anthropic Messages` / `Google Generative AI` / `自定义`。
- 名称、Base URL、模型名。
- API Key（密码输入；编辑时留空表示不修改，勾选「清除」表示删除）。
- 高级：
  - 请求头（JSON，值加密存储，界面只显示键名）。
  - 自定义协议：兼容模式（OpenAI 兼容端点 / Anthropic 兼容端点 / Gemini 兼容端点 / 纯模板）；兼容模式沿用标准工具调用格式，纯模板模式才禁用工具。
  - 纯模板模式：请求体模板、响应文本路径。
  - 超时、最大重试、温度、最大输出 tokens。
  - 能力：视觉、工具调用、JSON 模式、音频（v1 仅记录，不直接发送音频）。
  - 价格（可选，输入/输出每百万 tokens），用于估算费用。
- 测试连接：
  - 发送一张 1×1 PNG + 「只回复 OK」，验证鉴权、网络、视觉能力。
  - 可选「JSON 测试」：要求输出 `{"ok":true}`，验证 JSON 模式。
  - 显示延迟、HTTP 状态、错误详情、是否支持视觉。

预设（可一键填入，仍可改）：

| 预设 | 协议 | Base URL 示例 | 模型示例 |
|---|---|---|---|
| OpenAI | OpenAI 兼容 | `https://api.openai.com/v1` | `gpt-4o-mini` / 支持视觉的模型 |
| DeepSeek | OpenAI 兼容 | `https://api.deepseek.com/v1` | `deepseek-chat`（文本模型，界面提示「不支持视觉，仅可用于库级文本分析」） |
| 阿里云百炼 | OpenAI 兼容 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` |
| 智谱 | OpenAI 兼容 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-plus` |
| Gemini | Google Generative AI | `https://generativelanguage.googleapis.com` | `gemini-2.5-flash` 等 |
| Anthropic | Anthropic Messages | `https://api.anthropic.com` | `claude-...` |
| OpenRouter | OpenAI 兼容 | `https://openrouter.ai/api/v1` | 任意视觉模型 |
| 硅基流动 | OpenAI 兼容 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` |
| Ollama | OpenAI 兼容 | `http://127.0.0.1:11434/v1` | `qwen2.5vl:7b` |
| LM Studio | OpenAI 兼容 | `http://127.0.0.1:1234/v1` | 本地视觉模型 |
| OpenCode Go | 自定义（OpenAI 兼容端点） | 按服务商文档 | 任意支持视觉/工具的模型 |

> 模型名会随时间变化，预设只是示例；用户可自由修改。DeepSeek 目前没有公开的视觉 API，方案中会明确提示。

#### ACRCloud

- 开关、Host、Access Key、Access Secret、测试按钮。
- 测试方式：发送 3 秒静音音频；ACRCloud 返回 `1001 No result` 视为鉴权成功，其他错误码显示详情。
- 显示本地今日调用次数（来自 `ai_music_cache`），不是官方配额。
- 未配置时：工具不暴露给模型，提示词只使用 B 站标签/标题推断 BGM。

#### 抽帧与队列

- 每视频帧数（0–8，默认 3）、是否包含封面（默认开）、帧最大边长（512/768/1024，默认 768）。
- 队列并发（1–4，默认 2）、请求间隔（默认 300ms）、超时（默认 120s）、最大重试（默认 2）、最大工具轮次（默认 3）。
- 图片细节（low/auto/high，默认 auto）。
- 缓存保留天数（默认 30 天）+「清理 AI 缓存」按钮。
- 隐私说明：只有发起打标时才会把图片/音频上传到配置的服务；Key 加密保存在本机。

### 4.6 库级分析

向导式页面：

1. **选择素材**
   - 采样方式：随机 / 按来源分层 / 按 UP 分层 / 手动选择。
   - 默认 24 条；可改 8–200。
   - 手动选择：搜索 + 复选列表（封面、标题、UP、来源、时长），显示已选数量和网格预览。
   - 支持「全选当前筛选」「清空」。
2. **分析方式**
   - `混合（推荐）`：先用元数据做文本聚类，再选代表视频做视觉校验。
   - `仅文本`：只发标题/UP/简介/原始标签，便宜、快。
   - `仅视觉`：每条都发封面+2 帧，贵、准。
3. **预估**
   - 请求数、图片数、约 tokens；显示「将使用 Provider X / 模型 Y」。
   - 二次确认后开始。
4. **结果**
   - 主题摘要。
   - 分类体系：分类 + 描述 + 候选标签 + 覆盖率。
   - 关注点、停用词、别名。
   - 生成的系统提示词与用户模板（可编辑）。
   - 「保存为新方案」/「覆盖当前方案」；保存后可直接用于打标。

### 4.7 侧栏「本地标签」与详情面板

- 侧栏在现有「标签」之后新增「本地标签」分组：
  - 按分类分组展示审核通过的 AI 标签（每类最多 3 个，超出显示「+N」）。
  - 点击标签：`view='library'`，`filters.aiTag = name`，清空普通 `tag`。
  - 右侧显示数量；分组标题旁显示待审核数量。
- Inspector 新增「AI 标签」分区：
  - 按分类分组，chip 显示名称 + 置信度 + 来源徽标。
  - 已通过的标签可「取消通过」。
  - 显示「待审核 N 个」按钮，跳转审核页并按该视频筛选。
  - 「重新打标」按钮：单视频入队。
- 视频卡片暂不显示 AI 标签，避免网格信息过载；搜索/筛选已足够。

---

## 5. 数据模型

### 5.1 迁移 9

```sql
-- 标签方案：全局默认 + 来源覆盖
CREATE TABLE IF NOT EXISTS ai_tag_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'global',              -- global | source
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  is_default INTEGER NOT NULL DEFAULT 0,
  focus_json TEXT NOT NULL DEFAULT '[]',
  taxonomy_json TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL DEFAULT '',
  max_tags INTEGER NOT NULL DEFAULT 12,
  min_confidence REAL NOT NULL DEFAULT 0.5,
  language TEXT NOT NULL DEFAULT 'zh-CN',
  use_acrcloud INTEGER NOT NULL DEFAULT 1,
  use_bilibili_tags INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_profiles_default
  ON ai_tag_profiles(is_default) WHERE scope = 'global' AND is_default = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_profiles_source
  ON ai_tag_profiles(source_id) WHERE scope = 'source' AND source_id IS NOT NULL;

-- 批次
CREATE TABLE IF NOT EXISTS ai_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES ai_tag_profiles(id) ON DELETE SET NULL,
  provider_id TEXT,
  provider_name TEXT,
  model TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}',
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',             -- queued | running | paused | done | canceled
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_batches_status ON ai_batches(status, created_at DESC);

-- 单视频运行
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER REFERENCES ai_batches(id) ON DELETE CASCADE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES ai_tag_profiles(id) ON DELETE SET NULL,
  provider_id TEXT,
  provider_name TEXT,
  protocol TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'queued',             -- queued | running | done | failed | canceled
  stage TEXT,                                        -- frames | request | tools | parse
  frames_json TEXT NOT NULL DEFAULT '[]',
  prompt_hash TEXT,
  system_prompt TEXT,
  user_prompt TEXT,
  raw_response TEXT,
  result_json TEXT,
  error TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls_json TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'pending',     -- pending | partial | approved | rejected
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_video ON ai_runs(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_batch ON ai_runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_runs(status);
CREATE INDEX IF NOT EXISTS idx_ai_runs_review ON ai_runs(review_status, created_at DESC);

-- 运行产出的标签（审核前）
CREATE TABLE IF NOT EXISTS ai_run_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'vision',             -- vision | acrcloud | bilibili_tag | inferred
  status TEXT NOT NULL DEFAULT 'pending',            -- pending | approved | rejected | superseded
  evidence TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_run_tags_run ON ai_run_tags(run_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_run_tags_video ON ai_run_tags(video_id, status);

-- 审核通过的标签词典
CREATE TABLE IF NOT EXISTS ai_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (normalized_name, category)
);

-- 视频 <-> 已通过 AI 标签
CREATE TABLE IF NOT EXISTS video_ai_tags (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  ai_tag_id INTEGER NOT NULL REFERENCES ai_tags(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'vision',
  approved_at TEXT NOT NULL,
  PRIMARY KEY (video_id, ai_tag_id)
);
CREATE INDEX IF NOT EXISTS idx_video_ai_tags_tag ON video_ai_tags(ai_tag_id);

-- ACRCloud 结果缓存（按音频 hash）
CREATE TABLE IF NOT EXISTS ai_music_cache (
  hash TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 库级分析历史
CREATE TABLE IF NOT EXISTS ai_analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT,
  provider_name TEXT,
  model TEXT,
  mode TEXT NOT NULL,                                -- text | vision | hybrid
  sample_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result_json TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
```

### 5.2 关键查询

- 审核列表：`ai_runs` 按 `review_status`/`created_at` 分页，关联 `videos`、`sources`、`ai_run_tags`；原始标签从 `video_tags` + `tags` 取。
- 侧栏本地标签：`video_ai_tags` + `ai_tags` 按 `count` 排序，过滤 `videos.status <> 'trashed'`。
- 搜索/FTS：见 6.8 节。
- 待审核计数：`SELECT COUNT(*) FROM ai_run_tags WHERE status='pending'`。
- 统计：已打标视频数（`COUNT(DISTINCT video_id) FROM ai_runs WHERE status='done'`）、已通过标签数、失败运行数、tokens 汇总。

### 5.3 sidecar 扩展

`metadata.json` 的 `schema` 仍为 `bilishelf.item/1`，新增可选字段：

```json
{
  "schema": "bilishelf.item/1",
  "...": "现有字段不变",
  "aiTags": [
    { "name": "JK制服", "category": "服饰", "confidence": 0.94, "source": "vision", "approvedAt": "2026-11-14T..." }
  ],
  "aiTaggedAt": "2026-11-14T..."
}
```

- 审核通过/取消通过后调用 `writeSidecar(videoId)`。
- `rebuildFromDisk` 读取 `aiTags`，写入 `ai_tags` / `video_ai_tags`（`run_id = NULL`），恢复后参与搜索/筛选。
- 不写 NFO。

### 5.4 数据生命周期

0. 初始化：首次启动或首次打开 AI 页时，若 `ai_tag_profiles` 为空，插入内置「通用」全局默认方案（分类/提示词见 6.3）；不覆盖用户已有方案。
1. 入队：创建 `ai_batches` + 多条 `ai_runs(status='queued')`。
2. 运行：`status='running'`，阶段更新；抽帧路径写入 `frames_json`。
3. 完成：`status='done'`，`ai_run_tags` 全部 `pending`；同一视频同一方案的旧 `pending` 标签标记为 `superseded`。
4. 审核：通过 → `ai_run_tags.status='approved'` + `ai_tags`/`video_ai_tags` upsert；拒绝 → `rejected`。
5. 重跑：新 run；已通过的 `video_ai_tags` 保留，直到用户取消通过或被新审核覆盖。
6. 删除视频：外键级联删除 runs/tags；抽帧缓存由维护任务清理。
7. 清理：删除超过 `aiCacheDays` 的 `cache/ai` 目录（待审核运行保护），并把对应 run 的 `frames_json` 置为 `[]`；删除无引用的 `ai_music_cache`。

---

## 6. 打标流水线

### 6.1 队列与并发

`AiTaggingManager` 与现有 `DownloadManager` 类似：

- `start()`：启动时把 `running` 的 run 重置为 `queued`，继续处理。
- `enqueue({ videoIds?, scope?, profileId?, force?, limit? })`：
  - `videoIds` 直接指定；`scope` 为 `all` / `filter` / `source` 时，主进程复用 `queryVideoIds()` 解析，避免渲染层传几千个 ID。
  - 校验视频 `present`、文件存在、Provider/方案可用；`limit` 可限制本次数量。
  - 去重（同视频+方案+prompt_hash 已在队列/运行中则跳过）。
- `pump()`：按 `aiConcurrency`（默认 2）取 `queued` run；每个 run 独立 `AbortController`。
- `pause/resume/cancel(batchId)`：暂停只影响未开始的 run；取消中止当前请求/ffmpeg。
- 事件：`eventAiQueue`（批次快照，300ms 防抖）、`eventAiProgress`（单 run 阶段）、`eventAiReview`（审核变化）。
- 失败重试：429/5xx/超时按指数退避重试 `aiMaxRetries` 次；401/403 不重试，直接失败并提示 Key 问题。
- 运行阶段：`frames` → `request` → `tools`（可选，最多 3 轮）→ `parse` → `done`。

### 6.2 抽帧与音频

`prepareFrames(video, options)`：

- 封面：优先 `assets` 里的 `cover`；没有则用第一帧。统一缩放到最长边 768px 的 JPEG（webp/png 用 ffmpeg 转一次，结果缓存）。
- 视频帧：`status='present'` 且文件存在；用 `ffprobe` 读时长（DB 有则直接用）。
- 时间点：`start = max(2, duration*0.15)`，`end = min(duration-2, duration*0.85)`；`count=1` 取中点；否则等距。短于 6 秒的视频取中点/首尾安全点。
- ffmpeg：
  ```
  -ss <t> -i <video> -frames:v 1 -vf "scale=768:768:force_original_aspect_ratio=decrease" -q:v 3 -y <out>
  ```
- 缓存：`cache/ai/<videoId>/<videoHash>/frame-<i>-<t>.jpg`；`videoHash = sha1(size + mtime + frameCount + width)`。存在即复用。
- 音频（仅 ACRCloud 工具调用时）：
  ```
  -ss <t> -t 15 -vn -ac 1 -ar 44100 -b:a 128k -f mp3 <out>
  ```
  位置 `start` / `middle` / `end` 对应 15% / 50% / 85%；缓存 `cache/ai/<videoId>/<videoHash>/audio-<position>.mp3`。
- 协议：`bilishelf://ai/<runId>/<index>` 从 `ai_runs.frames_json` 取路径，校验 `isInside(root)` 后 `serveFile`；`index = -1` 表示封面。
- 清理：`maintenance.cleanupAiCache()` 删除超过 `aiCacheDays`（默认 30 天）的 `cache/ai` 目录；`review_status='pending'` 的运行保护其帧；被清理的 run 把 `frames_json` 置为 `[]`，审核历史仍保留标签/原始响应。设置/模型工具页提供按钮。

### 6.3 提示词

#### 默认系统提示词

```
你是 BiliShelf 的视频素材标注助手。你会收到一个视频的封面、若干视频帧、标题、UP 主、简介和原始标签。
规则：
1. 只根据画面和给定信息打标，不要臆测画面中不存在的内容。
2. 标签使用简体中文，尽量是 2–8 个字的短名词短语；不要输出“视频”“B站”“二次元”“好看”等泛词。
3. 按给定的分类输出；每个标签给出 0–1 的置信度；不确定就不要输出。
4. 人物、服饰、动作、场景、风格、情绪要分开归类；同一概念不要重复输出。
5. BGM：只有当画面或原始标签明显表明这是音乐、舞蹈、演奏、翻唱、MV 等内容时，才调用 identify_music 工具；工具无结果时不要编造曲名，可标注推断的音乐风格。
6. 只输出 JSON，不要 Markdown 代码块，不要解释。
```

#### 默认用户模板

```
视频信息：
标题：{{title}}
UP 主：{{upName}}
时长：{{duration}}
来源：{{sourceName}}
简介：{{description}}
原始标签：{{originalTags}}
BGM 线索：{{bgmHint}}

本次关注点：{{focus}}
分类体系：
{{taxonomy}}

输出要求：
- 最多 {{maxTags}} 个标签，置信度低于 {{minConfidence}} 的不要输出。
- 标签分类必须来自上面的分类体系；无法归类时用「其他」。
- 输出 JSON 结构：
{{schema}}
```

#### 输出 JSON

```json
{
  "summary": "一句话概括视频内容，60 字以内",
  "tags": [
    { "name": "JK制服", "category": "服饰", "confidence": 0.94, "evidence": "第 2 帧人物穿着" }
  ],
  "bgm": {
    "title": "曲名或 null",
    "artists": ["艺术家"],
    "genres": ["电子流行"],
    "source": "acrcloud | bilibili_tag | inferred",
    "confidence": 0.9
  }
}
```

#### 默认分类体系

| 分类 | 说明 | 示例 |
|---|---|---|
| 人物 | 人物形象、发型、气质、人数、性别表达 | 长发、双马尾、戴眼镜、群体 |
| 服饰 | 服装类型、制服、配饰、颜色、风格 | JK制服、汉服、洛丽塔、过膝袜 |
| 动作 | 舞蹈动作、手势、走位、运动、镜头互动 | 舞蹈、旋转、跳跃、挥手 |
| 场景 | 室内/室外、舞台、街景、教室、自然、摄影棚 | 舞台、教室、街道、夜景 |
| 风格 | 二次元、国风、赛博朋克、复古、极简、电影感、手绘 | 国风、赛博朋克、电影感 |
| BGM | 曲名、艺术家、流派、节奏、乐器 | 《曲名》、电子流行、钢琴 |
| 情绪 | 欢快、治愈、热血、忧郁、紧张、浪漫 | 欢快、治愈、热血 |
| 其他 | 无法归类的具体特征 | 特定道具、特定主题 |

默认方案关注点：人物形象、服饰、动作、场景、风格、BGM、情绪。
默认 `maxTags=12`，`minConfidence=0.5`。

### 6.4 Provider 适配器

接入方式参考 DeepSeek Harness 的 provider profile 思路：**provider 名称、协议、baseURL、apiKey、headers、model 分开配置，按 provider 路由请求**，而不是把模型名写死成适配器键。这样同一个模型可以挂在不同网关（官方、OpenRouter、硅基流动、本地 Ollama），私有网关也能直接加模型。

统一的中立消息模型：

```ts
type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; data: string }        // base64
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; result: unknown };

interface AiMessage { role: 'user' | 'assistant' | 'tool'; parts: AiContentPart[] }

interface AiChatRequest {
  system: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  imageDetail: 'low' | 'auto' | 'high';
  timeoutMs: number;
}

interface AiChatResponse {
  text: string;
  toolCalls: AiToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;
}
```

适配器：

- **OpenAI 兼容**：`POST {baseUrl}/chat/completions`；`Authorization: Bearer`；图片 `image_url` + data URL；工具 `tools[].function`；`response_format: { type: 'json_object' }`（能力开启时）。
  - 兼容回退：若 400 提示 `max_tokens` 不支持，改用 `max_completion_tokens` 重试一次；若 `response_format` 不支持，去掉后重试一次。
- **Anthropic Messages**：`POST {baseUrl}/v1/messages`；`x-api-key` + `anthropic-version: 2023-06-01`；图片 `source: { type: 'base64', media_type, data }`；工具 `tools[].input_schema`；工具结果放 user 消息的 `tool_result` block。
- **Google Generative AI**：`POST {baseUrl}/v1beta/models/{model}:generateContent?key=...`；`systemInstruction`；图片 `inline_data`；工具 `functionDeclarations`；`generationConfig.responseMimeType = 'application/json'`。
- **自定义**：
  - `compatMode`：`openai` / `anthropic` / `gemini` / `template`。
  - `openai` / `anthropic` / `gemini` 兼容模式：沿用对应协议的 messages/tools 序列化，只覆盖 baseURL、headers、model；**ACRCloud 工具调用可用**（OpenCode Go 等 OpenAI 兼容网关用 `openai` 模式）。
  - `template` 模式：`bodyTemplate`（JSON 字符串）+ `responsePath`（点路径，如 `choices.0.message.content`）；占位符 `{{model}} {{system}} {{prompt}} {{temperature}} {{maxTokens}} {{imagesDataUrl}} {{imagesBase64}} {{imageParts}}`；值等于占位符时替换为对应 JSON 类型，字符串内嵌时做字符串替换。**纯模板模式 v1 不支持 tool calling**，界面明确提示。
  - 兼容模式本质上等价于「标准协议 + 自定义端点」，因此不需要用户手写消息格式；只有非标准 API 才用纯模板模式。
- 所有协议统一使用 Electron `net.fetch`（跟随系统代理），超时用 `AbortController`；错误映射为可读中文。

### 6.5 ACRCloud 工具

工具定义：

```json
{
  "name": "identify_music",
  "description": "识别视频中某一段的背景音乐。仅在视频明显是音乐、舞蹈、演奏、翻唱、MV，或需要确认 BGM 时调用；普通视频不要调用。可对不同时间段最多调用 3 次。",
  "parameters": {
    "type": "object",
    "properties": {
      "position": { "type": "string", "enum": ["start", "middle", "end"], "description": "采样位置" }
    },
    "required": ["position"]
  }
}
```

主进程执行：

1. 校验调用次数 ≤ 3、ACRCloud 已配置。
2. 按 position 抽取 15 秒单声道 MP3。
3. 计算 `sha1(audioBytes + host)`，查 `ai_music_cache`；命中直接返回。
4. 请求 `POST https://{host}/v1/identify`：
   - `stringToSign = "POST\n/v1/identify\n{accessKey}\naudio\n1\n{timestamp}"`
   - `signature = base64(HMAC-SHA1(accessSecret, stringToSign))`
   - `FormData`：`access_key`、`data_type=audio`、`signature_version=1`、`signature`、`timestamp`、`sample`（base64）。
5. 解析 `metadata.music[0]`：`title`、`artists[].name`、`album.name`、`genres[].name`、`release_date`、`score`。
6. 返回给模型：
   ```json
   { "matched": true, "title": "...", "artists": ["..."], "genres": ["..."], "score": 95 }
   ```
   无结果（`status.code=1001`）返回 `{ "matched": false }`，不抛错。
7. 工具结果写入 `ai_runs.tool_calls_json`，并计入运行详情。

B 站 BGM 线索：

- `bgmHint` 由标题/简介/原始标签计算：命中「音乐、BGM、翻唱、舞蹈、演奏、MV、歌曲、钢琴、吉他、说唱、rap、宅舞、古风、电音、DJ」等关键词时，提示模型「建议调用 identify_music」。
- 原始标签中的 `《...》`、`音乐`、`BGM` 等作为候选，模型可据此生成 `source='bilibili_tag'` 的 BGM 标签。
- ACRCloud 结果优先级高于推断；`source` 字段记录来源。

### 6.6 JSON 解析与标签归一化

解析：

1. 去掉 Markdown 代码围栏；截取第一个 `{` 到最后一个 `}`。
2. `JSON.parse`；失败则发一次「修复请求」（附上原输出，要求只输出合法 JSON）；仍失败则 run 失败，保留 `raw_response`。
3. Zod 校验：`summary`、`tags[]`、`bgm` 可选；`tags` 最多 50 个。

归一化：

- `name`：trim、压缩空白、去掉开头 `#`；长度 1–24 个字符；超长截断。
- `category`：必须在方案分类中；否则归入「其他」；没有「其他」则用第一个分类。
- 别名：按方案 `aliases`（大小写不敏感）映射到标准名。
- 停用词：命中方案 `stopwords` 的标签丢弃。
- 去重：`normalized_name + category` 去重，保留最高置信度。
- 数量/置信度：过滤低于 `minConfidence`，按置信度降序取前 `maxTags`。
- BGM 展开（已确认曲名+艺术家+流派）：
  - `bgm.title` → `BGM` 分类标签；
  - `bgm.artists[]` → `BGM` 分类标签；
  - `bgm.genres[]` → `音乐风格` 分类（不存在则 `BGM`）；
  - 置信度使用 `bgm.confidence`，来源使用 `bgm.source`。
- 同一标签若模型已输出且 BGM 展开重复，按去重规则保留最高置信度。

### 6.7 审核入库

通过：

```ts
tx(() => {
  for (const tag of approvedTags) {
    upsert ai_tags (name, normalized_name, category)
    upsert video_ai_tags (video_id, ai_tag_id, run_id, confidence, source, approved_at)
    update ai_run_tags set status='approved'
  }
  recompute ai_runs.review_status
  refreshVideoFts(video_id)
});
await writeSidecar(videoId);
broadcastLibrary();
broadcastAiReview();
```

拒绝：

```sql
UPDATE ai_run_tags SET status='rejected' WHERE id IN (...);
-- 不删除 video_ai_tags 中此前已通过的标签；取消通过走单独接口
```

取消通过（Inspector/审核页已通过标签）：

```sql
DELETE FROM video_ai_tags WHERE video_id=? AND ai_tag_id IN (...);
UPDATE ai_run_tags SET status='pending' WHERE ...;
```

批量语义：

- `approve({ runIds, tagIds? })`：`tagIds` 省略时，通过这些 run 下所有 `pending` 标签。
- `reject` 同理。
- 审核页「全选」只选当前页/当前筛选结果，避免误操作全库；「全部通过」需二次确认。

### 6.8 搜索 / 筛选 / FTS

- `LibraryQuery` 新增 `aiTag?: string`。
- `buildWhere`：
  ```sql
  EXISTS (
    SELECT 1 FROM video_ai_tags vat JOIN ai_tags at ON at.id = vat.ai_tag_id
    WHERE vat.video_id = v.id AND at.name = ?
  )
  ```
- 短搜索（<3 字符）追加 AI 标签 `LIKE` 分支。
- `refreshVideoFts` 的 `tags_text` 合并普通标签 + 已通过 AI 标签：
  ```sql
  (SELECT GROUP_CONCAT(t.name,' ') FROM video_tags ...) || ' ' ||
  (SELECT GROUP_CONCAT(at.name,' ') FROM video_ai_tags ...)
  ```
- 审核通过/取消通过/重建后调用 `refreshVideoFts`。
- `Filters.aiTag` 与 `filters.tag` 互斥；点击本地标签时清空普通标签，反之亦然。
- `LibraryStats` 新增 `withAiTags`（已通过 AI 标签的视频数）。

### 6.9 库级分析提示词

**阶段 A：文本聚类（每批最多 60 条元数据）**

```
你是视频素材库的策展人。下面是 {{count}} 个视频的元数据（标题/UP/简介/原始标签/来源/时长）。
请完成：
1. 用 3–6 句话概括这个库的主题分布（例如：舞蹈、美食、教程、动画参考）。
2. 设计一套适合全库的标签分类体系：4–8 个分类，每个分类给 5–12 个候选标签。
3. 给出打标时应重点关注的内容维度（人物形象/服饰/动作/场景/风格/BGM/情绪等，按库的实际内容取舍）。
4. 给出应过滤的泛词/无信息标签。
只输出 JSON：
{"summary":"...","categories":[{"name":"人物","description":"...","tags":["..."]}],"focus":["..."],"stopwords":["..."],"aliases":{}}
```

**阶段 B：代表视频视觉校验（最多 8 个分类代表 + 2 个随机视频）**

```
这些是从库中挑选的代表视频，每个视频包含封面、2 张抽帧和元数据。请基于画面校正第一阶段的分类体系，并生成一套可直接用于逐视频打标的模板。
要求：
- 分类要贴合画面实际内容，不要照搬通用分类。
- 为每个分类给出 5–12 个具体标签示例。
- 明确 BGM 关注点：只有音乐/舞蹈/演奏/翻唱/MV 才建议调用 ACRCloud。
- 生成 systemPrompt 和 promptTemplate；模板必须包含 {{title}} {{originalTags}} {{focus}} {{taxonomy}} {{maxTags}} {{minConfidence}} {{schema}} 变量。
- 只输出 JSON：
{"summary":"...","categories":[{"name":"人物","description":"...","tags":["..."],"coverage":0.8}],"focus":["..."],"stopwords":["..."],"aliases":{},"systemPrompt":"...","promptTemplate":"...","notes":["..."]}
```

成本：阶段 A 请求数 = `ceil(样本数 / 60)`；阶段 B 请求数 = `min(分类数, 8) + 2`，每个请求 1 封面 + 2 帧。结果保存到 `ai_analysis_runs`，可编辑后保存为方案。

---

## 7. IPC 与类型

### 7.1 通道

```
ai:providers:list / save / remove / set-default / test
ai:acrcloud:get / save / test
ai:profiles:list / save / remove / set-default / duplicate
ai:queue:enqueue / batches / pause / resume / cancel / retry-failed
ai:runs:list / get
ai:review:list / counts / approve / reject / update-tag / add-tag / remove-tag
ai:tags:list
ai:analysis:estimate / run / history / get / save-as-profile
ai:maintenance:cleanup
event:ai-queue / event:ai-progress / event:ai-review / event:ai-analysis
```

### 7.2 关键类型

```ts
type AiProtocol = 'openai' | 'anthropic' | 'gemini' | 'custom';
type AiTagSource = 'vision' | 'acrcloud' | 'bilibili_tag' | 'inferred';
type AiRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
type AiReviewStatus = 'pending' | 'partial' | 'approved' | 'rejected';
type AiTagStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

interface AiProviderSummary {
  id: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  headerKeys: string[];
  capabilities: { vision: boolean; tools: boolean; jsonMode: boolean; audio: boolean };
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  imageDetail: 'low' | 'auto' | 'high';
  pricing?: { inputPerMillion: number; outputPerMillion: number; currency: string };
  isDefault: boolean;
  custom?: { compatMode: 'openai' | 'anthropic' | 'gemini' | 'template'; bodyTemplate?: string; responsePath?: string };
}

interface AiTagProfile {
  id: number;
  name: string;
  description: string;
  scope: 'global' | 'source';
  sourceId: number | null;
  sourceName: string | null;
  isDefault: boolean;
  focus: string[];
  taxonomy: {
    categories: Array<{ name: string; description?: string; examples?: string[] }>;
    stopwords: string[];
    aliases: Record<string, string>;
  };
  systemPrompt: string;
  promptTemplate: string;
  maxTags: number;
  minConfidence: number;
  language: string;
  useAcrcloud: boolean;
  useBilibiliTags: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AiFrame { index: number; time: number; url: string }

interface AiReviewTag {
  id: number;
  category: string;
  name: string;
  confidence: number;
  source: AiTagSource;
  status: AiTagStatus;
  evidence: string | null;
  edited: boolean;
}

interface AiReviewItem {
  runId: number;
  videoId: number;
  videoTitle: string;
  upName: string | null;
  sourceName: string | null;
  duration: number | null;
  coverUrl: string | null;
  reviewStatus: AiReviewStatus;
  frames: AiFrame[];
  originalTags: Array<{ name: string; source: 'manual' | 'auto' }>;
  aiTags: AiReviewTag[];
  summary: string | null;
  bgm: AiBgmResult | null;
  profileName: string | null;
  providerName: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

interface AiEnqueueInput {
  /** 直接指定视频；与 scope 二选一 */
  videoIds?: number[];
  /** 范围解析：all / 当前筛选 / 指定来源；主进程复用 queryVideoIds */
  scope?: {
    type: 'all' | 'filter' | 'source';
    filter?: LibraryQuery;
    sourceId?: number;
  };
  profileId?: number;
  force?: boolean;
  limit?: number;
}

interface AiReviewQuery {
  status?: AiReviewStatus | 'all';
  profileId?: number;
  sourceId?: number;
  search?: string;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

interface AiReviewDecision {
  runIds: number[];
  tagIds?: number[];
}

interface AiTagSummary {
  id: number;
  name: string;
  category: string;
  count: number;
  source: AiTagSource | 'mixed';
}

interface AiBatch {
  id: number;
  profileName: string | null;
  providerName: string | null;
  model: string | null;
  total: number;
  done: number;
  failed: number;
  status: 'queued' | 'running' | 'paused' | 'done' | 'canceled';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface AiQueueSnapshot {
  batches: AiBatch[];
  pendingReview: number;
}

interface AiProgress {
  batchId: number;
  runId: number;
  videoId: number;
  title: string;
  stage: 'frames' | 'request' | 'tools' | 'parse' | 'done';
  done: number;
  total: number;
}

interface AiReviewCounts {
  pending: number;
  approved: number;
  rejected: number;
}

interface AiAnalysisResult {
  summary: string;
  categories: Array<{ name: string; description: string; tags: string[]; coverage?: number }>;
  focus: string[];
  stopwords: string[];
  aliases: Record<string, string>;
  systemPrompt: string;
  promptTemplate: string;
  notes: string[];
}

interface AiProviderInput {
  id?: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
  headers?: Record<string, string>;
  capabilities: { vision: boolean; tools: boolean; jsonMode: boolean; audio: boolean };
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  imageDetail: 'low' | 'auto' | 'high';
  pricing?: { inputPerMillion: number; outputPerMillion: number; currency: string };
  custom?: { compatMode: 'openai' | 'anthropic' | 'gemini' | 'template'; bodyTemplate?: string; responsePath?: string } | null;
  isDefault?: boolean;
}

interface AiTagProfileInput {
  id?: number;
  name: string;
  description?: string;
  scope: 'global' | 'source';
  sourceId?: number | null;
  isDefault?: boolean;
  focus: string[];
  taxonomy: AiTagProfile['taxonomy'];
  systemPrompt: string;
  promptTemplate: string;
  maxTags: number;
  minConfidence: number;
  language: string;
  useAcrcloud: boolean;
  useBilibiliTags: boolean;
}

interface AiAnalysisInput {
  mode: 'text' | 'vision' | 'hybrid';
  sampleMode: 'random' | 'source' | 'up' | 'manual';
  sampleSize: number;
  videoIds?: number[];
  providerId?: string;
  model?: string;
  profileId?: number;
  instructions?: string;
}
```

`VideoItem` 新增：

```ts
aiTags: Array<{ name: string; category: string; confidence: number; source: AiTagSource }>;
aiPendingCount: number;
aiSummary: string | null;
aiLastRunAt: string | null;
```

`LibraryQuery` 新增 `aiTag?: string`；`LibraryStats` 新增 `withAiTags: number`。

### 7.3 配置存储

- **非敏感偏好**放在现有 `userData/config.json`（`AppSettings`）：
  - `aiFrameCount`（3）、`aiFrameWidth`（768）、`aiIncludeCover`（true）
  - `aiConcurrency`（2）、`aiRequestDelayMs`（300）、`aiTimeoutMs`（120000）
  - `aiMaxRetries`（2）、`aiMaxToolRounds`（3）、`aiCacheDays`（30）
  - `imageDetail` 与上传确认放在 `ai-config.json`，避免和 Provider 配置分散。
- **Provider / ACRCloud 配置**放在 `userData/ai-config.json`，敏感值用 Electron `safeStorage` 加密：
  ```json
  {
    "version": 1,
    "providers": [
      {
        "id": "uuid",
        "name": "通义千问 VL",
        "protocol": "openai",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-vl-max",
        "secret": "enc:v1:...",
        "capabilities": { "vision": true, "tools": true, "jsonMode": true, "audio": false },
        "temperature": 0.2,
        "maxTokens": 1200,
        "timeoutMs": 120000,
        "maxRetries": 2,
        "imageDetail": "auto",
        "pricing": { "inputPerMillion": 0, "outputPerMillion": 0, "currency": "CNY" },
        "custom": null,
        "isDefault": true
      }
    ],
    "acrcloud": {
      "enabled": true,
      "host": "identify-eu-west-1.acrcloud.com",
      "secret": "enc:v1:..."
    },
    "consent": {
      "acceptedAt": "2026-11-14T...",
      "hosts": ["dashscope.aliyuncs.com", "identify-eu-west-1.acrcloud.com"]
    }
  }
  ```
- `secret` 解密后是 `{ apiKey, headers }`；ACRCloud 是 `{ accessKey, accessSecret }`。
- 编辑 Provider 时：`apiKey` / `headers` 省略表示保持原值；显式 `clearApiKey: true` 或 `headers: {}` 表示清除。
- `safeStorage.isEncryptionAvailable() === false` 时退回 `plain:v1:` 并在 UI 显示黄色警告；Windows 下正常使用 DPAPI。
- 渲染进程永远拿不到 Key；只能看到 `hasApiKey`、末 4 位提示和 header 键名。

---

## 8. 安全与隐私

1. **Key 不落明文**：Provider Key、自定义请求头、ACRCloud Secret 都放在加密的 `ai-config.json`；日志和 IPC 不输出。
2. **上传前确认**：第一次发起打标时弹出隐私确认，列明：
   - 封面和抽帧图片会发送到「Provider 名称 / baseURL」；
   - 调用 ACRCloud 时 15 秒音频片段会发送到「host」；
   - 仅在你主动发起任务时上传，不会后台自动上传。
   - 确认后把 Provider host 与 ACRCloud host 写入 `ai-config.json` 的 `consent.hosts`；新 host 首次使用时再次提示。
3. **本地模型不强制确认**：`localhost` / `127.0.0.1` 的 Ollama/LM Studio 可跳过上传确认，但仍显示提示。
4. **不绕过访问控制**：只处理当前账号可正常播放、已下载到本地的内容；不抓取会员/付费/地区限制内容。
5. **缓存可清理**：抽帧/音频缓存只在本地，提供一键清理；删除视频后由维护任务清理孤儿目录。
6. **输出注入防护**：模型输出只作为标签文本存储，不执行、不拼接 SQL；所有标签参数化写入。
7. **自定义协议风险**：请求体模板由用户填写，可能包含敏感占位符；文档明确提示不要在其中写死密钥，密钥应放在加密的 Key/Headers 字段。

---

## 9. 成本、性能与限额

- **成本估算**（发起前显示，均为粗略值）：
  - 文本：prompt 字符数 / 3 + 元数据；
  - 图片：按 `imageDetail` 估算 300–1500 tokens/张；
  - 输出：`maxTags * 30 + 200`。
- 每次运行记录 `input_tokens` / `output_tokens`；Provider 配置了价格时显示估算费用，否则只显示 tokens。
- **并发**：默认 2；ffmpeg 抽帧与 API 请求共用并发槽，避免同时开太多进程。
- **缓存**：同一视频同一帧配置只抽一次；重跑直接复用。ACRCloud 结果按音频 hash 缓存。
- **体积**：768px JPEG 约 80–150KB/张；1 封面 + 3 帧约 0.4–0.6MB/视频；1000 条约 0.5GB，维护任务可清理。
- **超时/重试**：默认 120s、2 次指数退避；429/5xx 重试，401/403 不重试。
- **限流**：ACRCloud 全局串行（1 并发）；模型请求按 Provider 配置的并发/间隔执行。
- **中断恢复**：应用退出时运行中的 run 标记为 `queued`，下次启动继续；已抽帧缓存保留。

---

## 10. 测试计划

### 单元测试（Vitest）

1. `prompt.test.ts`
   - 变量替换、缺失变量、模板注入防护；
   - 分类体系渲染、`maxTags`/`minConfidence` 注入。
2. `normalize.test.ts`
   - 去代码围栏、提取 JSON、Zod 校验；
   - 去重、别名、停用词、分类回退、超长截断；
   - BGM 曲名/艺术家/流派展开、来源标记、置信度排序。
3. `frames.test.ts`
   - `planFrameTimes`：短/长/未知时长、count 0–8、边界、最小间隔；
   - 缓存 key 稳定性。
4. `providers.test.ts`
   - OpenAI/Anthropic/Gemini 请求体（文本+图片+工具）与响应解析（tool calls、usage）；
   - 工具结果消息格式；
   - 自定义模板占位符替换（字符串/数组/数字）；
   - 400 `max_tokens` 回退、`response_format` 回退。
5. `acrcloud.test.ts`
   - stringToSign、HMAC-SHA1、base64；
   - 成功/1001 无结果/鉴权错误解析。
6. `review.test.ts`（纯函数）
   - `review_status` 计算；
   - 通过/拒绝/取消通过的标签集合计算。

### 手动验收

1. 配置 OpenAI 兼容 Provider → 测试连接成功；错误 Key 显示可读错误。
2. 配置 ACRCloud → 测试成功；错误 Key 显示错误码。
3. 打标 1 个舞蹈视频 → 运行详情显示 3 帧、工具调用、tokens；审核页出现原始标签 + 抽帧 + AI 标签。
4. 批量通过 → 侧栏「本地标签」出现标签；点击筛选出该视频；搜索能命中 AI 标签。
5. `metadata.json` 含 `aiTags`；删除 DB 后重建索引，AI 标签恢复。
6. 库级分析 24 条 → 生成分类/关注点/模板 → 保存为方案 → 用于打标。
7. 自定义协议测试：OpenAI 兼容端点（含 ACRCloud 工具）与纯模板模式（无工具）；确认界面提示正确。
8. 队列：100 条 → 暂停/继续/取消/重试失败；重启应用后继续。
9. 隐私：确认弹窗出现；Key 不出现在渲染进程/日志；未确认时不能发起远程打标。
10. 维护：清理 AI 缓存后，重跑会重新抽帧。

### 工程校验

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

---

## 11. 实施阶段

### Phase 1：数据与配置（约 1–2 天）

- [ ] 迁移 9：AI 表。
- [ ] `db/ai.ts` 仓储：方案、批次、运行、标签、审核、统计。
- [ ] `services/ai/config.ts`：加密 Provider/ACRCloud 配置。
- [ ] `shared/types.ts` + `shared/ipc.ts` + preload 类型。
- [ ] Provider 适配器骨架 + 测试连接。

### Phase 2：打标流水线（约 2–3 天）

- [ ] `frames.ts`：封面/帧/音频抽取 + 缓存 + 清理。
- [ ] `protocol.ts`：`bilishelf://ai/<runId>/<index>`。
- [ ] `prompt.ts` + `normalize.ts`。
- [ ] `acrcloud.ts` + 工具循环。
- [ ] `tagging.ts`：队列、并发、重试、取消、恢复、事件。
- [ ] 审核入库事务 + sidecar + FTS。

### Phase 3：UI（约 3–4 天）

- [ ] AI 页 shell + 子页签 + 侧栏入口。
- [ ] 模型与工具页（Provider CRUD/测试、ACRCloud、抽帧/队列）。
- [ ] 标签方案列表 + 编辑器 + 预览。
- [ ] 开始打标弹窗 + 任务列表 + 运行详情。
- [ ] 标签审核大列表（虚拟滚动、抽帧、原始/AI 标签、批量通过、内联编辑、灯箱）。
- [ ] 库级分析向导（采样/手动选材/预估/结果/保存方案）。
- [ ] Inspector AI 标签 + 侧栏本地标签 + 搜索/筛选。
- [ ] 演示模式 mock。

### Phase 4：收尾（约 1 天）

- [ ] 维护任务：清理 AI 缓存。
- [ ] 文档：README、docs/usage、docs/development、docs/troubleshooting、docs/ai-tagging、CHANGELOG。
- [ ] 版本号 0.3.0。
- [ ] 单元测试 + typecheck + lint + build + 手动验收。
- [ ] 截图/UI 检查。

---

## 12. 风险与限制

| 风险 | 影响 | 应对 |
|---|---|---|
| VLM 输出不稳定/幻觉 | 标签不准 | 审核页 + 置信度 + 提示词约束 + JSON 修复 |
| ACRCloud 无结果/配额 | BGM 缺失 | 工具返回 no match；保留 B 站标签/推断来源；显示本地调用次数 |
| 纯模板模式不支持工具 | 无法用 ACRCloud | UI 明确提示；改用 OpenAI/Anthropic/Gemini 兼容模式 |
| 图片上传隐私 | 用户顾虑 | 首次确认 + 本地模型提示 + Key 加密 |
| 抽帧 CPU/磁盘占用 | 大批量卡顿 | 并发限制 + 缓存 + 清理 + 预估 |
| 模型 JSON 模式不兼容 | 解析失败 | 能力开关 + 自动回退 + 修复请求 |
| 长视频均匀取帧漏内容 | 标签不全 | v1 按确认用均匀取帧；后续可加场景检测策略 |
| B 站原始标签缺失（本地导入） | BGM 线索少 | 只用标题/简介/画面；标记来源为 inferred |
| 审核页数据量大 | 渲染卡顿 | 虚拟列表 + 分页 + 索引 |

---

## 13. 审批点

请确认以下事项后我再开始实现：

1. **页面结构**：AI 页 6 个子页签（概览/打标任务/标签审核/标签方案/模型与工具/库级分析）是否符合预期？
2. **审核页布局**：大列表行内展示封面、原始标签、3 张抽帧、按分类分组的 AI 标签、逐标签勾选 + 批量通过，是否 OK？
3. **Provider 范围**：OpenAI 兼容 + Anthropic + Gemini + 自定义；自定义支持 OpenAI/Anthropic/Gemini 兼容端点（含 ACRCloud 工具），纯模板模式除外。
4. **ACRCloud**：需要你提供 host / access key / access secret；未配置时只做 B 站标签与文本推断，是否可以？
5. **库级分析**：默认 24 条，支持手动选材；采用「文本聚类 + 代表视频视觉校验」的混合模式，是否 OK？
6. **版本与文档**：按 v0.3.0 发布，新增 `docs/ai-tagging.md`，更新 README/CHANGELOG/开发文档，是否 OK？

确认后我会按 Phase 1 → 4 实现，每完成一个阶段运行 typecheck/lint/test，并在最后做一次完整手动验收。
