import log from 'electron-log/main';
import { biliSession } from '../auth';

const API = 'https://api.bilibili.com';
const HEADERS = { Referer: 'https://www.bilibili.com/' };

export interface RecoveredTitle {
  bvid: string;
  title: string;
  cover: string | null;
  upName: string | null;
  upMid: number | null;
}

interface HistoryEntry {
  title?: string;
  cover?: string;
  author_name?: string;
  author_mid?: number;
  history?: { bvid?: string; page?: number } | null;
}

interface HistoryBody {
  code?: number;
  message?: string;
  data?: { list?: HistoryEntry[] | null; cursor?: { max?: number; view_at?: number } | null } | null;
}

/** 历史记录的两种返回结构都认：web 的 cursor 接口和 app 的 v2 接口字段一致。 */
export function parseHistoryPage(body: HistoryBody): {
  entries: RecoveredTitle[];
  cursor: { max: number; view_at: number } | null;
  code: number;
  message: string;
} {
  const entries: RecoveredTitle[] = [];
  for (const entry of body.data?.list ?? []) {
    const bvid = entry.history?.bvid?.toUpperCase();
    const title = (entry.title ?? '').trim();
    if (!bvid || !title) continue;
    entries.push({
      bvid,
      title,
      cover: entry.cover ?? null,
      upName: entry.author_name ?? null,
      upMid: entry.author_mid ?? null
    });
  }
  const cursor = body.data?.cursor;
  return {
    entries,
    cursor:
      cursor && (typeof cursor.max === 'number' || typeof cursor.view_at === 'number')
        ? { max: cursor.max ?? 0, view_at: cursor.view_at ?? 0 }
        : null,
    code: typeof body.code === 'number' ? body.code : -1,
    message: body.message ?? ''
  };
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<HistoryBody | null> {
  try {
    const response = await Promise.race([
      biliSession().fetch(url, { headers: HEADERS }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('请求超时')), timeoutMs))
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as HistoryBody;
  } catch (error) {
    log.warn('[rescue] history request failed', (error as Error).message);
    return null;
  }
}

/**
 * 从「观看历史」里找回失效稿件的真实标题。
 * 收藏夹接口对失效稿件只返回「已失效视频」，历史记录里通常仍保留原标题与 UP 名，
 * 有了标题才能用 B 站搜索 / IA 标题召回做补档。
 *
 * 两个端点都试：web 的 cursor 接口优先（不需要 app 参数），失败退回 app 的 v2 接口。
 */
export async function recoverTitlesFromHistory(
  bvids: string[],
  options: { maxPages?: number; onProgress?: (page: number) => void } = {}
): Promise<{ found: Map<string, RecoveredTitle>; pages: number; scanned: number; errors: string[] }> {
  const wanted = new Set(bvids.map((bvid) => bvid.toUpperCase()));
  const found = new Map<string, RecoveredTitle>();
  const errors: string[] = [];
  const maxPages = Math.min(Math.max(options.maxPages ?? 20, 1), 100);
  let pages = 0;
  let scanned = 0;

  const endpoints = [
    (cursor: { max: number; view_at: number }) =>
      `${API}/x/web-interface/history/cursor?ps=30&max=${cursor.max}&view_at=${cursor.view_at}&business=&type=archive`,
    (cursor: { max: number; view_at: number }) =>
      `${API}/x/v2/history?ps=30&max=${cursor.max}&viewed_at=${cursor.view_at}`
  ];

  let endpointIndex = 0;
  let cursor = { max: 0, view_at: 0 };

  for (let page = 0; page < maxPages; page += 1) {
    if (found.size >= wanted.size) break;
    const body = await fetchJson(endpoints[endpointIndex]!(cursor));
    if (!body) {
      errors.push('历史接口请求失败');
      break;
    }
    const parsed = parseHistoryPage(body);
    if (parsed.code !== 0) {
      // 第一个端点不可用就换下一个，从第一页重新开始
      if (endpointIndex + 1 < endpoints.length) {
        errors.push(`endpoint${endpointIndex + 1}: ${parsed.code} ${parsed.message}`);
        endpointIndex += 1;
        cursor = { max: 0, view_at: 0 };
        page -= 1;
        continue;
      }
      errors.push(`历史接口返回 ${parsed.code} ${parsed.message}`);
      break;
    }
    if (parsed.entries.length === 0) break;
    pages += 1;
    scanned += parsed.entries.length;

    for (const entry of parsed.entries) {
      if (!wanted.has(entry.bvid) || found.has(entry.bvid)) continue;
      found.set(entry.bvid, entry);
    }

    if (!parsed.cursor) break;
    if (parsed.cursor.max === cursor.max && parsed.cursor.view_at === cursor.view_at) break;
    cursor = parsed.cursor;
    options.onProgress?.(page + 1);
  }

  log.info(
    '[rescue] history scan',
    JSON.stringify({ pages, scanned, wanted: wanted.size, found: found.size, errors })
  );
  return { found, pages, scanned, errors };
}
