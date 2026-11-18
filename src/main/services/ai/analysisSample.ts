import { MAX_ANALYSIS_SAMPLES, MIN_SAMPLES_PER_GROUP } from '@shared/aiDefaults';

export interface StratifiedPlan {
  ids: number[];
  /** 每组的保底条数（分组太多时会小于 MIN_SAMPLES_PER_GROUP） */
  perGroup: number;
  /** 实际抽取总数 */
  target: number;
  /** 为了满足保底，样本数被自动提升过 */
  expanded: boolean;
}

/**
 * 分层抽取：先给每个分组保底 perGroup 条，剩余名额按各组规模比例分配。
 * 这样既不会漏掉小收藏夹，也不会让大收藏夹几乎不出现。
 */
export function pickStratified(buckets: number[][], size: number, perGroup: number): number[] {
  const picked: number[] = [];
  const taken = buckets.map(() => 0);

  for (let round = 0; round < perGroup && picked.length < size; round += 1) {
    for (let index = 0; index < buckets.length && picked.length < size; index += 1) {
      const bucket = buckets[index]!;
      const used = taken[index]!;
      if (used < bucket.length) {
        picked.push(bucket[used]!);
        taken[index] = used + 1;
      }
    }
  }

  // 剩余名额：每轮选「已抽比例」最低的分组，等价于按规模比例分配
  while (picked.length < size) {
    let best = -1;
    let bestRatio = Number.POSITIVE_INFINITY;
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index]!;
      const used = taken[index]!;
      if (used >= bucket.length) continue;
      const ratio = used / bucket.length;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = index;
      }
    }
    if (best < 0) break;
    const used = taken[best]!;
    picked.push(buckets[best]![used]!);
    taken[best] = used + 1;
  }

  return picked;
}

/**
 * 给定已分好组的 id 列表，算出最终要抽哪些。
 * 只有「分组数 × 3」放得进 MAX_ANALYSIS_SAMPLES 时才会为保底自动提升样本数；
 * 否则保持用户设定，尽量让每个分组都出现一次（并提示无法保底）。
 */
export function planStratified(buckets: number[][], requested: number): StratifiedPlan {
  const groups = buckets.length;
  if (groups === 0) {
    return { ids: [], perGroup: 0, target: 0, expanded: false };
  }
  const feasible = groups * MIN_SAMPLES_PER_GROUP <= MAX_ANALYSIS_SAMPLES;
  const perGroup = feasible ? MIN_SAMPLES_PER_GROUP : 1;
  const target = feasible
    ? Math.min(MAX_ANALYSIS_SAMPLES, Math.max(requested, groups * MIN_SAMPLES_PER_GROUP))
    : Math.min(MAX_ANALYSIS_SAMPLES, Math.max(requested, Math.min(groups, MAX_ANALYSIS_SAMPLES)));
  return {
    ids: pickStratified(buckets, target, perGroup),
    perGroup,
    target,
    expanded: target > requested
  };
}
