# BiliShelf

本地 B 站收藏夹素材库：**先拉清单、再选择性下载、最后像 Eagle 一样整理和播放**。

Windows 桌面 · 单机单用户 · 离线优先 · 数据全部在本机。

当前版本：**0.2.2**（2026-11-14）

![素材库预览（v0.2.2）](docs/preview-library.png)

---

## 现在能做什么

| 模块   | 已实现                                                                                  |
| ------ | --------------------------------------------------------------------------------------- |
| 素材库 | 网格 / 列表虚拟滚动、封面虚化背景、搜索、批量选择、评分 / 标签 / 备注                   |
| 来源   | 收藏夹、稍后再看、UP 主 / 合集；先同步清单，再选择性下载；支持「全部下载」与进度 / 取消 |
| 下载   | yt-dlp 队列、最高画质、暂存替换、画质升级、已下载去重                                   |
| 播放   | 本地 `bilishelf://` 播放、弹幕、SRT/VTT 字幕、续播进度                                  |
| 整理   | 标签、文件夹、1–5 星评分、备注、回收站                                                  |
| 维护   | 重建索引、搬库、补全 cid / 弹幕、悬停预览、封面压缩 / 缩略图、冗余清理                  |
| 外观   | 深色 / 浅色主题、透明侧边栏、封面虚化强度 / 不透明度 / 暗化可调                         |

## 下载 / 安装

从 [GitHub Releases](https://github.com/YYY7C/BiliShelf/releases) 下载：

| 产物                            | 说明                                                |
| ------------------------------- | --------------------------------------------------- |
| `BiliShelf-<版本>-setup.exe`    | NSIS 安装版：可选目录、创建快捷方式，卸载不删素材库 |
| `BiliShelf-<版本>-portable.exe` | 便携版单文件：双击即用，素材库放在 exe 同级         |

安装包已内置 yt-dlp / ffmpeg / ffprobe，目标机器无需额外安装。未配置代码签名，首次运行 SmartScreen 可能提示，选「仍要运行」即可。

## 从源码运行

要求 Node.js **>= 22.12**、Windows 10 / 11：

```powershell
npm install
npm run dev
```

完整环境、测试、打包与目录结构见 [docs/development.md](docs/development.md)。

## 文档

| 文档                                | 内容                                        |
| ----------------------------------- | ------------------------------------------- |
| [使用与快捷键](docs/usage.md)       | 快捷键、侧栏作用域、整理与修复、外观设置    |
| [开发与打包](docs/development.md)   | 环境要求、命令、NSIS / 便携版打包、目录结构 |
| [实测状态](docs/status.md)          | 已跑通链路、维护实测、未验证项              |
| [排障记录](docs/troubleshooting.md) | 下载、封面、弹幕、画质升级等踩坑记录        |
| [油猴脚本](docs/userscript.md)      | B 站动态短视频过滤 / 快速收藏脚本           |
| [CHANGELOG.md](CHANGELOG.md)        | 版本变化                                    |

## 使用边界

本项目是**非官方个人工具**，与哔哩哔哩无任何关联。仅用于备份你自己有权访问的内容：

- 不绕过登录态、会员/付费/充电内容、地区限制或 DRM；
- 不实现/传播签名与风控绕过，不高并发抓取；
- 不提供分享、再分发或公开服务；
- 请遵守平台用户协议与著作权法规，风险自负。

如果只想做备份而不需要整理：直接用 `bili-sync` + Eagle/Billfish 的组合更省事；本项目的价值在于“选择性同步 + 素材库体验”。

## 参考资料

- 预研文档：[docs/bili-shelf-pre-research.html](docs/bili-shelf-pre-research.html)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [Artplayer](https://github.com/zhw2590582/ArtPlayer) · [Danmaku.js](https://github.com/weizhenye/Danmaku)
- [bili-sync](https://github.com/amtoaer/bili-sync)（同步/调度参考）

## License

[MIT](LICENSE)
