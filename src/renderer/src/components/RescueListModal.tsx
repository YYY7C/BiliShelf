import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Wrench } from 'lucide-react';
import clsx from 'clsx';
import type { RescueListItem } from '@shared/types';
import { api } from '../lib/bridge';
import { useUi } from '../lib/store';
import { Button, Chip, Modal, Spinner, Tag, TextInput } from './ui';
import { filterRescueItems, stateLabel, type RescueFilter } from './rescueListFilter';
import { formatDuration } from '../lib/format';

type Filter = RescueFilter;

/**
 * 跨来源的「失效 / 已补档」清单。
 * 只读展示 + 本地副本修复，真正的存档补档下载放在 P1（需要人工确认候选）。
 */
export function RescueListModal({
  onClose,
  onOpenSource
}: {
  onClose: () => void;
  onOpenSource: (sourceId: number) => void;
}) {
  const pushToast = useUi((state) => state.pushToast);
  const [items, setItems] = useState<RescueListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('unavailable');
  const [search, setSearch] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.sources.rescueList());
    } catch (err) {
      setError((err as Error).message);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      unavailable: list.filter((item) => item.state === 'unavailable').length,
      rescued: list.filter((item) => item.state === 'rescued').length
    };
  }, [items]);

  const filtered = useMemo(
    () => filterRescueItems(items ?? [], filter, search),
    [items, filter, search]
  );

  const repair = async () => {
    setRepairing(true);
    try {
      const repaired = await api.sources.rescueRepair();
      pushToast(
        repaired > 0 ? 'success' : 'info',
        repaired > 0 ? `已修复 ${repaired} 条（本地有副本）` : '没有可修复的条目'
      );
      await load();
    } catch (err) {
      pushToast('error', (err as Error).message);
    } finally {
      setRepairing(false);
    }
  };

  return (
    <Modal
      title="失效清单"
      subtitle="B 站已不可播放的条目；本地已有副本的会自动标成「已补档」"
      onClose={onClose}
      width="max-w-5xl"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line2 px-5 py-2.5">
        <Chip active={filter === 'unavailable'} tone="red" onClick={() => setFilter('unavailable')}>
          已失效 {counts.unavailable}
        </Chip>
        <Chip active={filter === 'rescued'} tone="blue" onClick={() => setFilter('rescued')}>
          已补档 {counts.rescued}
        </Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          全部
        </Chip>
        <TextInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="过滤 BV / 标题 / UP / 来源"
          className="ml-2 w-64"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw size={12} />
            刷新
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void repair()}
            disabled={repairing}
            title="把「B 站失效但本地已有副本」的条目修成已补档"
          >
            {repairing ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
            修复本地副本
          </Button>
        </div>
      </div>

      <div className="scroll-thin scroll-stable flex-1 overflow-y-auto">
        {items === null ? (
          <div className="flex h-40 items-center justify-center gap-2 text-[12px] text-dim">
            <Spinner />
            读取清单…
          </div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center gap-2 text-[12px] text-red">
            <AlertTriangle size={14} />
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-[12px] text-dim">
            <CheckCircle2 size={18} className="text-green" />
            {filter === 'rescued' ? '还没有补档记录' : '没有匹配的条目'}
          </div>
        ) : (
          <table className="w-full table-fixed text-left text-[11.5px]">
            <thead className="sticky top-0 z-10 bg-panel2 text-[10.5px] text-dim">
              <tr className="border-b border-line2">
                <th className="w-16 px-3 py-2 font-normal">状态</th>
                <th className="w-32 px-2 py-2 font-normal">来源</th>
                <th className="w-32 px-2 py-2 font-normal">BV</th>
                <th className="px-2 py-2 font-normal">UP / 标题</th>
                <th className="w-16 px-2 py-2 text-right font-normal">时长</th>
                <th className="w-28 px-2 py-2 font-normal">本地</th>
                <th className="w-16 px-2 py-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const meta = stateLabel(item.state);
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-b border-line2/50 hover:bg-panel2/60"
                    onClick={() => {
                      onOpenSource(item.sourceId);
                      onClose();
                    }}
                    title="点击定位到来源"
                  >
                    <td className="px-3 py-2">
                      <Tag tone={meta.tone}>{meta.label}</Tag>
                    </td>
                    <td className="truncate px-2 py-2 text-muted" title={item.sourceTitle}>
                      {item.sourceTitle}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10.5px] text-dim">{item.bvid}</td>
                    <td className="px-2 py-2">
                      <div className="truncate text-fg/90" title={item.title}>
                        {item.title}
                      </div>
                      <div className="truncate text-[10px] text-dim" title={item.upName ?? undefined}>
                        {item.upName ?? '—'}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[10.5px] text-muted">
                      {item.duration ? formatDuration(item.duration) : '—'}
                    </td>
                    <td className="truncate px-2 py-2 text-[10.5px] text-dim">
                      {item.localVideoId ? `#${item.localVideoId}` : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className={clsx(
                          'flex h-6 w-6 items-center justify-center rounded text-dim hover:bg-panel3 hover:text-fg'
                        )}
                        title="在 B 站打开"
                        onClick={(event) => {
                          event.stopPropagation();
                          void api.app
                            .openExternal(`https://www.bilibili.com/video/${encodeURIComponent(item.bvid)}`)
                            .catch((err: Error) => pushToast('error', err.message));
                        }}
                      >
                        <ExternalLink size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex-none border-t border-line2 px-5 py-2 text-[10.5px] text-dim">
        共 {filtered.length} 条 · IA 补档候选需要人工确认（P1），这页只做失效盘点与本地副本修复
      </div>
    </Modal>
  );
}
