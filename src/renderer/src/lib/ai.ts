import type { AiReviewStatus, AiStage, AiTagSource } from '@shared/types';

export const AI_PROTOCOL_LABEL: Record<string, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  custom: '自定义'
};

export const AI_COMPAT_LABEL: Record<string, string> = {
  openai: 'OpenAI 兼容端点',
  anthropic: 'Anthropic 兼容端点',
  gemini: 'Gemini 兼容端点',
  template: '纯模板（无工具）'
};

export const AI_TAG_SOURCE_LABEL: Record<AiTagSource, string> = {
  vision: 'VLM',
  acrcloud: 'ACR',
  bilibili_tag: 'B站',
  inferred: '推断'
};

export const AI_TAG_SOURCE_CLASS: Record<AiTagSource, string> = {
  vision: 'border-pink/30 bg-pink/10 text-pink',
  acrcloud: 'border-green/30 bg-green/10 text-green',
  bilibili_tag: 'border-blue/30 bg-blue/10 text-blue',
  inferred: 'border-line bg-panel2 text-dim'
};

export const AI_STAGE_LABEL: Record<AiStage, string> = {
  frames: '抽帧',
  request: '请求模型',
  tools: '识别 BGM',
  parse: '解析结果',
  done: '完成'
};

export const AI_REVIEW_STATUS_LABEL: Record<AiReviewStatus, string> = {
  pending: '待审核',
  partial: '部分通过',
  approved: '已通过',
  rejected: '已拒绝'
};

export const AI_REVIEW_STATUS_CLASS: Record<AiReviewStatus, string> = {
  pending: 'border-yellow/30 bg-yellow/10 text-yellow',
  partial: 'border-blue/30 bg-blue/10 text-blue',
  approved: 'border-green/30 bg-green/10 text-green',
  rejected: 'border-red/30 bg-red/10 text-red'
};

const CATEGORY_CLASSES = [
  'border-pink/30 bg-pink/10 text-pink',
  'border-blue/30 bg-blue/10 text-blue',
  'border-green/30 bg-green/10 text-green',
  'border-yellow/30 bg-yellow/10 text-yellow',
  'border-purple/30 bg-purple/10 text-purple',
  'border-red/30 bg-red/10 text-red',
  'border-muted/30 bg-muted/10 text-muted'
];

export function categoryClass(category: string): string {
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) >>> 0;
  }
  return CATEGORY_CLASSES[hash % CATEGORY_CLASSES.length]!;
}

export function formatConfidence(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

export function formatFrameTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '封面';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function estimateCost(
  pricing: { inputPerMillion: number; outputPerMillion: number; currency: string } | null,
  inputTokens: number,
  outputTokens: number
): string | null {
  if (!pricing) return null;
  const cost =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return `${pricing.currency || 'CNY'} ${cost.toFixed(3)}`;
}
