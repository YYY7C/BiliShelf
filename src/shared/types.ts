/**
 * 主进程 / 预加载 / 渲染进程共享的类型契约。
 * 这里的字段是「渲染进程可见」的投影，数据库行不直接外泄。
 */

export type SourceKind = 'favorite' | 'watch_later' | 'space' | 'collection' | 'manual';

export type VideoStatus = 'present' | 'missing' | 'unavailable' | 'trashed' | 'importing';

export type RemoteState = 'available' | 'unavailable' | 'unknown';

export type JobStatus =
  'queued' | 'resolving' | 'downloading' | 'postprocessing' | 'done' | 'failed' | 'paused' | 'canceled';

export type AssetType =
  'video' | 'cover' | 'thumb' | 'preview' | 'subtitle' | 'danmaku' | 'nfo' | 'audio' | 'image';

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
  /** 本地原始封面的 bilishelf:// 地址（没有封面时为 null） */
  localCoverUrl: string | null;
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
  /** 审核通过的 AI 标签（独立于普通 tags） */
  aiTags: AiTagRef[];
  /** 待审核的 AI 标签数量 */
  aiPendingCount: number;
  /** 最近一次 AI 打标的一句话摘要 */
  aiSummary: string | null;
  /** 最近一次 AI 打标时间 */
  aiLastRunAt: string | null;
}

export interface LibraryQuery {
  search?: string;
  tag?: string;
  /** 已通过审核的 AI 标签名 */
  aiTag?: string;
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
  withAiTags: number;
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
  /** 数值越大越先执行；画质升级用高优先级插到批量下载前面。 */
  priority?: number;
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

export interface JobStatusCounts {
  active: number;
  pausable: number;
  queued: number;
  paused: number;
}

export interface JobsSnapshot {
  items: DownloadJob[];
  total: number;
  counts: JobStatusCounts;
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

export type ThemeMode = 'dark' | 'light';

export interface AppSettings {
  libraryRoot: string;
  defaultQuality: QualityPreset;
  concurrency: number;
  writeNfo: boolean;
  autoTagSource: boolean;
  autoTagUp: boolean;
  autoTagZone: boolean;
  generatePreview: boolean;
  /** 选中视频时显示本地封面虚化背景 */
  coverBackdrop: boolean;
  /** 背景虚化半径（px） */
  coverBackdropBlur: number;
  /** 背景不透明度（0-100） */
  coverBackdropOpacity: number;
  /** 背景暗化强度（0-100） */
  coverBackdropDim: number;
  /** 侧边栏透明玻璃效果 */
  sidebarTransparent: boolean;
  /** 关闭窗口时收进托盘，应用继续在后台下载 / 打标 */
  closeToTray: boolean;
  ytdlpPath: string;
  ffmpegPath: string;
  requestDelayMs: number;
  /** AI 打标每视频抽帧数（不含封面） */
  aiFrameCount: number;
  /** AI 抽帧最大边长 */
  aiFrameWidth: number;
  /** 是否把封面一起发给 VLM */
  aiIncludeCover: boolean;
  /** AI 打标并发 */
  aiConcurrency: number;
  /** AI 请求间隔（毫秒） */
  aiRequestDelayMs: number;
  /** AI 请求超时（毫秒） */
  aiTimeoutMs: number;
  /** AI 请求最大重试次数 */
  aiMaxRetries: number;
  /** 单次打标最多工具轮次 */
  aiMaxToolRounds: number;
  /** AI 抽帧/音频缓存保留天数 */
  aiCacheDays: number;
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

/* ---------------------------------- AI ---------------------------------- */

export type AiProtocol = 'openai' | 'anthropic' | 'gemini' | 'custom';
export type AiCustomCompatMode = 'openai' | 'anthropic' | 'gemini' | 'template';
export type AiTagSource = 'vision' | 'acrcloud' | 'bilibili_tag' | 'inferred';
export type AiRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export type AiReviewStatus = 'pending' | 'partial' | 'approved' | 'rejected';
export type AiTagStatus = 'pending' | 'approved' | 'rejected' | 'superseded';
export type AiBatchStatus = 'queued' | 'running' | 'paused' | 'done' | 'canceled';
export type AiStage = 'frames' | 'request' | 'tools' | 'parse' | 'done';
export type AiImageDetail = 'low' | 'auto' | 'high';

export interface AiCapabilities {
  vision: boolean;
  tools: boolean;
  jsonMode: boolean;
  audio: boolean;
}

export interface AiPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: string;
}

export interface AiCustomConfig {
  compatMode: AiCustomCompatMode;
  bodyTemplate?: string;
  responsePath?: string;
}

export interface AiProviderSummary {
  id: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  headerKeys: string[];
  capabilities: AiCapabilities;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  imageDetail: AiImageDetail;
  pricing: AiPricing | null;
  isDefault: boolean;
  custom: AiCustomConfig | null;
}

export interface AiProviderInput {
  id?: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
  headers?: Record<string, string>;
  capabilities: AiCapabilities;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  imageDetail: AiImageDetail;
  pricing?: AiPricing | null;
  custom?: AiCustomConfig | null;
  isDefault?: boolean;
}

export interface AiProviderTestResult {
  ok: boolean;
  latencyMs: number;
  status: number | null;
  message: string;
  visionOk: boolean | null;
  jsonOk: boolean | null;
  raw: string | null;
}

export interface AiModelInfo {
  id: string;
  name: string;
  vision?: boolean;
  tools?: boolean;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  contextWindow?: number;
  pricing?: AiPricing | null;
  inputModalities?: string[];
}

export interface AiModelProbeResult {
  models: AiModelInfo[];
  message: string;
}

export interface AcrCloudSummary {
  configured: boolean;
  enabled: boolean;
  host: string;
  accessKeyHint: string | null;
  hasSecret: boolean;
  callsToday: number;
}

export interface AcrCloudInput {
  enabled?: boolean;
  host?: string;
  accessKey?: string;
  accessSecret?: string;
  clearSecret?: boolean;
}

export interface AcrCloudTestResult {
  ok: boolean;
  latencyMs: number;
  status: number | null;
  message: string;
  code: number | null;
}

export interface AiTaxonomyCategory {
  name: string;
  description?: string;
  examples?: string[];
}

export interface AiTaxonomy {
  categories: AiTaxonomyCategory[];
  stopwords: string[];
  aliases: Record<string, string>;
}

export interface AiTagProfile {
  id: number;
  name: string;
  description: string;
  scope: 'global' | 'source';
  sourceId: number | null;
  sourceName: string | null;
  isDefault: boolean;
  focus: string[];
  taxonomy: AiTaxonomy;
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

export interface AiTagProfileInput {
  id?: number;
  name: string;
  description?: string;
  scope: 'global' | 'source';
  sourceId?: number | null;
  isDefault?: boolean;
  focus: string[];
  taxonomy: AiTaxonomy;
  systemPrompt: string;
  promptTemplate: string;
  maxTags: number;
  minConfidence: number;
  language: string;
  useAcrcloud: boolean;
  useBilibiliTags: boolean;
}

export interface AiFrame {
  index: number;
  time: number;
  url: string;
}

export interface AiBgmResult {
  title: string | null;
  artists: string[];
  genres: string[];
  source: AiTagSource;
  confidence: number;
}

export interface AiTagRef {
  name: string;
  category: string;
  confidence: number;
  source: AiTagSource;
}

export interface AiTagSummary {
  id: number;
  name: string;
  category: string;
  count: number;
  source: AiTagSource | 'mixed';
}

export interface AiBatch {
  id: number;
  profileName: string | null;
  providerName: string | null;
  model: string | null;
  total: number;
  done: number;
  failed: number;
  requestCount: number;
  musicRequestCount: number;
  status: AiBatchStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AiQueueSnapshot {
  batches: AiBatch[];
  pendingReview: number;
  running: number;
}

export interface AiProgress {
  batchId: number;
  runId: number;
  videoId: number;
  title: string;
  stage: AiStage;
  done: number;
  total: number;
}

export interface AiReviewTag {
  id: number;
  category: string;
  name: string;
  confidence: number;
  source: AiTagSource;
  status: AiTagStatus;
  evidence: string | null;
  edited: boolean;
}

export interface AiReviewItem {
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
  requestCount: number;
  musicRequestCount: number;
  createdAt: string;
}

export interface AiReviewPage {
  items: AiReviewItem[];
  total: number;
}

export interface AiReviewCounts {
  pending: number;
  approved: number;
  rejected: number;
}

export interface AiConsentState {
  acceptedAt: string | null;
  hosts: string[];
}

export interface AiConsentPreview {
  hosts: string[];
  required: boolean;
}

export interface AiStats {
  taggedVideos: number;
  pendingTags: number;
  approvedTags: number;
  failedRuns: number;
  inputTokens: number;
  outputTokens: number;
  modelRequests: number;
  musicRequests: number;
}

export interface AiReviewQuery {
  status?: AiReviewStatus | 'all';
  profileId?: number;
  sourceId?: number;
  videoId?: number;
  search?: string;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

export interface AiReviewDecision {
  runIds: number[];
  tagIds?: number[];
}

export interface AiReviewResult {
  approved: number;
  rejected: number;
  affectedVideos: number;
  videoIds: number[];
}

export interface AiReviewTagPatch {
  tagId: number;
  name?: string;
  category?: string;
  confidence?: number;
}

export interface AiReviewTagAdd {
  runId: number;
  category: string;
  name: string;
  confidence?: number;
}

export interface AiReviewTagRemove {
  tagId: number;
}

export interface AiReviewTagRestore {
  tagId: number;
}

export interface AiReviewUnapproveInput {
  videoId: number;
  name: string;
  category: string;
}

export interface AiEnqueueScope {
  type: 'all' | 'filter' | 'source';
  filter?: LibraryQuery;
  sourceId?: number;
}

export interface AiEnqueueInput {
  videoIds?: number[];
  scope?: AiEnqueueScope;
  profileId?: number;
  force?: boolean;
  limit?: number;
}

export interface AiEnqueueResult {
  batchId: number;
  queued: number;
  skipped: number;
}

export interface AiRunSummary {
  id: number;
  batchId: number | null;
  videoId: number;
  videoTitle: string;
  coverUrl: string | null;
  profileId: number | null;
  profileName: string | null;
  providerId: string | null;
  providerName: string | null;
  model: string | null;
  status: AiRunStatus;
  stage: AiStage | null;
  reviewStatus: AiReviewStatus;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  musicRequestCount: number;
  frames: AiFrame[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AiRunDetail extends AiRunSummary {
  systemPrompt: string | null;
  userPrompt: string | null;
  rawResponse: string | null;
  result: {
    summary?: string;
    tags?: Array<{ name: string; category: string; confidence: number; evidence?: string }>;
    bgm?: AiBgmResult | null;
  } | null;
  toolCalls: Array<{
    id: string;
    name: string;
    args: unknown;
    result: unknown;
    error?: string;
  }>;
}

export interface AiRunQuery {
  batchId?: number;
  status?: AiRunStatus | 'all';
  limit?: number;
  offset?: number;
}

export interface AiRunPage {
  items: AiRunSummary[];
  total: number;
}

export interface AiAnalysisInput {
  mode: 'text' | 'vision' | 'hybrid';
  sampleMode: 'random' | 'source' | 'up' | 'manual';
  sampleSize: number;
  videoIds?: number[];
  providerId?: string;
  model?: string;
  profileId?: number;
  instructions?: string;
}

export interface AiAnalysisEstimate {
  videos: number;
  requests: number;
  imageCount: number;
  approxInputTokens: number;
  approxOutputTokens: number;
  warnings: string[];
}

export interface AiAnalysisSample {
  videoId: number;
  title: string;
  coverUrl: string | null;
}

export interface AiAnalysisResult {
  summary: string;
  categories: Array<{ name: string; description: string; tags: string[]; coverage?: number }>;
  focus: string[];
  stopwords: string[];
  aliases: Record<string, string>;
  systemPrompt: string;
  promptTemplate: string;
  notes: string[];
}

export interface AiAnalysisRun {
  id: number;
  mode: 'text' | 'vision' | 'hybrid';
  status: AiRunStatus;
  providerName: string | null;
  model: string | null;
  sample: AiAnalysisSample[];
  result: AiAnalysisResult | null;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AiAnalysisProgress {
  stage: 'text' | 'vision' | 'merge';
  done: number;
  total: number;
  message: string;
}

export interface AiAnalysisSaveInput {
  runId: number;
  name: string;
  scope: 'global' | 'source';
  sourceId?: number | null;
  isDefault?: boolean;
}
