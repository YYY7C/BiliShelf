import { describe, expect, it } from 'vitest';
import { describeTarget, parseBiliInput, parseStoredTarget, targetKey, targetUrl } from './biliUrls';

function target(input: string) {
  const parsed = parseBiliInput(input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.target;
}

describe('parseBiliInput', () => {
  it('accepts a bare UID', () => {
    expect(target('123456789')).toEqual({ kind: 'space', mid: 123456789 });
    expect(target(' uid: 42 ')).toEqual({ kind: 'space', mid: 42 });
  });

  it('parses space links with and without scheme', () => {
    expect(target('https://space.bilibili.com/123456789')).toEqual({ kind: 'space', mid: 123456789 });
    expect(target('space.bilibili.com/123456789/video?spm_id_from=333.1')).toEqual({
      kind: 'space',
      mid: 123456789
    });
    expect(target('https://m.bilibili.com/space/123456789')).toEqual({ kind: 'space', mid: 123456789 });
  });

  it('parses collections and series', () => {
    expect(target('https://space.bilibili.com/123456789/channel/collectiondetail?sid=10001')).toEqual({
      kind: 'season',
      mid: 123456789,
      sid: 10001
    });
    expect(target('https://space.bilibili.com/123456789/channel/seriesdetail?sid=10002')).toEqual({
      kind: 'series',
      mid: 123456789,
      sid: 10002
    });
    expect(target('https://space.bilibili.com/123456789/lists/10001?type=season')).toEqual({
      kind: 'season',
      mid: 123456789,
      sid: 10001
    });
    expect(target('https://space.bilibili.com/123456789/lists/10002?type=series')).toEqual({
      kind: 'series',
      mid: 123456789,
      sid: 10002
    });
  });

  it('parses video lists and favorite links', () => {
    expect(target('https://www.bilibili.com/medialist/detail/ml20001?type=0')).toEqual({
      kind: 'medialist',
      mediaId: 20001
    });
    expect(target('https://www.bilibili.com/list/ml20001')).toEqual({
      kind: 'medialist',
      mediaId: 20001
    });
    expect(target('https://space.bilibili.com/123456789/favlist?fid=20001&ftype=create')).toEqual({
      kind: 'favorite',
      mediaId: 20001,
      ownerMid: 123456789
    });
  });

  it('returns short links for b23.tv', () => {
    expect(target('https://b23.tv/abcdefg')).toEqual({ kind: 'short', url: 'https://b23.tv/abcdefg' });
    expect(target('bili2233.cn/abcdefg')).toEqual({ kind: 'short', url: 'https://bili2233.cn/abcdefg' });
  });

  it('treats bilibili.com/space/<mid> and mobile video links correctly', () => {
    expect(target('https://www.bilibili.com/space/123456789')).toEqual({ kind: 'space', mid: 123456789 });
    expect(target('https://bilibili.com/space/123456789/video')).toEqual({ kind: 'space', mid: 123456789 });
    const mobileVideo = parseBiliInput('https://m.bilibili.com/video/BV1xx411c7mD');
    expect(mobileVideo.ok).toBe(false);
    if (!mobileVideo.ok) expect(mobileVideo.error).toContain('单个视频');
  });

  it('explains rejections instead of silently guessing', () => {
    const video = parseBiliInput('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(video.ok).toBe(false);
    if (!video.ok) expect(video.error).toContain('单个视频');

    const unknownHost = parseBiliInput('https://example.com/123');
    expect(unknownHost.ok).toBe(false);

    const ipLike = parseBiliInput('123456789/lists/10001?type=season');
    expect(ipLike.ok).toBe(false);
    if (!ipLike.ok) expect(ipLike.error).toContain('完整的 B 站链接');

    const missingSid = parseBiliInput('https://space.bilibili.com/1/channel/collectiondetail');
    expect(missingSid.ok).toBe(false);
    if (!missingSid.ok) expect(missingSid.error).toContain('sid');

    const empty = parseBiliInput('   ');
    expect(empty.ok).toBe(false);
  });
});

describe('canonical keys', () => {
  it('round-trips every target through remote_id', () => {
    const cases = [
      'https://space.bilibili.com/12',
      'https://space.bilibili.com/12/channel/collectiondetail?sid=34',
      'https://space.bilibili.com/12/channel/seriesdetail?sid=56',
      'https://www.bilibili.com/medialist/detail/ml78'
    ];
    for (const input of cases) {
      const parsed = target(input);
      const kind = parsed.kind === 'space' ? 'space' : 'collection';
      expect(parseStoredTarget(kind, targetKey(parsed))).toEqual(parsed);
    }
  });

  it('keeps reading legacy URL remote_ids', () => {
    expect(parseStoredTarget('space', 'https://space.bilibili.com/12/video')).toEqual({
      kind: 'space',
      mid: 12
    });
    expect(parseStoredTarget('collection', 'https://space.bilibili.com/12/channel/collectiondetail?sid=34')).toEqual({
      kind: 'season',
      mid: 12,
      sid: 34
    });
    expect(parseStoredTarget('favorite', '20001')).toEqual({
      kind: 'favorite',
      mediaId: 20001,
      ownerMid: null
    });
    expect(parseStoredTarget('watch_later', 'me')).toBeNull();
  });

  it('builds human-facing URLs', () => {
    expect(targetUrl({ kind: 'season', mid: 1, sid: 2 })).toBe(
      'https://space.bilibili.com/1/channel/collectiondetail?sid=2'
    );
    expect(targetUrl({ kind: 'medialist', mediaId: 3 })).toBe('https://www.bilibili.com/medialist/detail/ml3');
    expect(describeTarget({ kind: 'series', mid: 1, sid: 2 }, 'collection')).toContain('系列');
  });
});
