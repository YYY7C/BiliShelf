import { describe, expect, it } from 'vitest';
import { MIN_SAMPLES_PER_GROUP } from '@shared/aiDefaults';
import { pickStratified, planStratified } from './analysisSample';

describe('pickStratified', () => {
  it('每组先保底 MIN_SAMPLES_PER_GROUP 条', () => {
    const buckets = [
      [1, 2, 3, 4, 5],
      [10, 11],
      [20, 21, 22, 23, 24, 25, 26, 27]
    ];

    const picked = pickStratified(buckets, 9, MIN_SAMPLES_PER_GROUP);

    expect(picked).toHaveLength(9);
    // 小分组只有 2 条时全取，其余分组至少 3 条
    expect(picked.filter((id) => id < 10)).toHaveLength(3);
    expect(picked.filter((id) => id >= 10 && id < 20)).toHaveLength(2);
    expect(picked.filter((id) => id >= 20)).toHaveLength(4);
  });

  it('保底之后按分组规模比例补足，大分组拿得更多', () => {
    const buckets = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [20, 21, 22, 23]
    ];

    const picked = pickStratified(buckets, 8, MIN_SAMPLES_PER_GROUP);
    const small = picked.filter((id) => id >= 20).length;

    expect(picked).toHaveLength(8);
    expect(small).toBeGreaterThanOrEqual(3);
    expect(small).toBeLessThan(8 - small);
  });

  it('总量不足时返回全部可用项', () => {
    expect(pickStratified([[1], [2, 3]], 10, 3).sort()).toEqual([1, 2, 3]);
  });
});

describe('planStratified', () => {
  it('分组多到保底放不下时自动提升样本数', () => {
    const buckets = Array.from({ length: 10 }, (_, index) => [index * 10 + 1, index * 10 + 2]);

    const plan = planStratified(buckets, 12);

    expect(plan.expanded).toBe(true);
    expect(plan.perGroup).toBe(3);
    // 10 组 × 3 条 = 30，超过用户设定的 12
    expect(plan.target).toBe(30);
    expect(plan.ids).toHaveLength(20); // 每组只有 2 条可抽
  });

  it('分组太多、保底放不下时退化为每组一条，并尽量覆盖所有分组', () => {
    const buckets = Array.from({ length: 616 }, (_, index) => [index + 1]);

    const plan = planStratified(buckets, 24);

    expect(plan.perGroup).toBe(1);
    expect(plan.expanded).toBe(true);
    expect(plan.target).toBe(616);
    expect(plan.ids).toHaveLength(616);
    expect(new Set(plan.ids).size).toBe(616);
  });

  it('设定值已足够时不提升', () => {
    const plan = planStratified(
      [
        [1, 2, 3],
        [4, 5, 6]
      ],
      40
    );

    expect(plan.expanded).toBe(false);
    expect(plan.perGroup).toBe(3);
    expect(plan.target).toBe(40);
    expect(plan.ids).toHaveLength(6);
  });
});
