import { describe, expect, it } from 'vitest';
import {
  describeRange,
  formatSeconds,
  isRangeEmpty,
  isWithinRange,
  normalizeRange,
  UNLIMITED_RANGE
} from './durationRange';

describe('normalizeRange', () => {
  it('treats zero, negative and NaN as unlimited', () => {
    expect(normalizeRange(0, 0)).toEqual({ min: null, max: null });
    expect(normalizeRange(-5, Number.NaN)).toEqual({ min: null, max: null });
    expect(normalizeRange(undefined, null)).toEqual({ min: null, max: null });
  });

  it('swaps an inverted range instead of matching nothing', () => {
    expect(normalizeRange(600, 60)).toEqual({ min: 60, max: 600 });
  });

  it('rounds to whole seconds', () => {
    expect(normalizeRange(59.6, 120.4)).toEqual({ min: 60, max: 120 });
  });
});

describe('isWithinRange', () => {
  it('accepts everything when unlimited', () => {
    expect(isWithinRange(5, UNLIMITED_RANGE)).toBe(true);
    expect(isWithinRange(null, UNLIMITED_RANGE)).toBe(true);
  });

  it('treats unknown durations as unlimited so a missing field cannot empty the list', () => {
    expect(isWithinRange(null, { min: 60, max: 600 })).toBe(true);
    expect(isWithinRange(0, { min: 60, max: 600 })).toBe(true);
  });

  it('is inclusive on both ends', () => {
    const range = { min: 60, max: 600 };
    expect(isWithinRange(60, range)).toBe(true);
    expect(isWithinRange(600, range)).toBe(true);
    expect(isWithinRange(59, range)).toBe(false);
    expect(isWithinRange(601, range)).toBe(false);
  });

  it('supports one-sided ranges', () => {
    expect(isWithinRange(30, { min: 60, max: null })).toBe(false);
    expect(isWithinRange(90, { min: 60, max: null })).toBe(true);
    expect(isWithinRange(900, { min: null, max: 600 })).toBe(false);
    expect(isWithinRange(599, { min: null, max: 600 })).toBe(true);
  });
});

describe('describeRange', () => {
  it('renders readable labels', () => {
    expect(describeRange(UNLIMITED_RANGE)).toBe('不限');
    expect(describeRange({ min: 60, max: 600 })).toBe('1:00–10:00');
    expect(describeRange({ min: 60, max: null })).toBe('≥1:00');
    expect(describeRange({ min: null, max: 600 })).toBe('≤10:00');
    expect(isRangeEmpty({ min: null, max: 600 })).toBe(false);
  });
});

describe('formatSeconds', () => {
  it('formats minutes and hours', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(65)).toBe('1:05');
    expect(formatSeconds(3725)).toBe('1:02:05');
  });
});
