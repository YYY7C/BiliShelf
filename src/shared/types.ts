/**
 * 主进程 / 预加载 / 渲染进程共享的类型契约。
 * 这里的字段是「渲染进程可见」的投影，数据库行不直接外泄。
 */

export type SourceKind = 'favorite' | 'watch_later' | 'space' | 'collection' | 'manual';

export type VideoStatus = 'present' | 'missing' | 'unavailable' | 'trashed' | 'importing';

export type RemoteState = 'available' | 'unavailable' | 'unknown';

export type JobStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'postprocessing'
  | 'done'
  | 'failed'
  | 'paused'
  | 'canceled';

export type AssetType =
  | 'video'
  | 'cover'
  | 'thumb'
  | 'preview'
  | 'subtitle'
  | 'danmaku'
  | 'nfo'
  | 'audio'
  | 'image';

export type SortKey = 'added' | 'recent' | 'title' | 'duration' | 'size' | 'rating';

export type QualityPreset = 'compat' | '720' | 'best' | 'audio' | 'custom';

export interface VideoItem {
  id: number;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  upName: string | null;
  upMid: number | null;
  description: string | null;
  /** 远程封面地址，可能为空 */
  coverUrl: string | null;
  /** 本地封面/缩略图的 bilishelf:// 地址 */
  thumbUrl: string | null;
  videoUrl: string | null;
  previewUrl: string | null;
  subtitleUrl: string | null;
  danmakuUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  vcodec: string | null;
  acodec: string | null;
  fileSize: number | null;
  qualityLabel: string | null;
  status: VideoStatus;
  rating: number;
  note: string;
  tags: string[];
  folders: string[];
  playPosition: number;
  playedAt: string | null;
  downloadedAt: string | null;
  createdAt: string;
  sourceId: number | null;
  sourceName: string | null;
  hasDanmaku: boolean;
  hasSubtitle: boolean;
}

export interface LibraryQuery {
  search?: string;
  tag?: string;
  folder?: string;
  status?: VideoStatus | 'all';
  sourceId?: number;
  sort?: SortKey;
  limit?: number;
  offset?: number;
}

export interface LibraryResult {
  items: VideoItem[];
  total: number;
}

export interface LibraryStats {
  total: number;
  present: number;
  missing: number;
  unavailable: number;
  trashed: number;
  withTags: number;
  totalBytes: number;
}

export interface SourceSummary {
  id: number;
  kind: SourceKind;
  remoteId: string;
  title: string;
  /** 列表展示用封面：优先最新条目的本地缓存（bilishelf://cover/<id>），其次远程地址 */
  cover: string | null;
  ownerMid: number | null;
  itemCount: number;
  downloadedCount: number;
  unavailableCount: number;
  lastSyncedAt: string | null;
  syncEnabled: boolean;
  note: string | null;
}

export interface SourcePatch {
  syncEnabled?: boolean;
  note?: string | null;
}

export interface RemoteItem {
  id: number;
  sourceId: number;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  coverUrl: string | null;
  duration: number | null;
  upName: string | null;
  upMid: number | null;
  pubTime: string | null;
  favTime: string | null;
  state: RemoteState;
  tags: string[];
  downloadedVideoId: number | null;
  jobStatus: JobStatus | null;
  /** 已下载文件的格式信息，未下载时为 null */
  width: number | null;
  height: number | null;
  vcodec: string | null;
  fileSize: number | null;
  qualityLabel: string | null;
}

export interface RemoteItemsQuery {
  sourceId: number;
  search?: string;
  onlyUndownloaded?: boolean;
  onlyUnavailable?: boolean;
  limit?: number;
  offset?: number;
}

export interface RemoteItemsResult {
  items: RemoteItem[];
  total: number;
}

export interface DownloadJob {
  id: number;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  sourceId: number | null;
  sourceName: string | null;
  status: JobStatus;
  progress: number;
  speed: number | null;
  eta: number | null;
  quality: QualityPreset;
  upgradeVideoId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EnqueueInput {
  bvid: string;
  cid?: number | null;
  page?: number;
  title?: string;
  sourceId?: number | null;
  remoteItemId?: number | null;
  quality?: QualityPreset;
  upgradeVideoId?: number | null;
}

export interface QualityCandidate {
  videoId: number;
  bvid: string;
  title: string;
  sourceId: number | null;
  sourceName: string | null;
  currentHeight: number | null;
  currentBitrate: number | null;
  availableHeight: number;
  availableBitrate: number | null;
  reason: 'resolution' | 'bitrate';
}

export interface QualityScanResult {
  scanned: number;
  failed: number;
  remaining: number;
  candidates: QualityCandidate[];
}

export interface QualityScanProgress {
  scanned: number;
  total: number;
  title: string;
}

export interface JobsSnapshot {
  items: DownloadJob[];
  total: number;
}

export interface SyncProgress {
  scope: 'source' | 'all';
  sourceId: number | null;
  title: string;
  index: number;
  total: number;
  items: number;
}

export interface TagSummary {
  id: number;
  name: string;
  color: string | null;
  count: number;
  parentId: number | null;
  source: 'manual' | 'auto' | 'mixed';
}

export interface FolderSummary {
  id: number;
  name: string;
  parentId: number | null;
  count: number;
  sort: number;
}

export interface SmartCollection {
  id: number;
  name: string;
  query: LibraryQuery;
  icon: string | null;
  sort: number;
}

export type ToolKind = 'ytdlp' | 'ffmpeg' | 'ffprobe';

export interface ToolStatus {
  kind: ToolKind;
  path: string | null;
  version: string | null;
  ok: boolean;
  origin: 'bundled' | 'custom' | 'path' | 'missing';
}

export interface EngineStatus {
  tools: ToolStatus[];
  ready: boolean;
}

export interface AuthStatus {
  loggedIn: boolean;
  mid: number | null;
  name: string | null;
  avatar: string | null;
  checkedAt: string | null;
}

export interface AppSettings {
  libraryRoot: string;
  defaultQuality: QualityPreset;
  concurrency: number;
  writeNfo: boolean;
  autoTagSource: boolean;
  autoTagUp: boolean;
  autoTagZone: boolean;
  generatePreview: boolean;
  ytdlpPath: string;
  ffmpegPath: string;
  requestDelayMs: number;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  libraryRoot: string;
  userData: string;
  dev: boolean;
}

export interface ToastEvent {
  kind: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface UpdateVideoPatch {
  title?: string;
  rating?: number;
  note?: string;
  status?: VideoStatus;
}

export interface BulkAction {
  ids: number[];
  action: 'trash' | 'restore' | 'delete' | 'retag' | 'refolder' | 'rate' | 'redownload';
  tag?: string;
  folder?: string;
  rating?: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface ImportProgress {
  done: number;
  total: number;
  current: string;
}

export type MaintenancePhase = 'metadata' | 'previews' | 'covers' | 'thumbs' | 'cleanup';

export interface MaintenanceProgress {
  phase: MaintenancePhase;
  done: number;
  total: number;
  title: string;
}

export interface MaintenanceResult {
  total: number;
  updated: number;
  failed: number;
  bytesFreed: number;
  details: string;
}

export interface AppInfoResponse extends AppInfo {
  engines: EngineStatus;
}
