# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-13

首个公开版本。

### Added

- 素材库：网格 / 列表虚拟滚动、悬停缩略图、标签 / 文件夹 / 1–5 星评分 / 备注、批量操作、回收站
- 检索：SQLite FTS5 trigram，短词自动回退 LIKE；按标签、文件夹、来源、状态筛选
- 来源：收藏夹、稍后再看、UP 主 / 合集清单同步，自动标记失效条目，封面本地缓存
- 下载：yt-dlp 队列（持久化、并发限制、暂停 / 继续 / 取消 / 重试、错误分类、进度事件）
- 播放：`bilishelf://` 协议 + Range、Artplayer、弹幕、SRT/VTT 字幕、续播进度
- 导入：视频文件 / 文件夹递归导入、ffprobe 探测、抽帧缩略图、sidecar 写入
- 维护：从 sidecar 重建索引、素材库整体迁移、数据库备份、引擎自检
- 附带油猴脚本 `bilibili-dyn-filter.user.js`（动态短视频过滤、快速收藏、悬停预览、一键下载）

### Security

- 渲染进程沙箱 + contextIsolation；文件只通过 `bilishelf://` 暴露并做路径穿越校验
- Cookie 只在主进程使用；导出给 yt-dlp 的临时 cookies 文件在任务结束后删除
- 不绕过登录态、会员 / 付费内容、地区限制或 DRM
