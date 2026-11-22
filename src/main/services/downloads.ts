import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import type { EnqueueInput, JobsSnapshot } from '@shared/types';
import { qualityLabelText } from '@shared/format';
import { mapYtdlpError, shouldAutoRetry } from '@shared/ytdlp';
import { ensureLibraryDirs, fromLibraryRelative, isInside, libraryPaths, safeSegment, toLibraryRelative } from '../paths';
import { getSettings } from '../store';
import * as jobsRepo from '../db/jobs';
import type { JobRow } from '../db/jobs';
import { one, run } from '../db/index';
import {
  assignTagByName,
  getVideoRow,
  listAssets,
  setAsset,
  setVideoMetadata,
  upsertVideo,
  videoKeyFor
} from '../db/videos';
import { getRemoteItem, getSource } from '../db/sources';
import { deleteCookiesFile, exportCookiesFile } from './auth';
import { downloadVideo, findDownloadedVideo, findSidecarFiles } from '../engine/ytdlp';
import { makeCoverThumbnail, makeThumbnail, probeMedia } from './media';
import { fetchDanmakuXml, fetchVideoMeta } from './biliApi';
import { generatePreview, writeSidecar } from './library';
import { writeNfo } from './nfo';

type Intent = 'cancel' | 'pause';
type VideoRow = NonNullable<ReturnType<typeof getVideoRow>>;

interface InfoJson {
  title?: string;
  description?: string;
  uploader?: string;
  uploader_id?: string;
  tags?: string[];
  timestamp?: number;
  cid?: number;
}

function now(): string {
  return new Date().toISOString();
}

function buildUrl(bvid: string, page: number): string {
  return page > 1
    ? `https://www.bilibili.com/video/${bvid}?p=${page}`
    : `https://www.bilibili.com/video/${bvid}`;
}

/** 取消时清掉未完成的临时文件，避免留下看起来完整的半截视频。 */
function cleanupPartials(dir: string): void {
  try {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (/\.(part|ytdl|temp|download)$/i.test(name)) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
    // 没有完整视频（只剩封面 / 字幕 / info）就把整个任务目录删掉
    if (!findDownloadedVideo(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch (error) {
    log.debug('[downloads] cleanup partials failed', (error as Error).message);
  }
}

/**
 * 下载先落在 cache/temp/downloads/job-<id>，成功后再提升到正式目录。
 * 这样取消/失败不会污染 media，替换旧文件时也能先拿到完整的新文件。
 */
function promoteDownload(stagingDir: string, baseDir: string): { videoFile: string } {
  const video = findDownloadedVideo(stagingDir);
  if (!video) throw new Error('下载完成但未找到视频文件');

  fs.mkdirSync(baseDir, { recursive: true });
  for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
    const source = path.join(stagingDir, entry.name);
    const target = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(source, target, { recursive: true, force: true });
      fs.rmSync(source, { recursive: true, force: true });
      continue;
    }
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    try {
      fs.renameSync(source, target);
    } catch {
      fs.copyFileSync(source, target);
      fs.rmSync(source, { force: true });
    }
  }
  return { videoFile: path.join(baseDir, path.basename(video)) };
}

function removeStaging(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    log.debug('[downloads] remove staging failed', (error as Error).message);
  }
}

/** 只删除素材库内的文件，避免误删用户手动移动出去的文件。 */
async function removeLibraryFile(root: string, relative: string | null): Promise<void> {
  if (!relative) return;
  const absolute = fromLibraryRelative(root, relative);
  if (!isInside(root, absolute)) return;
  await fsp.rm(absolute, { force: true }).catch(() => undefined);
}

class DownloadManager {
  private children = new Map<number, ReturnType<typeof downloadVideo>['child']>();
  private intents = new Map<number, Intent>();
  private listeners = new Set<(snapshot: JobsSnapshot) => void>();
  private libraryListeners = new Set<() => void>();
  private retryTimers = new Map<number, { timer: NodeJS.Timeout; message: string }>();
  private pumping = false;
  private started = false;
  private stopping = false;

  onChange(listener: (snapshot: JobsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 下载入库后通知渲染层刷新素材库（下载服务不能直接 import ipc，避免循环依赖）。 */
  onLibraryChanged(listener: () => void): () => void {
    this.libraryListeners.add(listener);
    return () => this.libraryListeners.delete(listener);
  }

  private notifyLibraryChanged(): void {
    for (const listener of this.libraryListeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }

  private emit(): void {
    const snapshot: JobsSnapshot = {
      items: jobsRepo.listJobs(),
      total: jobsRepo.jobTotalCount(),
      counts: jobsRepo.jobStatusCounts()
    };
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore listener errors
      }
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const recovered = jobsRepo.recoverInterruptedJobs();
    if (recovered > 0) log.info('[downloads] recovered interrupted jobs', recovered);
    const pruned = jobsRepo.pruneFinishedJobs(7);
    if (pruned > 0) log.info('[downloads] pruned old finished jobs', pruned);
    this.pump();
  }

  enqueue(inputs: EnqueueInput[], options: { defer?: boolean } = {}): { queued: number; skipped: number } {
    const quality = getSettings().defaultQuality;
    let queued = 0;
    let skipped = 0;

    for (const input of inputs) {
      const page = input.page ?? 1;
      const cid = input.cid ?? null;
      const key = videoKeyFor(input.bvid, page);

      const existing = jobsRepo.findActiveJob(key);
      if (existing) {
        // 暂停中的任务：重新加入队列时直接恢复，而不是静默跳过
        if (existing.status === 'paused') {
          jobsRepo.updateJob(existing.id, {
            status: 'queued',
            progress: 0,
            speed: null,
            eta: null,
            errorCode: null,
            errorMessage: null
          });
          queued += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      const remote = input.remoteItemId ? getRemoteItem(input.remoteItemId) : null;
      jobsRepo.createJob({
        videoKey: key,
        bvid: input.bvid,
        cid,
        page,
        title: input.title || remote?.title || input.bvid,
        sourceId: input.sourceId ?? remote?.source_id ?? null,
        remoteItemId: input.remoteItemId ?? null,
        quality: input.quality ?? quality,
        upgradeVideoId: input.upgradeVideoId ?? null,
        priority: input.priority ?? 0
      });
      queued += 1;
    }

    if (queued > 0 && !options.defer) this.flush();
    return { queued, skipped };
  }

  /** 批量入队后统一触发一次刷新与调度。 */
  flush(): void {
    this.emit();
    this.pump();
  }

  pause(id: number): void {
    const job = jobsRepo.getJob(id);
    if (!job) return;
    if (job.status === 'queued') {
      jobsRepo.updateJob(id, { status: 'paused' });
      this.emit();
      return;
    }
    const child = this.children.get(id);
    if (child) {
      this.intents.set(id, 'pause');
      child.kill();
    } else if (job.status === 'resolving' || job.status === 'downloading') {
      // 子进程尚未创建（例如正在导出 cookies），由 run() 启动前检查并暂停。
      this.intents.set(id, 'pause');
    }
    this.emit();
  }

  resume(id: number): void {
    const job = jobsRepo.getJob(id);
    if (!job) return;
    if (job.status !== 'paused' && job.status !== 'failed' && job.status !== 'canceled') return;
    this.clearRetryTimer(id);
    jobsRepo.updateJob(id, {
      status: 'queued',
      errorCode: null,
      errorMessage: null,
      progress: 0
    });
    this.emit();
    this.pump();
  }

  /** 暂停所有排队与正在下载的任务；后处理中的任务短暂且不可中断，让其完成。 */
  pauseAll(): number {
    for (const id of [...this.retryTimers.keys()]) this.clearRetryTimer(id);
    let paused = jobsRepo.pauseQueuedJobs();
    for (const id of jobsRepo.listRunningJobIds()) {
      const job = jobsRepo.getJob(id);
      if (!job || (job.status !== 'resolving' && job.status !== 'downloading')) continue;
      this.intents.set(id, 'pause');
      this.children.get(id)?.kill();
      paused += 1;
    }
    this.emit();
    return paused;
  }

  /** 只恢复暂停中的任务，失败/取消的任务仍需单独重试。 */
  resumeAll(): number {
    const resumed = jobsRepo.resumePausedJobs();
    if (resumed > 0) {
      this.emit();
      this.pump();
    }
    return resumed;
  }

  /** 一键重试全部失败任务（含等待自动重试的），常用于 CDN 抖动 / 改代理后重来一遍。 */
  retryAllFailed(): number {
    for (const id of [...this.retryTimers.keys()]) this.clearRetryTimer(id, false);
    const retried = jobsRepo.requeueFailedJobs();
    if (retried > 0) {
      this.emit();
      this.pump();
    }
    return retried;
  }

  cancel(id: number): void {
    const job = jobsRepo.getJob(id);
    if (!job) return;
    this.clearRetryTimer(id);
    this.intents.set(id, 'cancel');
    const child = this.children.get(id);
    if (child) {
      child.kill();
      return;
    }
    jobsRepo.updateJob(id, { status: 'canceled', finishedAt: now(), speed: null, eta: null });
    this.emit();
  }

  retry(id: number): void {
    const job = jobsRepo.getJob(id);
    if (!job) return;
    this.clearRetryTimer(id);
    jobsRepo.updateJob(id, {
      status: 'queued',
      attempts: 0,
      progress: 0,
      errorCode: null,
      errorMessage: null
    });
    this.emit();
    this.pump();
  }

  clearFinished(): void {
    jobsRepo.clearFinishedJobs();
    this.emit();
  }

  /**
   * 取消排队中的自动重试。`restore` 为 true 时把任务说明还原成原始错误，
   * 避免任务列表里一直显示「将在 N 秒后重试」。
   */
  private clearRetryTimer(id: number, restore = true): void {
    const pending = this.retryTimers.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.retryTimers.delete(id);
    if (restore) {
      try {
        jobsRepo.updateJob(id, { errorMessage: pending.message.slice(0, 500) });
      } catch {
        // ignore
      }
    }
  }

  /**
   * 网络类失败自动重试。mcdn 超时、HTTP 424、断流基本都是「这一次的连接/节点不行」，
   * 重新跑一次 yt-dlp 会重新解析出新的 CDN 地址，成功率很高。
   * 412 风控 / 会员无权限 / 已下架 / 磁盘满不重试，避免越试越糟。
   */
  private scheduleAutoRetry(
    job: JobRow,
    stagingDir: string,
    code: string,
    message: string
  ): boolean {
    const limit = getSettings().downloadAutoRetry;
    const attempts = job.attempts ?? 0;
    if (!shouldAutoRetry(code, attempts, limit)) return false;

    const next = attempts + 1;
    const delay = 5000 * next;
    // 半截文件会让下一轮把它当作可续传的 .part，先清掉更保险
    cleanupPartials(stagingDir);
    jobsRepo.updateJob(job.id, {
      status: 'failed',
      attempts: next,
      errorCode: code,
      errorMessage: `第 ${next}/${limit} 次自动重试将在 ${Math.round(delay / 1000)} 秒后开始：${message}`.slice(0, 500),
      speed: null,
      eta: null,
      finishedAt: null
    });
    this.emit();

    const timer = setTimeout(() => {
      this.retryTimers.delete(job.id);
      const current = jobsRepo.getJob(job.id);
      // 用户中途手动取消/暂停/重试过就不要自动排队了
      if (!current || current.status !== 'failed' || current.attempts !== next) return;
      jobsRepo.updateJob(job.id, { status: 'queued', progress: 0, errorCode: null, errorMessage: null });
      this.emit();
      this.pump();
    }, delay);
    timer.unref?.();
    this.retryTimers.set(job.id, { timer, message });
    return true;
  }

  /** 退出前调用：终止子进程并把运行中的任务标记为暂停，避免留下孤儿 yt-dlp。 */
  shutdown(): void {
    this.stopping = true;
    for (const { timer } of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const [id, child] of this.children) {
      try {
        child.kill();
      } catch {
        // ignore
      }
      try {
        jobsRepo.updateJob(id, { status: 'paused', speed: null, eta: null });
      } catch {
        // ignore
      }
    }
    this.children.clear();
    this.intents.clear();
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const limit = getSettings().concurrency;
      for (let guard = 0; guard < 10; guard += 1) {
        if (jobsRepo.activeJobCount() >= limit) break;
        const next = jobsRepo.nextQueuedJob();
        if (!next) break;
        jobsRepo.markStarted(next.id);
        void this.run(next);
      }
    } finally {
      this.pumping = false;
      this.emit();
    }
  }

  private async run(job: JobRow): Promise<void> {
    const paths = ensureLibraryDirs(libraryPaths());
    const source = job.source_id ? getSource(job.source_id) : null;
    const upDir = safeSegment(source?.title || '未分类', '未分类', 60);
    const cidPart = job.cid ? String(job.cid) : `p${job.page}`;
    const baseDir = path.join(paths.media, new Date().getFullYear().toString(), upDir, `${job.bvid}_${cidPart}`);
    const stagingDir = path.join(paths.temp, 'downloads', `job-${job.id}`);
    fs.mkdirSync(stagingDir, { recursive: true });

    const existingVideo = one<{ id: number; file_path: string | null }>(
      'SELECT id, file_path FROM videos WHERE video_key = ?',
      [job.video_key]
    );
    const replaceVideoId = job.upgrade_video_id ?? existingVideo?.id ?? null;
    const oldVideo: VideoRow | undefined = replaceVideoId ? getVideoRow(replaceVideoId) : undefined;
    const oldAssets = replaceVideoId ? listAssets(replaceVideoId) : [];

    let cookiesFile: string | null = null;
    let lastEmit = 0;

    try {
      cookiesFile = await exportCookiesFile();
      if (this.intents.get(job.id) === 'pause') {
        this.intents.delete(job.id);
        jobsRepo.updateJob(job.id, { status: 'paused', speed: null, eta: null });
        this.emit();
        return;
      }
      const { child, done } = downloadVideo({
        url: buildUrl(job.bvid, job.page),
        outputDir: stagingDir,
        quality: job.quality,
        preferHighestBitrate: Boolean(job.upgrade_video_id),
        cookiesFile,
        proxy: getSettings().downloadProxy,
        onProgress: (progress) => {
          const ratio = progress.total > 0 ? progress.downloaded / progress.total : 0;
          const timestamp = Date.now();
          if (timestamp - lastEmit < 500) return;
          lastEmit = timestamp;
          jobsRepo.updateJob(job.id, {
            progress: Number.isFinite(ratio) ? ratio : 0,
            speed: progress.speed || null,
            eta: progress.eta || null
          });
          this.emit();
        },
        onLog: (line) => log.debug('[ytdlp]', job.id, line.slice(0, 200))
      });

      this.children.set(job.id, child);
      const outcome = await done;
      this.children.delete(job.id);
      if (this.stopping) return;

      const intent = this.intents.get(job.id);
      this.intents.delete(job.id);

      if (intent === 'cancel' || outcome.canceled) {
        if (intent === 'pause') {
          jobsRepo.updateJob(job.id, { status: 'paused', speed: null, eta: null });
        } else {
          jobsRepo.updateJob(job.id, { status: 'canceled', finishedAt: now(), speed: null, eta: null });
          cleanupPartials(stagingDir);
        }
        this.emit();
        return;
      }

      if (outcome.code !== 0) {
        const mapped = mapYtdlpError(outcome.stderr);
        // 会员/付费/充电专属：把清单条目标成「充电专属」，避免反复重试
        if (mapped.code === 'FORBIDDEN' && job.remote_item_id) {
          run("UPDATE remote_items SET state = 'paid' WHERE id = ? AND state = 'available'", [job.remote_item_id]);
        }
        // 网络类失败（mcdn 超时 / 424 / 断流）绝大多数重试一次就好，且重试会重新解析出新的 CDN 地址
        const retried = this.scheduleAutoRetry(job, stagingDir, mapped.code, mapped.message);
        if (!retried) jobsRepo.markFailed(job.id, mapped.code, mapped.message);
        log.warn('[downloads] failed', job.id, mapped.code, mapped.message, retried ? '(auto retry scheduled)' : '');
        this.emit();
        return;
      }

      jobsRepo.updateJob(job.id, { status: 'postprocessing', progress: 1, speed: null, eta: null });
      this.emit();

      const { videoFile } = promoteDownload(stagingDir, baseDir);
      const videoId = await this.ingest(job, baseDir, videoFile);
      await this.cleanupReplacedFiles(paths.root, oldVideo, oldAssets, videoId, baseDir);
      removeStaging(stagingDir);

      jobsRepo.markDone(job.id);
      this.notifyLibraryChanged();
      this.emit();
    } catch (error) {
      if (this.stopping) return;
      const message = error instanceof Error ? error.message : String(error);
      jobsRepo.markFailed(job.id, 'INTERNAL', message);
      log.error('[downloads] job error', job.id, message);
      this.emit();
    } finally {
      await deleteCookiesFile(cookiesFile);
      this.children.delete(job.id);
      if (!this.stopping) this.pump();
    }
  }

  /** 替换旧版本后清理旧文件、旧封面/字幕与旧 sidecar；新文件已经在正式目录。 */
  private async cleanupReplacedFiles(
    root: string,
    oldVideo: VideoRow | undefined,
    oldAssets: Array<{ type: string; path: string }>,
    videoId: number,
    baseDir: string
  ): Promise<void> {
    if (!oldVideo) return;
    const newRow = getVideoRow(videoId);
    if (oldVideo.file_path && oldVideo.file_path !== newRow?.file_path) {
      await removeLibraryFile(root, oldVideo.file_path);
    }
    const newPaths = new Set(listAssets(videoId).map((asset) => asset.path));
    for (const asset of oldAssets) {
      if (!newPaths.has(asset.path)) await removeLibraryFile(root, asset.path);
    }
    if (!oldVideo.file_path) return;

    const oldDir = path.dirname(fromLibraryRelative(root, oldVideo.file_path));
    if (!isInside(root, oldDir) || path.resolve(oldDir) === path.resolve(baseDir)) return;
    // 旧目录里的 sidecar 指向已删除的旧文件，重建索引时会把新视频误标为 missing
    await fsp.rm(path.join(oldDir, 'metadata.json'), { force: true }).catch(() => undefined);
    await fsp.rm(path.join(oldDir, 'movie.nfo'), { force: true }).catch(() => undefined);
    await fsp.rmdir(oldDir).catch(() => undefined);
  }

  private async ingest(job: JobRow, outputDir: string, videoFile: string): Promise<number> {
    const paths = libraryPaths();
    const probe = await probeMedia(videoFile);
    const stat = await fsp.stat(videoFile);
    const files = findSidecarFiles(outputDir);

    let info: InfoJson | null = null;
    if (files.infoJson) {
      try {
        info = JSON.parse((await fsp.readFile(files.infoJson, 'utf8')).replace(/^\uFEFF/, '')) as InfoJson;
      } catch {
        info = null;
      }
    }

    const meta = job.bvid ? await fetchVideoMeta(job.bvid, job.page).catch(() => null) : null;
    const remote = job.remote_item_id ? getRemoteItem(job.remote_item_id) : null;
    const cid = job.cid ?? meta?.cid ?? info?.cid ?? null;
    const upName = info?.uploader ?? meta?.upName ?? remote?.up_name ?? null;
    const oldVideo = job.upgrade_video_id ? getVideoRow(job.upgrade_video_id) : undefined;
    // 去重键必须与清单条目一致：收藏夹接口没有 cid，统一用 0 占位；
    // cid 只用于弹幕和分 P 元数据，不参与收藏夹条目的去重键。
    const videoKey = oldVideo?.video_key ?? videoKeyFor(job.bvid, job.page);

    const videoId = upsertVideo({
      videoKey,
      origin: 'bilibili',
      bvid: job.bvid,
      cid,
      page: job.page,
      title: info?.title ?? meta?.title ?? job.title,
      upName,
      upMid: remote?.up_mid ?? meta?.upMid ?? null,
      description: info?.description ?? meta?.description ?? null,
      coverUrl: remote?.cover_url ?? meta?.coverUrl ?? null,
      sourceId: job.source_id,
      remoteItemId: job.remote_item_id,
      filePath: toLibraryRelative(paths.root, videoFile),
      fileSize: stat.size,
      duration: probe?.duration ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      vcodec: probe?.vcodec ?? null,
      acodec: probe?.acodec ?? null,
      bitrate: probe?.bitrate ?? null,
      container: probe?.container ?? null,
      qualityLabel: qualityLabelText(probe?.width ?? null, probe?.height ?? null),
      status: 'present'
    });

    setAsset(videoId, 'video', toLibraryRelative(paths.root, videoFile), stat.size, 'video/mp4');

    // 封面：优先使用 yt-dlp 下载的原图，其次抽帧；正式目录只保留 cover.jpg
    let coverPath: string | null = null;
    if (files.thumbnail) {
      try {
        coverPath = path.join(outputDir, 'cover.jpg');
        if (path.resolve(files.thumbnail) !== path.resolve(coverPath)) {
          await fsp.copyFile(files.thumbnail, coverPath);
        }
        if (fs.existsSync(coverPath)) {
          setAsset(
            videoId,
            'cover',
            toLibraryRelative(paths.root, coverPath),
            fs.statSync(coverPath).size,
            'image/jpeg'
          );
        }
      } catch (error) {
        log.warn('[downloads] cover copy failed', (error as Error).message);
      }
    }

    // 卡片优先展示封面原图缩略图；没有封面（如本地导入）才退回视频抽帧
    const thumbWebp = path.join(paths.thumbs, `v${videoId}.webp`);
    const thumbOk =
      coverPath && fs.existsSync(coverPath)
        ? await makeCoverThumbnail(coverPath, thumbWebp)
        : await makeThumbnail(videoFile, thumbWebp, probe?.duration ?? null);
    if (thumbOk) {
      const finalThumb = fs.existsSync(thumbWebp) ? thumbWebp : thumbWebp.replace(/\.webp$/i, '.jpg');
      if (fs.existsSync(finalThumb)) {
        setAsset(
          videoId,
          'thumb',
          toLibraryRelative(paths.root, finalThumb),
          fs.statSync(finalThumb).size,
          'image/webp'
        );
        const staleThumb = finalThumb === thumbWebp ? thumbWebp.replace(/\.webp$/i, '.jpg') : thumbWebp;
        if (staleThumb !== finalThumb) await fsp.rm(staleThumb, { force: true }).catch(() => undefined);
      }
    }

    if (files.subtitles.length > 0) {
      const subtitle = files.subtitles[0]!;
      setAsset(
        videoId,
        'subtitle',
        toLibraryRelative(paths.root, subtitle),
        fs.statSync(subtitle).size,
        subtitle.endsWith('.srt') ? 'text/plain' : 'text/vtt'
      );
    }

    if (cid) {
      const xml = await fetchDanmakuXml(cid);
      if (xml) {
        const danmakuPath = path.join(outputDir, 'danmaku.xml');
        await fsp.writeFile(danmakuPath, xml, 'utf8');
        setAsset(
          videoId,
          'danmaku',
          toLibraryRelative(paths.root, danmakuPath),
          Buffer.byteLength(xml),
          'application/xml'
        );
      }
    }

    const settings = getSettings();
    if (settings.autoTagSource && job.source_id) {
      const sourceRow = getSource(job.source_id);
      if (sourceRow) assignTagByName(videoId, sourceRow.title, 'auto');
    }
    if (settings.autoTagUp && upName) {
      assignTagByName(videoId, upName, 'auto');
    }
    if (settings.autoTagZone && info?.tags?.length) {
      info.tags.slice(0, 8).forEach((tag) => assignTagByName(videoId, tag, 'auto'));
    }

    if (settings.generatePreview) {
      try {
        await generatePreview(videoId);
      } catch (error) {
        log.debug('[downloads] preview failed', (error as Error).message);
      }
    }

    // info.json 与原始缩略图已经入库为 sidecar / cover.jpg，不再保留副本
    if (files.infoJson) await fsp.rm(files.infoJson, { force: true }).catch(() => undefined);
    if (files.thumbnail && coverPath && path.resolve(files.thumbnail) !== path.resolve(coverPath)) {
      await fsp.rm(files.thumbnail, { force: true }).catch(() => undefined);
    }

    if (settings.writeNfo) writeNfo(videoId);
    await writeSidecar(videoId);

    setVideoMetadata(videoId, { status: 'present' });
    // 新文件需要重新检查画质
    run('UPDATE videos SET quality_checked_at = NULL WHERE id = ?', [videoId]);
    return videoId;
  }
}

export const downloadManager = new DownloadManager();
