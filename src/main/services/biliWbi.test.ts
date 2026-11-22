import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { extractWbiKeys, getWbiKey, mixinKey, resetWbiKeyCache, signWbiQuery } from './biliWbi';

describe('mixinKey', () => {
  it('matches the documented sample keys', () => {
    expect(mixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45')).toBe(
      'ea1db124af3c7062474693fa704f4ff8'
    );
  });
});

describe('extractWbiKeys', () => {
  it('reads the file name of the nav wbi images', () => {
    const nav = {
      code: -101,
      data: {
        wbi_img: {
          img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
        }
      }
    };
    expect(extractWbiKeys(nav)).toEqual({
      imgKey: '7cd084941338484aae1ad9425b84077c',
      subKey: '4932caff0ff746eab6f01bf08b70ac45'
    });
  });

  it('returns null when the response is incomplete', () => {
    expect(extractWbiKeys(null)).toBeNull();
    expect(extractWbiKeys({ data: {} })).toBeNull();
  });
});

describe('signWbiQuery', () => {
  it('sorts params and appends wts + w_rid', () => {
    const query = signWbiQuery({ mid: 42, pn: 1, ps: 30, order: 'pubdate' }, 'testkey', 1700000000);
    const [base, wRid] = query.split('&w_rid=');
    expect(base).toBe('mid=42&order=pubdate&pn=1&ps=30&wts=1700000000');
    expect(wRid).toBe(createHash('md5').update(`${base}testkey`).digest('hex'));
  });

  it('strips !\'()* from values like the web client does', () => {
    const query = signWbiQuery({ keyword: "a!b'c(d)e*f" }, 'key', 1);
    expect(query).toContain('keyword=abcdef');
  });

  it('is stable for the same inputs', () => {
    const a = signWbiQuery({ mid: 1, pn: 2 }, 'k', 100);
    const b = signWbiQuery({ pn: 2, mid: 1 }, 'k', 100);
    expect(a).toBe(b);
  });
});

describe('getWbiKey', () => {
  it('caches the derived key', async () => {
    resetWbiKeyCache();
    let calls = 0;
    const fetchNav = async () => {
      calls += 1;
      return {
        data: {
          wbi_img: {
            img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
            sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
          }
        }
      };
    };
    expect(await getWbiKey(fetchNav)).toBe('ea1db124af3c7062474693fa704f4ff8');
    expect(await getWbiKey(fetchNav)).toBe('ea1db124af3c7062474693fa704f4ff8');
    expect(calls).toBe(1);
    resetWbiKeyCache();
  });

  it('throws a readable error when nav is missing keys', async () => {
    resetWbiKeyCache();
    await expect(getWbiKey(async () => ({ data: {} }))).rejects.toThrow('WBI');
  });
});
