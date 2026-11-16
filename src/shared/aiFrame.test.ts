import { describe, expect, it } from 'vitest';
import { planFrameTimes } from './aiFrame';

describe('planFrameTimes', () => {
  it('returns no frames for invalid duration or zero count', () => {
    expect(planFrameTimes(null, 3)).toEqual([]);
    expect(planFrameTimes(0, 3)).toEqual([]);
    expect(planFrameTimes(120, 0)).toEqual([]);
  });

  it('uses the midpoint for short videos', () => {
    expect(planFrameTimes(4, 3)).toEqual([2]);
    expect(planFrameTimes(6, 2)).toEqual([3]);
  });

  it('evenly spaces frames and avoids the very beginning/end', () => {
    expect(planFrameTimes(100, 3)).toEqual([15, 50, 85]);
    expect(planFrameTimes(100, 1)).toEqual([50]);
  });

  it('caps the frame count at 8', () => {
    expect(planFrameTimes(600, 20)).toHaveLength(8);
  });

  it('does not produce duplicate timestamps', () => {
    const times = planFrameTimes(7, 8);
    expect(new Set(times).size).toBe(times.length);
  });
});
