# 开发与打包

## 环境要求

- Node.js **>= 22.12**（本项目在 Node 22.21 / Electron 45 上开发）
- Windows 10 / 11
- 下载功能需要 `yt-dlp.exe` 与 `ffmpeg.exe` / `ffprobe.exe`（放在 PATH、`resources/bin`，或在设置里指定）

## 快速开始

```powershell
npm install
npm run dev          # 开发模式（Vite + Electron）
npm run typecheck    # 主进程 + 渲染进程类型检查
npm test             # Vitest 单元测试
npm run lint         # ESLint
npm run build        # 产物输出到 out/
npm run dist         # 打包 NSIS 安装版 + 便携版（输出到 release/）
```

> 不需要 Visual Studio：数据层使用 Electron 内置的 `node:sqlite`，没有 better-sqlite3 之类的原生模块。

## 打包成 EXE / 便携版（已内置引擎）

`npm run dist` 会产出两个文件（`release/`）：

| 产物 | 说明 |
| --- | --- |
| `BiliShelf-<版本>-setup.exe` | NSIS 安装版：可选安装目录、创建快捷方式、卸载不删素材库 |
| `BiliShelf-<版本>-portable.exe` | 便携版单文件：双击即用，无需安装 |

**运行时依赖已一起打包**，目标机器不需要装 Python / ffmpeg / yt-dlp：

```
resources/bin/           ← 打进安装包的引擎（extraResources → <app>/resources/bin）
├─ yt-dlp.exe            独立版（非 pip 的 launcher，约 23 MB）
├─ ffmpeg.exe            约 122 MB
└─ ffprobe.exe           约 121 MB
```

这些二进制没有进版本库（`.gitignore` 里忽略了 `resources/bin/`），换机器后先跑一次：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prepare-engines.ps1 -Proxy http://127.0.0.1:<端口>
# 或者指定本机 ffmpeg 目录
#   -FfmpegDir <包含 ffmpeg.exe 的目录>
```

引擎查找顺序：**设置里的自定义路径 → 内置 `resources/bin` → 系统 PATH**，所以内置引擎优先，用户仍可在设置里覆盖。

打包相关约定：

- 素材库默认位置 = 程序启动目录
  - 安装版：exe 所在目录（装在 `Program Files` 不可写时自动退回 `%APPDATA%`）
  - 便携版：**你双击的那个 `.exe` 所在目录**（读取 `PORTABLE_EXECUTABLE_DIR`，不会把库丢进临时解压目录）
- 便携版解压目录固定为 `BiliShelf`（`portable.unpackDirName`），避免每次启动重新解压
- 未配置代码签名证书时自动跳过签名；首次运行 SmartScreen 可能提示，选「仍要运行」即可
- 因为引擎有 265 MB，安装包约 130–150 MB（7z 压缩后），安装后约 350 MB

如果你想要**不带引擎的瘦身版**（让用户自备 yt-dlp/ffmpeg，或在设置里指定），把 `package.json` 里的 `extraResources` 删掉再打包即可。

## 目录结构

```
src/
├─ main/                 主进程
│  ├─ db/                node:sqlite 连接、迁移、videos/tags/sources/jobs 仓储
│  ├─ engine/            yt-dlp 进程封装、工具探测
│  ├─ services/          下载队列、来源同步、登录、媒体处理、sidecar、NFO
│  ├─ protocol.ts        bilishelf://（Range / CORS / 路径校验）
│  ├─ ipc.ts             IPC 契约与 zod 校验
│  ├─ store.ts           userData/config.json（库路径、画质、引擎路径）
│  └─ index.ts           窗口、CSP、安全策略、生命周期
├─ preload/              contextBridge 白名单 API
├─ shared/               主进程 ↔ 渲染进程类型与通道常量
└─ renderer/src/
   ├─ components/        侧栏、顶栏、网格、检查器、播放器、来源、任务、设置
   ├─ lib/               bridge（含浏览器演示数据）、格式化、弹幕解析、zustand store
   └─ App.tsx
```

## 素材库结构

```
<libraryRoot>/
├─ library.db                 SQLite 索引（可从 sidecar 重建）
├─ media/<年>/<来源>/<BV>_<CID>/
│  ├─ video.mp4
│  ├─ cover.jpg
│  ├─ subtitle.srt
│  ├─ danmaku.xml
│  ├─ movie.nfo               （可选）
│  └─ metadata.json           sidecar：标题/UP/来源/标签/文件夹/评分/备注
├─ cache/covers/              640px JPEG 封面缓存
├─ cache/thumbnails/          640px 封面缩略图 / 4 秒悬停预览
├─ cache/temp/                cookies / 下载暂存（任务结束即删）
├─ backups/
└─ logs/
```

默认库路径 = **程序启动目录**（开发模式即项目目录，打包后在 exe 同级；若不可写会退回 `%APPDATA%`）。
在「设置 → 素材库」可以一键迁移到别处（会连同 `media/`、数据库、缓存一起搬走）。

> 因为素材库就在程序目录里，`.gitignore` 已忽略 `library.db* / media / cache / backups / logs`。

## 关键设计取舍

1. **下载引擎是外设**：yt-dlp 以独立进程运行，失败/升级不影响素材库；接口变化只改 `engine/ytdlp.ts`。
2. **数据库是索引，sidecar 是真相**：`metadata.json` 随视频目录走，搬库/换机可重建。
3. **先清单后下载**：同步只拉列表与元数据，勾选后才入队；降低风控、带宽与存储压力。
4. **安全边界**：渲染进程沙箱 + contextIsolation；文件只通过 `bilishelf://` 暴露，并做路径穿越校验；Cookie 只在主进程使用，导出给 yt-dlp 的临时文件任务后删除。
5. **不绕过访问控制**：只处理当前账号可正常播放的内容；遇到会员/付费/地区限制直接跳过并提示。

## 开发工具

```powershell
npm run seed:demo     # 生成 8 个测试视频 + 缩略图并写入当前素材库（便于联调）
```

截图钩子（仅未打包时生效）：

```powershell
$env:BILISHELF_CAPTURE="$PWD\shot.png"
$env:BILISHELF_CAPTURE_JS='document.querySelector("main img")?.closest("[class*=rounded-xl]")?.dispatchEvent(new MouseEvent("click",{bubbles:true}))'
& .\node_modules\electron\dist\electron.exe .
```
