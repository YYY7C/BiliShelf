import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_BATCH, MAX_TEXT_BATCH, textBatchSize } from './analysisBudget';

describe('textBatchSize', () => {
  it('没有上下文信息时用保守的 60 条', () => {
    expect(textBatchSize(undefined)).toBe(DEFAULT_TEXT_BATCH);
    expect(textBatchSize(null)).toBe(DEFAULT_TEXT_BATCH);
    expect(textBatchSize(0)).toBe(DEFAULT_TEXT_BATCH);
  });

  it('上下文越大批越大，但不超过 200 条', () => {
    expect(textBatchSize(1_000_000)).toBe(MAX_TEXT_BATCH);
    expect(textBatchSize(128_000)).toBe(MAX_TEXT_BATCH);
  });

  it('小上下文模型自动缩小批，避免请求超限', () => {
    // 32k × 40% = 12.8k → 约 98 条
    expect(textBatchSize(32_000)).toBe(98);
    // 16k × 40% = 6.4k → 约 49 条
    expect(textBatchSize(16_000)).toBe(49);
    // 极小上下文也至少保留 24 条
    expect(textBatchSize(4_000)).toBe(24);
  });
});
