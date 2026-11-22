import { describe, expect, it } from 'vitest';
import {
  ffmpegTime,
  readPngSize,
  screenshotArgs,
  screenshotBaseName,
  screenshotStamp
} from './screenshot';

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('screenshotStamp', () => {
  it('formats in-video time as HH-MM-SS', () => {
    expect(screenshotStamp(0)).toBe('00-00-00');
    expect(screenshotStamp(15.9)).toBe('00-00-15');
    expect(screenshotStamp(903)).toBe('00-15-03');
    expect(screenshotStamp(3725)).toBe('01-02-05');
  });

  it('falls back to zero for invalid input', () => {
    expect(screenshotStamp(Number.NaN)).toBe('00-00-00');
    expect(screenshotStamp(-5)).toBe('00-00-00');
  });
});

describe('ffmpegTime', () => {
  it('keeps millisecond precision and clamps negatives', () => {
    expect(ffmpegTime(15.2345)).toBe('15.235');
    expect(ffmpegTime(-2)).toBe('0.000');
    expect(ffmpegTime(Number.POSITIVE_INFINITY)).toBe('0.000');
  });
});

describe('screenshotBaseName', () => {
  it('keeps CJK titles and appends the timestamp', () => {
    expect(screenshotBaseName('示例标题❤luv【示例】', 903)).toBe('示例标题❤luv【示例】_00-15-03');
  });

  it('replaces characters Windows rejects', () => {
    const name = screenshotBaseName('a/b\\c:d*e?f"g<h>i|j', 1);
    expect(name).toBe('a b c d e f g h i j_00-00-01');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('falls back to video for empty titles and trims trailing dots', () => {
    expect(screenshotBaseName('   ', 0)).toBe('video_00-00-00');
    expect(screenshotBaseName('标题...', 0)).toBe('标题_00-00-00');
  });

  it('caps the title length so the path stays usable', () => {
    const name = screenshotBaseName('长'.repeat(200), 0);
    expect(name.length).toBeLessThanOrEqual(80 + '_00-00-00'.length);
  });
});

describe('screenshotArgs', () => {
  it('extracts exactly one frame at source resolution without scaling or filters', () => {
    const args = screenshotArgs('H:\\lib\\media\\a.mp4', 'H:\\lib\\screenshots\\out.png', 15.5);
    expect(args).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '15.500',
      '-i',
      'H:\\lib\\media\\a.mp4',
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-frames:v',
      '1',
      '-c:v',
      'png',
      '-y',
      'H:\\lib\\screenshots\\out.png'
    ]);
    expect(args).not.toContain('-vf');
    expect(args.join(' ')).not.toMatch(/scale=/);
  });
});

describe('readPngSize', () => {
  it('reads width and height from the IHDR chunk', () => {
    expect(readPngSize(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(readPngSize(pngHeader(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  });

  it('rejects non-PNG or truncated buffers', () => {
    expect(readPngSize(Buffer.from('not a png at all, definitely'))).toBeNull();
    expect(readPngSize(Buffer.alloc(4))).toBeNull();
    const zero = pngHeader(0, 0);
    expect(readPngSize(zero)).toBeNull();
  });
});
