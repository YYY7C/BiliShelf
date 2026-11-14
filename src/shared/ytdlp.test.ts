import { describe, expect, it } from 'vitest';
import { formatSelector, mapYtdlpError } from './ytdlp';

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
});
