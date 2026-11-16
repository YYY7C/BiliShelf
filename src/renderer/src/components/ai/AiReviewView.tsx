import clsx from 'clsx';
import { Check, ListChecks, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AiReviewCounts, AiReviewItem, AiTagProfile, SourceSummary } from '@shared/types';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { Button, Select, Spinner, TextInput } from '../ui';
import { AiReviewRow } from './AiReviewRow';

type ReviewFilter = 'pending' | 'approved' | 'rejected' | 'all';

const STATUS_OPTIONS: Array<{ value: ReviewFilter; label: string }> = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' }
];

export function AiReviewView() {
  const pushToast = useUi((state) => state.pushToast);
  const openPlayer = useUi((state) => state.openPlayer);
  const aiReviewVideoId = useUi((state) => state.aiReviewVideoId);
  const openAiReview = useUi((state) => state.openAiReview);
  const setAiTab = useUi((state) => state.setAiTab);

  const [status, setStatus] = useState<ReviewFilter>('pending');
  const [search, setSearch] = useState('');
  const [profileId, setProfileId] = useState<number | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [minConfidence, setMinConfidence] = useState(0);
  const [items, setItems] = useState<AiReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<AiReviewCounts>({ pending: 0, approved: 0, rejected: 0 });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<AiTagProfile[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (offset = 0, append = false) => {
      setLoading(true);
      try {
        const [page, nextCounts] = await Promise.all([
          api.ai.review.list({
            status,
            search: search.trim() || undefined,
            profileId: profileId ?? undefined,
            sourceId: sourceId ?? undefined,
            videoId: aiReviewVideoId ?? undefined,
            minConfidence: minConfidence > 0 ? minConfidence : undefined,
            limit: 50,
            offset
          }),
          api.ai.review.counts()
        ]);
        setItems((current) => (append ? [...current, ...page.items] : page.items));
        setTotal(page.total);
        setCounts(nextCounts);
      } catch (error) {
        pushToast('error', (error as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [aiReviewVideoId, minConfidence, profileId, pushToast, search, sourceId, status]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelected(new Set());
      scrollRef.current?.scrollTo({ top: 0 });
      void load(0, false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    void Promise.all([api.ai.profiles.list(), api.sources.list()])
      .then(([nextProfiles, nextSources]) => {
        setProfiles(nextProfiles);
        setSources(nextSources);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => api.ai.review.onChanged(() => void load(0, false)), [load]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 260,
    getItemKey: (index) => items[index]?.runId ?? index,
    overscan: 4
  });

  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.runId)), [items, selected]);

  const toggleRow = (runId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const approve = async (item: AiReviewItem, tagIds: number[]) => {
    if (tagIds.length === 0) return;
    setBusy(true);
    try {
      await api.ai.review.approve({ runIds: [item.runId], tagIds });
      pushToast('success', `已通过 ${tagIds.length} 个标签`);
      await load(0, false);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async (item: AiReviewItem, tagIds: number[]) => {
    if (tagIds.length === 0) return;
    setBusy(true);
    try {
      await api.ai.review.reject({ runIds: [item.runId], tagIds });
      pushToast('info', `已拒绝 ${tagIds.length} 个标签`);
      await load(0, false);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rerun = async (item: AiReviewItem) => {
    setBusy(true);
    try {
      const result = await api.ai.queue.enqueue({ videoIds: [item.videoId], force: true });
      pushToast(
        result.queued > 0 ? 'success' : 'warn',
        result.queued > 0 ? '已加入打标队列' : '未能加入队列'
      );
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateTag = async (
    tagId: number,
    patch: { name?: string; category?: string; confidence?: number }
  ) => {
    try {
      const updated = await api.ai.review.updateTag({ tagId, ...patch });
      if (updated)
        setItems((current) => current.map((item) => (item.runId === updated.runId ? updated : item)));
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const addTag = async (runId: number, name: string, category: string) => {
    try {
      const updated = await api.ai.review.addTag({ runId, name, category, confidence: 0.8 });
      if (updated)
        setItems((current) => current.map((item) => (item.runId === updated.runId ? updated : item)));
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const removeTag = async (tagId: number) => {
    try {
      const updated = await api.ai.review.removeTag({ tagId });
      if (updated)
        setItems((current) => current.map((item) => (item.runId === updated.runId ? updated : item)));
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const restoreTag = async (tagId: number) => {
    try {
      const updated = await api.ai.review.restoreTag({ tagId });
      if (updated)
        setItems((current) => current.map((item) => (item.runId === updated.runId ? updated : item)));
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const batchApprove = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await api.ai.review.approve({ runIds: Array.from(selected) });
      pushToast('success', `已通过 ${result.approved} 个标签，涉及 ${result.affectedVideos} 个视频`);
      setSelected(new Set());
      await load(0, false);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const batchReject = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await api.ai.review.reject({ runIds: Array.from(selected) });
      pushToast('info', `已拒绝 ${result.rejected} 个标签`);
      setSelected(new Set());
      await load(0, false);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const batchRerun = async () => {
    const videoIds = Array.from(new Set(selectedItems.map((item) => item.videoId)));
    if (videoIds.length === 0) return;
    setBusy(true);
    try {
      const result = await api.ai.queue.enqueue({ videoIds, force: true });
      pushToast(result.queued > 0 ? 'success' : 'warn', `已加入 ${result.queued} 个视频`);
      setSelected(new Set());
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-none border-b border-line2 bg-panel/30 px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-line bg-panel2/50 p-0.5">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                className={clsx(
                  'rounded-md px-2 py-1 text-[11.5px] transition-colors',
                  status === option.value
                    ? 'bg-pink/15 text-pink'
                    : 'text-muted hover:bg-panel3/70 hover:text-fg'
                )}
              >
                {option.label}
                {option.value === 'pending' && counts.pending > 0 ? (
                  <span className="ml-1 font-mono text-[9.5px] text-yellow">{counts.pending}</span>
                ) : null}
                {option.value === 'approved' && counts.approved > 0 ? (
                  <span className="ml-1 font-mono text-[9.5px] text-dim">{counts.approved}</span>
                ) : null}
                {option.value === 'rejected' && counts.rejected > 0 ? (
                  <span className="ml-1 font-mono text-[9.5px] text-dim">{counts.rejected}</span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="relative min-w-[180px] max-w-[360px] flex-1">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim"
            />
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题、UP、标签…"
              className="h-8 pl-7 text-[11.5px]"
            />
          </div>

          <Select
            value={profileId ? String(profileId) : 'all'}
            onChange={(value) => setProfileId(value === 'all' ? null : Number(value))}
            options={[
              { value: 'all', label: '全部方案' },
              ...profiles.map((profile) => ({ value: String(profile.id), label: profile.name }))
            ]}
          />
          <Select
            value={sourceId ? String(sourceId) : 'all'}
            onChange={(value) => setSourceId(value === 'all' ? null : Number(value))}
            options={[
              { value: 'all', label: '全部来源' },
              ...sources.map((source) => ({ value: String(source.id), label: source.title }))
            ]}
          />
          <label className="flex items-center gap-1.5 text-[10.5px] text-dim" title="最低置信度">
            <span className="hidden xl:inline">置信度</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minConfidence}
              onChange={(event) => setMinConfidence(Number(event.target.value))}
              className="w-16 accent-pink 2xl:w-20"
            />
            <span className="w-8 font-mono text-[10px]">{minConfidence.toFixed(2)}</span>
          </label>

          {aiReviewVideoId ? (
            <span className="inline-flex items-center gap-1 rounded border border-blue/30 bg-blue/10 px-1.5 py-0.5 text-[10.5px] text-blue">
              仅看视频 #{aiReviewVideoId}
              <button type="button" onClick={() => openAiReview(null)} aria-label="清除视频筛选">
                <X size={10} />
              </button>
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelected(new Set(items.map((item) => item.runId)))}
              className="text-[10.5px] text-dim transition-colors hover:text-fg"
            >
              全选当前页
            </button>
            <span className="text-[10.5px] text-dim">
              已选 {selected.size} · 共 {total} 条
            </span>
            {loading ? <Spinner className="h-3 w-3" /> : null}
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-pink/25 bg-pink/[0.04] px-2 py-1">
            <span className="text-[10.5px] text-pink">已选 {selected.size} 行</span>
            <Button
              size="sm"
              variant="subtle"
              className="h-6 px-2 text-[10.5px]"
              onClick={() => void batchApprove()}
              disabled={busy}
            >
              <Check size={10} />
              批量通过
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10.5px]"
              onClick={() => void batchReject()}
              disabled={busy}
            >
              <X size={10} />
              批量拒绝
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10.5px]"
              onClick={() => void batchRerun()}
              disabled={busy}
            >
              <RefreshCw size={10} />
              重跑
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto text-[10.5px] text-dim hover:text-fg"
            >
              清空选择
            </button>
          </div>
        ) : null}
      </div>

      <div ref={scrollRef} className="scroll-thin scroll-stable min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-dim">
            <Spinner />
            加载审核结果…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel2 text-dim">
              <ListChecks size={17} />
            </div>
            <div className="text-[13px] text-muted">这里还没有审核结果</div>
            <div className="max-w-[420px] text-[11px] leading-5 text-dim">
              先在「打标任务」里发起一次打标，完成后结果会出现在这里；通过的标签会进入侧栏「本地标签」。
            </div>
            <Button size="sm" variant="subtle" onClick={() => setAiTab('queue')}>
              去发起打标
            </Button>
          </div>
        ) : (
          <>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) return null;
                return (
                  <div
                    key={item.runId}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingBottom: 10
                    }}
                  >
                    <AiReviewRow
                      item={item}
                      selected={selected.has(item.runId)}
                      busy={busy}
                      defaultMinConfidence={minConfidence || 0.5}
                      onToggleRow={() => toggleRow(item.runId)}
                      onApprove={(tagIds) => void approve(item, tagIds)}
                      onReject={(tagIds) => void reject(item, tagIds)}
                      onRerun={() => void rerun(item)}
                      onPlay={() => openPlayer(item.videoId)}
                      onUpdateTag={(tagId, patch) => void updateTag(tagId, patch)}
                      onAddTag={(name, category) => void addTag(item.runId, name, category)}
                      onRemoveTag={(tagId) => void removeTag(tagId)}
                      onRestoreTag={(tagId) => void restoreTag(tagId)}
                    />
                  </div>
                );
              })}
            </div>
            {items.length < total ? (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => void load(items.length, true)}
                  disabled={loading}
                >
                  {loading ? '加载中…' : `加载更多（${items.length}/${total}）`}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
