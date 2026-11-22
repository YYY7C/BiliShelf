import { MAX_ANALYSIS_CATEGORIES, MAX_ANALYSIS_FOCUS } from '@shared/aiDefaults';
import type { CategoryRule } from '@shared/aiQuality';
import { extractJson } from './normalize';

export interface ParsedAnalysis {
  summary: string;
  categories: Array<{ name: string; description: string; tags: string[]; coverage?: number }>;
  focus: string[];
  stopwords: string[];
  aliases: Record<string, string>;
  systemPrompt: string;
  promptTemplate: string;
  notes: string[];
}

function asText(value: unknown, max: number): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, max);
  return '';
}

function asTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (typeof value === 'string') {
    // 有些模型会把 ["a","b"] 写成 "a、b"
    return value
      .split(/[、,，;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems)
      .map((item) => item.slice(0, maxLength));
  }
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? asText(
              (item as { name?: unknown; tag?: unknown; label?: unknown }).name ??
                (item as { tag?: unknown }).tag ??
                (item as { label?: unknown }).label,
              maxLength
            )
          : '';
    const trimmed = text.trim();
    if (trimmed) result.push(trimmed.slice(0, maxLength));
    if (result.length >= maxItems) break;
  }
  return result;
}

function asCoverage(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number.parseFloat(value.replace('%', '')) : Number(value);
  if (!Number.isFinite(number)) return undefined;
  const normalized = number > 1 ? number / 100 : number;
  return Math.min(1, Math.max(0, normalized));
}

let categoryRules: CategoryRule[] = [];

/**
 * 多轮分析（每批文本 + 每条代表视频）都会自己起分类名，
 * 直接按名字合并会留下「甲与气质 / 甲气质 / 甲与角色」这类同义分类。
 * 词表属于用户数据，由 qualityRules 从素材库的 ai-quality.json 读入；
 * 匹配不到的名字原样保留，所以美食、教程等其它类型的库不会被误伤。
 */
export function setCategoryRules(rules: CategoryRule[]): void {
  categoryRules = rules;
}

export function canonicalCategoryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLocaleLowerCase();
  for (const rule of categoryRules) {
    if (rule.any.some((needle) => lower.includes(needle.toLocaleLowerCase()))) return rule.canonical;
  }
  return trimmed.slice(0, 40);
}

/**
 * 模型输出只当启发式数据处理：字段缺失、类型不对、字符串过长都就地修正，
 * 而不是整轮分析失败（实测视觉阶段会把 aliases 写成数组、coverage 写成 "80%"）。
 */
export function sanitizeAnalysis(raw: unknown): ParsedAnalysis {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const categories: ParsedAnalysis['categories'] = [];
  const rawCategories = Array.isArray(source.categories) ? source.categories : [];
  for (const item of rawCategories.slice(0, 20)) {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = canonicalCategoryName(asText(entry.name ?? entry.category ?? entry.title, 40));
    if (!name) continue;
    categories.push({
      name,
      description: asText(entry.description ?? entry.desc, 300),
      tags: asTextList(entry.tags ?? entry.examples ?? entry.candidates, 50, 60),
      coverage: asCoverage(entry.coverage)
    });
  }

  const aliases: Record<string, string> = {};
  const rawAliases = source.aliases;
  if (Array.isArray(rawAliases)) {
    for (const item of rawAliases.slice(0, 100)) {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const from = asText(entry.from ?? entry.alias ?? entry.source, 60);
      const to = asText(entry.to ?? entry.target ?? entry.canonical, 60);
      if (from && to) aliases[from] = to;
    }
  } else if (rawAliases && typeof rawAliases === 'object') {
    for (const [key, value] of Object.entries(rawAliases as Record<string, unknown>).slice(0, 100)) {
      const to = asText(value, 60);
      if (key.trim() && to) aliases[key.trim().slice(0, 60)] = to;
    }
  }

  return {
    summary: asText(source.summary ?? source.overview, 1000),
    categories,
    // 关注点是一条「维度：具体看什么」的描述，40 字装不下，会从中间截断
    focus: asTextList(source.focus ?? source.focusAreas, 30, 200),
    stopwords: asTextList(source.stopwords ?? source.exclude, 100, 40),
    aliases,
    systemPrompt: asText(source.systemPrompt ?? source.system_prompt, 8000),
    promptTemplate: asText(source.promptTemplate ?? source.prompt_template ?? source.template, 12000),
    notes: asTextList(source.notes, 20, 300)
  };
}

export function parseAnalysis(raw: string): ParsedAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error('分析模型没有返回合法 JSON');
  }
  return sanitizeAnalysis(parsed);
}

export interface MergedAnalysisShape {
  categories: Array<{ name: string; description: string; tags: string[]; coverage?: number }>;
  focus: string[];
}

function focusKey(text: string): string {
  const [head] = text.split(/[:：]/);
  const key = (head ?? '').trim();
  return key || text.trim();
}

/**
 * 混合模式下每一轮视觉校验都会自造分类名与关注点描述，
 * 合并后容易出现「人物形象与气质 / 人物形象与妆发 / 角色人设」这类近义分类。
 * 这里按标签数保留前 N 个分类，并按「人物形象：…」的前缀去重关注点。
 */
export function pruneMergedAnalysis<T extends MergedAnalysisShape>(
  result: T,
  limits: { categories?: number; focus?: number } = {}
): T {
  const maxCategories = limits.categories ?? MAX_ANALYSIS_CATEGORIES;
  const maxFocus = limits.focus ?? MAX_ANALYSIS_FOCUS;

  // 单轮结果内部就可能出现同名分类（多轮合并只按名字对齐，管不到同一轮里的重复）
  const byName = new Map<string, MergedAnalysisShape['categories'][number]>();
  for (const category of result.categories) {
    const existing = byName.get(category.name);
    if (!existing) {
      byName.set(category.name, { ...category, tags: [...category.tags] });
      continue;
    }
    if (category.description.length > existing.description.length) existing.description = category.description;
    existing.tags = Array.from(new Set([...existing.tags, ...category.tags])).slice(0, 50);
    existing.coverage =
      category.coverage !== undefined
        ? Math.max(existing.coverage ?? 0, category.coverage)
        : existing.coverage;
  }

  const deduped = Array.from(byName.values());
  let kept = deduped;
  if (deduped.length > maxCategories) {
    const keep = new Set(
      [...deduped]
        .sort((a, b) => b.tags.length - a.tags.length)
        .slice(0, maxCategories)
        .map((category) => category.name)
    );
    kept = deduped.filter((category) => keep.has(category.name));
  }

  const focus: string[] = [];
  const byKey = new Map<string, number>();
  for (const item of result.focus) {
    const key = focusKey(item);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, focus.length);
      focus.push(item);
    } else if (item.length > focus[existing]!.length) {
      focus[existing] = item;
    }
  }

  return { ...result, categories: kept as T['categories'], focus: focus.slice(0, maxFocus) };
}
