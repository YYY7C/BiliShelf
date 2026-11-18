/** 单条样本元数据大约占多少 tokens（标题/UP/来源/时长/标签/简介前 100 字） */
export const TOKENS_PER_SAMPLE = 130;
/** 没探测到模型上下文时的保守批大小 */
export const DEFAULT_TEXT_BATCH = 60;
export const MAX_TEXT_BATCH = 200;
export const MIN_TEXT_BATCH = 24;

export { MAX_VISION_TARGETS, VISION_RANDOM_EXTRA } from '@shared/aiDefaults';

/**
 * 文本聚类的批大小随模型上下文自适应：输入最多占上下文的 40%，其余留给提示词与输出。
 * 上下文未知时沿用保守的 60 条。
 */
export function textBatchSize(contextWindow?: number | null): number {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return DEFAULT_TEXT_BATCH;
  }
  const inputBudget = Math.min(60_000, contextWindow * 0.4);
  const size = Math.floor(inputBudget / TOKENS_PER_SAMPLE);
  return Math.min(MAX_TEXT_BATCH, Math.max(MIN_TEXT_BATCH, size));
}
