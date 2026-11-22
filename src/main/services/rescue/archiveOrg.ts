/**
 * Internet Archive `bilibili_videos` 合集的最小客户端。
 * 刻意不依赖 electron：解析函数可以直接单测，也能在脚本里复用。
 */

const SEARCH_ENDPOINT = 'https://archive.org/advancedsearch.php';
const METADATA_ENDPOINT = 'https://archive.org/metadata';
const DOWNLOAD_ENDPOINT = 'https://archive.org/download';
const USER_AGENT = 'BiliShelf/0.3 (+local archival tool)';

/** 两次 IA 请求之间至少间隔多久，避免被限流。 */
const MIN_INTERVAL_MS = 350;
let lastRequestAt = 0;

/**
 * IA 在国内直连会超时（实测 Node 原生 fetch 报 UND_ERR_CONNECT_TIMEOUT），
 * 必须走系统代理。所以这里允许注入 Electron 的 net.fetch（走 Chromium 网络栈），
 * 测试与脚本则退回 Node 原生 fetch。
 */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
let fetcher: FetchLike = (input, init) => fetch(input, init);

export function setArchiveFetcher(next: FetchLike): void {
  fetcher = next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 超时用 Promise.race，不传 AbortSignal（Electron 的 session/net fetch 传 signal 会直接失败）。 */
async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    task,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs))
  ]);
}

async function politeFetch(url: string, init: RequestInit = {}, timeoutMs = 25_000): Promise<Response> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return withTimeout(
    fetcher(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) } }),
    timeoutMs,
    'IA 请求'
  );
}

export interface IaDoc {
  identifier: string;
  title: string | null;
  itemSize: number | null;
}

/** advancedsearch 的返回：{ response: { numFound, docs: [...] } } */
export function parseSearchResponse(json: unknown): IaDoc[] {
  const docs = (json as { response?: { docs?: unknown[] } } | null)?.response?.docs;
  if (!Array.isArray(docs)) return [];
  const out: IaDoc[] = [];
  for (const entry of docs) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const identifier = typeof row.identifier === 'string' ? row.identifier : null;
    if (!identifier) continue;
    // fl[] 不同字段时 title 可能是数组
    const rawTitle = row.title;
    const title = Array.isArray(rawTitle)
      ? typeof rawTitle[0] === 'string'
        ? rawTitle[0]
        : null
      : typeof rawTitle === 'string'
        ? rawTitle
        : null;
    const size = Number(row.item_size);
    out.push({ identifier, title, itemSize: Number.isFinite(size) && size > 0 ? size : null });
  }
  return out;
}

async function search(query: string, rows: number): Promise<IaDoc[]> {
  const params = new URLSearchParams();
  params.set('q', query);
  for (const field of ['identifier', 'title', 'item_size']) params.append('fl[]', field);
  params.set('rows', String(rows));
  params.set('page', '1');
  params.set('output', 'json');

  const response = await politeFetch(`${SEARCH_ENDPOINT}?${params.toString()}`);
  if (!response.ok) throw new Error(`IA 检索失败：HTTP ${response.status}`);
  return parseSearchResponse(await response.json());
}

/** ① identifier 精确：BiliBili-<bvid> 前缀。 */
export async function searchByIdentifier(bvid: string, rows = 20): Promise<IaDoc[]> {
  return search(`identifier:(BiliBili-${bvid}) OR identifier:(BiliBili-${bvid}*)`, rows);
}

/**
 * ③ 标题召回。中文在 IA 的全文索引里分词很差，只在库内 title 不是「已失效视频」时才有意义。
 */
export async function searchByTitle(title: string, rows = 20): Promise<IaDoc[]> {
  const cleaned = title.replace(/["\\]/g, ' ').trim();
  if (cleaned.length < 2) return [];
  return search(`collection:bilibili_videos AND mediatype:movies AND title:"${cleaned}"`, rows);
}

/**
 * ④ 按 UP 名（IA 的 creator 字段）召回。
 * 失效条目的标题已经被 B 站覆盖成「已失效视频」，bvid 又在 IA 里查不到时，
 * 这是唯一还能用的线索：同一个 UP 的存档往往是一批一起归档的。
 */
export async function searchByCreator(upName: string, rows = 30): Promise<IaDoc[]> {
  const cleaned = upName.replace(/["\\]/g, ' ').trim();
  if (cleaned.length < 2) return [];
  return search(`collection:bilibili_videos AND creator:"${cleaned}"`, rows);
}

export interface IaFileInfo {
  name: string;
  size: number | null;
  md5: string | null;
  format: string | null;
  source: string | null;
}

export interface IaItem {
  identifier: string;
  title: string | null;
  server: string | null;
  dir: string | null;
  files: IaFileInfo[];
}

/** /metadata/<id> 的返回。size 在 IA 里是字符串，这里统一成数字。 */
export function parseItemResponse(identifier: string, json: unknown): IaItem | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as Record<string, unknown>;
  const rawFiles = body.files;
  if (!Array.isArray(rawFiles)) return null;
  const files: IaFileInfo[] = [];
  for (const entry of rawFiles) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : null;
    if (!name) continue;
    const size = Number(row.size);
    files.push({
      name,
      size: Number.isFinite(size) && size > 0 ? size : null,
      md5: typeof row.md5 === 'string' ? row.md5 : null,
      format: typeof row.format === 'string' ? row.format : null,
      source: typeof row.source === 'string' ? row.source : null
    });
  }
  const metadata = (body.metadata ?? {}) as Record<string, unknown>;
  const rawTitle = metadata.title;
  return {
    identifier,
    title: typeof rawTitle === 'string' ? rawTitle : null,
    server: typeof body.server === 'string' ? body.server : null,
    dir: typeof body.dir === 'string' ? body.dir : null,
    files
  };
}

export async function fetchItem(identifier: string): Promise<IaItem | null> {
  try {
    const response = await politeFetch(`${METADATA_ENDPOINT}/${encodeURIComponent(identifier)}`);
    if (!response.ok) return null;
    return parseItemResponse(identifier, await response.json());
  } catch {
    return null;
  }
}

const VIDEO_EXT = /\.(mp4|mkv|webm|flv)$/i;
/** IA 会额外生成一份体积更小的 `_p1.ia.mp4` 派生文件，不能当成原片。 */
const IA_DERIVATIVE = /\.ia\.[a-z0-9]+$/i;

export interface IaAssets {
  video: IaFileInfo | null;
  infoJson: IaFileInfo | null;
  cover: IaFileInfo | null;
  /** xml 或 protobuf 弹幕 */
  danmaku: IaFileInfo | null;
  /** ass 弹幕（可直接当字幕加载） */
  subtitle: IaFileInfo | null;
}

/**
 * 从条目文件列表里挑出需要的东西：
 * 视频优先 `source=original` 的最大 mp4，排除 `.ia.mp4` 派生文件与 `.thumbs/` 目录。
 */
export function pickAssets(item: IaItem): IaAssets {
  const videos = item.files.filter(
    (file) => VIDEO_EXT.test(file.name) && !IA_DERIVATIVE.test(file.name) && !file.name.includes('.thumbs/')
  );
  videos.sort((a, b) => {
    const originalDiff = Number(b.source === 'original') - Number(a.source === 'original');
    if (originalDiff !== 0) return originalDiff;
    return (b.size ?? 0) - (a.size ?? 0);
  });
  const video = videos[0] ?? null;

  const infoJson =
    item.files.find((file) => file.name.toLowerCase().endsWith('.info.json')) ??
    item.files.find((file) => file.name.toLowerCase() === 'info.json') ??
    null;

  const imageFiles = item.files.filter(
    (file) => /\.(jpg|jpeg|png|webp)$/i.test(file.name) && !file.name.includes('.thumbs/')
  );
  const cover =
    imageFiles.find((file) => /itemimage/i.test(file.name)) ??
    imageFiles.find((file) => /(cover|poster)/i.test(file.name)) ??
    // 默认封面是 `<bvid>_p1.jpg`，既不是 thumb 也不是 itemimage
    imageFiles.find((file) => !/thumb/i.test(file.name)) ??
    imageFiles[0] ??
    null;

  const danmaku =
    item.files.find((file) => /danmaku.*\.xml$/i.test(file.name)) ??
    item.files.find((file) => /弹幕.*\.(pb|xml)$/i.test(file.name)) ??
    item.files.find((file) => /\.(pb)$/i.test(file.name)) ??
    null;

  const subtitle =
    item.files.find((file) => /弹幕.*\.ass$/i.test(file.name)) ??
    item.files.find((file) => /\.ass$/i.test(file.name)) ??
    null;

  return { video, infoJson, cover, danmaku, subtitle };
}

export function downloadUrl(identifier: string, fileName: string): string {
  return `${DOWNLOAD_ENDPOINT}/${encodeURIComponent(identifier)}/${fileName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

/** info.json 只有几十 KB，直接取全文；超过上限返回 null。 */
export async function fetchInfoJson(
  identifier: string,
  file: IaFileInfo,
  maxBytes = 400_000
): Promise<Record<string, unknown> | null> {
  if (file.size != null && file.size > maxBytes) return null;
  try {
    const response = await politeFetch(downloadUrl(identifier, file.name), {}, 20_000);
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > maxBytes) return null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 有些归档者把 UTF-8 的中文按 latin1 存进了 JSON，读出来是「ãæ´æ©ä¾å」这类乱码。
 * 这里做一次「latin1 → utf8」还原，只有还原结果确实是中文才采用。
 */
export function fixMojibake(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/[\u0080-\u00ff]/.test(value)) return value;
  const fixed = Buffer.from(value, 'latin1').toString('utf8');
  if (fixed.includes('\uFFFD')) return value;
  return /\p{Script=Han}/u.test(fixed) ? fixed : value;
}

export interface ArchiveInfo {
  bvid: string | null;
  title: string | null;
  duration: number | null;
  uploader: string | null;
  uploadDate: string | null;
  /** 原稿件是充电专属/付费内容（这种不参与补档） */
  paid: boolean;
}

/**
 * 解析条目里的 info.json。
 * IA 的 `bilibili_videos` 实际存的是 B 站 view 接口的原始返回（`data.View`），
 * 少数条目才是 yt-dlp 的 info.json，两种都要认。
 */
export function readInfoJson(info: Record<string, unknown>): ArchiveInfo {
  const num = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? fixMojibake(value) : null;

  const view = (info.data as { View?: Record<string, unknown> } | undefined)?.View;
  if (view) {
    const rights = (view.rights ?? {}) as Record<string, unknown>;
    return {
      bvid: str(view.bvid),
      title: str(view.title),
      duration: num(view.duration),
      uploader: str((view.owner as Record<string, unknown> | undefined)?.name),
      uploadDate: null,
      paid:
        rights.pay === 1 ||
        view.is_upower_exclusive === true ||
        view.is_charge_video === true ||
        num(view.ugc_pay) !== null
    };
  }

  return {
    bvid: str(info.id),
    title: str(info.title),
    duration: num(info.duration),
    uploader: str(info.uploader) ?? str(info.channel),
    uploadDate: str(info.upload_date),
    paid: false
  };
}
