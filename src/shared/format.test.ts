import { describe, expect, it } from 'vitest';
import {
  codecLabel,
  formatBytes,
  formatCount,
  formatDuration,
  qualityLabelText,
  resolutionLabel
} from './format';

describe('format helpers', () => {
  it('formats sizes and durations', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3665)).toBe('1:01:05');
  });

  it('formats large counts in 万', () => {
    expect(formatCount(9999)).toBe('9999');
    expect(formatCount(12345)).toBe('1.2 万');
  });

  it('uses the short side for vertical videos', () => {
    expect(qualityLabelText(3840, 2160)).toBe('4K');
    expect(qualityLabelText(1920, 1080)).toBe('1080P');
    expect(qualityLabelText(1080, 1920)).toBe('1080P');
    expect(resolutionLabel(1080, 1920)).toBe('1080P · 竖屏');
    expect(resolutionLabel(1920, 1080)).toBe('1080P');
    expect(resolutionLabel(1080, 1918)).toBe('1080P · 竖屏');
    expect(resolutionLabel(1918, 1080)).toBe('1080P');
  });

  it('labels codecs', () => {
    expect(codecLabel('avc1.640028')).toBe('H.264');
    expect(codecLabel('hev1.1.6.L120')).toBe('H.265');
    expect(codecLabel('av01.0.08M')).toBe('AV1');
    expect(codecLabel('vp09.00.10.08')).toBe('VP9');
  });
});
