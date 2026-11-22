import type { RescueListItem } from '@shared/types';

export type RescueFilter = 'unavailable' | 'rescued' | 'all';

export function stateLabel(state: RescueListItem['state']): { label: string; tone: 'red' | 'purple' | 'default' } {
  if (state === 'rescued') return { label: '已补档', tone: 'purple' };
  if (state === 'unavailable') return { label: '已失效', tone: 'red' };
  return { label: state, tone: 'default' };
}

/** 过滤：状态 + 关键词（BV / 标题 / UP / 来源），大小写不敏感。 */
export function filterRescueItems(
  items: RescueListItem[],
  filter: RescueFilter,
  search: string
): RescueListItem[] {
  const keyword = search.trim().toLowerCase();
  return items.filter((item) => {
    if (filter !== 'all' && item.state !== filter) return false;
    if (!keyword) return true;
    return (
      item.bvid.toLowerCase().includes(keyword) ||
      item.title.toLowerCase().includes(keyword) ||
      (item.upName ?? '').toLowerCase().includes(keyword) ||
      item.sourceTitle.toLowerCase().includes(keyword)
    );
  });
}
