import { beforeEach, describe, expect, it } from 'vitest';
import type { CategoryRule } from '@shared/aiQuality';
import {
  canonicalCategoryName,
  parseAnalysis,
  pruneMergedAnalysis,
  sanitizeAnalysis,
  setCategoryRules
} from './analysisParse';

// 真实词表存在素材库的 ai-quality.json（不进仓库），测试用合成规则
const RULES: CategoryRule[] = [
  { any: ['甲一', '甲二'], canonical: '甲桶' },
  { any: ['乙一'], canonical: '乙桶' }
];

beforeEach(() => setCategoryRules(RULES));

describe('canonicalCategoryName', () => {
  it('把同义分类归一到固定桶', () => {
    expect(canonicalCategoryName('甲一与气质')).toBe('甲桶');
    expect(canonicalCategoryName('甲二')).toBe('甲桶');
    expect(canonicalCategoryName('乙一分类')).toBe('乙桶');
    expect(canonicalCategoryName('甲桶')).toBe('甲桶');
  });

  it('匹配不到的领域保持原样', () => {
    expect(canonicalCategoryName('丙参考')).toBe('丙参考');
    expect(canonicalCategoryName('软件教程')).toBe('软件教程');
  });

  it('没有配置规则时不做归一', () => {
    setCategoryRules([]);
    expect(canonicalCategoryName('甲一')).toBe('甲一');
  });

  it('多轮结果归一后能正确合并', () => {
    const merged = sanitizeAnalysis({
      categories: [
        { name: '甲一', tags: ['标签丁'] },
        { name: '甲二', tags: ['标签申'] }
      ]
    });

    expect(merged.categories.map((category) => category.name)).toEqual(['甲桶', '甲桶']);
  });
});

describe('sanitizeAnalysis', () => {
  // 视觉阶段实测会返回 "aliases": ["某UP名"]，严格 schema 会直接让整轮分析失败
  it('别名写成数组时退化为空表而不是报错', () => {
    expect(sanitizeAnalysis({ aliases: ['某UP名', '标签甲'] }).aliases).toEqual({});

    expect(sanitizeAnalysis({ aliases: [{ from: 'AB', to: '标签乙' }] }).aliases).toEqual({ AB: '标签乙' });

    expect(sanitizeAnalysis({ aliases: { jk: '标签乙' } }).aliases).toEqual({ jk: '标签乙' });
  });

  it('coverage 支持字符串与百分数，标签支持对象数组', () => {
    const result = sanitizeAnalysis({
      categories: [
        { name: '人物', description: '出镜人物', tags: [{ name: '长发' }, '标签甲'], coverage: '80%' }
      ]
    });

    expect(result.categories).toEqual([
      { name: '人物', description: '出镜人物', tags: ['长发', '标签甲'], coverage: 0.8 }
    ]);
  });

  it('字符串形式的关注点会按分隔符拆开，缺字段用默认值', () => {
    const result = sanitizeAnalysis({ focus: '人物形象、服饰穿搭, 舞蹈风格', summary: 42 });

    expect(result.focus).toEqual(['人物形象', '服饰穿搭', '舞蹈风格']);
    expect(result.summary).toBe('42');
    expect(result.categories).toEqual([]);
    expect(result.systemPrompt).toBe('');
  });

  it('非对象输入不会抛错', () => {
    expect(sanitizeAnalysis(null).categories).toEqual([]);
    expect(sanitizeAnalysis('oops').focus).toEqual([]);
  });

  // 关注点是「维度：具体看什么」的一句话，早年按 40 字截断会把后半段吃掉
  it('关注点保留完整描述', () => {
    const long = '织物按材质/长度/颜色三轴分别标注：标签巳·标签午·标签未 / 标签子·标签丙·标签丑 / 标签寅·标签卯·标签辰';
    expect(sanitizeAnalysis({ focus: [long] }).focus).toEqual([long]);
  });
});

describe('parseAnalysis', () => {
  it('剥掉代码围栏后解析', () => {
    const result = parseAnalysis('```json\n{"summary":"舞蹈库","categories":[]}\n```');
    expect(result.summary).toBe('舞蹈库');
  });

  it('截断的 JSON 仍然抛出可读错误', () => {
    expect(() => parseAnalysis('{"summary":"舞蹈库","categories":[{"name":')).toThrow(
      '分析模型没有返回合法 JSON'
    );
  });
});

describe('pruneMergedAnalysis', () => {
  it('分类过多时按标签数裁剪，保留原始顺序', () => {
    const categories = Array.from({ length: 15 }, (_, index) => ({
      name: `分类${index}`,
      description: '',
      tags: Array.from({ length: index + 1 }, (_, tagIndex) => `标签${tagIndex}`)
    }));

    const result = pruneMergedAnalysis({ categories, focus: [] }, { categories: 5 });

    expect(result.categories).toHaveLength(5);
    // 标签最多的 5 个（分类10..14），且顺序仍是原始顺序
    expect(result.categories.map((category) => category.name)).toEqual([
      '分类10',
      '分类11',
      '分类12',
      '分类13',
      '分类14'
    ]);
  });

  it('关注点按前缀去重，保留描述更完整的一条', () => {
    const result = pruneMergedAnalysis({
      categories: [],
      focus: ['人物形象', '人物形象：标签甲与标签丁气质', '服饰穿搭', '服饰穿搭：标签乙']
    });

    expect(result.focus).toEqual(['人物形象：标签甲与标签丁气质', '服饰穿搭：标签乙']);
  });

  // 实测同一轮里会出现「A与B细节 / A与C细节」这类同名不同写法的分类
  it('同名分类合并成一条并合并标签', () => {
    const result = pruneMergedAnalysis({
      categories: [
        { name: '服饰造型', description: '短描述', tags: ['AB'] },
        { name: '人物', description: '', tags: ['标签丁'] },
        { name: '服饰造型', description: '更完整的穿搭描述', tags: ['AB', '标签丙'], coverage: 0.6 }
      ],
      focus: []
    });

    expect(result.categories.map((category) => category.name)).toEqual(['服饰造型', '人物']);
    expect(result.categories[0]).toEqual({
      name: '服饰造型',
      description: '更完整的穿搭描述',
      tags: ['AB', '标签丙'],
      coverage: 0.6
    });
  });
});
