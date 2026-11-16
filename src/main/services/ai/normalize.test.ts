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
    categories: [{ name: '人物' }, { name: '服饰' }, { name: 'BGM' }, { name: '音乐风格' }, { name: '其他' }],
    stopwords: ['视频', 'B站'],
    aliases: { jk: 'JK制服' }
  },
  systemPrompt: '',
  promptTemplate: '',
  maxTags: 12,
  minConfidence: 0.5,
  language: 'zh-CN',
  useAcrcloud: true,
  useBilibiliTags: true,
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
    expect(() => parseAiResult('不是 JSON')).toThrow();
  });

  it('applies aliases, stopwords, category fallback and dedupe', () => {
    const result = normalizeResult(
      parseAiResult(
        JSON.stringify({
          summary: '测试',
          tags: [
            { name: 'jk', category: '服饰', confidence: 0.8 },
            { name: 'JK制服', category: '服饰', confidence: 0.95 },
            { name: '视频', category: '其他', confidence: 0.99 },
            { name: '不存在的分类', category: '未知分类', confidence: 0.7 }
          ]
        })
      ),
      profile
    );
    expect(result.tags.filter((tag) => tag.name === 'JK制服')).toHaveLength(1);
    expect(result.tags.find((tag) => tag.name === 'JK制服')?.confidence).toBe(0.95);
    expect(result.tags.some((tag) => tag.name === '视频')).toBe(false);
    expect(result.tags.find((tag) => tag.name === '不存在的分类')?.category).toBe('其他');
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
