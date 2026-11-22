/**
 * AI 标签质量规则引擎（通用类型 + 纯函数）。
 *
 * 具体词表属于用户数据，放在素材库根目录的 `ai-quality.json`（已 gitignore），
 * 这里只保留选择器与判定逻辑。换装视频同一条里可能有多套造型，
 * 所以命中只做**提示**，不会自动改标签。
 */

/** 低置信度不是一条配置规则，固定用它作为问题标识 */
export const LOW_CONFIDENCE_KIND = 'low-confidence';
export const LOW_CONFIDENCE_LABEL = '存在低置信度标签';

/** 标签选择器：写了几个条件就是几个条件的「与」，空选择器不匹配任何标签 */
export interface RuleSelector {
  /** 标签名精确匹配 */
  tags?: string[];
  /** 分类名完全相等 */
  categoryEquals?: string;
  /** 分类名以它开头 */
  categoryPrefix?: string;
  /** 标签名以这些后缀结尾 */
  nameSuffixes?: string[];
}

export interface PairRule {
  kind: string;
  type: 'pair';
  /** 界面文案；留空用通用文案，避免把词表写进仓库 */
  label?: string;
  a: RuleSelector;
  b: RuleSelector;
}

export interface MultiRule {
  kind: string;
  type: 'multi';
  label?: string;
  group: RuleSelector;
  /** 组内不同标签数达到它即命中，最小 2 */
  minCount: number;
}

export type QualityRule = PairRule | MultiRule;

/** 分类名归一词表：名字命中 `any` 里任一关键词，就归到 `canonical` */
export interface CategoryRule {
  any: string[];
  canonical: string;
}

export interface AiQualityConfig {
  rules: QualityRule[];
  /** 多轮分析生成的同义分类名归一到固定桶，避免合并后出现重复分类 */
  categoryRules: CategoryRule[];
  /** 提示词里用来判断「这个视频值不值得调音乐识别」的关键词 */
  musicHints: string[];
  /** 低于它的置信度算一次提示；<=0 表示关闭 */
  lowConfidence: number;
}

export const DEFAULT_LOW_CONFIDENCE = 0.6;

export const EMPTY_QUALITY_CONFIG: AiQualityConfig = {
  rules: [],
  categoryRules: [],
  musicHints: [],
  lowConfidence: DEFAULT_LOW_CONFIDENCE
};

export interface QualityTag {
  name: string;
  category: string;
  confidence: number;
}

export function selectorIsEmpty(selector: RuleSelector): boolean {
  return (
    !selector.tags?.length &&
    selector.categoryEquals === undefined &&
    selector.categoryPrefix === undefined &&
    !selector.nameSuffixes?.length
  );
}

export function selectorMatches(tag: QualityTag, selector: RuleSelector): boolean {
  if (selectorIsEmpty(selector)) return false;
  if (selector.tags?.length && !selector.tags.includes(tag.name)) return false;
  if (selector.categoryEquals !== undefined && tag.category !== selector.categoryEquals) return false;
  if (selector.categoryPrefix !== undefined && !tag.category.startsWith(selector.categoryPrefix)) return false;
  if (selector.nameSuffixes?.length && !selector.nameSuffixes.some((suffix) => tag.name.endsWith(suffix))) {
    return false;
  }
  return true;
}

export function ruleLabel(rule: QualityRule): string {
  const custom = rule.label?.trim();
  if (custom) return custom;
  return rule.type === 'pair' ? '同一套造型内互斥' : '同分类多个取值';
}

/** 问题标识 → 界面文案；未配置的 kind 原样返回，方便排查 */
export function issueLabel(kind: string, config: AiQualityConfig): string {
  if (kind === LOW_CONFIDENCE_KIND) return LOW_CONFIDENCE_LABEL;
  const rule = config.rules.find((item) => item.kind === kind);
  return rule ? ruleLabel(rule) : kind;
}

/**
 * 检测一条打标结果里的问题。
 * 返回命中的问题标识（自定义 kind + `low-confidence`），空数组表示没问题。
 */
export function detectIssues(tags: QualityTag[], config: AiQualityConfig): string[] {
  const live = tags.filter((tag) => tag.name && tag.category);
  const issues: string[] = [];
  if (live.length === 0) return issues;

  for (const rule of config.rules) {
    if (rule.type === 'pair') {
      const hasA = live.some((tag) => selectorMatches(tag, rule.a));
      const hasB = live.some((tag) => selectorMatches(tag, rule.b));
      if (hasA && hasB) issues.push(rule.kind);
      continue;
    }
    const names = new Set(live.filter((tag) => selectorMatches(tag, rule.group)).map((tag) => tag.name));
    if (names.size >= Math.max(2, rule.minCount)) issues.push(rule.kind);
  }

  if (config.lowConfidence > 0 && live.some((tag) => tag.confidence > 0 && tag.confidence < config.lowConfidence)) {
    issues.push(LOW_CONFIDENCE_KIND);
  }

  return issues;
}

/** 低置信度只是提示，其余规则都表示「同一套造型里不可能同时成立」 */
export function isHardIssue(kind: string): boolean {
  return kind !== LOW_CONFIDENCE_KIND;
}

/* --------------------------------- 配置校验 -------------------------------- */

const MAX_RULES = 50;
const MAX_TAGS = 200;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = Array.from(new Set(value.map((item) => text(item, maxLength)).filter((item): item is string => Boolean(item))));
  return list.length > 0 ? list.slice(0, maxItems) : undefined;
}

function sanitizeSelector(value: unknown): RuleSelector | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const selector: RuleSelector = {};
  const tags = textList(raw.tags, MAX_TAGS, 40);
  if (tags) selector.tags = tags;
  const equals = text(raw.categoryEquals, 40);
  if (equals) selector.categoryEquals = equals;
  const prefix = text(raw.categoryPrefix, 40);
  if (prefix) selector.categoryPrefix = prefix;
  const suffixes = textList(raw.nameSuffixes, 20, 10);
  if (suffixes) selector.nameSuffixes = suffixes;
  return selectorIsEmpty(selector) ? null : selector;
}

/** 把 `ai-quality.json` 的内容收敛成合法配置，非法项直接丢弃，不让整份配置失效 */
export function sanitizeQualityConfig(input: unknown): AiQualityConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rules: QualityRule[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.rules) ? raw.rules : []) {
    if (rules.length >= MAX_RULES) break;
    if (!item || typeof item !== 'object') continue;
    const rule = item as Record<string, unknown>;
    const kind = text(rule.kind, 64);
    if (!kind || seen.has(kind)) continue;
    const label = text(rule.label, 60);

    if (rule.type === 'pair') {
      const a = sanitizeSelector(rule.a);
      const b = sanitizeSelector(rule.b);
      if (!a || !b) continue;
      rules.push({ kind, type: 'pair', ...(label ? { label } : {}), a, b });
    } else if (rule.type === 'multi') {
      const group = sanitizeSelector(rule.group);
      if (!group) continue;
      const minCount = Math.min(10, Math.max(2, Math.trunc(Number(rule.minCount) || 2)));
      rules.push({ kind, type: 'multi', ...(label ? { label } : {}), group, minCount });
    } else {
      continue;
    }
    seen.add(kind);
  }

  const categoryRules: CategoryRule[] = [];
  for (const item of Array.isArray(raw.categoryRules) ? raw.categoryRules : []) {
    if (categoryRules.length >= MAX_RULES) break;
    if (!item || typeof item !== 'object') continue;
    const rule = item as Record<string, unknown>;
    const canonical = text(rule.canonical, 40);
    const any = textList(rule.any, 40, 20);
    if (!canonical || !any) continue;
    categoryRules.push({ any, canonical });
  }

  const musicHints = textList(raw.musicHints, 40, 20) ?? [];

  const lowRaw = Number(raw.lowConfidence);
  const lowConfidence = Number.isFinite(lowRaw) ? Math.min(1, Math.max(0, lowRaw)) : DEFAULT_LOW_CONFIDENCE;
  return { rules, categoryRules, musicHints, lowConfidence };
}
