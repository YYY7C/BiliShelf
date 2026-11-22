import clsx from 'clsx';
import { AlertTriangle, Check, ListChecks, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AiReviewAudit, AiReviewCounts, AiReviewItem, AiTagProfile, SourceSummary } from '@shared/types';
import { EMPTY_QUALITY_CONFIG, issueLabel, LOW_CONFIDENCE_KIND, type AiQualityConfig } from '@shared/aiQuality';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { Button, Modal, Select, Spinner, TextInput } from '../ui';
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
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [audit, setAudit] = useState<AiReviewAudit | null>(null);
  const [quality, setQuality] = useState<AiQualityConfig>(EMPTY_QUALITY_CONFIG);
  const [auditOpen, setAuditOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<'all' | 'clean' | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
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
        const [page, nextCounts, nextAudit] = await Promise.all([
          api.ai.review.list({
            status,
            search: search.trim() || undefined,
            profileId: profileId ?? undefined,
            sourceId: sourceId ?? undefined,
            videoId: aiReviewVideoId ?? undefined,
            minConfidence: minConfidence > 0 ? minConfidence : undefined,
            conflicts: conflictsOnly ? 'any' : undefined,
            limit: 50,
            offset
          }),
          api.ai.review.counts(),
          api.ai.review.audit({
            status: 'pending',
            profileId: profileId ?? undefined,
            sourceId: sourceId ?? undefined,
            search: search.trim() || undefined,
            minConfidence: minConfidence > 0 ? minConfidence : undefined
          })
        ]);
        setItems((current) => (append ? [...current, ...page.items] : page.items));
        setTotal(page.total);
        setCounts(nextCounts);
        setAudit(nextAudit);
      } catch (error) {
        pushToast('error', (error as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [aiReviewVideoId, conflictsOnly, minConfidence, profileId, pushToast, search, sourceId, status]
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
    void Promise.all([api.ai.profiles.list(), api.sources.list(), api.ai.qualityRules()])
      .then(([nextProfiles, nextSources, nextQuality]) => {
        setProfiles(nextProfiles);
        setSources(nextSources);
        setQuality(nextQuality);
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

  // audit.issues 是按「规则」统计的，一条可能同时命中多条规则；
  // 条目数只能用「总数 − 干净数」，把各规则相加会重复计数。
  const conflictCount = audit ? Math.max(0, audit.runs - audit.cleanRuns) : 0;

  /** 按当前筛选条件批量通过；onlyClean 时跳过有矛盾标签的条目 */
  const runBulk = async (onlyClean: boolean) => {
    setBulkRunning(true);
    try {
      const result = await api.ai.review.bulk({
        action: 'approve',
        onlyClean,
        query: {
          status: 'pending',
          profileId: profileId ?? undefined,
          sourceId: sourceId ?? undefined,
          search: search.trim() || undefined,
          minConfidence: minConfidence > 0 ? minConfidence : undefined,
          conflicts: conflictsOnly ? 'any' : undefined
        }
      });
      pushToast(
        'success',
        `已通过 ${result.tags} 个标签（${result.runs} 条）${result.skipped > 0 ? `，跳过 ${result.skipped} 条有冲突的` : ''}`
      );
      setBulkConfirm(null);
      setSelected(new Set());
      await load(0, false);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBulkRunning(false);
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
            {audit && audit.runs > 0 ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10.5px]"
                  onClick={() => setBulkConfirm('clean')}
                  disabled={bulkRunning || audit.cleanRuns === 0}
                  title="通过没有矛盾标签的条目，有冲突的留给你人工看"
                >
                  <ShieldCheck size={10} />
                  智能通过 {audit.cleanRuns}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10.5px]"
                  onClick={() => setBulkConfirm('all')}
                  disabled={bulkRunning || audit.runs === 0}
                  title="通过当前筛选命中的全部条目（含存在冲突的）"
                >
                  <Check size={10} />
                  全部通过 {audit.runs}
                </Button>
                <button
                  type="button"
                  onClick={() => setAuditOpen(true)}
                  className={clsx(
                    'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors',
                    conflictCount > 0
                      ? 'border-red/40 bg-red/10 text-red hover:bg-red/15'
                      : 'border-line text-dim hover:text-fg'
                  )}
                  title="检查标签质量：同一套造型内互斥、同分类多个取值、低置信度"
                >
                  <AlertTriangle size={10} />
                  质量检查{conflictCount > 0 ? ` ${conflictCount}` : ''}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setConflictsOnly((value) => !value)}
              className={clsx(
                'rounded border px-1.5 py-0.5 text-[10.5px] transition-colors',
                conflictsOnly
                  ? 'border-red/40 bg-red/10 text-red'
                  : 'border-line text-dim hover:text-fg'
              )}
              title="只显示存在矛盾标签的条目"
            >
              仅有冲突
            </button>
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
                      quality={quality}
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

      {auditOpen && audit ? (
        <Modal
          title="标签质量检查"
          subtitle="规则来自素材库的 ai-quality.json；只做提示，不会自动改标签"
          onClose={() => setAuditOpen(false)}
          width="max-w-lg"
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-panel2/60 px-3 py-2.5 text-[11.5px] text-muted">
              当前筛选命中 <span className="font-mono text-fg">{audit.runs}</span> 条 ·{' '}
              <span className="font-mono text-fg">{audit.pendingTags}</span> 个待审标签 · 无冲突{' '}
              <span className="font-mono text-green">{audit.cleanRuns}</span> 条
            </div>
            <p className="text-[10.5px] leading-4 text-dim">
              换装视频同一条里可能有多套造型：这些规则只做提示，不会自动改标签，由你决定保留哪一方。
            </p>
            {quality.rules.length === 0 ? (
              <p className="rounded border border-line2/60 px-2.5 py-2 text-[11px] leading-5 text-dim">
                还没有配置质量规则：在素材库根目录放一个 <code className="text-fg">ai-quality.json</code> 即可（格式见
                docs/ai-tagging.md）。现在只检测低置信度。
              </p>
            ) : null}
            <ul className="space-y-1.5">
              {[...quality.rules.map((rule) => rule.kind), LOW_CONFIDENCE_KIND].map((kind) => {
                const count = audit.issues[kind] ?? 0;
                return (
                  <li
                    key={kind}
                    className="flex items-center justify-between gap-2 rounded border border-line2/60 px-2.5 py-1.5 text-[11.5px]"
                  >
                    <span className={count > 0 ? 'text-fg' : 'text-dim'}>{issueLabel(kind, quality)}</span>
                    <span
                      className={clsx(
                        'font-mono text-[11px]',
                        count > 0 ? (kind === LOW_CONFIDENCE_KIND ? 'text-yellow' : 'text-red') : 'text-dim'
                      )}
                    >
                      {count}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setAuditOpen(false)}>
                关闭
              </Button>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => {
                  setConflictsOnly(true);
                  setAuditOpen(false);
                }}
                disabled={conflictCount === 0}
              >
                只看有冲突的
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setAuditOpen(false);
                  setBulkConfirm('clean');
                }}
                disabled={audit.cleanRuns === 0}
              >
                通过无冲突的 {audit.cleanRuns} 条
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {bulkConfirm ? (
        <Modal
          title={bulkConfirm === 'clean' ? '通过无冲突条目' : '通过全部条目'}
          subtitle="通过后标签会进入素材库「本地标签」，不可一键撤销（可逐条取消）"
          onClose={() => {
            if (!bulkRunning) setBulkConfirm(null);
          }}
          width="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-[12px] leading-5 text-muted">
              {bulkConfirm === 'clean'
                ? `将通过与当前筛选一致、且没有矛盾标签的 ${audit?.cleanRuns ?? 0} 条打标结果。`
                : `将通过当前筛选命中的全部 ${audit?.runs ?? 0} 条打标结果（含存在矛盾的条目）。`}
            </p>
            {bulkConfirm === 'all' && conflictCount > 0 ? (
              <p className="rounded border border-yellow/30 bg-yellow/10 px-2.5 py-1.5 text-[11px] leading-5 text-yellow">
                其中有 {conflictCount} 条命中了你配置的质量规则（同一套造型内互斥 / 同分类多个取值）。
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBulkConfirm(null)}
                disabled={bulkRunning}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void runBulk(bulkConfirm === 'clean')}
                disabled={bulkRunning}
              >
                {bulkRunning ? <Spinner className="h-3 w-3" /> : <Check size={12} />}
                确认通过
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
