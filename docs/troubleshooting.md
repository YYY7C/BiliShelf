# 排障记录

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 收藏夹接口 `code:0` 但 `data:null` | 请求带了 `Origin` 头，被平台按跨域处理 | API 请求只带 `Referer`，不加 `Origin` |
| 下载进度 100% 但任务失败，`ERROR:` 后无内容 | CDN 对「非浏览器 UA + 单次长连接整文件下载」返回 `403/567` | yt-dlp 固定携带浏览器 UA，并加 `--http-chunk-size 1M` 分块请求 |
| 来源清单封面空白 | 封面是 `http://` 被 CSP 拦截；或 CDN 抖动、离线 | 入库统一升级 https；同步后把封面缓存到 `cache/covers/`，列表改用 `bilishelf://cover/<id>` |
| 来源封面全部显示为破图 | B 站 CDN 对 `localhost` / `file://` 的 Referer 返回 403 | 页面加 `<meta name="referrer" content="no-referrer">`，图片请求不带 Referer |
| 取消下载后留下半截文件 | 用了 `--no-part`，中断的 mp4 看起来是完整的 | 改回 `.part` 临时文件；取消时若目录里没有完整视频，整目录删除（含封面/字幕/info） |
| 重新加入队列没反应 | 上次中断的任务被标记为 `paused`，`enqueue` 直接跳过 | 暂停中的任务再次入队时自动恢复 |
| 下载被中途打断 | 上一次残留的 `BILISHELF_CAPTURE` 环境变量让应用自动退出 | 调试钩子只在显式设置时生效，跑下载前清空相关变量 |
| 截图里圆角背景“变高/错位” | `capturePage()` 在 Windows 125% 缩放下偶发的合成偏差，不是真实渲染问题 | 视觉验收改用系统级 `PrintWindow` 截图 |
| 弹幕一直为空、sidecar 里 cid 是 `null` | yt-dlp 的 `info.json` 不包含 `cid`，旧版本直接读了不存在的字段 | 下载后用 `x/web-interface/view` 补 cid；设置 → 整理与修复 →「补全 cid / 弹幕」可回填旧视频 |
| 4K 显示成 `2160P`、竖屏 1080×1920 显示成 `1920P` | 分辨率标签只用了 `height` | 统一用短边 + `4K / 2K / 1080P / 720P` 映射，竖屏追加「竖屏」 |
| 封面缓存占用越来越大 | 缓存的是 B 站原图（平均 ~600KB） | 缓存时压成 640px JPEG；设置 →「压缩封面缓存」可重建旧缓存 |
| 素材库卡片显示视频画面而不是 B 站封面 | 卡片优先用 `thumb`，旧版本把视频抽帧存成了 `thumb` | 下载时改为从 `cover.jpg` 生成 640px 缩略图；旧库用「重建封面缩略图」修复 |
| 下载失败 / 取消后 media 里留下半截文件 | 直接下载到正式目录 | 先下载到 `cache/temp/downloads/job-<id>`，成功后才提升；取消时清理暂存 |
| 画质升级后视频多嵌套一层 `upgrade-<id>/` | 升级任务直接用了子目录作为输出目录 | 所有任务统一走暂存目录，成功后按 `BV_CID` 正式目录替换旧文件 |
| 播放器弹幕报 `Cannot read properties of undefined (reading 'context')` | 弹幕层在 Artplayer 初始化前挂载，canvas 引擎拿不到 2D context | 弹幕层改到播放器初始化后挂载，并切换到 DOM 引擎 |
