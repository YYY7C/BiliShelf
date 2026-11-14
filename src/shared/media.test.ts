import { describe, expect, it } from 'vitest';
import { remoteItemKey, videoKeyFor } from './media';

describe('dedup keys', () => {
  it('keeps different pages apart without depending on cid', () => {
    expect(videoKeyFor('BV1xx', 1)).toBe('bv:BV1xx:1');
    expect(videoKeyFor('BV1xx', 2)).not.toBe(videoKeyFor('BV1xx', 1));
  });

  it('builds remote item keys', () => {
    expect(remoteItemKey('BV1xx', null, 1)).toBe('BV1xx:0:1');
  });
});
