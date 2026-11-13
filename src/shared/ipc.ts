import type {
  AppInfoResponse,
  AppSettings,
  AuthStatus,
  BulkAction,
  DownloadJob,
  EngineStatus,
  FolderSummary,
  ImportResult,
  LibraryQuery,
  LibraryResult,
  LibraryStats,
  QualityPreset,
  RemoteItemsQuery,
  RemoteItemsResult,
  SmartCollection,
  SourceKind,
  SourceSummary,
  TagSummary,
  ToastEvent,
  ToolKind,
  UpdateVideoPatch,
  VideoItem
} from './types';

/** 所有 IPC 通道名集中在此，避免字符串散落。 */
export const IPC = {
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appShowInFolder: 'app:show-in-folder',
  appOpenLogs: 'app:open-logs',

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
  sourcesRemove: 'sources:remove',
  sourcesSync: 'sources:sync',
  sourcesItems: 'sources:items',
  sourcesEnqueue: 'sources:enqueue',
  sourcesSyncAll: 'sources:sync-all',

  jobsList: 'jobs:list',
  jobsPause: 'jobs:pause',
  jobsResume: 'jobs:resume',
  jobsCancel: 'jobs:cancel',
  jobsRetry: 'jobs:retry',
  jobsClear: 'jobs:clear',

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
    remove(id: number): Promise<SourceSummary[]>;
    sync(id: number): Promise<{ added: number; updated: number; unavailable: number }>;
    syncAll(): Promise<{ added: number; updated: number; unavailable: number }>;
    items(query: RemoteItemsQuery): Promise<RemoteItemsResult>;
    enqueue(remoteItemIds: number[], quality?: QualityPreset): Promise<{ queued: number; skipped: number }>;
  };
  jobs: {
    list(): Promise<DownloadJob[]>;
    pause(id: number): Promise<void>;
    resume(id: number): Promise<void>;
    cancel(id: number): Promise<void>;
    retry(id: number): Promise<void>;
    clear(): Promise<void>;
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
    onJobs(cb: (jobs: DownloadJob[]) => void): () => void;
    onLibrary(cb: () => void): () => void;
    onSources(cb: () => void): () => void;
    onToast(cb: (toast: ToastEvent) => void): () => void;
    onAuth(cb: (status: AuthStatus) => void): () => void;
  };
}

declare global {
  interface Window {
    bilishelf?: BilishelfApi;
  }
}
