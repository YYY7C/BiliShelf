import type { BilishelfApi } from '@shared/ipc';
import type {
  AcrCloudSummary,
  AiAnalysisRun,
  AiBatch,
  AiConsentState,
  AiProviderInput,
  AiProviderSummary,
  AiReviewItem,
  AiReviewTag,
  AiRunDetail,
  AiRunSummary,
  AiStats,
  AiTagProfile,
  AiTagProfileInput,
  AiTagSummary,
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
import {
  DEFAULT_FOCUS,
  DEFAULT_MAX_TAGS,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TAXONOMY
} from '@shared/aiDefaults';

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
      hasSubtitle: index % 4 === 0,
      aiTags: [],
      aiPendingCount: 0,
      aiSummary: null,
      aiLastRunAt: null
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
  {
    id: 1,
    name: '未看的教程',
    query: { tag: '教程', status: 'present', sort: 'added' },
    icon: null,
    sort: 0
  },
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
  closeToTray: true,
  ytdlpPath: '',
  ffmpegPath: '',
  requestDelayMs: 600,
  aiFrameCount: 3,
  aiFrameWidth: 768,
  aiIncludeCover: true,
  aiConcurrency: 2,
  aiRequestDelayMs: 300,
  aiTimeoutMs: 120000,
  aiMaxRetries: 2,
  aiMaxToolRounds: 3,
  aiCacheDays: 30
};

let localVideos = [...demoVideos];
let localJobs = [...demoJobs];

/* ------------------------------- demo AI state ------------------------------ */

const DEMO_NOW = new Date().toISOString();
let demoProviderSeq = 2;
let demoProfileSeq = 2;
let demoReviewTagSeq = 10000;

let demoProviders: AiProviderSummary[] = [
  {
    id: 'demo-provider',
    name: '演示 VLM',
    protocol: 'openai',
    baseUrl: 'https://demo.local/v1',
    model: 'demo-vlm',
    hasApiKey: true,
    apiKeyHint: '…demo',
    headerKeys: [],
    capabilities: { vision: true, tools: true, jsonMode: true, audio: false },
    temperature: 0.2,
    maxTokens: 1200,
    timeoutMs: 120000,
    maxRetries: 2,
    imageDetail: 'auto',
    pricing: null,
    isDefault: true,
    custom: null
  }
];

let demoProfiles: AiTagProfile[] = [
  {
    id: 1,
    name: '舞蹈 / 人物（演示）',
    description: '演示方案：关注人物形象、服饰、动作、BGM。',
    scope: 'global',
    sourceId: null,
    sourceName: null,
    isDefault: true,
    focus: [...DEFAULT_FOCUS],
    taxonomy: {
      categories: DEFAULT_TAXONOMY.categories.map((category) => ({
        ...category,
        examples: [...(category.examples ?? [])]
      })),
      stopwords: [...DEFAULT_TAXONOMY.stopwords],
      aliases: { ...DEFAULT_TAXONOMY.aliases }
    },
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    maxTags: DEFAULT_MAX_TAGS,
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    language: 'zh-CN',
    useAcrcloud: true,
    useBilibiliTags: true,
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW
  }
];

let demoAcrcloud: AcrCloudSummary = {
  configured: false,
  enabled: false,
  host: 'identify-eu-west-1.acrcloud.com',
  accessKeyHint: null,
  hasSecret: false,
  callsToday: 0
};

let demoConsent: AiConsentState = { acceptedAt: null, hosts: [] };

const demoAiReviewListeners = new Set<() => void>();
function notifyDemoAiReview(): void {
  for (const listener of demoAiReviewListeners) {
    try {
      listener();
    } catch {
      // ignore demo listener errors
    }
  }
}

function demoFrameSet(video: VideoItem): AiReviewItem['frames'] {
  const cover = video.thumbUrl ?? svgCover(video.title, '#7b3a52', '#1d4d63');
  return [
    { index: -1, time: 0, url: cover },
    { index: 0, time: 12, url: svgCover(`${video.title} · 00:12`, '#2b4c7e', '#6e3f6b') },
    { index: 1, time: 45, url: svgCover(`${video.title} · 00:45`, '#3c6b4e', '#1f3c5e') },
    { index: 2, time: 80, url: svgCover(`${video.title} · 01:20`, '#6b4a2b', '#3c2b52') }
  ];
}

function demoReviewItem(video: VideoItem, index: number): AiReviewItem {
  const definitions: Array<[string, string[]]> = [
    ['人物', ['长发', '双马尾']],
    ['服饰', ['JK制服', '过膝袜']],
    ['动作', ['舞蹈']],
    ['BGM', ['《演示曲名》', '电子流行']]
  ];
  const aiTags: AiReviewTag[] = definitions.flatMap(([category, names], categoryIndex) =>
    names.map((name, tagIndex) => ({
      id: index * 100 + categoryIndex * 10 + tagIndex + 1,
      category,
      name,
      confidence: Math.max(0.55, 0.95 - categoryIndex * 0.04 - tagIndex * 0.03),
      source: category === 'BGM' ? 'acrcloud' : 'vision',
      status: 'pending',
      evidence: null,
      edited: false
    }))
  );
  return {
    runId: 1000 + index,
    videoId: video.id,
    videoTitle: video.title,
    upName: video.upName,
    sourceName: video.sourceName,
    duration: video.duration,
    coverUrl: video.thumbUrl,
    reviewStatus: 'pending',
    frames: demoFrameSet(video),
    originalTags: video.tags.map((name, tagIndex) => ({
      name,
      source: tagIndex === 0 ? 'manual' : 'auto'
    })),
    aiTags,
    summary: '演示摘要：人物穿着制服在室内舞台跳舞，画面偏二次元风格。',
    bgm:
      index === 0
        ? {
            title: '《演示曲名》',
            artists: ['演示歌手'],
            genres: ['电子流行'],
            source: 'acrcloud',
            confidence: 0.92
          }
        : null,
    profileName: demoProfiles[0]!.name,
    providerName: demoProviders[0]!.name,
    model: demoProviders[0]!.model,
    inputTokens: 1280,
    outputTokens: 240,
    requestCount: 2,
    musicRequestCount: 1,
    createdAt: DEMO_NOW
  };
}
let demoReviewItems: AiReviewItem[] = localVideos
  .slice(0, 3)
  .map((video, index) => demoReviewItem(video, index));

localVideos = localVideos.map((video, index) => {
  if (index < 3) {
    return { ...video, aiPendingCount: demoReviewItems[index]?.aiTags.length ?? 0 };
  }
  if (index === 3) {
    return {
      ...video,
      aiTags: [
        { name: 'JK制服', category: '服饰', confidence: 0.94, source: 'vision' as const },
        { name: '长发', category: '人物', confidence: 0.91, source: 'vision' as const }
      ],
      aiSummary: '演示摘要：JK 制服人物参考。',
      aiLastRunAt: DEMO_NOW
    };
  }
  return video;
});

let demoBatches: AiBatch[] = [
  {
    id: 1,
    profileName: demoProfiles[0]!.name,
    providerName: demoProviders[0]!.name,
    model: demoProviders[0]!.model,
    total: demoReviewItems.length,
    done: demoReviewItems.length,
    failed: 0,
    requestCount: demoReviewItems.reduce((sum, item) => sum + item.requestCount, 0),
    musicRequestCount: demoReviewItems.reduce((sum, item) => sum + item.musicRequestCount, 0),
    status: 'done',
    createdAt: DEMO_NOW,
    startedAt: DEMO_NOW,
    finishedAt: DEMO_NOW
  }
];

const demoRuns: AiRunSummary[] = demoReviewItems.map((item) => ({
  id: item.runId,
  batchId: 1,
  videoId: item.videoId,
  videoTitle: item.videoTitle,
  coverUrl: item.coverUrl,
  profileId: 1,
  profileName: item.profileName,
  providerId: 'demo-provider',
  providerName: item.providerName,
  model: item.model,
  status: 'done',
  stage: 'done',
  reviewStatus: 'pending',
  error: null,
  inputTokens: item.inputTokens,
  outputTokens: item.outputTokens,
  requestCount: item.requestCount,
  musicRequestCount: item.musicRequestCount,
  frames: item.frames,
  startedAt: DEMO_NOW,
  finishedAt: DEMO_NOW,
  createdAt: item.createdAt
}));

let demoAnalysisRuns: AiAnalysisRun[] = [];

function demoReviewStatus(item: AiReviewItem): AiReviewItem['reviewStatus'] {
  const pending = item.aiTags.filter((tag) => tag.status === 'pending').length;
  const approved = item.aiTags.filter((tag) => tag.status === 'approved').length;
  const rejected = item.aiTags.filter((tag) => tag.status === 'rejected').length;
  if (pending > 0) return 'pending';
  if (approved > 0 && rejected > 0) return 'partial';
  if (approved > 0) return 'approved';
  if (rejected > 0) return 'rejected';
  return 'pending';
}

function demoReviewCounts(): { pending: number; approved: number; rejected: number } {
  const tags = demoReviewItems.flatMap((item) => item.aiTags);
  return {
    pending: tags.filter((tag) => tag.status === 'pending').length,
    approved:
      tags.filter((tag) => tag.status === 'approved').length +
      localVideos.reduce((sum, video) => sum + video.aiTags.length, 0),
    rejected: tags.filter((tag) => tag.status === 'rejected').length
  };
}

function demoAiStats(): AiStats {
  const counts = demoReviewCounts();
  return {
    taggedVideos: new Set([
      ...localVideos.filter((video) => video.aiTags.length > 0).map((video) => video.id),
      ...demoReviewItems.map((item) => item.videoId)
    ]).size,
    pendingTags: counts.pending,
    approvedTags: counts.approved,
    failedRuns: demoRuns.filter((run) => run.status === 'failed').length,
    inputTokens: demoRuns.reduce((sum, run) => sum + run.inputTokens, 0),
    outputTokens: demoRuns.reduce((sum, run) => sum + run.outputTokens, 0),
    modelRequests: demoRuns.reduce((sum, run) => sum + run.requestCount, 0),
    musicRequests: demoRuns.reduce((sum, run) => sum + run.musicRequestCount, 0)
  };
}

function demoAiTagSummaries(): AiTagSummary[] {
  const map = new Map<
    string,
    { id: number; name: string; category: string; count: number; sources: Set<string> }
  >();
  for (const video of localVideos) {
    for (const tag of video.aiTags) {
      const key = `${tag.category}:${tag.name}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.sources.add(tag.source);
      } else {
        map.set(key, {
          id: map.size + 1,
          name: tag.name,
          category: tag.category,
          count: 1,
          sources: new Set([tag.source])
        });
      }
    }
  }
  return Array.from(map.values())
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      count: item.count,
      source: item.sources.size > 1 ? 'mixed' : (Array.from(item.sources)[0] as AiTagSummary['source'])
    }))
    .sort((a, b) => b.count - a.count);
}

function demoAddApprovedTag(videoId: number, tag: AiReviewTag): void {
  localVideos = localVideos.map((video) => {
    if (video.id !== videoId) return video;
    const exists = video.aiTags.some((item) => item.name === tag.name && item.category === tag.category);
    if (exists) return video;
    return {
      ...video,
      aiTags: [
        ...video.aiTags,
        { name: tag.name, category: tag.category, confidence: tag.confidence, source: tag.source }
      ],
      aiSummary: video.aiSummary ?? '演示摘要：AI 已审核通过的标签。',
      aiLastRunAt: new Date().toISOString()
    };
  });
}

function demoRemoveApprovedTag(videoId: number, name: string, category: string): void {
  localVideos = localVideos.map((video) =>
    video.id === videoId
      ? {
          ...video,
          aiTags: video.aiTags.filter((tag) => !(tag.name === name && tag.category === category))
        }
      : video
  );
}

function demoRunDetail(id: number): AiRunDetail | null {
  const run = demoRuns.find((item) => item.id === id);
  if (!run) return null;
  const item = demoReviewItems.find((review) => review.runId === id);
  return {
    ...run,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPrompt: '演示用户提示词：视频标题、UP 主、原始标签和分类体系……',
    rawResponse: JSON.stringify(
      { summary: item?.summary, tags: item?.aiTags ?? [], bgm: item?.bgm ?? null },
      null,
      2
    ),
    result: item
      ? {
          summary: item.summary ?? undefined,
          tags: item.aiTags.map((tag) => ({
            name: tag.name,
            category: tag.category,
            confidence: tag.confidence
          })),
          bgm: item.bgm
        }
      : null,
    toolCalls: []
  };
}

function demoProfileFromInput(input: AiTagProfileInput, id: number): AiTagProfile {
  return {
    id,
    name: input.name,
    description: input.description ?? '',
    scope: input.scope,
    sourceId: input.sourceId ?? null,
    sourceName: input.sourceId
      ? (demoSources.find((source) => source.id === input.sourceId)?.title ?? null)
      : null,
    isDefault: Boolean(input.isDefault),
    focus: [...input.focus],
    taxonomy: input.taxonomy,
    systemPrompt: input.systemPrompt,
    promptTemplate: input.promptTemplate,
    maxTags: input.maxTags,
    minConfidence: input.minConfidence,
    language: input.language,
    useAcrcloud: input.useAcrcloud,
    useBilibiliTags: input.useBilibiliTags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function demoProviderFromInput(input: AiProviderInput, id: string): AiProviderSummary {
  return {
    id,
    name: input.name,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    model: input.model,
    hasApiKey:
      Boolean(input.apiKey) || Boolean(demoProviders.find((provider) => provider.id === id)?.hasApiKey),
    apiKeyHint: input.apiKey
      ? `…${input.apiKey.slice(-4)}`
      : (demoProviders.find((provider) => provider.id === id)?.apiKeyHint ?? null),
    headerKeys: input.headers
      ? Object.keys(input.headers)
      : (demoProviders.find((provider) => provider.id === id)?.headerKeys ?? []),
    capabilities: input.capabilities,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
    imageDetail: input.imageDetail,
    pricing: input.pricing ?? null,
    isDefault: Boolean(input.isDefault) || demoProviders.length === 0,
    custom: input.custom ?? null
  };
}

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
    withAiTags: localVideos.filter((video) => video.aiTags.length > 0).length,
    totalBytes: localVideos.reduce((sum, video) => sum + (video.fileSize ?? 0), 0)
  };
}

export const demoApi: BilishelfApi = {
  app: {
    info: () =>
      delay({
        version: '0.3.0-demo',
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
          const haystack =
            `${video.title} ${video.upName ?? ''} ${video.tags.join(' ')} ${video.note}`.toLowerCase();
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
    list: () =>
      delay({
        items: localJobs,
        total: localJobs.length,
        counts: {
          active: localJobs.filter((job) =>
            ['resolving', 'downloading', 'postprocessing'].includes(job.status)
          ).length,
          pausable: localJobs.filter((job) => ['resolving', 'downloading'].includes(job.status)).length,
          queued: localJobs.filter((job) => job.status === 'queued').length,
          paused: localJobs.filter((job) => job.status === 'paused').length
        }
      }),
    pause: async () => undefined,
    resume: async () => undefined,
    pauseAll: async () => {
      let count = 0;
      localJobs = localJobs.map((job) => {
        if (!['queued', 'resolving', 'downloading', 'postprocessing'].includes(job.status)) return job;
        count += 1;
        return { ...job, status: 'paused' };
      });
      return count;
    },
    resumeAll: async () => {
      let count = 0;
      localJobs = localJobs.map((job) => {
        if (job.status !== 'paused') return job;
        count += 1;
        return { ...job, status: 'queued' };
      });
      return count;
    },
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
  ai: {
    providers: {
      list: () => delay(demoProviders.map((provider) => ({ ...provider }))),
      save: (input) => {
        const id = input.id ?? `demo-provider-${demoProviderSeq++}`;
        const next = demoProviderFromInput(input, id);
        demoProviders = input.id
          ? demoProviders.map((provider) => (provider.id === id ? next : provider))
          : [...demoProviders, next];
        if (next.isDefault) {
          demoProviders = demoProviders.map((provider) => ({ ...provider, isDefault: provider.id === id }));
        }
        if (!demoProviders.some((provider) => provider.isDefault) && demoProviders[0]) {
          demoProviders = demoProviders.map((provider, index) => ({ ...provider, isDefault: index === 0 }));
        }
        return delay(demoProviders);
      },
      remove: (id) => {
        demoProviders = demoProviders.filter((provider) => provider.id !== id);
        if (demoProviders.length > 0 && !demoProviders.some((provider) => provider.isDefault)) {
          demoProviders = demoProviders.map((provider, index) => ({ ...provider, isDefault: index === 0 }));
        }
        return delay(demoProviders);
      },
      setDefault: (id) => {
        demoProviders = demoProviders.map((provider) => ({ ...provider, isDefault: provider.id === id }));
        return delay(demoProviders);
      },
      test: () =>
        delay({
          ok: true,
          latencyMs: 42,
          status: 200,
          message: '演示模式：连接测试通过（未发起真实请求）',
          visionOk: true,
          jsonOk: true,
          raw: 'OK'
        }),
      probe: () =>
        delay({
          models: [
            {
              id: 'demo-vlm',
              name: 'Demo VLM',
              vision: true,
              tools: true,
              jsonMode: true,
              maxOutputTokens: 1200,
              contextWindow: 128000,
              pricing: null,
              inputModalities: ['text', 'image/png', 'image/jpeg']
            },
            {
              id: 'demo-text',
              name: 'Demo Text',
              vision: false,
              tools: false,
              jsonMode: true,
              maxOutputTokens: 4096,
              contextWindow: 128000,
              pricing: null,
              inputModalities: ['text']
            }
          ],
          message: '演示模式：已读取 2 个模型，包含能力元数据；选择模型会自动填入配置。'
        })
    },
    acrcloud: {
      get: () => delay({ ...demoAcrcloud }),
      save: (input) => {
        demoAcrcloud = {
          ...demoAcrcloud,
          enabled: input.enabled ?? demoAcrcloud.enabled,
          host: input.host ?? demoAcrcloud.host,
          configured: Boolean(input.accessKey || demoAcrcloud.configured),
          accessKeyHint: input.accessKey ? `…${input.accessKey.slice(-4)}` : demoAcrcloud.accessKeyHint,
          hasSecret: Boolean(input.accessSecret || demoAcrcloud.hasSecret)
        };
        return delay({ ...demoAcrcloud });
      },
      test: () =>
        delay({
          ok: demoAcrcloud.configured,
          latencyMs: 38,
          status: 200,
          message: demoAcrcloud.configured
            ? '演示模式：ACRCloud 鉴权成功'
            : '演示模式：请先填写 ACRCloud 凭据',
          code: demoAcrcloud.configured ? 1001 : null
        })
    },
    profiles: {
      list: () => delay(demoProfiles.map((profile) => ({ ...profile }))),
      save: (input) => {
        const id = input.id ?? demoProfileSeq++;
        const next = demoProfileFromInput(input, id);
        demoProfiles = input.id
          ? demoProfiles.map((profile) => (profile.id === id ? next : profile))
          : [...demoProfiles, next];
        if (next.isDefault && next.scope === 'global') {
          demoProfiles = demoProfiles.map((profile) => ({
            ...profile,
            isDefault: profile.scope === 'global' ? profile.id === id : false
          }));
        }
        return delay(demoProfiles);
      },
      remove: (id) => {
        demoProfiles = demoProfiles.filter((profile) => profile.id !== id);
        if (demoProfiles.length > 0 && !demoProfiles.some((profile) => profile.isDefault)) {
          demoProfiles = demoProfiles.map((profile, index) => ({ ...profile, isDefault: index === 0 }));
        }
        return delay(demoProfiles);
      },
      setDefault: (id) => {
        demoProfiles = demoProfiles.map((profile) => ({
          ...profile,
          isDefault: profile.scope === 'global' ? profile.id === id : profile.isDefault
        }));
        return delay(demoProfiles);
      },
      duplicate: (id) => {
        const source = demoProfiles.find((profile) => profile.id === id);
        if (!source) return delay(demoProfiles);
        const copy: AiTagProfile = {
          ...source,
          id: demoProfileSeq++,
          name: `${source.name} 副本`,
          scope: 'global',
          sourceId: null,
          sourceName: null,
          isDefault: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        demoProfiles = [...demoProfiles, copy];
        return delay(demoProfiles);
      }
    },
    consent: {
      get: () => delay({ ...demoConsent }),
      accept: (hosts) => {
        demoConsent = { acceptedAt: new Date().toISOString(), hosts: Array.from(new Set(hosts)) };
        return delay({ ...demoConsent });
      }
    },
    queue: {
      enqueue: (input) => {
        const count = input.videoIds?.length ?? Math.min(3, localVideos.length);
        const id = demoBatches.length + 1;
        const batch: AiBatch = {
          id,
          profileName: demoProfiles[0]?.name ?? null,
          providerName: demoProviders[0]?.name ?? null,
          model: demoProviders[0]?.model ?? null,
          total: count,
          done: count,
          failed: 0,
          requestCount: 1,
          musicRequestCount: 0,
          status: 'done',
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString()
        };
        demoBatches = [batch, ...demoBatches];
        return delay({ batchId: id, queued: count, skipped: 0 });
      },
      consent: () => delay({ hosts: [], required: false }),
      batches: () => {
        const counts = demoReviewCounts();
        return delay({
          batches: demoBatches.map((batch) => ({ ...batch })),
          pendingReview: counts.pending,
          running: demoBatches.filter((batch) => batch.status === 'running').length
        });
      },
      pause: async (id) => {
        demoBatches = demoBatches.map((batch) => (batch.id === id ? { ...batch, status: 'paused' } : batch));
      },
      resume: async (id) => {
        demoBatches = demoBatches.map((batch) => (batch.id === id ? { ...batch, status: 'queued' } : batch));
      },
      cancel: async (id) => {
        demoBatches = demoBatches.map((batch) =>
          batch.id === id ? { ...batch, status: 'canceled' } : batch
        );
      },
      retryFailed: async (id) => {
        demoBatches = demoBatches.map((batch) => (batch.id === id ? { ...batch, status: 'queued' } : batch));
      },
      runs: (query) => {
        let items = demoRuns.filter((run) => !query.batchId || run.batchId === query.batchId);
        if (query.status && query.status !== 'all')
          items = items.filter((run) => run.status === query.status);
        return delay({ items, total: items.length });
      },
      getRun: (id) => delay(demoRunDetail(id)),
      onQueue: () => () => undefined,
      onProgress: () => () => undefined
    },
    review: {
      list: (query) => {
        let items = [...demoReviewItems];
        const status = query.status ?? 'pending';
        if (status === 'pending')
          items = items.filter((item) => item.aiTags.some((tag) => tag.status === 'pending'));
        else if (status === 'approved') items = items.filter((item) => item.reviewStatus === 'approved');
        else if (status === 'rejected') items = items.filter((item) => item.reviewStatus === 'rejected');
        else if (status === 'partial') items = items.filter((item) => item.reviewStatus === 'partial');
        if (query.videoId) items = items.filter((item) => item.videoId === query.videoId);
        if (query.search?.trim()) {
          const needle = query.search.trim().toLowerCase();
          items = items.filter(
            (item) =>
              item.videoTitle.toLowerCase().includes(needle) ||
              (item.upName ?? '').toLowerCase().includes(needle) ||
              item.aiTags.some((tag) => tag.name.toLowerCase().includes(needle))
          );
        }
        if (query.minConfidence !== undefined) {
          items = items.filter((item) => item.aiTags.some((tag) => tag.confidence >= query.minConfidence!));
        }
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 50;
        return delay({ items: items.slice(offset, offset + limit), total: items.length });
      },
      counts: () => delay(demoReviewCounts()),
      approve: (decision) => {
        const runIds = new Set(decision.runIds);
        const tagIds = decision.tagIds ? new Set(decision.tagIds) : null;
        let approved = 0;
        const videoIds = new Set<number>();
        demoReviewItems = demoReviewItems.map((item) => {
          if (!runIds.has(item.runId)) return item;
          const nextTags = item.aiTags.map((tag) => {
            if (tag.status !== 'pending') return tag;
            if (tagIds && !tagIds.has(tag.id)) return tag;
            approved += 1;
            videoIds.add(item.videoId);
            demoAddApprovedTag(item.videoId, tag);
            return { ...tag, status: 'approved' as const };
          });
          const next = { ...item, aiTags: nextTags };
          return { ...next, reviewStatus: demoReviewStatus(next) };
        });
        notifyDemoAiReview();
        return delay({
          approved,
          rejected: 0,
          affectedVideos: videoIds.size,
          videoIds: Array.from(videoIds)
        });
      },
      reject: (decision) => {
        const runIds = new Set(decision.runIds);
        const tagIds = decision.tagIds ? new Set(decision.tagIds) : null;
        let rejected = 0;
        const videoIds = new Set<number>();
        demoReviewItems = demoReviewItems.map((item) => {
          if (!runIds.has(item.runId)) return item;
          const nextTags = item.aiTags.map((tag) => {
            if (tag.status !== 'pending') return tag;
            if (tagIds && !tagIds.has(tag.id)) return tag;
            rejected += 1;
            videoIds.add(item.videoId);
            return { ...tag, status: 'rejected' as const };
          });
          const next = { ...item, aiTags: nextTags };
          return { ...next, reviewStatus: demoReviewStatus(next) };
        });
        notifyDemoAiReview();
        return delay({
          approved: 0,
          rejected,
          affectedVideos: videoIds.size,
          videoIds: Array.from(videoIds)
        });
      },
      updateTag: (patch) => {
        let updated: AiReviewItem | null = null;
        demoReviewItems = demoReviewItems.map((item) => {
          if (!item.aiTags.some((tag) => tag.id === patch.tagId)) return item;
          const next = {
            ...item,
            aiTags: item.aiTags.map((tag) =>
              tag.id === patch.tagId
                ? {
                    ...tag,
                    name: patch.name ?? tag.name,
                    category: patch.category ?? tag.category,
                    confidence: patch.confidence ?? tag.confidence,
                    edited: true
                  }
                : tag
            )
          };
          updated = { ...next, reviewStatus: demoReviewStatus(next) };
          return updated;
        });
        return delay(updated);
      },
      addTag: (input) => {
        let updated: AiReviewItem | null = null;
        demoReviewItems = demoReviewItems.map((item) => {
          if (item.runId !== input.runId) return item;
          const next = {
            ...item,
            aiTags: [
              ...item.aiTags,
              {
                id: demoReviewTagSeq++,
                category: input.category,
                name: input.name,
                confidence: input.confidence ?? 0.8,
                source: 'vision' as const,
                status: 'pending' as const,
                evidence: null,
                edited: true
              }
            ]
          };
          updated = { ...next, reviewStatus: demoReviewStatus(next) };
          return updated;
        });
        return delay(updated);
      },
      removeTag: (input) => {
        let updated: AiReviewItem | null = null;
        demoReviewItems = demoReviewItems.map((item) => {
          if (!item.aiTags.some((tag) => tag.id === input.tagId)) return item;
          const next = { ...item, aiTags: item.aiTags.filter((tag) => tag.id !== input.tagId) };
          updated = { ...next, reviewStatus: demoReviewStatus(next) };
          return updated;
        });
        return delay(updated);
      },
      restoreTag: (input) => {
        let updated: AiReviewItem | null = null;
        demoReviewItems = demoReviewItems.map((item) => {
          if (!item.aiTags.some((tag) => tag.id === input.tagId)) return item;
          const next = {
            ...item,
            aiTags: item.aiTags.map((tag) =>
              tag.id === input.tagId ? { ...tag, status: 'pending' as const } : tag
            )
          };
          updated = { ...next, reviewStatus: demoReviewStatus(next) };
          return updated;
        });
        return delay(updated);
      },
      unapprove: (input) => {
        demoRemoveApprovedTag(input.videoId, input.name, input.category);
        demoReviewItems = demoReviewItems.map((item) => {
          if (item.videoId !== input.videoId) return item;
          const next = {
            ...item,
            aiTags: item.aiTags.map((tag) =>
              tag.name === input.name && tag.category === input.category && tag.status === 'approved'
                ? { ...tag, status: 'pending' as const }
                : tag
            )
          };
          return { ...next, reviewStatus: demoReviewStatus(next) };
        });
        notifyDemoAiReview();
        return delay({ approved: 0, rejected: 0, affectedVideos: 1, videoIds: [input.videoId] });
      },
      onChanged: (callback) => {
        demoAiReviewListeners.add(callback);
        return () => demoAiReviewListeners.delete(callback);
      }
    },
    tags: {
      list: () => delay(demoAiTagSummaries())
    },
    stats: () => delay(demoAiStats()),
    analysis: {
      estimate: (input) =>
        delay({
          videos: input.videoIds?.length ?? input.sampleSize,
          requests: input.mode === 'text' ? 1 : 3,
          imageCount: input.mode === 'text' ? 0 : 6,
          approxInputTokens: 2400,
          approxOutputTokens: 1200,
          warnings: []
        }),
      run: (input) => {
        const result: NonNullable<AiAnalysisRun['result']> = {
          summary: '演示分析：这个库以动画参考、设计教程和摄影为主，建议关注人物形象、服饰、场景和 BGM。',
          categories: DEFAULT_TAXONOMY.categories.map((category) => ({
            name: category.name,
            description: category.description ?? '',
            tags: category.examples ?? [],
            coverage: 0.7
          })),
          focus: [...DEFAULT_FOCUS],
          stopwords: [...DEFAULT_TAXONOMY.stopwords],
          aliases: {},
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          promptTemplate: DEFAULT_PROMPT_TEMPLATE,
          notes: ['演示数据']
        };
        const run: AiAnalysisRun = {
          id: demoAnalysisRuns.length + 1,
          mode: input.mode,
          status: 'done',
          providerName: demoProviders[0]?.name ?? null,
          model: demoProviders[0]?.model ?? null,
          sample: localVideos.slice(0, Math.min(input.sampleSize, 8)).map((video) => ({
            videoId: video.id,
            title: video.title,
            coverUrl: video.thumbUrl
          })),
          result,
          inputTokens: 2400,
          outputTokens: 1200,
          error: null,
          createdAt: new Date().toISOString(),
          finishedAt: new Date().toISOString()
        };
        demoAnalysisRuns = [run, ...demoAnalysisRuns];
        return delay(run);
      },
      history: () => delay(demoAnalysisRuns),
      get: (id) => delay(demoAnalysisRuns.find((run) => run.id === id) ?? null),
      saveAsProfile: (input) => {
        const run = demoAnalysisRuns.find((item) => item.id === input.runId);
        if (!run?.result) return delay(demoProfiles);
        const profile: AiTagProfile = {
          id: demoProfileSeq++,
          name: input.name,
          description: run.result.summary.slice(0, 200),
          scope: input.scope,
          sourceId: input.scope === 'source' ? (input.sourceId ?? null) : null,
          sourceName: null,
          isDefault: Boolean(input.isDefault),
          focus: run.result.focus,
          taxonomy: {
            categories: run.result.categories.map((category) => ({
              name: category.name,
              description: category.description,
              examples: category.tags
            })),
            stopwords: run.result.stopwords,
            aliases: run.result.aliases
          },
          systemPrompt: run.result.systemPrompt,
          promptTemplate: run.result.promptTemplate,
          maxTags: DEFAULT_MAX_TAGS,
          minConfidence: DEFAULT_MIN_CONFIDENCE,
          language: 'zh-CN',
          useAcrcloud: true,
          useBilibiliTags: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        demoProfiles = [...demoProfiles, profile];
        return delay(demoProfiles);
      },
      onProgress: () => () => undefined
    },
    maintenance: {
      cleanup: () =>
        delay({ total: 0, updated: 0, failed: 0, bytesFreed: 0, details: '演示模式：没有需要清理的缓存' })
    }
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
