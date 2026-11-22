import log from 'electron-log/main';
import { biliSession } from '../auth';

const API = 'https://api.bilibili.com';
/** 只带 Referer：带 Origin 时部分接口返回 code:0 但 data:null（与 biliApi 保持一致）。 */
const HEADERS = { Referer: 'https://www.bilibili.com/' };

export type AvailabilityVerdict = 'local' | 'alive' | 'reviewing' | 'paid' | 'private' | 'dead' | 'unknown';

export interface AvailabilityProbe {
  bvid: string;
  verdict: Exclude<AvailabilityVerdict, 'local'>;
  code: number;
  message: string;
  title: string | null;
  duration: number | null;
  upName: string | null;
  upMid: number | null;
  pageCount: number;
  /** 充电专属 / 付费 / 课程 */
  paid: boolean;
  /** pagelist 接口的返回码：0 = 稿件记录还在；-404 = 彻底没了 */
  pageListCode: number | null;
}

interface ViewBody {
  code?: number;
  message?: string;
  data?: {
    title?: string;
    duration?: number;
    state?: number;
    owner?: { mid?: number; name?: string };
    rights?: { pay?: number };
    is_upower_exclusive?: boolean;
    is_charge_video?: boolean;
    pages?: Array<{ cid?: number; page?: number }>;
    ugc_pay?: number;
  } | null;
}

/**
 * 把 view 接口的返回映射成初判结论。
 * 注意 62002「稿件不可见」是个筐：审核中、下架、私密、彻底删除都会返回它，
 * 必须再用 pagelist 区分（见 refineWithPageList）。
 */
export function mapViewResponse(bvid: string, body: ViewBody): AvailabilityProbe {
  const code = typeof body.code === 'number' ? body.code : -1;
  const message = body.message ?? '';
  const data = body.data ?? null;
  const base: AvailabilityProbe = {
    bvid,
    verdict: 'unknown',
    code,
    message,
    title: data?.title ?? null,
    duration: typeof data?.duration === 'number' && data.duration > 0 ? data.duration : null,
    upName: data?.owner?.name ?? null,
    upMid: data?.owner?.mid ?? null,
    pageCount: data?.pages?.length ?? 0,
    paid: false,
    pageListCode: null
  };

  if (code === 0 && data) {
    const paid =
      data.rights?.pay === 1 ||
      data.is_upower_exclusive === true ||
      data.is_charge_video === true ||
      data.ugc_pay === 1;
    return { ...base, verdict: paid ? 'paid' : 'alive', paid };
  }
  if (code === 62004) return { ...base, verdict: 'reviewing' };
  if (code === -404) return { ...base, verdict: 'dead' };
  if (code === 62002 || code === -403 || code === 62012 || code === 62013) {
    return { ...base, verdict: 'private' };
  }
  return base;
}

/**
 * 用 /x/player/pagelist 区分「记录还在但不可见」与「彻底没了」。
 * 实测：真正被删的稿件 view 返回 62002，但 pagelist 返回 -404「啥都木有」；
 * 审核中 / 私密的稿件 pagelist 仍会返回 cid 列表。
 */
export function refineWithPageList(probe: AvailabilityProbe, pageListCode: number | null): AvailabilityProbe {
  const refined: AvailabilityProbe = { ...probe, pageListCode };
  if (probe.verdict === 'alive' || probe.verdict === 'paid' || probe.verdict === 'unknown') return refined;
  if (pageListCode === null) return refined;

  if (pageListCode === -404) return { ...refined, verdict: 'dead' };
  if (pageListCode === 0) {
    // 62004 明确是审核中；其余「不可见」按私密/下架处理（UP 可能重新公开）
    return { ...refined, verdict: probe.verdict === 'reviewing' ? 'reviewing' : 'private' };
  }
  return refined;
}

/**
 * 超时用 Promise.race 实现，不传 AbortSignal：
 * 实测给 Electron 的 session.fetch 传 signal 会让请求直接失败（fetch failed）。
 */
async function fetchJson(
  url: string,
  timeoutMs = 12_000,
  attempts = 2
): Promise<Record<string, unknown> | null> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      const response = await Promise.race([
        biliSession().fetch(url, { headers: HEADERS }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('请求超时')), timeoutMs)
        )
      ]);
      if (!response.ok && response.status !== 404) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('请求失败');
}

/** 复核单个 bvid 的真实状态（只读，不改库）。 */
export async function probeAvailability(bvid: string): Promise<AvailabilityProbe> {
  let view: AvailabilityProbe;
  try {
    const body = (await fetchJson(
      `${API}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
    )) as ViewBody | null;
    view = body
      ? mapViewResponse(bvid, body)
      : {
          bvid,
          verdict: 'unknown',
          code: -1,
          message: '返回内容无法解析',
          title: null,
          duration: null,
          upName: null,
          upMid: null,
          pageCount: 0,
          paid: false,
          pageListCode: null
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('[rescue] view probe failed', bvid, message);
    return {
      bvid,
      verdict: 'unknown',
      code: -1,
      message,
      title: null,
      duration: null,
      upName: null,
      upMid: null,
      pageCount: 0,
      paid: false,
      pageListCode: null
    };
  }

  // 只有「不可见」类结论才需要二次判定
  if (view.verdict !== 'reviewing' && view.verdict !== 'private') return view;

  try {
    const body = (await fetchJson(
      `${API}/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`
    )) as { code?: number } | null;
    const pageListCode = typeof body?.code === 'number' ? body.code : null;
    return refineWithPageList(view, pageListCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('[rescue] pagelist probe failed', bvid, message);
    return { ...view, pageListCode: null };
  }
}
