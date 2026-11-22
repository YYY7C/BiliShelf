import log from 'electron-log/main';
import { net } from 'electron';
import type {
  RescueCandidateView,
  RescuePlan,
  RescuePlanRow,
  RescueSearchResult,
  RescueVerdict
} from '@shared/types';
import { all, one } from '../../db/index';
import {
  fetchInfoJson,
  fetchItem,
  pickAssets,
  readInfoJson,
  searchByCreator,
  searchByIdentifier,
  searchByTitle,
  setArchiveFetcher,
  type IaDoc
} from './archiveOrg';
import { isPlaceholderTitle, scoreCandidate, type MatchCandidate, type MatchTier } from './match';
import { probeAvailability } from './probe';
import { recoverTitlesFromHistory } from './titles';

// IA 在国内必须走系统代理：net.fetch 用 Chromium 网络栈，会遵循系统代理设置
setArchiveFetcher((input, init) => net.fetch(input, init));

/** B 站复核之间的间隔，避免 412。 */
const PROBE_INTERVAL_MS = 600;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const DEFAULT_VERIFY_TOP = 5;
/** 按 UP 名检索时最多校验多少个存档条目（同一 UP 的条目会被缓存复用） */
const CREATOR_VERIFY_CAP = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DeadRow {
  id: number;
  source_id: number;
  source_title: string;
  bvid: string;
  page: number;
  title: string;
  duration: number | null;
  up_name: string | null;
}

function pickRows(input: { sourceId?: number | null; remoteItemIds?: number[]; limit: number }): DeadRow[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (input.remoteItemIds && input.remoteItemIds.length > 0) {
    where.push(`r.id IN (${input.remoteItemIds.map(() => '?').join(',')})`);
    params.push(...input.remoteItemIds);
  } else {
    where.push("r.state = 'unavailable'");
    if (input.sourceId != null) {
      where.push('r.source_id = ?');
      params.push(input.sourceId);
    }
  }
  params.push(input.limit);

  return all<DeadRow>(
    `SELECT r.id, r.source_id, r.bvid, r.page, r.title, r.duration, r.up_name,
            s.title AS source_title
       FROM remote_items r JOIN sources s ON s.id = r.source_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.id DESC
      LIMIT ?`,
    params
  );
}

function dedupeDocs(docs: IaDoc[]): IaDoc[] {
  const seen = new Set<string>();
  const out: IaDoc[] = [];
  for (const doc of docs) {
    if (seen.has(doc.identifier)) continue;
    seen.add(doc.identifier);
    out.push(doc);
  }
  return out;
}

type ArchiveVia = 'identifier' | 'creator' | 'title' | 'none';

export interface ArchiveOutcome {
  queries: number;
  hits: number;
  via: ArchiveVia;
  candidates: RescueCandidateView[];
  best: RescueCandidateView | null;
  paidSkipped: number;
}

interface ArchiveCaches {
  identifier: Map<string, IaDoc[]>;
  creator: Map<string, IaDoc[]>;
  items: Map<string, { candidate: MatchCandidate | null; paid: boolean }>;
  results: Map<string, ArchiveOutcome>;
}

function createCaches(): ArchiveCaches {
  return { identifier: new Map(), creator: new Map(), items: new Map(), results: new Map() };
}

async function identifierDocs(bvid: string, caches: ArchiveCaches): Promise<IaDoc[]> {
  const cached = caches.identifier.get(bvid);
  if (cached) return cached;
  const docs = dedupeDocs(await searchByIdentifier(bvid, 20));
  caches.identifier.set(bvid, docs);
  return docs;
}

async function creatorDocs(upName: string, caches: ArchiveCaches): Promise<IaDoc[]> {
  const cached = caches.creator.get(upName);
  if (cached) return cached;
  const docs = dedupeDocs(await searchByCreator(upName, CREATOR_VERIFY_CAP));
  caches.creator.set(upName, docs);
  return docs;
}

/** 拉 info.json 做二次校验：IA 的条目标题经常是文件名，info.json 才是原始元数据。 */
async function buildCandidate(
  doc: IaDoc,
  fromCreator: boolean,
  caches: ArchiveCaches
): Promise<{ candidate: MatchCandidate | null; paid: boolean }> {
  const cached = caches.items.get(doc.identifier);
  if (cached) return cached;

  let result: { candidate: MatchCandidate | null; paid: boolean } = { candidate: null, paid: false };
  const item = await fetchItem(doc.identifier);
  if (item) {
    const assets = pickAssets(item);
    if (assets.video) {
      let title = item.title ?? doc.title;
      let duration: number | null = null;
      let uploader: string | null = null;
      let bvid: string | null = null;
      let paid = false;

      if (assets.infoJson) {
        const info = await fetchInfoJson(doc.identifier, assets.infoJson);
        if (info) {
          const meta = readInfoJson(info);
          title = meta.title ?? title;
          duration = meta.duration;
          uploader = meta.uploader;
          bvid = meta.bvid;
          paid = meta.paid;
        }
      }

      // 充电/付费原稿件不补档（用户已确认），但要计数以便在报告里说明
      result = paid
        ? { candidate: null, paid: true }
        : {
            candidate: {
              identifier: doc.identifier,
              bvid,
              title,
              duration,
              uploader,
              size: assets.video.size,
              fromCreator
            },
            paid: false
          };
    }
  }

  caches.items.set(doc.identifier, result);
  return result;
}

async function evaluateArchive(
  target: { bvid: string; title: string; upName: string | null; duration: number | null },
  verifyTop: number,
  caches: ArchiveCaches
): Promise<ArchiveOutcome> {
  const cached = caches.results.get(target.bvid);
  if (cached) return cached;

  let queries = 0;
  let via: ArchiveVia = 'none';

  // 关键词①：bvid（IA 的 identifier 里带 BV 号，最准）
  let docs = await identifierDocs(target.bvid, caches);
  queries += 1;
  if (docs.length > 0) via = 'identifier';

  // 关键词②：按 UP 名。失效条目的标题已被覆盖成「已失效视频」，这是唯一还能用的线索
  if (docs.length === 0 && !isPlaceholderTitle(target.upName)) {
    docs = await creatorDocs(target.upName!, caches);
    queries += 1;
    if (docs.length > 0) via = 'creator';
  }

  // 关键词③：标题（库内标题不是占位文本时）
  if (docs.length === 0 && !isPlaceholderTitle(target.title)) {
    docs = dedupeDocs(await searchByTitle(target.title, 20));
    queries += 1;
    if (docs.length > 0) via = 'title';
  }

  if (docs.length === 0) {
    const empty: ArchiveOutcome = { queries, hits: 0, via: 'none', candidates: [], best: null, paidSkipped: 0 };
    caches.results.set(target.bvid, empty);
    return empty;
  }

  const scored: Array<{
    candidate: MatchCandidate;
    result: { score: number; tier: MatchTier; reasons: string[] };
  }> = [];
  let paidSkipped = 0;

  for (const doc of docs.slice(0, via === 'creator' ? CREATOR_VERIFY_CAP : verifyTop)) {
    const built = await buildCandidate(doc, via === 'creator', caches);
    if (built.paid) {
      paidSkipped += 1;
      continue;
    }
    if (!built.candidate) continue;
    const result = scoreCandidate(
      { bvid: target.bvid, title: target.title, duration: target.duration, upName: target.upName },
      built.candidate
    );
    if (result.tier === 'reject') continue;
    scored.push({ candidate: built.candidate, result });
  }
  scored.sort((a, b) => b.result.score - a.result.score);

  const outcome: ArchiveOutcome = {
    queries,
    hits: docs.length,
    via,
    candidates: scored.map((entry) => toView(entry.candidate, entry.result)),
    best: scored[0] ? toView(scored[0].candidate, scored[0].result) : null,
    paidSkipped
  };
  caches.results.set(target.bvid, outcome);
  return outcome;
}

function toView(
  candidate: MatchCandidate,
  score: { score: number; tier: MatchTier; reasons: string[] }
): RescueCandidateView {
  return {
    identifier: candidate.identifier,
    title: candidate.title,
    duration: candidate.duration,
    uploader: candidate.uploader,
    size: candidate.size,
    score: score.score,
    tier: score.tier,
    reasons: score.reasons
  };
}

export interface RescuePlanInput {
  sourceId?: number | null;
  remoteItemIds?: number[];
  limit?: number;
  /** 每个条目最多校验多少个 IA 候选的 info.json */
  verifyTop?: number;
}

/**
 * P0 只读计划：复核失效条目 + 在 Internet Archive 上找候选，不写任何表、不下载。
 * 同一 bvid 在多个来源里出现时只检索一次（结果按 bvid 缓存）。
 */
export async function planRescue(input: RescuePlanInput = {}): Promise<RescuePlan> {
  const started = Date.now();
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const verifyTop = Math.min(Math.max(input.verifyTop ?? DEFAULT_VERIFY_TOP, 1), 10);
  const rows = pickRows({ ...input, limit });
  const caches = createCaches();

  const out: RescuePlanRow[] = [];
  let probeCount = 0;

  for (const row of rows) {
    const rowStarted = Date.now();
    const base: RescuePlanRow = {
      remoteItemId: row.id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      bvid: row.bvid,
      page: row.page,
      title: row.title,
      duration: row.duration,
      upName: row.up_name,
      localVideoId: null,
      verdict: 'unknown',
      probeCode: null,
      probeMessage: null,
      pageListCode: null,
      iaQueries: 0,
      iaHits: 0,
      candidates: [],
      best: null,
      paidSkipped: 0,
      note: null,
      elapsedMs: 0,
      error: null
    };
    // 出错时也要保留已经拿到的探测结论，否则报告里只剩 unknown
    let partial = base;

    try {
      const local = one<{ id: number }>(
        `SELECT id FROM videos WHERE bvid = ? AND page = ? AND status IN ('present','trashed') LIMIT 1`,
        [row.bvid, row.page]
      );
      if (local) {
        out.push({
          ...base,
          verdict: 'local',
          localVideoId: local.id,
          note: '本地已有副本，无需补档',
          elapsedMs: Date.now() - rowStarted
        });
        continue;
      }

      if (row.page > 1) {
        out.push({
          ...base,
          verdict: 'dead',
          note: '多 P 稿件（page>1），IA 只收 P1，跳过检索',
          elapsedMs: Date.now() - rowStarted
        });
        continue;
      }

      if (probeCount > 0) await sleep(PROBE_INTERVAL_MS);
      probeCount += 1;
      const probe = await probeAvailability(row.bvid);
      const verdict = probe.verdict as RescueVerdict;
      const rowWithProbe: RescuePlanRow = {
        ...base,
        verdict,
        probeCode: probe.code,
        probeMessage: probe.message,
        pageListCode: probe.pageListCode,
        title: probe.title ?? base.title,
        duration: probe.duration ?? base.duration,
        upName: probe.upName ?? base.upName
      };
      partial = rowWithProbe;

      if (verdict !== 'dead' && verdict !== 'private') {
        out.push({ ...rowWithProbe, elapsedMs: Date.now() - rowStarted });
        continue;
      }

      const outcome = await evaluateArchive(
        {
          bvid: row.bvid,
          title: row.title,
          upName: rowWithProbe.upName,
          duration: rowWithProbe.duration
        },
        verifyTop,
        caches
      );

      out.push({
        ...rowWithProbe,
        iaQueries: outcome.queries,
        iaHits: outcome.hits,
        candidates: outcome.candidates,
        best: outcome.best,
        paidSkipped: outcome.paidSkipped,
        note:
          outcome.paidSkipped > 0
            ? `IA 上有 ${outcome.paidSkipped} 条充电/付费内容，已按规则跳过`
            : outcome.via === 'creator'
              ? '标题缺失，按 UP 名召回后用时长相较'
              : null,
        elapsedMs: Date.now() - rowStarted
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('[rescue] plan row failed', row.bvid, message);
      out.push({ ...partial, error: message, elapsedMs: Date.now() - rowStarted });
    }
  }

  // 同一 bvid 跨来源重复时按 bvid 汇总，避免命中率被重复计数
  const unique = new Map<string, RescuePlanRow>();
  for (const row of out) if (!unique.has(row.bvid)) unique.set(row.bvid, row);
  const deduped = [...unique.values()];

  // 一个 IA 条目只能对应一个稿件：按分数从高到低做一对一排他分配，
  // 否则同一个存档会被多条同时长视频重复「认领」（实测同一 UP 有 4 条都指向同一条）。
  const bestByBvid = assignUniqueCandidates(out);
  for (const row of out) row.best = bestByBvid.get(row.bvid) ?? null;

  const summary = {
    requested: out.length,
    local: out.filter((row) => row.verdict === 'local').length,
    alive: out.filter((row) => row.verdict === 'alive').length,
    reviewing: out.filter((row) => row.verdict === 'reviewing').length,
    paid: out.filter((row) => row.verdict === 'paid').length,
    dead: out.filter((row) => row.verdict === 'dead').length,
    private: out.filter((row) => row.verdict === 'private').length,
    unknown: out.filter((row) => row.verdict === 'unknown').length,
    withCandidate: deduped.filter((row) => bestByBvid.get(row.bvid) != null).length,
    sure: deduped.filter((row) => bestByBvid.get(row.bvid)?.tier === 'sure').length,
    likely: deduped.filter((row) => bestByBvid.get(row.bvid)?.tier === 'likely').length,
    doubt: deduped.filter((row) => bestByBvid.get(row.bvid)?.tier === 'doubt').length,
    paidSkipped: out.reduce((sum, row) => sum + row.paidSkipped, 0),
    uniqueBvid: deduped.length,
    elapsedMs: Date.now() - started
  };

  log.info('[rescue] plan done', JSON.stringify(summary));
  return { rows: out, summary };
}

/** 贪心一对一：先满足分数高的认领，已被占用的 identifier 不再分配给其它 bvid。 */
function assignUniqueCandidates(rows: RescuePlanRow[]): Map<string, RescueCandidateView> {
  const claims: Array<{ bvid: string; candidate: RescueCandidateView }> = [];
  for (const row of rows) {
    for (const candidate of row.candidates) claims.push({ bvid: row.bvid, candidate });
  }
  claims.sort((a, b) => b.candidate.score - a.candidate.score);

  const takenIdentifiers = new Set<string>();
  const best = new Map<string, RescueCandidateView>();
  for (const claim of claims) {
    if (best.has(claim.bvid)) continue;
    if (takenIdentifiers.has(claim.candidate.identifier)) continue;
    takenIdentifiers.add(claim.candidate.identifier);
    best.set(claim.bvid, claim.candidate);
  }
  return best;
}

export interface RescueTitlesResult {
  scanned: number;
  pages: number;
  found: Array<{ bvid: string; title: string; upName: string | null }>;
  errors: string[];
}

/**
 * 用观看历史恢复失效条目的真实标题（只读，不写库）。
 * 传入 bvids 时只查这些；不传则查当前来源下所有失效条目。
 */
export async function recoverRescueTitles(input: {
  sourceId?: number | null;
  bvids?: string[];
}): Promise<RescueTitlesResult> {
  let bvids = input.bvids ?? [];
  if (bvids.length === 0) {
    const rows = all<{ bvid: string }>(
      `SELECT bvid FROM remote_items
        WHERE state = 'unavailable' ${input.sourceId != null ? 'AND source_id = ?' : ''}
        ORDER BY id DESC LIMIT 500`,
      input.sourceId != null ? [input.sourceId] : []
    );
    bvids = rows.map((row) => row.bvid);
  }
  if (bvids.length === 0) return { scanned: 0, pages: 0, found: [], errors: [] };

  const { found, pages, scanned, errors } = await recoverTitlesFromHistory(bvids, { maxPages: 60 });
  return {
    scanned,
    pages,
    errors,
    found: [...found.values()].map((item) => ({
      bvid: item.bvid,
      title: item.title,
      upName: item.upName
    }))
  };
}

export interface RescueSearchInput {
  bvid: string;
  title?: string | null;
  duration?: number | null;
  upName?: string | null;
  verifyTop?: number;
}

/**
 * 直接对某个 BV 检索存档（不依赖清单条目）。
 * 用于「手动补档」入口，也用来验证 IA 检索链路。
 */
export async function searchRescueCandidates(input: RescueSearchInput): Promise<RescueSearchResult> {
  const bvid = input.bvid.trim();
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('BV 号格式不正确');
  const verifyTop = Math.min(Math.max(input.verifyTop ?? 5, 1), 10);
  const outcome = await evaluateArchive(
    {
      bvid,
      title: input.title ?? '',
      upName: input.upName ?? null,
      duration: input.duration ?? null
    },
    verifyTop,
    createCaches()
  );
  return {
    queries: outcome.queries,
    hits: outcome.hits,
    paidSkipped: outcome.paidSkipped,
    candidates: outcome.candidates
  };
}
