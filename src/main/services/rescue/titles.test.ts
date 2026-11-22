import { describe, expect, it } from 'vitest';
import { parseHistoryPage } from './titles';

describe('parseHistoryPage', () => {
  it('reads entries and cursor', () => {
    const parsed = parseHistoryPage({
      code: 0,
      data: {
        list: [
          {
            title: '夏虫',
            cover: 'https://i1.hdslb.com/a.jpg',
            author_name: '示例歌手',
            author_mid: 123,
            history: { bvid: 'bv1hf4y1l7mf', page: 1 }
          },
          { title: '没有 bvid 的条目', history: {} },
          { title: '  ', history: { bvid: 'BV1xx411c7mD' } }
        ],
        cursor: { max: 999, view_at: 1700000000 }
      }
    });
    expect(parsed.code).toBe(0);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ bvid: 'BV1HF4Y1L7MF', title: '夏虫', upName: '示例歌手' });
    expect(parsed.cursor).toEqual({ max: 999, view_at: 1700000000 });
  });

  it('reports auth errors without throwing', () => {
    const parsed = parseHistoryPage({ code: -101, message: '账号未登录' });
    expect(parsed.code).toBe(-101);
    expect(parsed.message).toBe('账号未登录');
    expect(parsed.entries).toEqual([]);
    expect(parsed.cursor).toBeNull();
  });

  it('tolerates missing data', () => {
    expect(parseHistoryPage({}).entries).toEqual([]);
    expect(parseHistoryPage({ data: { list: null } }).entries).toEqual([]);
  });
});
