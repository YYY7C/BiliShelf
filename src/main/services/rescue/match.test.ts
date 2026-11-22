import { describe, expect, it } from 'vitest';
import {
  isPlaceholderTitle,
  normalizeTitle,
  scoreCandidate,
  similarity,
  tokenize,
  type MatchTarget
} from './match';

const target: MatchTarget = {
  bvid: 'BV1Rescue003',
  title: '已失效视频',
  duration: 61,
  upName: '示例UP主'
};

describe('normalizeTitle', () => {
  it('strips emoji, punctuation and spacing', () => {
    expect(normalizeTitle('🏝️示例标题！Sample Title\'【示例副标题】')).toBe('示例标题 sample title 示例副标题');
  });

  it('handles full-width and case', () => {
    expect(normalizeTitle('ＡＢＣ　１２３')).toBe('abc 123');
  });

  it('returns empty for nullish input', () => {
    expect(normalizeTitle(null)).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
  });
});

describe('isPlaceholderTitle', () => {
  it('detects Bilibili placeholder titles', () => {
    expect(isPlaceholderTitle('已失效视频')).toBe(true);
    expect(isPlaceholderTitle('已失效视频（up主已删除）')).toBe(true);
    expect(isPlaceholderTitle('稿件不可见')).toBe(true);
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle(null)).toBe(true);
  });

  it('keeps real titles', () => {
    expect(isPlaceholderTitle('示例标题甲/示例标题乙')).toBe(false);
    expect(isPlaceholderTitle('已失效')).toBe(true);
  });
});

describe('tokenize / similarity', () => {
  it('builds CJK bigrams and latin words', () => {
    const tokens = tokenize('海边 水着 Marine');
    expect(tokens.has('海边')).toBe(true);
    expect(tokens.has('marine')).toBe(true);
  });

  it('scores near-duplicate titles high', () => {
    expect(similarity('青春修炼手册 翻跳', '青春修炼手册翻跳')).toBeGreaterThan(0.8);
    expect(similarity('完全不同的标题', 'another title')).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('accepts immediately when info.json reports the same bvid', () => {
    const result = scoreCandidate(target, {
      identifier: 'whatever',
      bvid: 'BV1Rescue003',
      title: null,
      duration: null,
      uploader: null,
      size: null
    });
    expect(result.score).toBe(100);
    expect(result.tier).toBe('sure');
    expect(result.reasons[0]).toContain('info.json');
  });

  it('accepts immediately when identifier contains the bvid', () => {
    const result = scoreCandidate(target, {
      identifier: 'BiliBili-BV1Rescue003',
      title: null,
      duration: null,
      uploader: null,
      size: null
    });
    expect(result.score).toBe(100);
    expect(result.tier).toBe('sure');
  });

  it('gives partial score for matching duration and uploader only', () => {
    const result = scoreCandidate(target, {
      identifier: 'x',
      title: null,
      duration: 62,
      uploader: '示例UP主',
      size: 40 * 1024 * 1024
    });
    // 时长一致 40 + UP 名一致 15
    expect(result.score).toBe(55);
    expect(result.tier).toBe('reject');
    expect(result.reasons).toContain('时长一致');
    expect(result.reasons).toContain('UP 名一致');
  });

  it('rejects when duration differs by more than 30s', () => {
    const result = scoreCandidate(target, {
      identifier: 'x',
      title: '已失效视频',
      duration: 200,
      uploader: '示例UP主',
      size: 40 * 1024 * 1024
    });
    expect(result.tier).toBe('reject');
    expect(result.reasons[0]).toContain('时长相差');
  });

  it('rejects tiny files that look like previews', () => {
    const result = scoreCandidate(
      { ...target, duration: 600 },
      { identifier: 'x', title: null, duration: 600, uploader: null, size: 1024 * 1024 }
    );
    expect(result.tier).toBe('reject');
    expect(result.reasons[0]).toContain('试看');
  });

  it('never scores placeholder titles', () => {
    const result = scoreCandidate(
      { ...target, title: '已失效视频' },
      { identifier: 'x', title: '已失效视频', duration: 61, uploader: null, size: 50 * 1024 * 1024 }
    );
    expect(result.reasons.some((reason) => reason.includes('占位'))).toBe(true);
    expect(result.score).toBe(40);
  });

  it('uses the title when both sides have real titles', () => {
    const withTitle = scoreCandidate(
      { ...target, title: '示例标题 sample title', upName: null },
      {
        identifier: 'x',
        title: '示例标题 sample title',
        duration: 61,
        uploader: null,
        size: 50 * 1024 * 1024
      }
    );
    expect(withTitle.score).toBeGreaterThanOrEqual(70);
    expect(withTitle.tier).toBe('likely');
  });

  it('gives the creator-search bonus only when the uploader also matches', () => {
    // 同长度但 UP 名对不上：不给补偿分，只能留在 reject
    const weak = scoreCandidate(target, {
      identifier: 'x',
      title: null,
      duration: 61,
      uploader: 'someone-else',
      size: 50 * 1024 * 1024,
      fromCreator: true
    });
    expect(weak.score).toBe(40);
    expect(weak.tier).toBe('reject');

    // 同长度 + UP 名一致 + 来自 UP 检索：40 + 15 + 20 = 75
    const strong = scoreCandidate(target, {
      identifier: 'x',
      title: null,
      duration: 61,
      uploader: '示例UP主',
      size: 50 * 1024 * 1024,
      fromCreator: true
    });
    expect(strong.score).toBe(75);
    expect(strong.tier).toBe('likely');
  });
});
