import { describe, expect, it } from 'vitest';
import type { RescueListItem } from '@shared/types';
import { filterRescueItems, stateLabel } from './rescueListFilter';

const items: RescueListItem[] = [
  {
    id: 1,
    sourceId: 1,
    sourceTitle: '示例收藏夹A',
    bvid: 'BV1Rescue001',
    page: 1,
    title: '已失效视频',
    upName: '示例UP主',
    duration: 92,
    state: 'unavailable',
    lastSeenAt: null,
    localVideoId: null
  },
  {
    id: 2,
    sourceId: 2,
    sourceTitle: '示例收藏夹B',
    bvid: 'BV1Rescue002',
    page: 1,
    title: '示例补档标题',
    upName: '另一个UP主',
    duration: 97,
    state: 'rescued',
    lastSeenAt: null,
    localVideoId: 2
  }
];

describe('stateLabel', () => {
  it('labels rescued and unavailable states', () => {
    expect(stateLabel('rescued')).toEqual({ label: '已补档', tone: 'purple' });
    expect(stateLabel('unavailable')).toEqual({ label: '已失效', tone: 'red' });
  });
});

describe('filterRescueItems', () => {
  it('filters by state', () => {
    expect(filterRescueItems(items, 'unavailable', '').map((item) => item.id)).toEqual([1]);
    expect(filterRescueItems(items, 'rescued', '').map((item) => item.id)).toEqual([2]);
    expect(filterRescueItems(items, 'all', '')).toHaveLength(2);
  });

  it('matches BV, title, UP and source name case-insensitively', () => {
    expect(filterRescueItems(items, 'all', 'bv1rescue001').map((item) => item.id)).toEqual([1]);
    expect(filterRescueItems(items, 'all', '示例up主').map((item) => item.id)).toEqual([1]);
    expect(filterRescueItems(items, 'all', '收藏夹a').map((item) => item.id)).toEqual([1]);
    expect(filterRescueItems(items, 'all', '补档').map((item) => item.id)).toEqual([2]);
  });

  it('returns nothing for an unmatched keyword', () => {
    expect(filterRescueItems(items, 'all', '不存在的关键词')).toEqual([]);
  });
});
