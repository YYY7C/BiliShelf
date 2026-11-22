import { beforeEach, describe, expect, it } from 'vitest';
import type { AiTagProfile } from '@shared/types';
import { buildBgmHint, renderPrompt, setMusicKeywords } from './prompt';

// 真实关键词存在素材库的 ai-quality.json（不进仓库），测试用合成词
beforeEach(() => setMusicKeywords(['演示关键词', '演示曲']));

const profile: AiTagProfile = {
  id: 7,
  name: '示例方案',
  description: '',
  scope: 'global',
  sourceId: null,
  sourceName: null,
  isDefault: true,
  focus: ['人物形象', '服饰', 'BGM'],
  taxonomy: {
    categories: [
      { name: '人物', description: '人物形象', examples: ['长发'] },
      { name: '服饰', description: '服装', examples: ['标签甲'] },
      { name: 'BGM', description: '音乐', examples: [] }
    ],
    stopwords: ['视频'],
    aliases: {}
  },
  systemPrompt: '系统：{{title}}',
  promptTemplate:
    '标题={{title}} 关注={{focus}} 最多={{maxTags}} 置信度={{minConfidence}} 分类={{taxonomy}} 结构={{schema}}',
  maxTags: 8,
  minConfidence: 0.6,
  language: 'zh-CN',
  useAcrcloud: true,
  useBilibiliTags: true,
  allowExtraTags: false,
  createdAt: '',
  updatedAt: ''
};

describe('AI prompt rendering', () => {
  it('detects music clues from title and tags', () => {
    const hint = buildBgmHint({
      title: '《演示曲名》演示关键词',
      upName: null,
      description: '一段演示',
      duration: 90,
      sourceName: null,
      tags: ['演示关键词']
    });
    expect(hint).toContain('建议调用 identify_music');
    expect(hint).toContain('演示曲名');
  });

  it('renders variables, taxonomy and output constraints', () => {
    const rendered = renderPrompt(
      profile,
      {
        title: '测试视频',
        upName: 'UP',
        description: '简介',
        duration: 125,
        sourceName: '收藏夹',
        tags: ['示例标签']
      },
      [
        { index: -1, time: 0, path: 'a.jpg' },
        { index: 0, time: 12.5, path: 'b.jpg' }
      ]
    );
    expect(rendered.system).toContain('系统：测试视频');
    expect(rendered.user).toContain('标题=测试视频');
    expect(rendered.user).toContain('最多=8');
    expect(rendered.user).toContain('置信度=0.6');
    expect(rendered.user).toContain('人物：人物形象');
    expect(rendered.user).toContain('"summary"');
    expect(rendered.hash).toHaveLength(40);
  });

  it('produces a different hash when frames change', () => {
    const video = {
      title: '测试视频',
      upName: null,
      description: null,
      duration: 100,
      sourceName: null,
      tags: []
    };
    const first = renderPrompt(profile, video, [{ index: 0, time: 10, path: 'a.jpg' }]);
    const second = renderPrompt(profile, video, [{ index: 0, time: 20, path: 'a.jpg' }]);
    expect(first.hash).not.toBe(second.hash);
  });
});
