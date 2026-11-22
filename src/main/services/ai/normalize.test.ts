import { describe, expect, it } from 'vitest';
import type { AiTagProfile } from '@shared/types';
import { extractJson, normalizeResult, parseAiResult } from './normalize';

const profile: AiTagProfile = {
  id: 1,
  name: '测试方案',
  description: '',
  scope: 'global',
  sourceId: null,
  sourceName: null,
  isDefault: true,
  focus: ['人物', '服饰', 'BGM'],
  taxonomy: {
    categories: [
      { name: '人物', examples: ['标签丁', '标签甲'] },
      { name: '服饰', examples: ['标签乙'] },
      { name: 'BGM' },
      { name: '音乐风格' },
      { name: '其他' }
    ],
    stopwords: ['视频', 'B站'],
    aliases: { jk: '标签乙' }
  },
  systemPrompt: '',
  promptTemplate: '',
  maxTags: 12,
  minConfidence: 0.5,
  language: 'zh-CN',
  useAcrcloud: true,
  useBilibiliTags: true,
  allowExtraTags: false,
  createdAt: '',
  updatedAt: ''
};

describe('AI result normalization', () => {
  it('extracts JSON from fenced model output', () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
    expect(extractJson('说明 {"ok":true} 结束')).toBe('{"ok":true}');
  });

  it('parses a valid result and rejects invalid JSON', () => {
    const parsed = parseAiResult(
      '{"summary":" 摘要 ","tags":[{"name":"长发","category":"人物","confidence":0.9}]}'
    );
    expect(parsed.summary).toBe(' 摘要 ');
    expect(parsed.tags).toHaveLength(1);
    expect(() => parseAiResult('不是 JSON')).toThrow('没有返回合法 JSON');
  });

  // 逐视频打标实测会把 JSON 切在 evidence 中间，报「不是合法 JSON」会让人误以为是模型乱回
  it('被截断的 JSON 给出可读原因', () => {
    const truncated = '{"summary":"标签壬在商场跳舞","tags":[{"name":"标签丁","category":"人物","evidence":"第2帧';
    expect(() => parseAiResult(truncated)).toThrow('被截断');
  });

  it('结构不符时报出具体字段', () => {
    expect(() => parseAiResult('{"tags":[{"name":""}]}')).toThrow('结构不符合要求');
  });

  // 实测：模型把 bgm.source 写成 "none"，整轮打标被判失败
  it('bgm.source 写成非法值时归一，不抛出', () => {
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({
          summary: '',
          tags: [],
          bgm: { title: '示例曲', artists: ['张三'], genres: [], source: 'none', confidence: 0 }
        })
      ),
      profile
    );
    expect(result.bgm).toEqual({ title: '示例曲', artists: ['张三'], genres: [], source: 'inferred', confidence: 0 });

    const acr = normalizeResult(
      parseAiResult(JSON.stringify({ bgm: { title: '示例曲', source: 'ACRCloud' } })),
      profile
    );
    expect(acr.bgm?.source).toBe('acrcloud');
  });

  it('bgm 全空时不留下空对象', () => {
    const result = normalizeResult(
      parseAiResult(JSON.stringify({ tags: [], bgm: { title: null, artists: [], genres: [], source: 'none' } })),
      profile
    );
    expect(result.bgm).toBeNull();
  });

  it('applies aliases, stopwords and dedupe', () => {
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({
          summary: '测试',
          tags: [
            { name: 'jk', category: '服饰', confidence: 0.8 },
            { name: '标签乙', category: '服饰', confidence: 0.95 },
            { name: '视频', category: '其他', confidence: 0.99 },
            { name: '不存在的分类', category: '未知分类', confidence: 0.7 }
          ]
        })
      ),
      profile
    );
    expect(result.tags.filter((tag) => tag.name === '标签乙')).toHaveLength(1);
    expect(result.tags.find((tag) => tag.name === '标签乙')?.confidence).toBe(0.95);
    expect(result.tags.some((tag) => tag.name === '视频')).toBe(false);
    // 默认只保留方案内的标签，模型自造的「不存在的分类」被丢掉
    expect(result.tags.some((tag) => tag.name === '不存在的分类')).toBe(false);
  });

  it('打开「允许方案外标签」后保留未知标签并落到兜底分类', () => {
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({ summary: '', tags: [{ name: '不存在的分类', category: '未知分类', confidence: 0.7 }] })
      ),
      { ...profile, allowExtraTags: true }
    );
    expect(result.tags.find((tag) => tag.name === '不存在的分类')?.category).toBe('其他');
  });

  it('别名指向方案外的曲名时保留原词，不把标签带出范围', () => {
    const scoped = {
      ...profile,
      taxonomy: {
        ...profile.taxonomy,
        categories: [{ name: '服饰', examples: ['标签戊'] }],
        aliases: { 标签戊: '标签己', 标签庚: '标签辛' }
      }
    };
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({
          summary: '',
          tags: [
            { name: '标签戊', category: '服饰', confidence: 0.9 },
            { name: '标签庚', category: '服饰', confidence: 0.9 }
          ]
        })
      ),
      scoped
    );
    expect(result.tags.map((tag) => tag.name)).toEqual(['标签戊']);
  });

  it('同一标签出现在多个分类时只保留一条', () => {
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({
          summary: '',
          tags: [
            { name: '标签壬', category: '人物', confidence: 0.7 },
            { name: '标签壬', category: '其他', confidence: 0.9 }
          ]
        })
      ),
      profile
    );
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0]?.confidence).toBe(0.9);
  });

  it('分类名写法不一致时按包含关系归位，而不是全落到第一个分类', () => {
    const scoped = {
      ...profile,
      taxonomy: {
        ...profile.taxonomy,
        categories: [
          { name: '人物', examples: ['标签丁'] },
          { name: '服饰造型', examples: ['标签乙'] },
          { name: '配饰与道具', examples: ['标签癸'] }
        ]
      }
    };
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({
          tags: [
            { name: '标签乙', category: '服饰', confidence: 0.9 },
            { name: '标签癸', category: '配饰', confidence: 0.9 }
          ]
        })
      ),
      scoped
    );
    expect(result.tags.find((tag) => tag.name === '标签乙')?.category).toBe('服饰造型');
    expect(result.tags.find((tag) => tag.name === '标签癸')?.category).toBe('配饰与道具');
  });

  // 实测：模型会把一批服饰/配饰标签都标成「人物」
  it('分类归属以方案为准，不信模型写的分类', () => {
    const scoped = {
      ...profile,
      taxonomy: {
        ...profile.taxonomy,
        categories: [
          { name: '人物', examples: ['标签丁'] },
          { name: '服饰造型', examples: ['标签乙'] }
        ]
      }
    };
    const result = normalizeResult(
      parseAiResult(JSON.stringify({ tags: [{ name: '标签乙', category: '人物', confidence: 0.9 }] })),
      scoped
    );
    expect(result.tags[0]?.category).toBe('服饰造型');
  });

  it('方案内一个都不匹配时退回原始标签，不返回空结果', () => {
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({ summary: '', tags: [{ name: '方案外词', category: '场景', confidence: 0.8 }] })
      ),
      profile
    );
    expect(result.tags.map((tag) => tag.name)).toEqual(['方案外词']);
  });

  it('expands ACRCloud BGM into BGM and music-style tags', () => {
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({
          summary: '舞蹈',
          tags: [],
          bgm: {
            title: '演示曲名',
            artists: ['演示歌手'],
            genres: ['电子流行'],
            source: 'acrcloud',
            confidence: 0.9
          }
        })
      ),
      profile
    );
    expect(result.bgm?.title).toBe('演示曲名');
    expect(result.tags.find((tag) => tag.name === '演示曲名')?.category).toBe('BGM');
    expect(result.tags.find((tag) => tag.name === '演示歌手')?.category).toBe('BGM');
    expect(result.tags.find((tag) => tag.name === '电子流行')?.category).toBe('音乐风格');
    expect(result.tags.every((tag) => tag.source === 'acrcloud')).toBe(true);
  });

  it('filters by confidence and limits the tag count', () => {
    const lowConfidence = normalizeResult(
      parseAiResult(
        JSON.stringify({
          tags: [{ name: '低置信度', category: '人物', confidence: 0.2 }]
        })
      ),
      profile
    );
    expect(lowConfidence.tags).toHaveLength(0);

    const many = normalizeResult(
      parseAiResult(
        JSON.stringify({
          tags: Array.from({ length: 20 }, (_, index) => ({
            name: `标签${index}`,
            category: '人物',
            confidence: 0.9
          }))
        })
      ),
      { ...profile, maxTags: 5 }
    );
    expect(many.tags).toHaveLength(5);
  });
});
