import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromLibraryRelative, isInside, safeSegment, toLibraryRelative } from './pathUtils';

describe('pathUtils', () => {
  it('sanitizes windows path segments', () => {
    expect(safeSegment('a/b:c*?"<>|')).toBe('a b c');
    expect(safeSegment('   ')).toBe('untitled');
    expect(safeSegment('CON')).toBe('_CON');
    expect(safeSegment('x'.repeat(120)).length).toBe(80);
  });

  it('checks containment', () => {
    const root = path.resolve('C:/library');
    expect(isInside(root, path.join(root, 'media', 'a.mp4'))).toBe(true);
    expect(isInside(root, path.join(root, '..', 'evil.mp4'))).toBe(false);
    expect(isInside(root, root)).toBe(false);
  });

  it('round-trips library-relative paths', () => {
    const root = path.resolve('C:/library');
    const absolute = path.join(root, 'media', '2026', 'a.mp4');
    expect(toLibraryRelative(root, absolute)).toBe('media/2026/a.mp4');
    expect(fromLibraryRelative(root, 'media/2026/a.mp4')).toBe(absolute);
  });
});
