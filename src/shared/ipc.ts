import type {
  AcrCloudInput,
  AcrCloudSummary,
  AcrCloudTestResult,
  AiAnalysisEstimate,
  AiAnalysisInput,
  AiAnalysisProgress,
  AiAnalysisRun,
  AiAnalysisSaveInput,
  AiConsentPreview,
  AiConsentState,
  AiEnqueueInput,
  AiEnqueueResult,
  AiProgress,
  AiProviderInput,
  AiModelProbeResult,
  AiProviderSummary,
  AiProviderTestResult,
  AiQueueSnapshot,
  AiReviewCounts,
  AiReviewAudit,
  AiBulkReviewInput,
  AiBulkReviewResult,
  AiReviewDecision,
  AiReviewItem,
  AiReviewPage,
  AiReviewQuery,
  AiReviewResult,
  AiReviewTagAdd,
  AiReviewTagPatch,
  AiReviewTagRemove,
  AiReviewTagRestore,
  AiReviewUnapproveInput,
  AiRunDetail,
  AiRunPage,
  AiRunQuery,
  AiStats,
  AiTagProfile,
  AiTagProfileInput,
  AiTagSummary,
  AppInfoResponse,
  AppSettings,
  AuthStatus,
  BulkAction,
  EngineStatus,
  FolderSummary,
  ImportProgress,
  ImportResult,
  JobsSnapshot,
  LibraryQuery,
  LibraryResult,
  LibraryStats,
  MaintenanceProgress,
  MaintenanceResult,
  QualityPreset,
  QualityScanProgress,
  QualityScanResult,
  RemoteItemsQuery,
  RemoteItemsResult,
  RescuePlan,
  RescueListItem,
  RescueSearchResult,
  ScreenshotInput,
  ScreenshotResult,
  SmartCollection,
  SourceKind,
  SourcePatch,
  SourcePreview,
  SourceSummary,
  SyncProgress,
  TagSummary,
  ToastEvent,
  ToolKind,
  ThemeMode,
  UpdateVideoPatch,
  VideoItem
} from './types';
import type { AiQualityConfig } from './aiQuality';

/** 所有 IPC 通道名集中在此，避免字符串散落。 */
export const IPC = {
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appShowInFolder: 'app:show-in-folder',
  appOpenLogs: 'app:open-logs',
  appSetTheme: 'app:set-theme',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseRoot: 'settings:choose-root',
  settingsRelocate: 'settings:relocate',

  libraryQuery: 'library:query',
  libraryGet: 'library:get',
  libraryStats: 'library:stats',
  libraryUpdate: 'library:update',
  libraryBulk: 'library:bulk',
  libraryImportFiles: 'library:import-files',
  libraryImportFolder: 'library:import-folder',
  libraryRebuild: 'library:rebuild',
  libraryBackup: 'library:backup',
  libraryReveal: 'library:reveal',
  libraryPlayUrl: 'library:play-url',
  librarySetTag: 'library:set-tag',
  librarySetFolder: 'library:set-folder',

  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsRename: 'tags:rename',
  tagsDelete: 'tags:delete',
  tagsMerge: 'tags:merge',

  foldersList: 'folders:list',
  foldersCreate: 'folders:create',
  foldersRename: 'folders:rename',
  foldersDelete: 'folders:delete',

  smartList: 'smart:list',
  smartSave: 'smart:save',
  smartDelete: 'smart:delete',

  sourcesList: 'sources:list',
  sourcesAdd: 'sources:add',
  sourcesPreview: 'sources:preview',
  sourcesRescuePlan: 'sources:rescue-plan',
  sourcesRescueSearch: 'sources:rescue-search',
  sourcesRescueTitles: 'sources:rescue-titles',
  sourcesRescueList: 'sources:rescue-list',
  sourcesRescueRepair: 'sources:rescue-repair',
  sourcesUpdate: 'sources:update',
  sourcesRemove: 'sources:remove',
  sourcesSync: 'sources:sync',
  sourcesItems: 'sources:items',
  sourcesEnqueue: 'sources:enqueue',
  sourcesEnqueueAll: 'sources:enqueue-all',
  sourcesEnqueuePreview: 'sources:enqueue-preview',
  sourcesSyncAll: 'sources:sync-all',
  sourcesCancelSync: 'sources:cancel-sync',

  jobsList: 'jobs:list',
  jobsPause: 'jobs:pause',
  jobsResume: 'jobs:resume',
  jobsPauseAll: 'jobs:pause-all',
  jobsResumeAll: 'jobs:resume-all',
  jobsRetryAllFailed: 'jobs:retry-all-failed',
  jobsCancel: 'jobs:cancel',
  jobsRetry: 'jobs:retry',
  jobsClear: 'jobs:clear',

  qualityScan: 'quality:scan',
  qualityEnqueue: 'quality:enqueue',
  qualityProgress: 'quality:progress',

  maintenanceBackfill: 'maintenance:backfill',
  maintenancePreviews: 'maintenance:previews',
  maintenanceCovers: 'maintenance:covers',
  maintenanceThumbs: 'maintenance:thumbs',
  maintenanceCleanup: 'maintenance:cleanup',
  eventMaintenance: 'event:maintenance',
  eventImportProgress: 'event:import-progress',
  eventSyncProgress: 'event:sync-progress',

  engineStatus: 'engine:status',
  engineSetPath: 'engine:set-path',
  enginePick: 'engine:pick',
  engineRefresh: 'engine:refresh',

  authStatus: 'auth:status',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',

  playerProgress: 'player:progress',
  playerScreenshot: 'player:screenshot',

  aiProvidersList: 'ai:providers:list',
  aiProvidersSave: 'ai:providers:save',
  aiProvidersRemove: 'ai:providers:remove',
  aiProvidersSetDefault: 'ai:providers:set-default',
  aiProvidersTest: 'ai:providers:test',
  aiProvidersProbe: 'ai:providers:probe',

  aiAcrcloudGet: 'ai:acrcloud:get',
  aiAcrcloudSave: 'ai:acrcloud:save',
  aiAcrcloudTest: 'ai:acrcloud:test',

  aiProfilesList: 'ai:profiles:list',
  aiProfilesSave: 'ai:profiles:save',
  aiProfilesRemove: 'ai:profiles:remove',
  aiProfilesSetDefault: 'ai:profiles:set-default',
  aiProfilesDuplicate: 'ai:profiles:duplicate',

  aiConsentGet: 'ai:consent:get',
  aiConsentAccept: 'ai:consent:accept',

  aiQueueEnqueue: 'ai:queue:enqueue',
  aiQueueConsent: 'ai:queue:consent',
  aiQueueBatches: 'ai:queue:batches',
  aiQueuePause: 'ai:queue:pause',
  aiQueueResume: 'ai:queue:resume',
  aiQueueCancel: 'ai:queue:cancel',
  aiQueueRetryFailed: 'ai:queue:retry-failed',
  aiRunsList: 'ai:runs:list',
  aiRunsGet: 'ai:runs:get',

  aiReviewList: 'ai:review:list',
  aiReviewCounts: 'ai:review:counts',
  aiReviewApprove: 'ai:review:approve',
  aiReviewReject: 'ai:review:reject',
  aiReviewAudit: 'ai:review:audit',
  aiReviewBulk: 'ai:review:bulk',
  aiReviewUpdateTag: 'ai:review:update-tag',
  aiReviewAddTag: 'ai:review:add-tag',
  aiReviewRemoveTag: 'ai:review:remove-tag',
  aiReviewRestoreTag: 'ai:review:restore-tag',
  aiReviewUnapprove: 'ai:review:unapprove',

  aiTagsList: 'ai:tags:list',
  aiStats: 'ai:stats',
  aiQualityRules: 'ai:quality-rules',

  aiAnalysisEstimate: 'ai:analysis:estimate',
  aiAnalysisRun: 'ai:analysis:run',
  aiAnalysisHistory: 'ai:analysis:history',
  aiAnalysisGet: 'ai:analysis:get',
  aiAnalysisSaveAsProfile: 'ai:analysis:save-as-profile',

  aiMaintenanceCleanup: 'ai:maintenance:cleanup',

  eventAiQueue: 'event:ai-queue',
  eventAiProgress: 'event:ai-progress',
  eventAiReview: 'event:ai-review',
  eventAiAnalysis: 'event:ai-analysis',

  eventJobs: 'event:jobs',
  eventLibrary: 'event:library',
  eventSources: 'event:sources',
  eventToast: 'event:toast',
  eventAuth: 'event:auth'
} as const;

/** 渲染进程可用的 API（由 preload 暴露到 window.bilishelf）。 */
export interface BilishelfApi {
  app: {
    info(): Promise<AppInfoResponse>;
    openExternal(url: string): Promise<void>;
    showInFolder(fullPath: string): Promise<void>;
    openLogs(): Promise<void>;
    setTheme(theme: ThemeMode): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    chooseLibraryRoot(): Promise<string | null>;
    relocate(target?: string): Promise<string>;
  };
  library: {
    query(query: LibraryQuery): Promise<LibraryResult>;
    get(id: number): Promise<VideoItem | null>;
    stats(): Promise<LibraryStats>;
    update(id: number, patch: UpdateVideoPatch): Promise<VideoItem | null>;
    bulk(action: BulkAction): Promise<{ affected: number }>;
    importFiles(): Promise<ImportResult | null>;
    importFolder(): Promise<ImportResult | null>;
    rebuild(): Promise<{ scanned: number; restored: number }>;
    backup(): Promise<string | null>;
    reveal(id: number): Promise<void>;
    playUrl(id: number): Promise<string | null>;
    setTag(id: number, tag: string, add: boolean): Promise<VideoItem | null>;
    setFolder(id: number, folder: string, add: boolean): Promise<VideoItem | null>;
  };
  tags: {
    list(): Promise<TagSummary[]>;
    create(name: string, parentId?: number | null): Promise<TagSummary[]>;
    rename(id: number, name: string): Promise<TagSummary[]>;
    remove(id: number): Promise<TagSummary[]>;
    merge(sourceId: number, targetId: number): Promise<TagSummary[]>;
  };
  folders: {
    list(): Promise<FolderSummary[]>;
    create(name: string, parentId?: number | null): Promise<FolderSummary[]>;
    rename(id: number, name: string): Promise<FolderSummary[]>;
    remove(id: number): Promise<FolderSummary[]>;
  };
  smart: {
    list(): Promise<SmartCollection[]>;
    save(input: {
      id?: number;
      name: string;
      query: LibraryQuery;
      icon?: string | null;
    }): Promise<SmartCollection[]>;
    remove(id: number): Promise<SmartCollection[]>;
  };
  sources: {
    list(): Promise<SourceSummary[]>;
    add(input: {
      kind: SourceKind | 'auto';
      url?: string;
      remoteId?: string;
      title?: string;
      minDuration?: number | null;
      maxDuration?: number | null;
    }): Promise<SourceSummary[]>;
    preview(input: {
      url?: string;
      remoteId?: string;
      minDuration?: number | null;
      maxDuration?: number | null;
    }): Promise<SourcePreview>;
    /** P0 只读：复核失效条目并在 Internet Archive 上找候选，不写库、不下载 */
    rescuePlan(input: {
      sourceId?: number | null;
      remoteItemIds?: number[];
      limit?: number;
      verifyTop?: number;
    }): Promise<RescuePlan>;
    /** 对单个 BV 手动检索存档候选（不依赖清单条目） */
    rescueSearch(input: {
      bvid: string;
      title?: string | null;
      duration?: number | null;
      upName?: string | null;
      verifyTop?: number;
    }): Promise<RescueSearchResult>;
    /** 用观看历史恢复失效条目的真实标题（收藏夹接口只给「已失效视频」） */
    rescueTitles(input: { sourceId?: number | null; bvids?: string[] }): Promise<{
      scanned: number;
      pages: number;
      found: Array<{ bvid: string; title: string; upName: string | null }>;
      errors: string[];
    }>;
    /** 失效 / 已补档清单（跨来源） */
    rescueList(): Promise<RescueListItem[]>;
    /** 把「B 站失效但本地已有副本」的条目修成 rescued，返回修复条数 */
    rescueRepair(): Promise<number>;
    update(id: number, patch: SourcePatch): Promise<SourceSummary[]>;
    remove(id: number): Promise<SourceSummary[]>;
    sync(id: number): Promise<{ added: number; updated: number; unavailable: number; filtered: number }>;
    syncAll(): Promise<{
      added: number;
      updated: number;
      unavailable: number;
      filtered: number;
      failed: number;
    }>;
    items(query: RemoteItemsQuery): Promise<RemoteItemsResult>;
    enqueue(remoteItemIds: number[], quality?: QualityPreset): Promise<{ queued: number; skipped: number }>;
    enqueueAll(input: {
      sourceId?: number | null;
      quality?: QualityPreset;
    }): Promise<{ total: number; queued: number; skipped: number }>;
    enqueuePreview(input: { sourceId?: number | null }): Promise<{ total: number }>;
    cancelSync(): Promise<void>;
  };
  jobs: {
    list(): Promise<JobsSnapshot>;
    pause(id: number): Promise<void>;
    resume(id: number): Promise<void>;
    pauseAll(): Promise<number>;
    resumeAll(): Promise<number>;
    retryAllFailed(): Promise<number>;
    cancel(id: number): Promise<void>;
    retry(id: number): Promise<void>;
    clear(): Promise<void>;
  };
  quality: {
    scan(): Promise<QualityScanResult>;
    enqueue(videoIds: number[]): Promise<{ queued: number; skipped: number }>;
    onProgress(cb: (progress: QualityScanProgress) => void): () => void;
  };
  maintenance: {
    backfill(): Promise<MaintenanceResult>;
    previews(): Promise<MaintenanceResult>;
    covers(): Promise<MaintenanceResult>;
    thumbs(): Promise<MaintenanceResult>;
    cleanup(): Promise<MaintenanceResult>;
    onProgress(cb: (progress: MaintenanceProgress) => void): () => void;
  };
  engine: {
    status(): Promise<EngineStatus>;
    setPath(kind: ToolKind, path: string): Promise<EngineStatus>;
    pick(kind: ToolKind): Promise<EngineStatus>;
    refresh(): Promise<EngineStatus>;
  };
  auth: {
    status(): Promise<AuthStatus>;
    login(): Promise<AuthStatus>;
    logout(): Promise<AuthStatus>;
  };
  ai: {
    providers: {
      list(): Promise<AiProviderSummary[]>;
      save(input: AiProviderInput): Promise<AiProviderSummary[]>;
      remove(id: string): Promise<AiProviderSummary[]>;
      setDefault(id: string): Promise<AiProviderSummary[]>;
      test(id: string): Promise<AiProviderTestResult>;
      probe(input: AiProviderInput): Promise<AiModelProbeResult>;
    };
    acrcloud: {
      get(): Promise<AcrCloudSummary>;
      save(input: AcrCloudInput): Promise<AcrCloudSummary>;
      test(): Promise<AcrCloudTestResult>;
    };
    profiles: {
      list(): Promise<AiTagProfile[]>;
      save(input: AiTagProfileInput): Promise<AiTagProfile[]>;
      remove(id: number): Promise<AiTagProfile[]>;
      setDefault(id: number): Promise<AiTagProfile[]>;
      duplicate(id: number): Promise<AiTagProfile[]>;
    };
    consent: {
      get(): Promise<AiConsentState>;
      accept(hosts: string[]): Promise<AiConsentState>;
    };
    queue: {
      enqueue(input: AiEnqueueInput): Promise<AiEnqueueResult>;
      consent(input: AiEnqueueInput): Promise<AiConsentPreview>;
      batches(): Promise<AiQueueSnapshot>;
      pause(batchId: number): Promise<void>;
      resume(batchId: number): Promise<void>;
      cancel(batchId: number): Promise<void>;
      retryFailed(batchId: number): Promise<void>;
      runs(query: AiRunQuery): Promise<AiRunPage>;
      getRun(id: number): Promise<AiRunDetail | null>;
      onQueue(cb: (snapshot: AiQueueSnapshot) => void): () => void;
      onProgress(cb: (progress: AiProgress) => void): () => void;
    };
    review: {
      list(query: AiReviewQuery): Promise<AiReviewPage>;
      counts(): Promise<AiReviewCounts>;
      approve(input: AiReviewDecision): Promise<AiReviewResult>;
      reject(input: AiReviewDecision): Promise<AiReviewResult>;
      /** 标签质量审计：按问题类型统计命中条目数 */
      audit(query?: AiReviewQuery): Promise<AiReviewAudit>;
      /** 按筛选条件批量通过/拒绝（onlyClean 跳过矛盾条目） */
      bulk(input: AiBulkReviewInput): Promise<AiBulkReviewResult>;
      updateTag(input: AiReviewTagPatch): Promise<AiReviewItem | null>;
      addTag(input: AiReviewTagAdd): Promise<AiReviewItem | null>;
      removeTag(input: AiReviewTagRemove): Promise<AiReviewItem | null>;
      restoreTag(input: AiReviewTagRestore): Promise<AiReviewItem | null>;
      unapprove(input: AiReviewUnapproveInput): Promise<AiReviewResult>;
      onChanged(cb: () => void): () => void;
    };
    /** 素材库本地的质量规则（ai-quality.json），用于审核页打问题徽标 */
    qualityRules(): Promise<AiQualityConfig>;
    tags: {
      list(): Promise<AiTagSummary[]>;
    };
    stats(): Promise<AiStats>;
    analysis: {
      estimate(input: AiAnalysisInput): Promise<AiAnalysisEstimate>;
      run(input: AiAnalysisInput): Promise<AiAnalysisRun>;
      history(): Promise<AiAnalysisRun[]>;
      get(id: number): Promise<AiAnalysisRun | null>;
      saveAsProfile(input: AiAnalysisSaveInput): Promise<AiTagProfile[]>;
      onProgress(cb: (progress: AiAnalysisProgress) => void): () => void;
    };
    maintenance: {
      cleanup(): Promise<MaintenanceResult>;
    };
  };
  player: {
    progress(id: number, position: number): Promise<void>;
    /** 导出当前时间点的原始分辨率截图（PNG） */
    screenshot(input: ScreenshotInput): Promise<ScreenshotResult>;
  };
  events: {
    onJobs(cb: (snapshot: JobsSnapshot) => void): () => void;
    onLibrary(cb: () => void): () => void;
    onSources(cb: () => void): () => void;
    onToast(cb: (toast: ToastEvent) => void): () => void;
    onAuth(cb: (status: AuthStatus) => void): () => void;
    onImportProgress(cb: (progress: ImportProgress) => void): () => void;
    onSyncProgress(cb: (progress: SyncProgress) => void): () => void;
  };
}

declare global {
  interface Window {
    bilishelf?: BilishelfApi;
  }
}
