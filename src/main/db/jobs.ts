import type { DownloadJob, JobStatus, JobStatusCounts, QualityPreset } from '@shared/types';
import { all, one, run } from './index';

export interface JobRow {
  id: number;
  video_key: string;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  source_id: number | null;
  remote_item_id: number | null;
  quality: QualityPreset;
  upgrade_video_id: number | null;
  status: JobStatus;
  progress: number;
  speed: number | null;
  eta: number | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  priority: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  source_name?: string | null;
}

function now(): string {
  return new Date().toISOString();
}

export function listJobs(limit = 200): DownloadJob[] {
  const rows = all<JobRow>(
    `SELECT j.*, s.title AS source_name
     FROM download_jobs j
     LEFT JOIN sources s ON s.id = j.source_id
     ORDER BY
       CASE j.status
         WHEN 'downloading' THEN 0
         WHEN 'postprocessing' THEN 1
         WHEN 'resolving' THEN 2
         WHEN 'queued' THEN 3
         WHEN 'paused' THEN 4
         WHEN 'failed' THEN 5
         ELSE 6
       END,
       j.priority DESC, j.id DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map((row) => ({
    id: row.id,
    bvid: row.bvid,
    cid: row.cid,
    page: row.page,
    title: row.title,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    status: row.status,
    progress: row.progress,
    speed: row.speed,
    eta: row.eta,
    quality: row.quality,
    upgradeVideoId: row.upgrade_video_id ?? null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attempts: row.attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }));
}

export function getJob(id: number): JobRow | undefined {
  return one<JobRow>('SELECT * FROM download_jobs WHERE id = ?', [id]);
}

export function findActiveJob(videoKey: string): JobRow | undefined {
  return one<JobRow>(
    `SELECT * FROM download_jobs WHERE video_key = ?
      AND status IN ('queued','resolving','downloading','postprocessing','paused')
      ORDER BY id DESC LIMIT 1`,
    [videoKey]
  );
}

export function createJob(input: {
  videoKey: string;
  bvid: string;
  cid?: number | null;
  page?: number;
  title: string;
  sourceId?: number | null;
  remoteItemId?: number | null;
  quality?: QualityPreset;
  upgradeVideoId?: number | null;
  priority?: number;
  status?: JobStatus;
}): number {
  const result = run(
    `INSERT INTO download_jobs (
      video_key, bvid, cid, page, title, source_id, remote_item_id, quality, upgrade_video_id, status, priority, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.videoKey,
      input.bvid,
      input.cid ?? null,
      input.page ?? 1,
      input.title,
      input.sourceId ?? null,
      input.remoteItemId ?? null,
      input.quality ?? 'compat',
      input.upgradeVideoId ?? null,
      input.status ?? 'queued',
      input.priority ?? 0,
      now()
    ]
  );
  return Number(result.lastInsertRowid);
}

export function updateJob(
  id: number,
  patch: Partial<{
    status: JobStatus;
    progress: number;
    speed: number | null;
    eta: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    attempts: number;
    startedAt: string | null;
    finishedAt: string | null;
  }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.progress !== undefined) {
    sets.push('progress = ?');
    params.push(Math.max(0, Math.min(1, patch.progress)));
  }
  if (patch.speed !== undefined) {
    sets.push('speed = ?');
    params.push(patch.speed);
  }
  if (patch.eta !== undefined) {
    sets.push('eta = ?');
    params.push(patch.eta);
  }
  if (patch.errorCode !== undefined) {
    sets.push('error_code = ?');
    params.push(patch.errorCode);
  }
  if (patch.errorMessage !== undefined) {
    sets.push('error_message = ?');
    params.push(patch.errorMessage);
  }
  if (patch.attempts !== undefined) {
    sets.push('attempts = ?');
    params.push(patch.attempts);
  }
  if (patch.startedAt !== undefined) {
    sets.push('started_at = ?');
    params.push(patch.startedAt);
  }
  if (patch.finishedAt !== undefined) {
    sets.push('finished_at = ?');
    params.push(patch.finishedAt);
  }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE download_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function markStarted(id: number): void {
  updateJob(id, { status: 'downloading', startedAt: now(), errorCode: null, errorMessage: null, progress: 0 });
}

export function markDone(id: number): void {
  updateJob(id, { status: 'done', progress: 1, speed: null, eta: null, finishedAt: now() });
}

export function markFailed(id: number, code: string, message: string): void {
  updateJob(id, {
    status: 'failed',
    speed: null,
    eta: null,
    errorCode: code,
    errorMessage: message.slice(0, 500),
    finishedAt: now()
  });
}

/** 崩溃恢复：把中断的 downloading/postprocessing 置为 paused，由用户决定是否继续。 */
export function recoverInterruptedJobs(): number {
  const result = run(
    `UPDATE download_jobs SET status = 'paused', speed = NULL, eta = NULL
     WHERE status IN ('downloading','postprocessing','resolving')`
  );
  return result.changes;
}

export function pauseQueuedJobs(): number {
  const result = run(
    `UPDATE download_jobs SET status = 'paused', speed = NULL, eta = NULL
     WHERE status = 'queued'`
  );
  return result.changes;
}

export function listRunningJobIds(): number[] {
  return all<{ id: number }>(
    `SELECT id FROM download_jobs
     WHERE status IN ('resolving','downloading','postprocessing')`
  ).map((row) => row.id);
}

export function resumePausedJobs(): number {
  const result = run(
    `UPDATE download_jobs
     SET status = 'queued', progress = 0, speed = NULL, eta = NULL,
         error_code = NULL, error_message = NULL
     WHERE status = 'paused'`
  );
  return result.changes;
}

/** 批量重试所有失败任务（例如一批画质升级被同一个 CDN 问题打挂后，改完设置一键重来）。 */
export function requeueFailedJobs(): number {
  const result = run(
    `UPDATE download_jobs
     SET status = 'queued', attempts = 0, progress = 0, speed = NULL, eta = NULL,
         error_code = NULL, error_message = NULL, started_at = NULL, finished_at = NULL
     WHERE status = 'failed'`
  );
  return result.changes;
}

export function clearFinishedJobs(): number {
  const result = run("DELETE FROM download_jobs WHERE status IN ('done','canceled','failed')");
  return result.changes;
}

/** 自动清理超过 N 天的已结束任务，避免下载几千条后任务表无限膨胀。 */
export function pruneFinishedJobs(days = 7): number {
  const result = run(
    `DELETE FROM download_jobs
      WHERE status IN ('done','canceled','failed')
        AND COALESCE(finished_at, created_at) < ?`,
    [new Date(Date.now() - days * 86_400_000).toISOString()]
  );
  return result.changes;
}

export function jobTotalCount(): number {
  return one<{ c: number }>('SELECT COUNT(*) AS c FROM download_jobs')?.c ?? 0;
}

export function nextQueuedJob(): JobRow | undefined {
  return one<JobRow>(
    "SELECT * FROM download_jobs WHERE status = 'queued' ORDER BY priority DESC, id ASC LIMIT 1"
  );
}

export function activeJobCount(): number {
  return (
    one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM download_jobs WHERE status IN ('resolving','downloading','postprocessing')"
    )?.c ?? 0
  );
}

export function jobStatusCounts(): JobStatusCounts {
  const row = one<Record<keyof JobStatusCounts, number | bigint | null>>(
    `SELECT
       SUM(CASE WHEN status IN ('resolving','downloading','postprocessing') THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status IN ('resolving','downloading') THEN 1 ELSE 0 END) AS pausable,
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused
     FROM download_jobs`
  );
  return {
    active: Number(row?.active ?? 0),
    pausable: Number(row?.pausable ?? 0),
    queued: Number(row?.queued ?? 0),
    paused: Number(row?.paused ?? 0)
  };
}
