import { describe, expect, it } from 'vitest';
import { formatSelector, mapYtdlpError, shouldAutoRetry } from './ytdlp';

describe('yt-dlp helpers', () => {
  it('selects formats by quality preset', () => {
    expect(formatSelector('best')).toBe('bv*+ba/b');
    expect(formatSelector('audio')).toBe('ba/b');
    expect(formatSelector('compat')).toContain('avc1');
    expect(formatSelector('720')).toContain('height<=720');
  });

  it('maps common yt-dlp failures', () => {
    expect(mapYtdlpError('ERROR: 412 Too Many Requests').code).toBe('RATE_LIMIT');
    expect(mapYtdlpError('ERROR: 大会员专享').code).toBe('FORBIDDEN');
    expect(mapYtdlpError('ERROR: [Errno 28] ENOSPC').code).toBe('DISK');
    expect(mapYtdlpError('ERROR: something odd').code).toBe('DOWNLOAD');
  });

  it('explains CDN failures with an actionable hint', () => {
    const not424 = mapYtdlpError('ERROR: unable to download video data: HTTP Error 424: Failed Dependency');
    expect(not424.code).toBe('DOWNLOAD');
    expect(not424.message).toContain('424');
    expect(not424.message).toContain('直连');

    const mcdn = mapYtdlpError("Read timed out. (host='xy1.mcdn.bilivideo.cn', port=8082)");
    expect(mcdn.code).toBe('DOWNLOAD');
    expect(mcdn.message).toContain('CDN');

    const reset = mapYtdlpError('ConnectionResetError(10054, ...)');
    expect(reset.message).toContain('CDN');
  });

  it('only auto retries transient download errors', () => {
    expect(shouldAutoRetry('DOWNLOAD', 0, 2)).toBe(true);
    expect(shouldAutoRetry('DOWNLOAD', 1, 2)).toBe(true);
    expect(shouldAutoRetry('DOWNLOAD', 2, 2)).toBe(false);
    expect(shouldAutoRetry('DOWNLOAD', 0, 0)).toBe(false);
    expect(shouldAutoRetry('RATE_LIMIT', 0, 2)).toBe(false);
    expect(shouldAutoRetry('FORBIDDEN', 0, 2)).toBe(false);
    expect(shouldAutoRetry('NOT_FOUND', 0, 2)).toBe(false);
    expect(shouldAutoRetry('DISK', 0, 2)).toBe(false);
  });
});
