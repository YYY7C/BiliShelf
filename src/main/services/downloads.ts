import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import type { DownloadJob, EnqueueInput } from '@shared/types';
import { ensureLibraryDirs, libraryPaths, safeSegment, toLibraryRelative } from '../paths';
import { getSettings } from '../store';
import * as jobsRepo from '../db/jobs';
import type { JobRow } from '../db/jobs';
import {
  assignTagByName,
  setAsset,
  setVideoMetadata,
  upsertVideo,
  videoKeyFor
} from '../db/videos';
import { getRemoteItem, getSource } from '../db/sources';
import { deleteCookiesFile, exportCookiesFile } from './auth';
import { downloadVideo, findDownloadedVideo, findSidecarFiles } from '../engine/ytdlp';
import { makeThumbnail, probeMedia } from './media';
import { fetchDanmakuXml } from './biliApi';
import { writeSidecar } from './library';
import { writeNfo } from './nfo';

type Intent = 'cancel' | 'pause';

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

function mapError(stderr: string): { code: string; message: string } {
  const text = stderr || '';
  if (/412|Too Many Requests|请求过于频繁/i.test(text)) {
    return { code: 'RATE_LIMIT', message: '触发平台限流（412）。已停止该任务，请降低并发或稍后再试。' };
  }
  if (/-352|-799|风控|risk/i.test(text)) {
    return { code: 'RATE_LIMIT', message: '触发平台风控。请不要连续重试，稍后再试。' };
  }
  if (/大会员|会员|premium|vip|付费|充电/i.test(text)) {
    return { code: 'FORBIDDEN', message: '当前账号无权限获取该内容（会员/付费/充电专属），已跳过。' };
  }
  if (/不存在|已删除|404|not found|unavailable/i.test(text)) {
    return { code: 'NOT_FOUND', message: '内容不存在或已下架。' };
  }
  if (/ENOSPC|no space/i.test(text)) {
    return { code: 'DISK', message: '磁盘空间不足。' };
  }
  return { code: 'DOWNLOAD', message: text.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || '下载失败' };
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

class DownloadManager {
  private children = new Map<number, ReturnType<typeof downloadVideo>['child']>();
  private intents = new Map<number, Intent>();
  private listeners = new Set<(jobs: DownloadJob[]) => void>();
  private pumping = false;
  private started = false;
  private stopping = false;

  onChange(listener: (jobs: DownloadJob[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const jobs = jobsRepo.listJobs();
    for (const listener of this.listeners) {
      try {
        listener(jobs);
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
    this.pump();
  }

  enqueue(inputs: EnqueueInput[]): { queued: number; skipped: number } {
    const quality = getSettings().defaultQuality;
    let queued = 0;
    let skipped = 0;

    for (const input of inputs) {
      const page = input.page ?? 1;
      const cid = input.cid ?? null;
      const key = videoKeyFor(input.bvid, cid, page);

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
        quality: input.quality ?? quality
      });
      queued += 1;
    }

    if (queued > 0) {
      this.emit();
      this.pump();
    }
    return { queued, skipped };
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
    }
    this.emit();
  }

  resume(id: number): void {
    const job = jobsRepo.getJob(id);
    if (!job) return;
    if (job.status !== 'paused' && job.status !== 'failed' && job.status !== 'canceled') return;
    jobsRepo.updateJob(id, {
      status: 'queued',
      errorCode: null,
      errorMessage: null,
      progress: 0
    });
    this.emit();
    this.pump();
  }

  cancel(id: number): void {
    const job = jobsRepo.getJob(id);
    if (!job) return;
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

  /** 退出前调用：终止子进程并把运行中的任务标记为暂停，避免留下孤儿 yt-dlp。 */
  shutdown(): void {
    this.stopping = true;
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
    const outputDir = path.join(paths.media, new Date().getFullYear().toString(), upDir, `${job.bvid}_${cidPart}`);
    fs.mkdirSync(outputDir, { recursive: true });

    let cookiesFile: string | null = null;
    let lastEmit = 0;

    try {
      cookiesFile = await exportCookiesFile();
      const { child, done } = downloadVideo({
        url: buildUrl(job.bvid, job.page),
        outputDir,
        quality: job.quality,
        cookiesFile,
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
          cleanupPartials(outputDir);
        }
        this.emit();
        return;
      }

      if (outcome.code !== 0) {
        const mapped = mapError(outcome.stderr);
        jobsRepo.markFailed(job.id, mapped.code, mapped.message);
        log.warn('[downloads] failed', job.id, mapped.code, mapped.message);
        this.emit();
        return;
      }

      jobsRepo.updateJob(job.id, { status: 'postprocessing', progress: 1, speed: null, eta: null });
      this.emit();

      await this.ingest(job, outputDir);
      jobsRepo.markDone(job.id);
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

  private async ingest(job: JobRow, outputDir: string): Promise<void> {
    const paths = libraryPaths();
    const videoFile = findDownloadedVideo(outputDir);
    if (!videoFile) throw new Error('下载完成但未找到视频文件');

    const probe = await probeMedia(videoFile);
    const stat = await fsp.stat(videoFile);
    const files = findSidecarFiles(outputDir);

    let info: InfoJson | null = null;
    if (files.infoJson) {
      try {
        info = JSON.parse(await fsp.readFile(files.infoJson, 'utf8')) as InfoJson;
      } catch {
        info = null;
      }
    }

    const remote = job.remote_item_id ? getRemoteItem(job.remote_item_id) : null;
    const upName = info?.uploader ?? remote?.up_name ?? null;
    const cid = job.cid ?? info?.cid ?? null;
    const videoKey = videoKeyFor(job.bvid, cid, job.page);

    const videoId = upsertVideo({
      videoKey,
      origin: 'bilibili',
      bvid: job.bvid,
      cid,
      page: job.page,
      title: info?.title ?? job.title,
      upName,
      upMid: remote?.up_mid ?? null,
      description: info?.description ?? null,
      coverUrl: remote?.cover_url ?? null,
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
      qualityLabel: probe?.height ? `${probe.height}P` : null,
      status: 'present'
    });

    setAsset(videoId, 'video', toLibraryRelative(paths.root, videoFile), stat.size, 'video/mp4');

    // 封面：优先使用 yt-dlp 下载的原图，其次抽帧
    if (files.thumbnail) {
      try {
        const coverPath = path.join(outputDir, 'cover.jpg');
        if (path.resolve(files.thumbnail) !== path.resolve(coverPath)) {
          await fsp.copyFile(files.thumbnail, coverPath);
        }
        if (fs.existsSync(coverPath)) {
          setAsset(videoId, 'cover', toLibraryRelative(paths.root, coverPath), fs.statSync(coverPath).size, 'image/jpeg');
        }
      } catch (error) {
        log.warn('[downloads] cover copy failed', (error as Error).message);
      }
    }

    const thumbWebp = path.join(paths.thumbs, `v${videoId}.webp`);
    if (await makeThumbnail(videoFile, thumbWebp, probe?.duration ?? null)) {
      const finalThumb = fs.existsSync(thumbWebp) ? thumbWebp : thumbWebp.replace(/\.webp$/i, '.jpg');
      if (fs.existsSync(finalThumb)) {
        setAsset(videoId, 'thumb', toLibraryRelative(paths.root, finalThumb), fs.statSync(finalThumb).size, 'image/webp');
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
        setAsset(videoId, 'danmaku', toLibraryRelative(paths.root, danmakuPath), Buffer.byteLength(xml), 'application/xml');
      }
    }

    // 自动标签：来源名 / UP 名 / 平台标签
    const settings = getSettings();
    if (settings.autoTagSource && job.source_id) {
      const sourceRow = getSource(job.source_id);
      if (sourceRow) assignTagByName(videoId, sourceRow.title, 'auto');
    }
    if (settings.autoTagUp && upName) {
      assignTagByName(videoId, upName, 'auto');
    }
    if (info?.tags?.length) {
      info.tags.slice(0, 8).forEach((tag) => assignTagByName(videoId, tag, 'auto'));
    }

    if (settings.writeNfo) writeNfo(videoId);
    await writeSidecar(videoId);

    setVideoMetadata(videoId, { status: 'present' });
  }
}

export const downloadManager = new DownloadManager();
