import type {
  AiAnalysisRun,
  AiAnalysisSample,
  AiBatch,
  AiBatchStatus,
  AiBgmResult,
  AiFrame,
  AiReviewCounts,
  AiReviewDecision,
  AiReviewItem,
  AiReviewPage,
  AiReviewQuery,
  AiReviewResult,
  AiReviewStatus,
  AiReviewTag,
  AiRunDetail,
  AiRunPage,
  AiRunQuery,
  AiRunStatus,
  AiRunSummary,
  AiStage,
  AiStats,
  AiTagProfile,
  AiTagProfileInput,
  AiTagRef,
  AiTagSource,
  AiTagStatus,
  AiTagSummary,
  AiTaxonomy
} from '@shared/types';
import {
  DEFAULT_FOCUS,
  DEFAULT_MAX_TAGS,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TAXONOMY
} from '@shared/aiDefaults';
import { all, one, run, tx } from './index';

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function sanitizeTaxonomy(input: AiTaxonomy | null | undefined): AiTaxonomy {
  const categories = (input?.categories ?? [])
    .map((category) => ({
      name: String(category?.name ?? '').trim(),
      description: String(category?.description ?? '').trim(),
      examples: Array.isArray(category?.examples)
        ? category.examples
            .map((example) => String(example).trim())
            .filter(Boolean)
            .slice(0, 20)
        : []
    }))
    .filter((category) => category.name.length > 0)
    .slice(0, 20);
  const seen = new Set<string>();
  const uniqueCategories = categories.filter((category) => {
    const key = category.name.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const stopwords = Array.from(
    new Set(
      (input?.stopwords ?? [])
        .map((word) => String(word).trim())
        .filter(Boolean)
        .slice(0, 200)
    )
  );
  const aliases: Record<string, string> = {};
  for (const [key, value] of Object.entries(input?.aliases ?? {})) {
    const from = String(key).trim();
    const to = String(value).trim();
    if (from && to) aliases[from] = to;
  }
  return {
    categories:
      uniqueCategories.length > 0
        ? uniqueCategories
        : DEFAULT_TAXONOMY.categories.map((category) => ({
            ...category,
            examples: [...(category.examples ?? [])]
          })),
    stopwords,
    aliases
  };
}

/* --------------------------------- profiles -------------------------------- */

interface ProfileRow {
  id: number;
  name: string;
  description: string;
  scope: 'global' | 'source';
  source_id: number | null;
  source_name?: string | null;
  is_default: number;
  focus_json: string;
  taxonomy_json: string;
  system_prompt: string;
  prompt_template: string;
  max_tags: number;
  min_confidence: number;
  language: string;
  use_acrcloud: number;
  use_bilibili_tags: number;
  created_at: string;
  updated_at: string;
}

function mapProfile(row: ProfileRow): AiTagProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    scope: row.scope,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    isDefault: row.is_default === 1,
    focus: parseJson<string[]>(row.focus_json, []),
    taxonomy: sanitizeTaxonomy(parseJson<AiTaxonomy | null>(row.taxonomy_json, null)),
    systemPrompt: row.system_prompt || DEFAULT_SYSTEM_PROMPT,
    promptTemplate: row.prompt_template || DEFAULT_PROMPT_TEMPLATE,
    maxTags: row.max_tags,
    minConfidence: row.min_confidence,
    language: row.language || 'zh-CN',
    useAcrcloud: row.use_acrcloud === 1,
    useBilibiliTags: row.use_bilibili_tags === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const PROFILE_SELECT = `SELECT p.*, s.title AS source_name
  FROM ai_tag_profiles p
  LEFT JOIN sources s ON s.id = p.source_id`;

export function listProfiles(): AiTagProfile[] {
  return all<ProfileRow>(
    `${PROFILE_SELECT} ORDER BY CASE p.scope WHEN 'global' THEN 0 ELSE 1 END, p.is_default DESC, p.name COLLATE NOCASE`
  ).map(mapProfile);
}

export function getProfile(id: number): AiTagProfile | null {
  const row = one<ProfileRow>(`${PROFILE_SELECT} WHERE p.id = ?`, [id]);
  return row ? mapProfile(row) : null;
}

export function ensureDefaultProfile(): AiTagProfile {
  const existing = one<{ id: number }>(
    "SELECT id FROM ai_tag_profiles WHERE scope = 'global' ORDER BY id LIMIT 1"
  );
  if (existing) {
    return getProfile(existing.id) ?? createDefaultProfile();
  }
  return createDefaultProfile();
}

function createDefaultProfile(): AiTagProfile {
  const stamp = now();
  run(
    `INSERT INTO ai_tag_profiles (
       name, description, scope, source_id, is_default, focus_json, taxonomy_json,
       system_prompt, prompt_template, max_tags, min_confidence, language,
       use_acrcloud, use_bilibili_tags, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      '通用方案',
      '默认的通用打标方案，可复制后按收藏夹内容调整。',
      'global',
      null,
      1,
      JSON.stringify(DEFAULT_FOCUS),
      JSON.stringify(DEFAULT_TAXONOMY),
      DEFAULT_SYSTEM_PROMPT,
      DEFAULT_PROMPT_TEMPLATE,
      DEFAULT_MAX_TAGS,
      DEFAULT_MIN_CONFIDENCE,
      'zh-CN',
      1,
      1,
      stamp,
      stamp
    ]
  );
  const row = one<ProfileRow>(`${PROFILE_SELECT} WHERE p.scope = 'global' ORDER BY p.id LIMIT 1`);
  return mapProfile(row!);
}

export function getEffectiveProfile(sourceId: number | null | undefined): AiTagProfile {
  if (sourceId) {
    const sourceProfile = one<ProfileRow>(`${PROFILE_SELECT} WHERE p.scope = 'source' AND p.source_id = ?`, [
      sourceId
    ]);
    if (sourceProfile) return mapProfile(sourceProfile);
  }
  const defaultProfile = one<ProfileRow>(`${PROFILE_SELECT} WHERE p.scope = 'global' AND p.is_default = 1`);
  if (defaultProfile) return mapProfile(defaultProfile);
  const firstGlobal = one<ProfileRow>(`${PROFILE_SELECT} WHERE p.scope = 'global' ORDER BY p.id LIMIT 1`);
  return firstGlobal ? mapProfile(firstGlobal) : ensureDefaultProfile();
}

export function saveProfile(input: AiTagProfileInput): AiTagProfile[] {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('方案名称不能为空');
  const scope: 'global' | 'source' = input.scope === 'source' ? 'source' : 'global';
  const sourceId = scope === 'source' ? (input.sourceId ?? null) : null;
  if (scope === 'source' && !sourceId) throw new Error('来源方案需要指定来源');
  const taxonomy = sanitizeTaxonomy(input.taxonomy);
  const focus = Array.from(
    new Set((input.focus ?? []).map((item) => String(item).trim()).filter(Boolean))
  ).slice(0, 30);
  const maxTags = clamp(input.maxTags, 1, 50, DEFAULT_MAX_TAGS);
  const minConfidence = clamp(input.minConfidence, 0, 1, DEFAULT_MIN_CONFIDENCE);
  const systemPrompt = String(input.systemPrompt ?? '').trim() || DEFAULT_SYSTEM_PROMPT;
  const promptTemplate = String(input.promptTemplate ?? '').trim() || DEFAULT_PROMPT_TEMPLATE;
  const language = String(input.language ?? '').trim() || 'zh-CN';
  let id = input.id ?? null;

  if (!id && scope === 'source') {
    const existing = one<{ id: number }>('SELECT id FROM ai_tag_profiles WHERE scope = ? AND source_id = ?', [
      'source',
      sourceId
    ]);
    if (existing) id = existing.id;
  }

  tx(() => {
    if (scope === 'global' && input.isDefault) {
      run("UPDATE ai_tag_profiles SET is_default = 0 WHERE scope = 'global'");
    }
    if (id) {
      run(
        `UPDATE ai_tag_profiles SET
           name = ?, description = ?, scope = ?, source_id = ?, is_default = ?,
           focus_json = ?, taxonomy_json = ?, system_prompt = ?, prompt_template = ?,
           max_tags = ?, min_confidence = ?, language = ?, use_acrcloud = ?, use_bilibili_tags = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          name,
          String(input.description ?? '').trim(),
          scope,
          sourceId,
          input.isDefault ? 1 : 0,
          JSON.stringify(focus),
          JSON.stringify(taxonomy),
          systemPrompt,
          promptTemplate,
          Math.round(maxTags),
          minConfidence,
          language,
          input.useAcrcloud ? 1 : 0,
          input.useBilibiliTags ? 1 : 0,
          now(),
          id
        ]
      );
    } else {
      const globalCount =
        one<{ c: number }>("SELECT COUNT(*) AS c FROM ai_tag_profiles WHERE scope = 'global'")?.c ?? 0;
      const makeDefault = scope === 'global' && (Boolean(input.isDefault) || globalCount === 0);
      run(
        `INSERT INTO ai_tag_profiles (
           name, description, scope, source_id, is_default, focus_json, taxonomy_json,
           system_prompt, prompt_template, max_tags, min_confidence, language,
           use_acrcloud, use_bilibili_tags, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          name,
          String(input.description ?? '').trim(),
          scope,
          sourceId,
          makeDefault ? 1 : 0,
          JSON.stringify(focus),
          JSON.stringify(taxonomy),
          systemPrompt,
          promptTemplate,
          Math.round(maxTags),
          minConfidence,
          language,
          input.useAcrcloud ? 1 : 0,
          input.useBilibiliTags ? 1 : 0,
          now(),
          now()
        ]
      );
    }
  });

  ensureDefaultProfileMarker();
  return listProfiles();
}

function ensureDefaultProfileMarker(): void {
  const existing = one<{ id: number }>(
    "SELECT id FROM ai_tag_profiles WHERE scope = 'global' AND is_default = 1"
  );
  if (existing) return;
  const first = one<{ id: number }>(
    "SELECT id FROM ai_tag_profiles WHERE scope = 'global' ORDER BY id LIMIT 1"
  );
  if (first) run('UPDATE ai_tag_profiles SET is_default = 1 WHERE id = ?', [first.id]);
}

export function deleteProfile(id: number): AiTagProfile[] {
  const profile = getProfile(id);
  if (!profile) return listProfiles();
  tx(() => {
    run('DELETE FROM ai_tag_profiles WHERE id = ?', [id]);
    if (profile.scope === 'global' && profile.isDefault) {
      const first = one<{ id: number }>(
        "SELECT id FROM ai_tag_profiles WHERE scope = 'global' ORDER BY id LIMIT 1"
      );
      if (first) run('UPDATE ai_tag_profiles SET is_default = 1 WHERE id = ?', [first.id]);
    }
  });
  if (listProfiles().length === 0) ensureDefaultProfile();
  return listProfiles();
}

export function setDefaultProfile(id: number): AiTagProfile[] {
  const profile = getProfile(id);
  if (!profile) throw new Error('方案不存在');
  if (profile.scope !== 'global') throw new Error('只有全局方案可以设为默认');
  tx(() => {
    run("UPDATE ai_tag_profiles SET is_default = 0 WHERE scope = 'global'");
    run('UPDATE ai_tag_profiles SET is_default = 1 WHERE id = ?', [id]);
  });
  return listProfiles();
}

export function duplicateProfile(id: number): AiTagProfile[] {
  const profile = getProfile(id);
  if (!profile) throw new Error('方案不存在');
  return saveProfile({
    name: `${profile.name} 副本`,
    description: profile.description,
    scope: 'global',
    sourceId: null,
    isDefault: false,
    focus: profile.focus,
    taxonomy: profile.taxonomy,
    systemPrompt: profile.systemPrompt,
    promptTemplate: profile.promptTemplate,
    maxTags: profile.maxTags,
    minConfidence: profile.minConfidence,
    language: profile.language,
    useAcrcloud: profile.useAcrcloud,
    useBilibiliTags: profile.useBilibiliTags
  });
}

/* ---------------------------------- batches -------------------------------- */

interface BatchRow {
  id: number;
  profile_id: number | null;
  profile_name?: string | null;
  provider_id: string | null;
  provider_name: string | null;
  model: string | null;
  total: number;
  done: number;
  failed: number;
  request_count: number;
  music_request_count: number;
  status: AiBatchStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const BATCH_SELECT = `SELECT b.*, p.name AS profile_name,
    (SELECT COUNT(*) FROM ai_runs r WHERE r.batch_id = b.id) AS total,
    (SELECT COUNT(*) FROM ai_runs r WHERE r.batch_id = b.id AND r.status = 'done') AS done,
    (SELECT COUNT(*) FROM ai_runs r WHERE r.batch_id = b.id AND r.status = 'failed') AS failed,
    (SELECT COALESCE(SUM(r.request_count), 0) FROM ai_runs r WHERE r.batch_id = b.id) AS request_count,
    (SELECT COALESCE(SUM(r.music_request_count), 0) FROM ai_runs r WHERE r.batch_id = b.id) AS music_request_count
  FROM ai_batches b
  LEFT JOIN ai_tag_profiles p ON p.id = b.profile_id`;

function mapBatch(row: BatchRow): AiBatch {
  return {
    id: row.id,
    profileName: row.profile_name ?? null,
    providerName: row.provider_name,
    model: row.model,
    total: row.total,
    done: row.done,
    failed: row.failed,
    requestCount: row.request_count ?? 0,
    musicRequestCount: row.music_request_count ?? 0,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

export function createBatch(input: {
  profileId: number | null;
  providerId: string;
  providerName: string;
  model: string;
  scope: unknown;
  total: number;
}): number {
  return run(
    `INSERT INTO ai_batches (profile_id, provider_id, provider_name, model, scope_json, total, status, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.profileId,
      input.providerId,
      input.providerName,
      input.model,
      JSON.stringify(input.scope ?? {}),
      input.total,
      'queued',
      now()
    ]
  ).lastInsertRowid;
}

export function updateBatch(
  id: number,
  patch: Partial<{
    status: AiBatchStatus;
    total: number;
    startedAt: string | null;
    finishedAt: string | null;
  }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.total !== undefined) {
    sets.push('total = ?');
    params.push(patch.total);
  }
  if (patch.startedAt !== undefined) {
    sets.push('started_at = ?');
    params.push(patch.startedAt);
  }
  if (patch.finishedAt !== undefined) {
    sets.push('finished_at = ?');
    params.push(patch.finishedAt);
  }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE ai_batches SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function getBatch(id: number): AiBatch | null {
  const row = one<BatchRow>(`${BATCH_SELECT} WHERE b.id = ?`, [id]);
  return row ? mapBatch(row) : null;
}

export function listBatches(limit = 50): AiBatch[] {
  return all<BatchRow>(`${BATCH_SELECT} ORDER BY b.created_at DESC, b.id DESC LIMIT ?`, [
    Math.min(Math.max(limit, 1), 200)
  ]).map(mapBatch);
}

export function batchSnapshot(): { batches: AiBatch[]; pendingReview: number; running: number } {
  return {
    batches: listBatches(50),
    pendingReview: reviewCounts().pending,
    running: one<{ c: number }>("SELECT COUNT(*) AS c FROM ai_runs WHERE status = 'running'")?.c ?? 0
  };
}

/* ----------------------------------- runs ---------------------------------- */

interface RunRow {
  id: number;
  batch_id: number | null;
  video_id: number;
  profile_id: number | null;
  provider_id: string | null;
  provider_name: string | null;
  protocol: string | null;
  model: string | null;
  status: AiRunStatus;
  stage: AiStage | null;
  frames_json: string;
  prompt_hash: string | null;
  system_prompt: string | null;
  user_prompt: string | null;
  raw_response: string | null;
  result_json: string | null;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  music_request_count: number;
  tool_calls_json: string;
  review_status: AiReviewStatus;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  video_title?: string;
  up_name?: string | null;
  duration?: number | null;
  source_id?: number | null;
  source_name?: string | null;
  profile_name?: string | null;
  cover_type?: string | null;
  cover_url?: string | null;
}

const RUN_SELECT = `SELECT r.*, v.title AS video_title, v.up_name, v.duration, v.source_id,
    s.title AS source_name, p.name AS profile_name,
    (SELECT a.type FROM assets a WHERE a.video_id = v.id AND a.type IN ('thumb','cover')
       ORDER BY CASE a.type WHEN 'thumb' THEN 0 ELSE 1 END LIMIT 1) AS cover_type,
    v.cover_url
  FROM ai_runs r
  JOIN videos v ON v.id = r.video_id
  LEFT JOIN sources s ON s.id = v.source_id
  LEFT JOIN ai_tag_profiles p ON p.id = r.profile_id`;

function coverFor(row: RunRow): string | null {
  if (row.cover_type) return `bilishelf://asset/${row.video_id}/${row.cover_type}`;
  return row.cover_url ?? null;
}

function parseFrames(runId: number, json: string): AiFrame[] {
  const stored = parseJson<Array<{ index: number; time: number; path?: string }>>(json, []);
  return stored
    .filter((frame) => Number.isFinite(frame.index))
    .map((frame) => ({
      index: frame.index,
      time: Number(frame.time) || 0,
      url: `bilishelf://ai/${runId}/${frame.index}`
    }));
}

function mapRunSummary(row: RunRow): AiRunSummary {
  return {
    id: row.id,
    batchId: row.batch_id,
    videoId: row.video_id,
    videoTitle: row.video_title ?? '',
    coverUrl: coverFor(row),
    profileId: row.profile_id,
    profileName: row.profile_name ?? null,
    providerId: row.provider_id,
    providerName: row.provider_name,
    model: row.model,
    status: row.status,
    stage: row.stage,
    reviewStatus: row.review_status,
    error: row.error,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requestCount: row.request_count ?? 0,
    musicRequestCount: row.music_request_count ?? 0,
    frames: parseFrames(row.id, row.frames_json),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}

export function createRun(input: {
  batchId: number;
  videoId: number;
  profileId: number | null;
  providerId: string;
  providerName: string;
  protocol: string;
  model: string;
}): number {
  return run(
    `INSERT INTO ai_runs (batch_id, video_id, profile_id, provider_id, provider_name, protocol, model, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.batchId,
      input.videoId,
      input.profileId,
      input.providerId,
      input.providerName,
      input.protocol,
      input.model,
      'queued',
      now()
    ]
  ).lastInsertRowid;
}

export function updateRun(
  id: number,
  patch: Partial<{
    status: AiRunStatus;
    stage: AiStage | null;
    framesJson: string;
    promptHash: string | null;
    systemPrompt: string | null;
    userPrompt: string | null;
    rawResponse: string | null;
    resultJson: string | null;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    requestCount: number;
    musicRequestCount: number;
    toolCallsJson: string;
    reviewStatus: AiReviewStatus;
    startedAt: string | null;
    finishedAt: string | null;
  }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: Array<[keyof typeof patch, string]> = [
    ['status', 'status'],
    ['stage', 'stage'],
    ['framesJson', 'frames_json'],
    ['promptHash', 'prompt_hash'],
    ['systemPrompt', 'system_prompt'],
    ['userPrompt', 'user_prompt'],
    ['rawResponse', 'raw_response'],
    ['resultJson', 'result_json'],
    ['error', 'error'],
    ['inputTokens', 'input_tokens'],
    ['outputTokens', 'output_tokens'],
    ['requestCount', 'request_count'],
    ['musicRequestCount', 'music_request_count'],
    ['toolCallsJson', 'tool_calls_json'],
    ['reviewStatus', 'review_status'],
    ['startedAt', 'started_at'],
    ['finishedAt', 'finished_at']
  ];
  for (const [key, column] of map) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE ai_runs SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function getRun(id: number): AiRunDetail | null {
  const row = one<RunRow>(`${RUN_SELECT} WHERE r.id = ?`, [id]);
  if (!row) return null;
  const result = parseJson<AiRunDetail['result']>(row.result_json, null);
  return {
    ...mapRunSummary(row),
    systemPrompt: row.system_prompt,
    userPrompt: row.user_prompt,
    rawResponse: row.raw_response,
    result,
    toolCalls: parseJson<AiRunDetail['toolCalls']>(row.tool_calls_json, [])
  };
}

export function listRuns(query: AiRunQuery): AiRunPage {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.batchId) {
    where.push('r.batch_id = ?');
    params.push(query.batchId);
  }
  if (query.status && query.status !== 'all') {
    where.push('r.status = ?');
    params.push(query.status);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);
  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM ai_runs r ${clause}`, params)?.c ?? 0;
  const rows = all<RunRow>(`${RUN_SELECT} ${clause} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset
  ]);
  return { items: rows.map(mapRunSummary), total };
}

export function getNextQueuedRun(): RunRow | null {
  return (
    one<RunRow>(
      `SELECT r.* FROM ai_runs r
        JOIN ai_batches b ON b.id = r.batch_id
       WHERE r.status = 'queued' AND b.status IN ('queued','running')
       ORDER BY r.id ASC LIMIT 1`
    ) ?? null
  );
}

export function countRunningRuns(): number {
  return one<{ c: number }>("SELECT COUNT(*) AS c FROM ai_runs WHERE status = 'running'")?.c ?? 0;
}

export function recoverInterruptedRuns(): number {
  const count = one<{ c: number }>("SELECT COUNT(*) AS c FROM ai_runs WHERE status = 'running'")?.c ?? 0;
  if (count > 0) {
    run("UPDATE ai_runs SET status = 'queued', stage = NULL WHERE status = 'running'");
    run("UPDATE ai_batches SET status = 'queued', started_at = NULL WHERE status = 'running'");
  }
  return count;
}

/* ---------------------------------- run tags -------------------------------- */

interface RunTagRow {
  id: number;
  run_id: number;
  video_id: number;
  category: string;
  name: string;
  normalized_name: string;
  confidence: number;
  source: AiTagSource;
  status: AiTagStatus;
  evidence: string | null;
  edited: number;
  created_at: string;
}

export interface NormalizedAiTag {
  category: string;
  name: string;
  normalizedName: string;
  confidence: number;
  source: AiTagSource;
  evidence?: string | null;
}

export function replaceRunTags(
  runId: number,
  videoId: number,
  profileId: number | null,
  tags: NormalizedAiTag[]
): void {
  tx(() => {
    run(
      `UPDATE ai_run_tags SET status = 'superseded'
        WHERE video_id = ? AND status = 'pending' AND run_id <> ?
          AND run_id IN (SELECT id FROM ai_runs WHERE profile_id IS ?)`,
      [videoId, runId, profileId]
    );
    run('DELETE FROM ai_run_tags WHERE run_id = ?', [runId]);
    for (const tag of tags) {
      run(
        `INSERT INTO ai_run_tags (run_id, video_id, category, name, normalized_name, confidence, source, status, evidence, edited, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          runId,
          videoId,
          tag.category,
          tag.name,
          tag.normalizedName,
          tag.confidence,
          tag.source,
          'pending',
          tag.evidence ?? null,
          0,
          now()
        ]
      );
    }
    run("UPDATE ai_runs SET review_status = 'pending' WHERE id = ?", [runId]);
  });
}

function mapReviewTag(row: RunTagRow): AiReviewTag {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    confidence: row.confidence,
    source: row.source,
    status: row.status,
    evidence: row.evidence,
    edited: row.edited === 1
  };
}

export function listRunTags(runId: number): AiReviewTag[] {
  return all<RunTagRow>(
    `SELECT * FROM ai_run_tags WHERE run_id = ? AND status <> 'superseded'
      ORDER BY category COLLATE NOCASE, confidence DESC, name COLLATE NOCASE`,
    [runId]
  ).map(mapReviewTag);
}

/* ---------------------------------- review --------------------------------- */

interface ReviewRow extends RunRow {
  run_id: number;
}

const REVIEW_SELECT = `SELECT r.id AS id, r.id AS run_id, r.video_id, r.review_status, r.created_at, r.input_tokens, r.output_tokens,
    r.request_count, r.music_request_count, r.frames_json, r.result_json, r.provider_name, r.model,
    v.title AS video_title, v.up_name, v.duration, v.source_id, s.title AS source_name,
    p.name AS profile_name,
    (SELECT a.type FROM assets a WHERE a.video_id = v.id AND a.type IN ('thumb','cover')
       ORDER BY CASE a.type WHEN 'thumb' THEN 0 ELSE 1 END LIMIT 1) AS cover_type,
    v.cover_url
  FROM ai_runs r
  JOIN videos v ON v.id = r.video_id
  LEFT JOIN sources s ON s.id = v.source_id
  LEFT JOIN ai_tag_profiles p ON p.id = r.profile_id`;

function buildReviewWhere(query: AiReviewQuery): { clause: string; params: unknown[] } {
  const where: string[] = [
    "r.status = 'done'",
    "EXISTS (SELECT 1 FROM ai_run_tags t WHERE t.run_id = r.id AND t.status <> 'superseded')"
  ];
  const params: unknown[] = [];
  const status = query.status ?? 'pending';
  if (status === 'pending') {
    where.push("EXISTS (SELECT 1 FROM ai_run_tags t WHERE t.run_id = r.id AND t.status = 'pending')");
  } else if (status === 'approved') {
    where.push("r.review_status = 'approved'");
  } else if (status === 'rejected') {
    where.push("r.review_status = 'rejected'");
  } else if (status === 'partial') {
    where.push("r.review_status = 'partial'");
  }
  if (query.profileId) {
    where.push('r.profile_id = ?');
    params.push(query.profileId);
  }
  if (query.sourceId) {
    where.push('v.source_id = ?');
    params.push(query.sourceId);
  }
  if (query.videoId) {
    where.push('r.video_id = ?');
    params.push(query.videoId);
  }
  const search = query.search?.trim();
  if (search) {
    where.push(`(v.title LIKE ? OR COALESCE(v.up_name,'') LIKE ?
      OR EXISTS (SELECT 1 FROM ai_run_tags t WHERE t.run_id = r.id AND t.name LIKE ?))`);
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (query.minConfidence !== undefined && Number.isFinite(query.minConfidence)) {
    where.push(
      `EXISTS (SELECT 1 FROM ai_run_tags t WHERE t.run_id = r.id AND t.status <> 'superseded' AND t.confidence >= ?)`
    );
    params.push(query.minConfidence);
  }
  return { clause: `WHERE ${where.join(' AND ')}`, params };
}

function buildReviewItem(row: ReviewRow): AiReviewItem {
  const result = parseJson<{
    summary?: string;
    bgm?: AiBgmResult | null;
  }>(row.result_json, {});
  return {
    runId: row.run_id,
    videoId: row.video_id,
    videoTitle: row.video_title ?? '',
    upName: row.up_name ?? null,
    sourceName: row.source_name ?? null,
    duration: row.duration ?? null,
    coverUrl: coverFor(row),
    reviewStatus: row.review_status,
    frames: parseFrames(row.run_id, row.frames_json),
    originalTags: all<{ name: string; source: 'manual' | 'auto' }>(
      `SELECT t.name, vt.source FROM video_tags vt
        JOIN tags t ON t.id = vt.tag_id
       WHERE vt.video_id = ?
       ORDER BY t.name COLLATE NOCASE`,
      [row.video_id]
    ),
    aiTags: listRunTags(row.run_id),
    summary: result.summary ?? null,
    bgm: result.bgm ?? null,
    profileName: row.profile_name ?? null,
    providerName: row.provider_name,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requestCount: row.request_count ?? 0,
    musicRequestCount: row.music_request_count ?? 0,
    createdAt: row.created_at
  };
}

export function listReview(query: AiReviewQuery): AiReviewPage {
  const { clause, params } = buildReviewWhere(query);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const total =
    one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ai_runs r
        JOIN videos v ON v.id = r.video_id
        LEFT JOIN ai_tag_profiles p ON p.id = r.profile_id
        ${clause}`,
      params
    )?.c ?? 0;
  const rows = all<ReviewRow>(
    `${REVIEW_SELECT} ${clause} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { items: rows.map(buildReviewItem), total };
}

export function getReviewItem(runId: number): AiReviewItem | null {
  const row = one<ReviewRow>(`${REVIEW_SELECT} WHERE r.id = ?`, [runId]);
  return row ? buildReviewItem(row) : null;
}

export function reviewCounts(): AiReviewCounts {
  const row = one<{ pending: number; approved: number; rejected: number }>(
    `SELECT
       (SELECT COUNT(*) FROM ai_run_tags WHERE status = 'pending') AS pending,
       (SELECT COUNT(*) FROM ai_run_tags WHERE status = 'approved') AS approved,
       (SELECT COUNT(*) FROM ai_run_tags WHERE status = 'rejected') AS rejected`
  );
  return { pending: row?.pending ?? 0, approved: row?.approved ?? 0, rejected: row?.rejected ?? 0 };
}

function resolvePendingTags(decision: AiReviewDecision): RunTagRow[] {
  const runIds = Array.from(new Set((decision.runIds ?? []).filter((id) => Number.isFinite(id) && id > 0)));
  if (runIds.length === 0) return [];
  const tagIds = decision.tagIds?.filter((id) => Number.isFinite(id) && id > 0);
  if (tagIds && tagIds.length === 0) return [];
  const params: unknown[] = [...runIds];
  let sql = `SELECT * FROM ai_run_tags WHERE status = 'pending' AND run_id IN (${runIds.map(() => '?').join(',')})`;
  if (tagIds && tagIds.length > 0) {
    sql += ` AND id IN (${tagIds.map(() => '?').join(',')})`;
    params.push(...tagIds);
  }
  return all<RunTagRow>(sql, params);
}

export function approveTags(decision: AiReviewDecision): AiReviewResult {
  const rows = resolvePendingTags(decision);
  if (rows.length === 0) return { approved: 0, rejected: 0, affectedVideos: 0, videoIds: [] };
  const runIds = Array.from(new Set(rows.map((row) => row.run_id)));
  const videoIds = Array.from(new Set(rows.map((row) => row.video_id)));
  const stamp = now();
  tx(() => {
    for (const tag of rows) {
      run(
        `INSERT INTO ai_tags (name, normalized_name, category, created_at)
         VALUES (?,?,?,?)
         ON CONFLICT(normalized_name, category) DO UPDATE SET name = excluded.name`,
        [tag.name, tag.normalized_name, tag.category, stamp]
      );
      const aiTag = one<{ id: number }>('SELECT id FROM ai_tags WHERE normalized_name = ? AND category = ?', [
        tag.normalized_name,
        tag.category
      ]);
      if (!aiTag) continue;
      run(
        `INSERT INTO video_ai_tags (video_id, ai_tag_id, run_id, confidence, source, approved_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(video_id, ai_tag_id) DO UPDATE SET
           run_id = excluded.run_id, confidence = excluded.confidence,
           source = excluded.source, approved_at = excluded.approved_at`,
        [tag.video_id, aiTag.id, tag.run_id, tag.confidence, tag.source, stamp]
      );
      run("UPDATE ai_run_tags SET status = 'approved' WHERE id = ?", [tag.id]);
    }
    for (const runId of runIds) recomputeRunReviewStatus(runId);
  });
  return {
    approved: rows.length,
    rejected: 0,
    affectedVideos: videoIds.length,
    videoIds
  };
}

export function rejectTags(decision: AiReviewDecision): AiReviewResult {
  const rows = resolvePendingTags(decision);
  if (rows.length === 0) return { approved: 0, rejected: 0, affectedVideos: 0, videoIds: [] };
  const runIds = Array.from(new Set(rows.map((row) => row.run_id)));
  const videoIds = Array.from(new Set(rows.map((row) => row.video_id)));
  tx(() => {
    for (const tag of rows) {
      run("UPDATE ai_run_tags SET status = 'rejected' WHERE id = ?", [tag.id]);
    }
    for (const runId of runIds) recomputeRunReviewStatus(runId);
  });
  return {
    approved: 0,
    rejected: rows.length,
    affectedVideos: videoIds.length,
    videoIds
  };
}

export function recomputeRunReviewStatus(runId: number): AiReviewStatus {
  const rows = all<{ status: AiTagStatus; c: number }>(
    `SELECT status, COUNT(*) AS c FROM ai_run_tags
      WHERE run_id = ? AND status <> 'superseded' GROUP BY status`,
    [runId]
  );
  const counts = new Map(rows.map((row) => [row.status, row.c]));
  const pending = counts.get('pending') ?? 0;
  const approved = counts.get('approved') ?? 0;
  const rejected = counts.get('rejected') ?? 0;
  let status: AiReviewStatus = 'pending';
  if (pending > 0) status = 'pending';
  else if (approved > 0 && rejected > 0) status = 'partial';
  else if (approved > 0) status = 'approved';
  else if (rejected > 0) status = 'rejected';
  run('UPDATE ai_runs SET review_status = ? WHERE id = ?', [status, runId]);
  return status;
}

export function updateRunTag(patch: {
  tagId: number;
  name?: string;
  category?: string;
  confidence?: number;
}): AiReviewItem | null {
  const row = one<RunTagRow>('SELECT * FROM ai_run_tags WHERE id = ?', [patch.tagId]);
  if (!row) return null;
  if (row.status === 'approved') throw new Error('已通过的标签请先取消通过');
  const name = patch.name !== undefined ? String(patch.name).trim() : row.name;
  const category = patch.category !== undefined ? String(patch.category).trim() : row.category;
  const confidence =
    patch.confidence !== undefined ? clamp(patch.confidence, 0, 1, row.confidence) : row.confidence;
  if (!name || !category) throw new Error('标签名和分类不能为空');
  run(
    `UPDATE ai_run_tags SET name = ?, normalized_name = ?, category = ?, confidence = ?, edited = 1 WHERE id = ?`,
    [name, normalizeName(name), category, confidence, patch.tagId]
  );
  recomputeRunReviewStatus(row.run_id);
  return getReviewItem(row.run_id);
}

export function addRunTag(input: {
  runId: number;
  category: string;
  name: string;
  confidence?: number;
}): AiReviewItem | null {
  const runRow = one<{ id: number; video_id: number }>('SELECT id, video_id FROM ai_runs WHERE id = ?', [
    input.runId
  ]);
  if (!runRow) return null;
  const name = String(input.name ?? '').trim();
  const category = String(input.category ?? '').trim();
  if (!name || !category) throw new Error('标签名和分类不能为空');
  run(
    `INSERT INTO ai_run_tags (run_id, video_id, category, name, normalized_name, confidence, source, status, evidence, edited, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.runId,
      runRow.video_id,
      category,
      name,
      normalizeName(name),
      clamp(input.confidence ?? 0.8, 0, 1, 0.8),
      'vision',
      'pending',
      null,
      1,
      now()
    ]
  );
  recomputeRunReviewStatus(input.runId);
  return getReviewItem(input.runId);
}

export function restoreRunTag(tagId: number): AiReviewItem | null {
  const row = one<RunTagRow>('SELECT * FROM ai_run_tags WHERE id = ?', [tagId]);
  if (!row) return null;
  if (row.status === 'rejected') {
    run("UPDATE ai_run_tags SET status = 'pending' WHERE id = ?", [tagId]);
    recomputeRunReviewStatus(row.run_id);
  }
  return getReviewItem(row.run_id);
}

export function unapproveTag(
  videoId: number,
  name: string,
  category: string
): { videoId: number; runIds: number[] } {
  const normalized = normalizeName(name);
  const aiTag = one<{ id: number }>('SELECT id FROM ai_tags WHERE normalized_name = ? AND category = ?', [
    normalized,
    category
  ]);
  const runRows = all<{ id: number; run_id: number }>(
    `SELECT id, run_id FROM ai_run_tags
      WHERE video_id = ? AND normalized_name = ? AND category = ? AND status = 'approved'`,
    [videoId, normalized, category]
  );
  tx(() => {
    if (aiTag) run('DELETE FROM video_ai_tags WHERE video_id = ? AND ai_tag_id = ?', [videoId, aiTag.id]);
    for (const row of runRows) {
      run("UPDATE ai_run_tags SET status = 'pending' WHERE id = ?", [row.id]);
    }
    for (const runId of new Set(runRows.map((row) => row.run_id))) {
      recomputeRunReviewStatus(runId);
    }
  });
  return { videoId, runIds: Array.from(new Set(runRows.map((row) => row.run_id))) };
}

export function removeRunTag(tagId: number): AiReviewItem | null {
  const row = one<RunTagRow>('SELECT * FROM ai_run_tags WHERE id = ?', [tagId]);
  if (!row) return null;
  tx(() => {
    if (row.status === 'approved') {
      const aiTag = one<{ id: number }>('SELECT id FROM ai_tags WHERE normalized_name = ? AND category = ?', [
        row.normalized_name,
        row.category
      ]);
      if (aiTag) {
        run('DELETE FROM video_ai_tags WHERE video_id = ? AND ai_tag_id = ?', [row.video_id, aiTag.id]);
      }
    }
    run('DELETE FROM ai_run_tags WHERE id = ?', [tagId]);
    recomputeRunReviewStatus(row.run_id);
  });
  return getReviewItem(row.run_id);
}

/* --------------------------------- approved tags ---------------------------- */

export function listAiTags(): AiTagSummary[] {
  return all<{
    id: number;
    name: string;
    category: string;
    count: number;
    sources: string | null;
  }>(
    `SELECT at.id, at.name, at.category, COUNT(vat.video_id) AS count,
            GROUP_CONCAT(DISTINCT vat.source) AS sources
       FROM ai_tags at
       JOIN video_ai_tags vat ON vat.ai_tag_id = at.id
       JOIN videos v ON v.id = vat.video_id AND v.status <> 'trashed'
      GROUP BY at.id, at.name, at.category
      ORDER BY count DESC, at.name COLLATE NOCASE`
  ).map((row) => {
    const sources = (row.sources ?? '').split(',').filter(Boolean);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      count: row.count,
      source: (sources.length > 1 ? 'mixed' : (sources[0] as AiTagSource)) ?? 'vision'
    };
  });
}

export function getApprovedAiTags(videoId: number): AiTagRef[] {
  return all<AiTagRef>(
    `SELECT at.name, at.category, vat.confidence, vat.source
       FROM video_ai_tags vat
       JOIN ai_tags at ON at.id = vat.ai_tag_id
      WHERE vat.video_id = ?
      ORDER BY at.category COLLATE NOCASE, vat.confidence DESC, at.name COLLATE NOCASE`,
    [videoId]
  );
}

export function getAiTaggedAt(videoId: number): string | null {
  return (
    one<{ approved_at: string | null }>(
      'SELECT MAX(approved_at) AS approved_at FROM video_ai_tags WHERE video_id = ?',
      [videoId]
    )?.approved_at ?? null
  );
}

export function restoreApprovedAiTag(
  videoId: number,
  tag: { name: string; category: string; confidence: number; source: AiTagSource; approvedAt?: string }
): void {
  const name = String(tag.name ?? '').trim();
  const category = String(tag.category ?? '').trim();
  if (!name || !category) return;
  const normalized = normalizeName(name);
  const approvedAt = tag.approvedAt || now();
  run(
    `INSERT INTO ai_tags (name, normalized_name, category, created_at)
     VALUES (?,?,?,?)
     ON CONFLICT(normalized_name, category) DO UPDATE SET name = excluded.name`,
    [name, normalized, category, approvedAt]
  );
  const aiTag = one<{ id: number }>('SELECT id FROM ai_tags WHERE normalized_name = ? AND category = ?', [
    normalized,
    category
  ]);
  if (!aiTag) return;
  run(
    `INSERT INTO video_ai_tags (video_id, ai_tag_id, run_id, confidence, source, approved_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(video_id, ai_tag_id) DO UPDATE SET
       confidence = excluded.confidence, source = excluded.source, approved_at = excluded.approved_at`,
    [videoId, aiTag.id, null, clamp(tag.confidence, 0, 1, 0.7), tag.source || 'vision', approvedAt]
  );
}

export function getAiPendingCount(videoId: number): number {
  return (
    one<{ c: number }>("SELECT COUNT(*) AS c FROM ai_run_tags WHERE video_id = ? AND status = 'pending'", [
      videoId
    ])?.c ?? 0
  );
}

export function getAiSummary(videoId: number): { summary: string | null; lastRunAt: string | null } {
  const row = one<{ result_json: string | null; created_at: string }>(
    `SELECT result_json, created_at FROM ai_runs
      WHERE video_id = ? AND status = 'done'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [videoId]
  );
  if (!row) return { summary: null, lastRunAt: null };
  const result = parseJson<{ summary?: string }>(row.result_json, {});
  return { summary: result.summary ?? null, lastRunAt: row.created_at };
}

export function aiStats(): AiStats {
  const row = one<{
    taggedVideos: number;
    pendingTags: number;
    approvedTags: number;
    failedRuns: number;
    inputTokens: number;
    outputTokens: number;
    modelRequests: number;
    musicRequests: number;
  }>(
    `SELECT
       (SELECT COUNT(DISTINCT video_id) FROM ai_runs WHERE status = 'done') AS taggedVideos,
       (SELECT COUNT(*) FROM ai_run_tags WHERE status = 'pending') AS pendingTags,
       (SELECT COUNT(*) FROM ai_run_tags WHERE status = 'approved') AS approvedTags,
       (SELECT COUNT(*) FROM ai_runs WHERE status = 'failed') AS failedRuns,
       (SELECT COALESCE(SUM(input_tokens), 0) FROM ai_runs) AS inputTokens,
       (SELECT COALESCE(SUM(output_tokens), 0) FROM ai_runs) AS outputTokens,
       (SELECT COALESCE(SUM(request_count), 0) FROM ai_runs) AS modelRequests,
       (SELECT COALESCE(SUM(music_request_count), 0) FROM ai_runs) AS musicRequests`
  );
  return {
    taggedVideos: row?.taggedVideos ?? 0,
    pendingTags: row?.pendingTags ?? 0,
    approvedTags: row?.approvedTags ?? 0,
    failedRuns: row?.failedRuns ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    modelRequests: row?.modelRequests ?? 0,
    musicRequests: row?.musicRequests ?? 0
  };
}

/* -------------------------------- music cache ------------------------------- */

export function getMusicCache(hash: string): unknown | null {
  const row = one<{ result_json: string }>('SELECT result_json FROM ai_music_cache WHERE hash = ?', [hash]);
  return row ? parseJson<unknown>(row.result_json, null) : null;
}

export function setMusicCache(hash: string, result: unknown): void {
  run(
    `INSERT INTO ai_music_cache (hash, result_json, created_at) VALUES (?,?,?)
     ON CONFLICT(hash) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at`,
    [hash, JSON.stringify(result), now()]
  );
}

export function countMusicCallsToday(): number {
  const today = new Date().toISOString().slice(0, 10);
  return (
    one<{ c: number }>('SELECT COUNT(*) AS c FROM ai_music_cache WHERE substr(created_at, 1, 10) = ?', [
      today
    ])?.c ?? 0
  );
}

/* --------------------------------- analysis --------------------------------- */

interface AnalysisRow {
  id: number;
  provider_id: string | null;
  provider_name: string | null;
  model: string | null;
  mode: 'text' | 'vision' | 'hybrid';
  sample_json: string;
  status: AiRunStatus;
  result_json: string | null;
  input_tokens: number;
  output_tokens: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

function mapAnalysis(row: AnalysisRow): AiAnalysisRun {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    providerName: row.provider_name,
    model: row.model,
    sample: parseJson<AiAnalysisSample[]>(row.sample_json, []),
    result: parseJson<AiAnalysisRun['result']>(row.result_json, null),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at
  };
}

export function createAnalysisRun(input: {
  providerId: string;
  providerName: string;
  model: string;
  mode: 'text' | 'vision' | 'hybrid';
  sample: AiAnalysisSample[];
}): number {
  return run(
    `INSERT INTO ai_analysis_runs (provider_id, provider_name, model, mode, sample_json, status, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      input.providerId,
      input.providerName,
      input.model,
      input.mode,
      JSON.stringify(input.sample),
      'queued',
      now()
    ]
  ).lastInsertRowid;
}

export function updateAnalysisRun(
  id: number,
  patch: Partial<{
    status: AiRunStatus;
    resultJson: string | null;
    inputTokens: number;
    outputTokens: number;
    error: string | null;
    finishedAt: string | null;
  }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: Array<[keyof typeof patch, string]> = [
    ['status', 'status'],
    ['resultJson', 'result_json'],
    ['inputTokens', 'input_tokens'],
    ['outputTokens', 'output_tokens'],
    ['error', 'error'],
    ['finishedAt', 'finished_at']
  ];
  for (const [key, column] of map) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE ai_analysis_runs SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function listAnalysisRuns(): AiAnalysisRun[] {
  return all<AnalysisRow>('SELECT * FROM ai_analysis_runs ORDER BY created_at DESC, id DESC LIMIT 20').map(
    mapAnalysis
  );
}

export function getAnalysisRun(id: number): AiAnalysisRun | null {
  const row = one<AnalysisRow>('SELECT * FROM ai_analysis_runs WHERE id = ?', [id]);
  return row ? mapAnalysis(row) : null;
}
