import type { AiQualityConfig, QualityRule, RuleSelector } from '@shared/aiQuality';

/**
 * 把规则翻成 SQL 片段（只统计 pending 标签）。
 * 判定必须与渲染层的 `selectorMatches` / `detectIssues` 一致，
 * 二者共用同一份 `ai-quality.json`，改这里时记得同步改那边。
 */

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlList(values: string[]): string {
  return values.map((value) => sqlText(value)).join(',');
}

/** 条件之间是「与」，空选择器返回 0（永不命中） */
export function selectorSql(selector: RuleSelector): string {
  const parts: string[] = [];
  if (selector.tags?.length) parts.push(`t.name IN (${sqlList(selector.tags)})`);
  if (selector.categoryEquals !== undefined) parts.push(`t.category = ${sqlText(selector.categoryEquals)}`);
  if (selector.categoryPrefix !== undefined) parts.push(`t.category LIKE ${sqlText(`${selector.categoryPrefix}%`)}`);
  if (selector.nameSuffixes?.length) {
    parts.push(`(${selector.nameSuffixes.map((suffix) => `t.name LIKE ${sqlText(`%${suffix}`)}`).join(' OR ')})`);
  }
  return parts.length > 0 ? parts.join(' AND ') : '0';
}

export function ruleClause(rule: QualityRule): string {
  if (rule.type === 'pair') {
    const exists = (selector: RuleSelector) =>
      `EXISTS (SELECT 1 FROM ai_run_tags t WHERE t.run_id = r.id AND t.status = 'pending' AND (${selectorSql(selector)}))`;
    return `(${exists(rule.a)} AND ${exists(rule.b)})`;
  }
  const minCount = Math.max(2, Math.trunc(rule.minCount));
  return `(SELECT COUNT(DISTINCT t.name) FROM ai_run_tags t
    WHERE t.run_id = r.id AND t.status = 'pending' AND (${selectorSql(rule.group)})) >= ${minCount}`;
}

/** 任一硬冲突（低置信度不算） */
export function anyRuleClause(config: AiQualityConfig): string {
  if (config.rules.length === 0) return '0';
  return `(${config.rules.map((rule) => `(${ruleClause(rule)})`).join(' OR ')})`;
}

export function lowConfidenceClause(config: AiQualityConfig): string {
  return `EXISTS (SELECT 1 FROM ai_run_tags t WHERE t.run_id = r.id AND t.status = 'pending'
    AND t.confidence > 0 AND t.confidence < ${config.lowConfidence})`;
}
