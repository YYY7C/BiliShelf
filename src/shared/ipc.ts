import type {
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
  SmartCollection,
  SourceKind,
  SourcePatch,
  SourceSummary,
  SyncProgress,
  TagSummary,
  ToastEvent,
  ToolKind,
  ThemeMode,
  UpdateVideoPatch,
  VideoItem
} from './types';

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

  eventJobs: 'event:jobs',
  eventLibrary: 'event:library',
  eventSources: 'event:sources',
  eventToast: 'event:toast',
  eventAuth: 'event:auth'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

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
    save(input: { id?: number; name: string; query: LibraryQuery; icon?: string | null }): Promise<SmartCollection[]>;
    remove(id: number): Promise<SmartCollection[]>;
  };
  sources: {
    list(): Promise<SourceSummary[]>;
    add(input: { kind: SourceKind; url?: string; remoteId?: string; title?: string }): Promise<SourceSummary[]>;
    update(id: number, patch: SourcePatch): Promise<SourceSummary[]>;
    remove(id: number): Promise<SourceSummary[]>;
    sync(id: number): Promise<{ added: number; updated: number; unavailable: number }>;
    syncAll(): Promise<{ added: number; updated: number; unavailable: number; failed: number }>;
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
  player: {
    progress(id: number, position: number): Promise<void>;
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
