import { describe, expect, it } from 'vitest';
import { audioExtractArgs } from './audioArgs';

describe('audioExtractArgs', () => {
  it('includes the input video before output-only options', () => {
    const args = audioExtractArgs('C:\\library\\video.mp4', 5.5, 'C:\\cache\\audio.mp3');
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('C:\\library\\video.mp4');
    expect(args[args.indexOf('-ss') + 1]).toBe('5.5');
    expect(args).toContain('-vn');
    expect(args[args.length - 1]).toBe('C:\\cache\\audio.mp3');
  });
});
