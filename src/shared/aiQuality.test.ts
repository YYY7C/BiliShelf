import { describe, expect, it } from 'vitest';
import {
  detectIssues,
  isHardIssue,
  issueLabel,
  LOW_CONFIDENCE_KIND,
  ruleLabel,
  sanitizeQualityConfig,
  selectorMatches,
  type AiQualityConfig
} from './aiQuality';

// 全部用合成词，避免把真实标签方案写进仓库
const tag = (name: string, category: string, confidence = 0.9) => ({ name, category, confidence });

const config: AiQualityConfig = {
  lowConfidence: 0.6,
  categoryRules: [],
  musicHints: [],
  rules: [
    { kind: 'pair-tag-prefix', type: 'pair', a: { tags: ['甲'] }, b: { categoryPrefix: '类目乙' } },
    {
      kind: 'pair-tag-suffix',
      type: 'pair',
      a: { tags: ['甲'] },
      b: { categoryEquals: '类目丙', nameSuffixes: ['子'] }
    },
    { kind: 'multi-category', type: 'multi', group: { categoryEquals: '类目丁' }, minCount: 2 },
    { kind: 'multi-tags', type: 'multi', group: { tags: ['戊', '己', '庚'] }, minCount: 2 },
    {
      kind: 'multi-suffix',
      type: 'multi',
      group: { categoryEquals: '类目丙', nameSuffixes: ['子'] },
      minCount: 2
    }
  ]
};

describe('selectorMatches', () => {
  it('matches tag names, categories and suffixes', () => {
    expect(selectorMatches(tag('甲', '别处'), { tags: ['甲'] })).toBe(true);
    expect(selectorMatches(tag('别的', '类目乙·子类'), { categoryPrefix: '类目乙' })).toBe(true);
    expect(selectorMatches(tag('丙子', '类目丙'), { categoryEquals: '类目丙', nameSuffixes: ['子'] })).toBe(true);
  });

  it('requires every provided condition', () => {
    expect(selectorMatches(tag('丙子', '别处'), { categoryEquals: '类目丙', nameSuffixes: ['子'] })).toBe(false);
    expect(selectorMatches(tag('丙丑', '类目丙'), { categoryEquals: '类目丙', nameSuffixes: ['子'] })).toBe(false);
  });

  it('never matches an empty selector', () => {
    expect(selectorMatches(tag('甲', '类目乙'), {})).toBe(false);
  });
});

describe('detectIssues', () => {
  it('flags a pair when both sides are present', () => {
    expect(detectIssues([tag('甲', '人物'), tag('乙一', '类目乙·颜色')], config)).toContain('pair-tag-prefix');
  });

  it('does not flag a pair with only one side', () => {
    expect(detectIssues([tag('甲', '人物')], config)).not.toContain('pair-tag-prefix');
  });

  it('applies category and suffix conditions together', () => {
    expect(detectIssues([tag('甲', '人物'), tag('丙子', '类目丙')], config)).toContain('pair-tag-suffix');
    expect(detectIssues([tag('甲', '人物'), tag('丙子', '别处')], config)).not.toContain('pair-tag-suffix');
  });

  it('flags a category group with two distinct names', () => {
    expect(detectIssues([tag('丁一', '类目丁'), tag('丁二', '类目丁')], config)).toContain('multi-category');
    expect(detectIssues([tag('丁一', '类目丁'), tag('丁一', '类目丁')], config)).not.toContain('multi-category');
  });

  it('checks the tag group by name', () => {
    expect(detectIssues([tag('戊', '别处'), tag('己', '别处')], config)).toContain('multi-tags');
    expect(detectIssues([tag('戊', '别处'), tag('辛', '别处')], config)).not.toContain('multi-tags');
  });

  it('counts distinct suffixes inside one category', () => {
    expect(detectIssues([tag('丙子', '类目丙'), tag('丙丑子', '类目丙')], config)).toContain('multi-suffix');
    expect(detectIssues([tag('丙子', '类目丙')], config)).not.toContain('multi-suffix');
  });

  it('reports low confidence separately', () => {
    expect(detectIssues([tag('甲', '人物', 0.4)], config)).toContain(LOW_CONFIDENCE_KIND);
    expect(detectIssues([tag('甲', '人物', 0.8)], config)).not.toContain(LOW_CONFIDENCE_KIND);
    expect(detectIssues([tag('甲', '人物', 0)], { ...config, lowConfidence: 0.6 })).not.toContain(
      LOW_CONFIDENCE_KIND
    );
  });

  it('treats low confidence as a hint, not a hard conflict', () => {
    expect(isHardIssue(LOW_CONFIDENCE_KIND)).toBe(false);
    expect(isHardIssue('pair-tag-prefix')).toBe(true);
  });

  it('ignores tags without name or category', () => {
    expect(detectIssues([tag('', '类目丁'), tag('丁一', '')], config)).toEqual([]);
  });

  it('returns nothing when no rules are configured', () => {
    expect(
      detectIssues([tag('甲', '类目乙')], { rules: [], categoryRules: [], musicHints: [], lowConfidence: 0 })
    ).toEqual([]);
  });
});

describe('labels', () => {
  it('falls back to generic wording so the vocabulary stays out of the repo', () => {
    expect(ruleLabel({ kind: 'x', type: 'pair', a: { tags: ['甲'] }, b: { tags: ['乙'] } })).toBe(
      '同一套造型内互斥'
    );
    expect(ruleLabel({ kind: 'y', type: 'multi', group: { tags: ['甲'] }, minCount: 2 })).toBe('同分类多个取值');
  });

  it('uses the configured label when present', () => {
    const rules = [{ kind: 'z', type: 'pair' as const, label: '自定义', a: { tags: ['甲'] }, b: { tags: ['乙'] } }];
    expect(issueLabel('z', { rules, categoryRules: [], musicHints: [], lowConfidence: 0 })).toBe('自定义');
    expect(issueLabel(LOW_CONFIDENCE_KIND, { rules, categoryRules: [], musicHints: [], lowConfidence: 0 })).toBe(
      '存在低置信度标签'
    );
  });
});

describe('sanitizeQualityConfig', () => {
  it('keeps valid rules and drops broken ones', () => {
    const result = sanitizeQualityConfig({
      lowConfidence: 2,
      rules: [
        { kind: 'a', type: 'pair', a: { tags: [' 甲 ', '甲'] }, b: { categoryPrefix: '乙' } },
        { kind: 'a', type: 'pair', a: { tags: ['丙'] }, b: { tags: ['丁'] } },
        { kind: 'b', type: 'pair', a: {}, b: { tags: ['丁'] } },
        { kind: 'c', type: 'multi', group: { tags: ['戊'] }, minCount: 1 },
        { kind: '', type: 'multi', group: { tags: ['己'] }, minCount: 2 },
        { kind: 'd', type: 'unknown' }
      ]
    });
    expect(result.lowConfidence).toBe(1);
    expect(result.rules.map((rule) => rule.kind)).toEqual(['a', 'c']);
    expect(result.rules[0]).toMatchObject({ type: 'pair', a: { tags: ['甲'] } });
    expect(result.rules[1]).toMatchObject({ type: 'multi', minCount: 2 });
  });

  it('falls back to an empty config for garbage input', () => {
    expect(sanitizeQualityConfig(null).rules).toEqual([]);
    expect(sanitizeQualityConfig('nope').rules).toEqual([]);
    expect(sanitizeQualityConfig({ rules: 'nope' }).rules).toEqual([]);
  });
});
