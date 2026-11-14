import type { BilishelfApi } from '@shared/ipc';
import type {
  AppSettings,
  AuthStatus,
  DownloadJob,
  FolderSummary,
  LibraryStats,
  RemoteItem,
  SmartCollection,
  SourceSummary,
  TagSummary,
  VideoItem
} from '@shared/types';

/** 浏览器里直接打开（非 Electron）时使用的演示数据，便于设计/联调。 */
export const isDemo = typeof window === 'undefined' || !window.bilishelf;

const GRADIENTS: Array<[string, string]> = [
  ['#7b3a52', '#1d4d63'],
  ['#2b4c7e', '#6e3f6b'],
  ['#3c6b4e', '#1f3c5e'],
  ['#6b4a2b', '#3c2b52'],
  ['#4b2b6b', '#1f5e6b'],
  ['#1f5e6b', '#7b3a52'],
  ['#5c3d2e', '#2e4a5c'],
  ['#3a2f5c', '#5c3a2f']
];

function svgCover(title: string, from: string, to: string): string {
  const label = title.replace(/[<>&"]/g, '').slice(0, 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <circle cx="540" cy="70" r="150" fill="rgba(255,255,255,0.06)"/>
    <text x="36" y="300" font-family="sans-serif" font-size="26" fill="rgba(255,255,255,0.82)">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const TITLES = [
  '「赛博朋克：边缘行者」作画 MAD 合集',
  'Blender 4.2 硬表面建模全流程（含 UV 与烘焙）',
  '为什么你的 UI 看起来不高级？三个真实案例拆解',
  '【4K】城市夜景延时摄影 · 东京 2024',
  '从零实现一个渲染器：光线追踪入门',
  '动画分镜的节奏感是怎么练出来的',
  'Rust 所有权模型 30 分钟讲透',
  '配色理论：如何让画面“高级”而不脏',
  '视频剪辑中的 J-Cut 与 L-Cut 实战',
  '镜头语言：景别、角度与运动',
  '像素画的色彩限制与抖动技法',
  '用 FFmpeg 搭建自己的素材处理流水线',
  '产品设计中的信息密度控制',
  '音乐制作：和弦进行的情绪设计',
  '独居生活记录 · 一镜到底的一天',
  '摄影布光：三点光与柔光箱的区别',
  '游戏关卡设计：引导玩家的十种方法',
  '字体排版：中文标题的呼吸感'
];

const UP_NAMES = ['作画研究所', '三维笔记', '设计档案馆', '夜色工作室', '图形学小站', '动画拆解室'];

const TAG_POOL = [
  ['动画', '作画', '参考'],
  ['教程', 'Blender', '3D'],
  ['UI', '设计', '拆解'],
  ['摄影', '延时', '城市'],
  ['技术', '图形学', 'Rust'],
  ['剪辑', '节奏', '方法']
];

function makeVideos(): VideoItem[] {
  const now = Date.now();
  return TITLES.map((title, index) => {
    const gradient = GRADIENTS[index % GRADIENTS.length]!;
    const duration = Math.round(120 + ((index * 137) % 2400));
    const size = Math.round(duration * 1024 * 1024 * 0.16);
    const status = index === 5 ? 'missing' : index === 11 ? 'unavailable' : 'present';
    return {
      id: index + 1,
      bvid: `BV1demo${String(index + 1).padStart(4, '0')}`,
      cid: 100000 + index,
      page: 1,
      title,
      upName: UP_NAMES[index % UP_NAMES.length]!,
      upMid: 1000 + (index % UP_NAMES.length),
      description: '这是一条演示数据，用于在没有登录/没有下载的情况下预览素材库界面。',
      coverUrl: null,
      thumbUrl: svgCover(title, gradient[0], gradient[1]),
      localCoverUrl: svgCover(title, gradient[0], gradient[1]),
      videoUrl: null,
      previewUrl: null,
      subtitleUrl: null,
      danmakuUrl: null,
      duration,
      width: 1920,
      height: index % 5 === 0 ? 1080 : 1080,
      vcodec: index % 4 === 0 ? 'hevc' : 'h264',
      acodec: 'aac',
      fileSize: status === 'present' ? size : null,
      qualityLabel: '1080P',
      status,
      rating: index % 6 === 0 ? 5 : index % 4 === 0 ? 4 : 0,
      note: index === 0 ? '留作片头参考，注意第 12 秒的镜头切换。' : '',
      tags: TAG_POOL[index % TAG_POOL.length]!,
      folders: index % 3 === 0 ? ['项目 A / 参考片'] : [],
      playPosition: index % 7 === 0 ? 132 : 0,
      playedAt: index % 7 === 0 ? new Date(now - 86400000 * 3).toISOString() : null,
      downloadedAt: status === 'present' ? new Date(now - 86400000 * index).toISOString() : null,
      createdAt: new Date(now - 86400000 * index).toISOString(),
      sourceId: index % 2 === 0 ? 1 : 2,
      sourceName: index % 2 === 0 ? '动画参考' : '稍后再看',
      hasDanmaku: index % 3 === 0,
      hasSubtitle: index % 4 === 0
    } satisfies VideoItem;
  });
}

const demoVideos = makeVideos();

const demoSources: SourceSummary[] = [
  {
    id: 1,
    kind: 'favorite',
    remoteId: '100001',
    title: '动画参考',
    cover: svgCover('动画参考', '#7b3a52', '#1d4d63'),
    ownerMid: 1000,
    itemCount: 312,
    downloadedCount: 9,
    unavailableCount: 4,
    lastSyncedAt: new Date(Date.now() - 3600_000 * 5).toISOString(),
    syncEnabled: true,
    note: '作画 MAD 与分镜参考，优先补齐 4K'
  },
  {
    id: 2,
    kind: 'watch_later',
    remoteId: 'me',
    title: '稍后再看',
    cover: svgCover('稍后再看', '#2b4c7e', '#6e3f6b'),
    ownerMid: 1000,
    itemCount: 57,
    downloadedCount: 9,
    unavailableCount: 1,
    lastSyncedAt: new Date(Date.now() - 3600_000 * 26).toISOString(),
    syncEnabled: true,
    note: null
  },
  {
    id: 3,
    kind: 'space',
    remoteId: 'https://space.bilibili.com/12345/video',
    title: 'UP 12345',
    cover: svgCover('UP 12345', '#3c6b4e', '#1f3c5e'),
    ownerMid: 12345,
    itemCount: 88,
    downloadedCount: 0,
    unavailableCount: 0,
    lastSyncedAt: null,
    syncEnabled: false,
    note: null
  }
];

function makeRemoteItems(): RemoteItem[] {
  return Array.from({ length: 24 }).map((_, index) => {
    const downloaded = index < 4;
    return {
      id: index + 1,
      sourceId: index % 3 === 0 ? 2 : 1,
      bvid: `BV1remote${String(index + 1).padStart(3, '0')}`,
      cid: null,
      page: 1,
      title: `${TITLES[index % TITLES.length]}${index > 17 ? ' · 补档' : ''}`,
      coverUrl: svgCover(TITLES[index % TITLES.length]!, GRADIENTS[index % 8]![0], GRADIENTS[index % 8]![1]),
      duration: 180 + index * 53,
      upName: UP_NAMES[index % UP_NAMES.length]!,
      upMid: 1000 + (index % 6),
      pubTime: new Date(Date.now() - 86400000 * (index + 2)).toISOString(),
      favTime: new Date(Date.now() - 86400000 * index).toISOString(),
      state: index === 5 ? 'unavailable' : 'available',
      tags: TAG_POOL[index % TAG_POOL.length]!,
      downloadedVideoId: downloaded ? index + 1 : null,
      jobStatus: null,
      width: downloaded ? 1920 : null,
      height: downloaded ? 1080 : null,
      vcodec: downloaded ? (index % 2 === 0 ? 'avc1.640028' : 'hev1.1.6.L120.90') : null,
      fileSize: downloaded ? Math.round((180 + index * 53) * 1024 * 1024 * 0.16) : null,
      qualityLabel: downloaded ? '1080P' : null
    } satisfies RemoteItem;
  });
}

const demoRemoteItems = makeRemoteItems();

const demoTags: TagSummary[] = [
  { id: 1, name: '动画', color: null, count: 14, parentId: null, source: 'mixed' },
  { id: 2, name: '作画', color: null, count: 9, parentId: null, source: 'manual' },
  { id: 3, name: '参考', color: null, count: 12, parentId: null, source: 'manual' },
  { id: 4, name: '教程', color: null, count: 7, parentId: null, source: 'auto' },
  { id: 5, name: 'Blender', color: null, count: 4, parentId: 4, source: 'manual' },
  { id: 6, name: 'UI', color: null, count: 5, parentId: null, source: 'manual' },
  { id: 7, name: '摄影', color: null, count: 3, parentId: null, source: 'manual' },
  { id: 8, name: '技术', color: null, count: 6, parentId: null, source: 'manual' }
];

const demoFolders: FolderSummary[] = [
  { id: 1, name: '项目 A', parentId: null, count: 12, sort: 0 },
  { id: 2, name: '参考片', parentId: 1, count: 8, sort: 0 },
  { id: 3, name: '灵感库', parentId: null, count: 23, sort: 1 },
  { id: 4, name: '待整理', parentId: null, count: 6, sort: 2 }
];

const demoSmart: SmartCollection[] = [
  { id: 1, name: '未看的教程', query: { tag: '教程', status: 'present', sort: 'added' }, icon: null, sort: 0 },
  { id: 2, name: '大文件', query: { sort: 'size', status: 'present' }, icon: null, sort: 1 }
];

const demoJobs: DownloadJob[] = [
  {
    id: 1,
    bvid: 'BV1demo0002',
    cid: 100001,
    page: 1,
    title: 'Blender 4.2 硬表面建模全流程（含 UV 与烘焙）',
    sourceId: 1,
    sourceName: '动画参考',
    status: 'downloading',
    progress: 0.62,
    speed: 12_400_000,
    eta: 42,
    quality: 'compat',
    upgradeVideoId: null,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null
  },
  {
    id: 2,
    bvid: 'BV1demo0003',
    cid: 100002,
    page: 1,
    title: '为什么你的 UI 看起来不高级？三个真实案例拆解',
    sourceId: 2,
    sourceName: '稍后再看',
    status: 'queued',
    progress: 0,
    speed: null,
    eta: null,
    quality: 'compat',
    upgradeVideoId: null,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null
  },
  {
    id: 3,
    bvid: 'BV1demo0006',
    cid: 100005,
    page: 1,
    title: '动画分镜的节奏感是怎么练出来的',
    sourceId: 1,
    sourceName: '动画参考',
    status: 'failed',
    progress: 0.12,
    speed: null,
    eta: null,
    quality: 'compat',
    upgradeVideoId: null,
    errorCode: 'FORBIDDEN',
    errorMessage: '当前账号无权限获取该内容（会员/付费/充电专属），已跳过。',
    attempts: 1,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  }
];

const demoAuth: AuthStatus = {
  loggedIn: false,
  mid: null,
  name: null,
  avatar: null,
  checkedAt: new Date().toISOString()
};

const demoSettings: AppSettings = {
  libraryRoot: 'C:\\Users\\Demo\\bili-sync',
  defaultQuality: 'best',
  concurrency: 2,
  writeNfo: false,
  autoTagSource: true,
  autoTagUp: true,
  autoTagZone: true,
  generatePreview: true,
  coverBackdrop: true,
  coverBackdropBlur: 6,
  coverBackdropOpacity: 82,
  coverBackdropDim: 55,
  sidebarTransparent: true,
  ytdlpPath: '',
  ffmpegPath: '',
  requestDelayMs: 600
};

let localVideos = [...demoVideos];
let localJobs = [...demoJobs];

function enqueueDemoJobs(ids: number[]): number {
  const base = localJobs.length;
  const added = ids
    .map((id) => demoRemoteItems.find((item) => item.id === id))
    .filter((item): item is RemoteItem => Boolean(item))
    .map<DownloadJob>((item, index) => ({
      id: 100 + base + index,
      bvid: item.bvid,
      cid: item.cid,
      page: item.page,
      title: item.title,
      sourceId: item.sourceId,
      sourceName: demoSources.find((source) => source.id === item.sourceId)?.title ?? null,
      status: 'queued',
      progress: 0,
      speed: null,
      eta: null,
      quality: 'compat',
      upgradeVideoId: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null
    }));
  localJobs = [...added, ...localJobs];
  return added.length;
}

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function computeStats(): LibraryStats {
  return {
    total: localVideos.length,
    present: localVideos.filter((video) => video.status === 'present').length,
    missing: localVideos.filter((video) => video.status === 'missing').length,
    unavailable: localVideos.filter((video) => video.status === 'unavailable').length,
    trashed: localVideos.filter((video) => video.status === 'trashed').length,
    withTags: localVideos.filter((video) => video.tags.length > 0).length,
    totalBytes: localVideos.reduce((sum, video) => sum + (video.fileSize ?? 0), 0)
  };
}

export const demoApi: BilishelfApi = {
  app: {
    info: () =>
      delay({
        version: '0.2.2-demo',
        electron: '—',
        chrome: '—',
        node: '—',
        platform: 'browser',
        libraryRoot: demoSettings.libraryRoot,
        userData: '—',
        dev: true,
        engines: {
          tools: [
            { kind: 'ytdlp', path: null, version: null, ok: false, origin: 'missing' },
            { kind: 'ffmpeg', path: null, version: null, ok: false, origin: 'missing' },
            { kind: 'ffprobe', path: null, version: null, ok: false, origin: 'missing' }
          ],
          ready: false
        }
      }),
    openExternal: async () => undefined,
    showInFolder: async () => undefined,
    openLogs: async () => undefined,
    setTheme: async () => undefined
  },
  settings: {
    get: () => delay({ ...demoSettings }),
    update: (patch) => {
      Object.assign(demoSettings, patch);
      return delay({ ...demoSettings });
    },
    chooseLibraryRoot: () => delay(null),
    relocate: () => delay(demoSettings.libraryRoot)
  },
  library: {
    query: (query) => {
      let items = localVideos.filter((video) => {
        if (query.status && query.status !== 'all') {
          if (video.status !== query.status) return false;
        } else if (video.status === 'trashed') {
          return false;
        }
        if (query.tag && !video.tags.includes(query.tag)) return false;
        if (query.folder && !video.folders.some((folder) => folder.includes(query.folder!))) return false;
        if (query.search) {
          const needle = query.search.toLowerCase();
          const haystack = `${video.title} ${video.upName ?? ''} ${video.tags.join(' ')} ${video.note}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      });
      if (query.sort === 'title') items = [...items].sort((a, b) => a.title.localeCompare(b.title, 'zh'));
      if (query.sort === 'duration') items = [...items].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
      if (query.sort === 'size') items = [...items].sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
      if (query.sort === 'rating') items = [...items].sort((a, b) => b.rating - a.rating);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 120;
      return delay({ items: items.slice(offset, offset + limit), total: items.length });
    },
    get: (id) => delay(localVideos.find((video) => video.id === id) ?? null),
    stats: () => delay(computeStats()),
    update: async (id, patch) => {
      localVideos = localVideos.map((video) => (video.id === id ? { ...video, ...patch } : video));
      return delay(localVideos.find((video) => video.id === id) ?? null);
    },
    bulk: async (action) => {
      if (action.action === 'trash') {
        localVideos = localVideos.map((video) =>
          action.ids.includes(video.id) ? { ...video, status: 'trashed' } : video
        );
      }
      if (action.action === 'restore') {
        localVideos = localVideos.map((video) =>
          action.ids.includes(video.id) ? { ...video, status: 'present' } : video
        );
      }
      if (action.action === 'retag' && action.tag) {
        localVideos = localVideos.map((video) =>
          action.ids.includes(video.id) && !video.tags.includes(action.tag!)
            ? { ...video, tags: [...video.tags, action.tag!] }
            : video
        );
      }
      return delay({ affected: action.ids.length });
    },
    importFiles: () => delay(null),
    importFolder: () => delay(null),
    rebuild: () => delay({ scanned: 0, restored: 0 }),
    backup: () => delay(null),
    reveal: async () => undefined,
    playUrl: () => delay(null),
    setTag: async (id, tag, add) => {
      localVideos = localVideos.map((video) =>
        video.id === id
          ? {
              ...video,
              tags: add
                ? Array.from(new Set([...video.tags, tag]))
                : video.tags.filter((item) => item !== tag)
            }
          : video
      );
      return delay(localVideos.find((video) => video.id === id) ?? null);
    },
    setFolder: async (id, folder, add) => {
      localVideos = localVideos.map((video) =>
        video.id === id
          ? {
              ...video,
              folders: add
                ? Array.from(new Set([...video.folders, folder]))
                : video.folders.filter((item) => item !== folder)
            }
          : video
      );
      return delay(localVideos.find((video) => video.id === id) ?? null);
    }
  },
  tags: {
    list: () => delay(demoTags),
    create: () => delay(demoTags),
    rename: () => delay(demoTags),
    remove: () => delay(demoTags),
    merge: () => delay(demoTags)
  },
  folders: {
    list: () => delay(demoFolders),
    create: () => delay(demoFolders),
    rename: () => delay(demoFolders),
    remove: () => delay(demoFolders)
  },
  smart: {
    list: () => delay(demoSmart),
    save: () => delay(demoSmart),
    remove: () => delay(demoSmart)
  },
  sources: {
    list: () => delay(demoSources),
    add: () => delay(demoSources),
    update: (id, patch) => {
      const source = demoSources.find((item) => item.id === id);
      if (source) {
        if (patch.syncEnabled !== undefined) source.syncEnabled = patch.syncEnabled;
        if (patch.note !== undefined) source.note = patch.note;
      }
      return delay([...demoSources]);
    },
    remove: () => delay(demoSources),
    sync: () => delay({ added: 3, updated: 24, unavailable: 1 }),
    syncAll: () => delay({ added: 3, updated: 24, unavailable: 1, failed: 0 }),
    items: (query) => {
      const needle = query.search?.trim().toLowerCase();
      const items = demoRemoteItems.filter(
        (item) =>
          item.sourceId === query.sourceId &&
          (!query.onlyUnavailable || item.state === 'unavailable') &&
          (!query.onlyUndownloaded || !item.downloadedVideoId) &&
          (!needle || `${item.title} ${item.upName ?? ''}`.toLowerCase().includes(needle))
      );
      return delay({ items, total: items.length });
    },
    enqueue: (ids) => {
      const queued = enqueueDemoJobs(ids);
      return delay({ queued, skipped: 0 });
    },
    enqueueAll: (input) => {
      const pool = demoRemoteItems.filter((item) => {
        if (item.state === 'unavailable' || item.downloadedVideoId) return false;
        if (input.sourceId != null) return item.sourceId === input.sourceId;
        return demoSources.find((source) => source.id === item.sourceId)?.kind === 'favorite';
      });
      const queued = enqueueDemoJobs(pool.map((item) => item.id));
      return delay({ total: pool.length, queued, skipped: 0 });
    },
    enqueuePreview: (input) => {
      const total = demoRemoteItems.filter((item) => {
        if (item.state === 'unavailable' || item.downloadedVideoId) return false;
        if (input.sourceId != null) return item.sourceId === input.sourceId;
        return demoSources.find((source) => source.id === item.sourceId)?.kind === 'favorite';
      }).length;
      return delay({ total });
    },
    cancelSync: async () => undefined
  },
  jobs: {
    list: () => delay({ items: localJobs, total: localJobs.length }),
    pause: async () => undefined,
    resume: async () => undefined,
    cancel: async () => undefined,
    retry: async () => undefined,
    clear: async () => {
      localJobs = [];
    }
  },
  quality: {
    scan: () =>
      delay({
        scanned: 16,
        failed: 0,
        remaining: 0,
        candidates: [
          {
            videoId: 1,
            bvid: 'BV1demo001',
            title: 'Blender 4.2 硬表面建模全流程（含 UV 与烘焙）',
            sourceId: 1,
            sourceName: '动画参考',
            currentHeight: 1080,
            currentBitrate: 2500000,
            availableHeight: 2160,
            availableBitrate: 12000000,
            reason: 'resolution' as const
          },
          {
            videoId: 2,
            bvid: 'BV1demo002',
            title: '为什么你的 UI 看起来不高级？三个真实案例拆解',
            sourceId: 1,
            sourceName: '动画参考',
            currentHeight: 1080,
            currentBitrate: 1800000,
            availableHeight: 1080,
            availableBitrate: 4200000,
            reason: 'bitrate' as const
          }
        ]
      }),
    enqueue: (ids) => delay({ queued: ids.length, skipped: 0 }),
    onProgress: () => () => undefined
  },
  maintenance: {
    backfill: () => delay({ total: 0, updated: 0, failed: 0, bytesFreed: 0, details: '演示模式' }),
    previews: () => delay({ total: 0, updated: 0, failed: 0, bytesFreed: 0, details: '演示模式' }),
    covers: () => delay({ total: 0, updated: 0, failed: 0, bytesFreed: 0, details: '演示模式' }),
    thumbs: () => delay({ total: 0, updated: 0, failed: 0, bytesFreed: 0, details: '演示模式' }),
    cleanup: () => delay({ total: 0, updated: 0, failed: 0, bytesFreed: 0, details: '演示模式' }),
    onProgress: () => () => undefined
  },
  engine: {
    status: () =>
      delay({
        tools: [
          { kind: 'ytdlp', path: null, version: null, ok: false, origin: 'missing' as const },
          { kind: 'ffmpeg', path: null, version: null, ok: false, origin: 'missing' as const },
          { kind: 'ffprobe', path: null, version: null, ok: false, origin: 'missing' as const }
        ],
        ready: false
      }),
    setPath: () => delay({ tools: [], ready: false }),
    pick: () => delay({ tools: [], ready: false }),
    refresh: () => delay({ tools: [], ready: false })
  },
  auth: {
    status: () => delay(demoAuth),
    login: () => delay({ ...demoAuth, loggedIn: true, mid: 1000, name: '演示账号' }),
    logout: () => delay(demoAuth)
  },
  player: {
    progress: async () => undefined
  },
  events: {
    onJobs: () => () => undefined,
    onLibrary: () => () => undefined,
    onSources: () => () => undefined,
    onToast: () => () => undefined,
    onAuth: () => () => undefined,
    onImportProgress: () => () => undefined,
    onSyncProgress: () => () => undefined
  }
};

export const api: BilishelfApi = window.bilishelf ?? demoApi;
