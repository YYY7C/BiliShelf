import { z } from 'zod';
import type { AiBgmResult, AiTagProfile, AiTagSource } from '@shared/types';
import type { NormalizedAiTag } from '../../db/ai';

const rawTagSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(40).optional().default('其他'),
  confidence: z.number().min(0).max(1).optional().default(0.7),
  evidence: z.string().max(300).optional()
});

const rawBgmSchema = z
  .object({
    title: z.string().max(200).nullable().optional(),
    artists: z.array(z.string().max(100)).max(10).optional(),
    genres: z.array(z.string().max(50)).max(10).optional(),
    source: z.enum(['acrcloud', 'bilibili_tag', 'inferred']).optional(),
    confidence: z.number().min(0).max(1).optional()
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

export function parseAiResult(raw: string): RawAiResult {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('模型没有返回合法 JSON');
  }
  return rawResultSchema.parse(parsed);
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
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

export function normalizeResult(raw: RawAiResult, profile: AiTagProfile): NormalizedAiResult {
  const categories = profile.taxonomy.categories.map((category) => category.name);
  const categoryLookup = new Map(categories.map((category) => [category.toLocaleLowerCase(), category]));
  const other = categories.find((category) => category === '其他') ?? categories[0] ?? '其他';
  const aliases = new Map(
    Object.entries(profile.taxonomy.aliases ?? {}).map(([from, to]) => [from.toLocaleLowerCase(), to])
  );
  const stopwords = new Set(profile.taxonomy.stopwords.map((word) => word.toLocaleLowerCase()));
  const tags: NormalizedAiTag[] = [];
  const indexByKey = new Map<string, number>();

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
    if (alias) name = cleanTagName(alias);
    if (!name || stopwords.has(name.toLocaleLowerCase())) return;
    const category =
      categoryLookup.get(
        String(categoryValue ?? '')
          .trim()
          .toLocaleLowerCase()
      ) ?? other;
    const confidence = clamp(confidenceValue, 0, 1, 0.7);
    const key = `${normalizeName(name)}|${category}`;
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
      normalizedName: normalizeName(name),
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
    const source: AiTagSource = raw.bgm.source ?? 'inferred';
    const confidence = clamp(raw.bgm.confidence ?? 0.7, 0, 1, 0.7);
    const title = raw.bgm.title?.trim() || null;
    const artists = Array.from(
      new Set((raw.bgm.artists ?? []).map((artist) => artist.trim()).filter(Boolean))
    );
    const genres = Array.from(new Set((raw.bgm.genres ?? []).map((genre) => genre.trim()).filter(Boolean)));
    if (title) addTag(title, 'BGM', confidence, source);
    for (const artist of artists) addTag(artist, 'BGM', confidence * 0.95, source);
    const genreCategory = categories.includes('音乐风格') ? '音乐风格' : 'BGM';
    for (const genre of genres) addTag(genre, genreCategory, confidence * 0.9, source);
    bgm = {
      title,
      artists,
      genres,
      source,
      confidence
    };
  }

  const filtered = tags
    .filter((tag) => tag.confidence >= profile.minConfidence)
    .sort((a, b) => b.confidence - a.confidence || a.category.localeCompare(b.category, 'zh'))
    .slice(0, profile.maxTags);

  return {
    summary: String(raw.summary ?? '')
      .trim()
      .slice(0, 300),
    tags: filtered,
    bgm
  };
}
