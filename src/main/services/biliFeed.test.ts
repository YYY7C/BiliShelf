import { describe, expect, it } from 'vitest';
import {
  isPaidItem,
  isUnavailableItem,
  mapArchiveItem,
  mapMediaItem,
  mapSeeds,
  mapSpaceItem,
  parseDuration
} from './biliFeed';

describe('parseDuration', () => {
  it('parses clock strings and plain seconds', () => {
    expect(parseDuration('12:34')).toBe(754);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration(95)).toBe(95);
  });

  it('rejects garbage instead of producing NaN', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('1:2:3:4')).toBeNull();
    expect(parseDuration(0)).toBeNull();
    expect(parseDuration(null)).toBeNull();
  });
});

describe('state detection', () => {
  it('recognises charging / paid videos across field names', () => {
    expect(isPaidItem({ ugc_pay: 1 })).toBe(true);
    expect(isPaidItem({ is_ugc_pay: 1 })).toBe(true);
    expect(isPaidItem({ is_pay_video: 1 })).toBe(true);
    expect(isPaidItem({ is_lesson_video: 1 })).toBe(true);
    expect(isPaidItem({ rights: { pay: 1 } })).toBe(true);
    // 空间投稿列表的实测字段
    expect(isPaidItem({ is_pay: 1 })).toBe(true);
    expect(isPaidItem({ is_charging_arc: 1 })).toBe(true);
    expect(isPaidItem({ elec_arc_type: 2 })).toBe(true);
    expect(isPaidItem({ elec_arc_badge: '充电专属' })).toBe(true);
    expect(isPaidItem({ ugc_pay: 0, is_pay_video: 0, is_pay: 0, is_charging_arc: 0, elec_arc_type: 0 })).toBe(false);
    expect(isPaidItem({ elec_arc_badge: '' })).toBe(false);
    expect(isPaidItem(null)).toBe(false);
  });

  it('recognises unavailable items', () => {
    expect(isUnavailableItem({ title: '【已失效】某个视频' })).toBe(true);
    expect(isUnavailableItem({ title: '正常视频', attr: 1 })).toBe(true);
    expect(isUnavailableItem({ title: '正常视频', attr: 2 })).toBe(false);
    expect(isUnavailableItem({ title: '正常视频', state: -2 })).toBe(true);
    expect(isUnavailableItem(null)).toBe(true);
  });
});

describe('feed mappers', () => {
  it('maps a space item with UP info from the card fallback', () => {
    const seed = mapSpaceItem(
      {
        bvid: 'BV1xx411c7mD',
        title: '测试稿件',
        pic: 'http://i0.hdslb.com/a.jpg',
        length: '10:01',
        created: 1700000000,
        is_pay_video: 1
      },
      { mid: 42, name: '某个 UP' }
    );
    expect(seed).toMatchObject({
      bvid: 'BV1xx411c7mD',
      title: '测试稿件',
      coverUrl: 'https://i0.hdslb.com/a.jpg',
      duration: 601,
      upName: '某个 UP',
      upMid: 42,
      state: 'paid'
    });
    expect(seed?.pubTime).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('drops entries without a valid BV id', () => {
    expect(mapSpaceItem({ title: 'bad', bvid: 'av123' }, { mid: 1, name: null })).toBeNull();
    expect(mapArchiveItem({ title: 'bad' }, { mid: 1, name: null })).toBeNull();
  });

  it('maps archives with numeric duration and availability', () => {
    const seed = mapArchiveItem(
      {
        bvid: 'BV1yy411c7mE',
        title: '合集里的稿件',
        pic: 'https://i1.hdslb.com/b.jpg',
        duration: 88,
        pubdate: 1700000001,
        ugc_pay: 1
      },
      { mid: 7, name: 'UP7' }
    );
    expect(seed).toMatchObject({ duration: 88, upMid: 7, upName: 'UP7', state: 'paid' });

    const dead = mapArchiveItem({ bvid: 'BV1zz411c7mF', title: '已失效稿件' }, { mid: 7, name: 'UP7' });
    expect(dead?.state).toBe('unavailable');
  });

  it('maps media list items with cid and favourite time', () => {
    const seed = mapMediaItem({
      bvid: 'BV1aa411c7mG',
      title: '收藏的视频',
      cover: 'http://i2.hdslb.com/c.jpg',
      duration: 33,
      cid: 999,
      upper: { mid: 5, name: 'UP5' },
      pubtime: 1700000002,
      fav_time: 1700000100,
      attr: 0
    });
    expect(seed).toMatchObject({
      bvid: 'BV1aa411c7mG',
      cid: 999,
      duration: 33,
      upName: 'UP5',
      upMid: 5,
      state: 'available'
    });
    expect(seed?.favTime).toBe(new Date(1700000100 * 1000).toISOString());
  });

  it('dedupes by bvid across pages', () => {
    const seeds = mapSeeds(
      [
        { bvid: 'BV1aa411c7mG', title: 'a' },
        { bvid: 'BV1aa411c7mG', title: 'a again' },
        { bvid: 'BV1bb411c7mH', title: 'b' },
        { bvid: 'nope', title: 'c' }
      ],
      (item) => mapArchiveItem(item, { mid: 1, name: null })
    );
    expect(seeds.map((seed) => seed.bvid)).toEqual(['BV1aa411c7mG', 'BV1bb411c7mH']);
  });
});
