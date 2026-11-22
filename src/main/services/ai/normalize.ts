import { z } from 'zod';
import type { AiBgmResult, AiTagProfile, AiTagSource } from '@shared/types';
import { normalizeKey } from '@shared/text';
import type { NormalizedAiTag } from '../../db/ai';

const rawTagSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(40).optional().default('其他'),
  confidence: z.number().min(0).max(1).optional().default(0.7),
  evidence: z.string().max(300).optional()
});

/**
 * 模型对 bgm 的写法很随意：source 会写成 "none"、"vision"、"description"，
 * 置信度可能超过 1，字段可能是空字符串。这里一律宽松接收，再由 normalizeBgm 归一，
 * 否则一条视频的整轮打标会因为这个字段判失败。
 */
const rawBgmSchema = z
  .object({
    title: z.string().max(200).nullable().optional(),
    artists: z.array(z.string().max(100)).max(10).optional(),
    genres: z.array(z.string().max(50)).max(10).optional(),
    source: z.string().max(40).optional(),
    confidence: z.number().optional()
  })
  .nullable()
  .optional();

const rawResultSchema = z.object({
  summary: z.string().max(300).optional().default(''),
  tags: z.array(rawTagSchema).max(50).optional().default([]),
  bgm: rawBgmSchema
});

export type RawAiResult = z.infer<typeof rawResultSchema>;

export interface NormalizedAiResult {
  summary: string;
  tags: NormalizedAiTag[];
  bgm: AiBgmResult | null;
}

export function extractJson(raw: string): string {
  let text = String(raw ?? '').trim();
  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function looksTruncated(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
  }
  return inString || depth > 0;
}

export function parseAiResult(raw: string): RawAiResult {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // 推理/长输出模型经常被 max_tokens 切断，报「不是合法 JSON」会误导排查
    throw new Error(
      looksTruncated(json)
        ? '模型输出被截断，JSON 不完整（可在「模型与工具」提高输出上限，或减少单条视频的标签数量）'
        : '模型没有返回合法 JSON'
    );
  }
  const result = rawResultSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('；');
    throw new Error(`模型返回的 JSON 结构不符合要求：${detail}`);
  }
  return result.data;
}

function cleanTagName(value: string): string {
  const name = String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(name).slice(0, 24).join('');
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** 模型爱写 "none" / "vision" / "description"，统一收敛到三种合法来源 */
function normalizeBgmSource(value: string | undefined): AiTagSource {
  const text = String(value ?? '').toLocaleLowerCase();
  if (/acr/.test(text)) return 'acrcloud';
  if (/bili|tag|原始标签/.test(text)) return 'bilibili_tag';
  return 'inferred';
}

export function normalizeResult(raw: RawAiResult, profile: AiTagProfile): NormalizedAiResult {
  const categories = profile.taxonomy.categories.map((category) => category.name);
  const categoryLookup = new Map(categories.map((category) => [category.toLocaleLowerCase(), category]));
  const other = categories.find((category) => category === '其他') ?? categories[0] ?? '其他';
  const aliases = new Map(
    Object.entries(profile.taxonomy.aliases ?? {}).map(([from, to]) => [from.toLocaleLowerCase(), to])
  );
  const stopwords = new Set(profile.taxonomy.stopwords.map((word) => word.toLocaleLowerCase()));
  // 方案默认只用分类体系里列出的标签：模型很爱自己造词（把配色、材质、场景细拆成新标签），
  // 放任不管会让同一概念散成一堆近义标签。允许方案外标签时保持旧行为。
  const strict = profile.allowExtraTags !== true;
  const whitelist = new Set<string>();
  // 标签归属哪个分类以方案为准：模型把「服饰造型」写成「服饰」时，
  // 按名字查不到分类就会全部落到第一个分类（人物），实测一条视频 47 个服饰标签被塞进人物
  const tagCategory = new Map<string, string>();
  for (const category of profile.taxonomy.categories) {
    for (const example of category.examples ?? []) {
      const key = normalizeKey(example);
      whitelist.add(key);
      if (!tagCategory.has(key)) tagCategory.set(key, category.name);
    }
  }

  const resolveCategory = (value: string): string => {
    const key = String(value ?? '')
      .trim()
      .toLocaleLowerCase();
    if (!key) return other;
    const exact = categoryLookup.get(key);
    if (exact) return exact;
    const partial = categories.find((name) => {
      const lower = name.toLocaleLowerCase();
      return lower.includes(key) || key.includes(lower);
    });
    return partial ?? other;
  };

  const tags: NormalizedAiTag[] = [];
  const indexByKey = new Map<string, number>();
  // BGM 曲名/艺人本来就有独立字段，兜底时不该占用标签位
  const bgmKeys = new Set<string>();

  const addTag = (
    value: string,
    categoryValue: string,
    confidenceValue: number,
    source: AiTagSource,
    evidence?: string | null
  ): void => {
    let name = cleanTagName(value);
    if (!name) return;
    const alias = aliases.get(name.toLocaleLowerCase());
    // 别名只往方案内的规范名收敛：别名表里还有一堆曲名/UP 主映射，
    // 直接跟随会把标签带出方案范围，所以目标不在方案里时保留原词
    if (alias) {
      const target = cleanTagName(alias);
      if (!strict || whitelist.has(normalizeKey(target))) name = target;
    }
    if (!name || stopwords.has(name.toLocaleLowerCase())) return;
    // 同一个标签只保留一条：模型常把同一个标签同时标进两个分类
    const key = normalizeKey(name);
    const category = (strict ? tagCategory.get(key) : undefined) ?? resolveCategory(categoryValue);
    const confidence = clamp(confidenceValue, 0, 1, 0.7);
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      const current = tags[existing]!;
      if (confidence > current.confidence) {
        tags[existing] = { ...current, confidence, source, evidence: evidence ?? current.evidence };
      }
      return;
    }
    indexByKey.set(key, tags.length);
    tags.push({
      category,
      name,
      normalizedName: normalizeKey(name),
      confidence,
      source,
      evidence: evidence ?? null
    });
  };

  for (const tag of raw.tags) {
    addTag(tag.name, tag.category, tag.confidence, 'vision', tag.evidence ?? null);
  }

  let bgm: AiBgmResult | null = null;
  if (raw.bgm) {
    const title = raw.bgm.title?.trim() || null;
    const artists = Array.from(
      new Set((raw.bgm.artists ?? []).map((artist) => artist.trim()).filter(Boolean))
    );
    const genres = Array.from(new Set((raw.bgm.genres ?? []).map((genre) => genre.trim()).filter(Boolean)));
    // 什么都没识别出来时不要留一个空 bgm 对象，界面会显示成「识别到 BGM」
    if (title || artists.length > 0 || genres.length > 0) {
      const source = normalizeBgmSource(raw.bgm.source);
      const confidence = clamp(raw.bgm.confidence ?? 0.7, 0, 1, 0.7);
      if (title) {
        addTag(title, 'BGM', confidence, source);
        bgmKeys.add(normalizeKey(title));
      }
      for (const artist of artists) {
        addTag(artist, 'BGM', confidence * 0.95, source);
        bgmKeys.add(normalizeKey(artist));
      }
      const genreCategory = categories.includes('音乐风格') ? '音乐风格' : 'BGM';
      for (const genre of genres) {
        addTag(genre, genreCategory, confidence * 0.9, source);
        bgmKeys.add(normalizeKey(genre));
      }
      bgm = { title, artists, genres, source, confidence };
    }
  }

  const filtered = tags
    .filter((tag) => tag.confidence >= profile.minConfidence)
    .sort((a, b) => b.confidence - a.confidence || a.category.localeCompare(b.category, 'zh'));

  const inScope = strict ? filtered.filter((tag) => whitelist.has(tag.normalizedName)) : filtered;
  // 全都不在方案内时宁可保留模型的原始输出，也不要返回空标签（曲名除外，它有独立字段）
  const rawOnly = filtered.filter((tag) => !bgmKeys.has(tag.normalizedName));
  const fallback = rawOnly.length > 0 ? rawOnly : filtered;
  const chosen = (strict && inScope.length === 0 ? fallback : inScope).slice(0, profile.maxTags);

  return {
    summary: String(raw.summary ?? '')
      .trim()
      .slice(0, 300),
    tags: chosen,
    bgm
  };
}
