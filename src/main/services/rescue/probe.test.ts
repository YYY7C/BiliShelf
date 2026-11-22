import { describe, expect, it } from 'vitest';
import { mapViewResponse, refineWithPageList, type AvailabilityProbe } from './probe';

function probeOf(code: number, data: Record<string, unknown> | null = null): AvailabilityProbe {
  return mapViewResponse('BV1xx411c7mD', { code, message: 'm', data: data as never });
}

describe('mapViewResponse', () => {
  it('treats a playable video as alive', () => {
    const probe = probeOf(0, { title: 'T', duration: 61, pages: [{ cid: 1 }] });
    expect(probe.verdict).toBe('alive');
    expect(probe.paid).toBe(false);
    expect(probe.duration).toBe(61);
    expect(probe.pageCount).toBe(1);
  });

  it('detects supporter-only and paid videos', () => {
    expect(probeOf(0, { is_upower_exclusive: true }).verdict).toBe('paid');
    expect(probeOf(0, { rights: { pay: 1 } }).verdict).toBe('paid');
    expect(probeOf(0, { ugc_pay: 1 }).verdict).toBe('paid');
    expect(probeOf(0, { is_charge_video: true }).verdict).toBe('paid');
  });

  it('maps "invisible" codes to a provisional private verdict', () => {
    expect(probeOf(62002).verdict).toBe('private');
    expect(probeOf(-403).verdict).toBe('private');
    expect(probeOf(62012).verdict).toBe('private');
    expect(probeOf(62004).verdict).toBe('reviewing');
    expect(probeOf(-404).verdict).toBe('dead');
  });

  it('keeps unknown codes unknown', () => {
    expect(probeOf(-500).verdict).toBe('unknown');
    expect(probeOf(0).verdict).toBe('unknown');
  });
});

describe('refineWithPageList', () => {
  it('marks a 62002 video as dead when pagelist says -404', () => {
    const refined = refineWithPageList(probeOf(62002), -404);
    expect(refined.verdict).toBe('dead');
    expect(refined.pageListCode).toBe(-404);
  });

  it('keeps a 62002 video private when the cid list still exists', () => {
    expect(refineWithPageList(probeOf(62002), 0).verdict).toBe('private');
  });

  it('keeps 62004 as reviewing when the record still exists', () => {
    expect(refineWithPageList(probeOf(62004), 0).verdict).toBe('reviewing');
  });

  it('does not downgrade alive/paid videos', () => {
    const alive = probeOf(0, { title: 'T', pages: [{ cid: 1 }] });
    expect(refineWithPageList(alive, -404).verdict).toBe('alive');
    const paid = probeOf(0, { is_upower_exclusive: true });
    expect(refineWithPageList(paid, -404).verdict).toBe('paid');
  });

  it('keeps the provisional verdict when pagelist is unavailable', () => {
    expect(refineWithPageList(probeOf(62002), null).verdict).toBe('private');
  });
});
