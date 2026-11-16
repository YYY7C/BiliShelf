import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp, Clock, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AiReviewItem, AiReviewTag } from '@shared/types';
import { formatDuration } from '../../lib/format';
import {
  AI_REVIEW_STATUS_CLASS,
  AI_REVIEW_STATUS_LABEL,
  AI_TAG_SOURCE_CLASS,
  AI_TAG_SOURCE_LABEL,
  categoryClass,
  formatConfidence,
  formatTokens
} from '../../lib/ai';
import { Button, TextInput } from '../ui';
import { AiFrameStrip } from './AiFrameStrip';

interface AiReviewRowProps {
  item: AiReviewItem;
  selected: boolean;
  busy?: boolean;
  defaultMinConfidence?: number;
  onToggleRow: () => void;
  onApprove: (tagIds: number[]) => void;
  onReject: (tagIds: number[]) => void;
  onRerun: () => void;
  onPlay?: (time: number) => void;
  onUpdateTag: (tagId: number, patch: { name?: string; category?: string; confidence?: number }) => void;
  onAddTag: (name: string, category: string) => void;
  onRemoveTag: (tagId: number) => void;
  onRestoreTag: (tagId: number) => void;
}

function tagIsSelectable(tag: AiReviewTag): boolean {
  return tag.status === 'pending';
}

export function AiReviewRow({
  item,
  selected,
  busy,
  defaultMinConfidence = 0.5,
  onToggleRow,
  onApprove,
  onReject,
  onRerun,
  onPlay,
  onUpdateTag,
  onAddTag,
  onRemoveTag,
  onRestoreTag
}: AiReviewRowProps) {
  const [selectedTags, setSelectedTags] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<AiReviewTag | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editConfidence, setEditConfidence] = useState('0.8');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    setSelectedTags(
      new Set(
        item.aiTags
          .filter((tag) => tagIsSelectable(tag) && tag.confidence >= defaultMinConfidence)
          .map((tag) => tag.id)
      )
    );
  }, [item.runId, item.aiTags, defaultMinConfidence]);

  const grouped = useMemo(() => {
    const map = new Map<string, AiReviewTag[]>();
    for (const tag of item.aiTags) {
      if (!map.has(tag.category)) map.set(tag.category, []);
      map.get(tag.category)!.push(tag);
    }
    return Array.from(map.entries());
  }, [item.aiTags]);

  const pendingCount = item.aiTags.filter(tagIsSelectable).length;
  const selectedPending = item.aiTags.filter((tag) => tagIsSelectable(tag) && selectedTags.has(tag.id));

  const selectAllPending = () => {
    setSelectedTags(new Set(item.aiTags.filter(tagIsSelectable).map((tag) => tag.id)));
  };

  const clearSelected = () => setSelectedTags(new Set());

  const toggleTag = (tag: AiReviewTag) => {
    if (!tagIsSelectable(tag)) return;
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag.id)) next.delete(tag.id);
      else next.add(tag.id);
      return next;
    });
  };

  const startEdit = (tag: AiReviewTag) => {
    setEditing(tag);
    setEditName(tag.name);
    setEditCategory(tag.category);
    setEditConfidence(String(tag.confidence));
  };

  const saveEdit = () => {
    if (!editing) return;
    onUpdateTag(editing.id, {
      name: editName.trim() || editing.name,
      category: editCategory.trim() || editing.category,
      confidence: Number(editConfidence)
    });
    setEditing(null);
  };

  const addTag = () => {
    const name = newName.trim();
    const category = newCategory.trim() || grouped[0]?.[0] || '其他';
    if (!name) return;
    onAddTag(name, category);
    setNewName('');
    setNewCategory('');
    setAdding(false);
  };

  return (
    <div
      className={clsx(
        'rounded-xl border transition-colors',
        selected ? 'border-pink/35 bg-pink/[0.04]' : 'border-line/70 bg-panel/35'
      )}
    >
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleRow}
            className="mt-1 h-3.5 w-3.5 flex-none accent-pink"
            aria-label={`选择 ${item.videoTitle}`}
          />

          <div className="relative h-16 w-28 flex-none overflow-hidden rounded-lg border border-line bg-panel3">
            {item.coverUrl ? (
              <img src={item.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : null}
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 font-mono text-[9px] text-white/90">
              {formatDuration(item.duration)}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="min-w-0 max-w-full truncate text-[13px] font-medium text-fg xl:max-w-[52ch]"
                title={item.videoTitle}
              >
                {item.videoTitle}
              </span>
              <span
                className={clsx(
                  'flex-none rounded border px-1.5 py-0.5 text-[10px]',
                  AI_REVIEW_STATUS_CLASS[item.reviewStatus]
                )}
              >
                {AI_REVIEW_STATUS_LABEL[item.reviewStatus]}
              </span>
              {item.reviewStatus === 'pending' ? (
                <span className="flex-none font-mono text-[10px] text-yellow">{pendingCount} 待审</span>
              ) : null}
              <div className="ml-auto flex flex-none items-center gap-1">
                {pendingCount > 0 ? (
                  <>
                    <Button
                      variant="subtle"
                      size="sm"
                      className="h-6 px-2 text-[10.5px]"
                      onClick={() => onApprove(selectedPending.map((tag) => tag.id))}
                      disabled={busy || selectedPending.length === 0}
                      title="通过当前勾选的标签"
                    >
                      <Check size={10} />
                      通过 {selectedPending.length}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10.5px]"
                      onClick={() => onReject(selectedPending.map((tag) => tag.id))}
                      disabled={busy || selectedPending.length === 0}
                      title="拒绝当前勾选的标签"
                    >
                      <X size={10} />
                      拒绝
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10.5px]"
                  onClick={onRerun}
                  disabled={busy}
                  title="重新打标这个视频"
                >
                  <RotateCcw size={10} />
                  重跑
                </Button>
              </div>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-dim">
              <span className="truncate">{item.upName ?? '未知 UP'}</span>
              <span>·</span>
              <span className="truncate">{item.sourceName ?? '无来源'}</span>
              <span>·</span>
              <span className="truncate">{item.profileName ?? '未记录方案'}</span>
              <span>·</span>
              <span className="truncate">{item.model ?? '未记录模型'}</span>
              <span>·</span>
              <span className="inline-flex shrink-0 items-center gap-0.5">
                <Clock size={9} />
                {new Date(item.createdAt).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-[9.5px] text-dim">原始标签</span>
              {item.originalTags.length === 0 ? (
                <span className="text-[9.5px] text-dim">无</span>
              ) : (
                <>
                  {item.originalTags.slice(0, 8).map((tag) => (
                    <span
                      key={`${tag.name}-${tag.source}`}
                      className={clsx(
                        'max-w-[120px] truncate rounded border px-1.5 py-0.5 text-[9.5px]',
                        tag.source === 'manual'
                          ? 'border-line bg-panel2 text-muted'
                          : 'border-blue/20 bg-blue/[0.06] text-blue/90'
                      )}
                      title={tag.source === 'manual' ? '手动标签' : '平台/自动标签'}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {item.originalTags.length > 8 ? (
                    <span className="text-[9.5px] text-dim">+{item.originalTags.length - 8}</span>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2.5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_248px]">
          <div className="flex min-w-0 flex-wrap gap-3">
            <div className="flex-none">
              <div className="mb-1 text-[10px] text-dim">抽帧</div>
              <AiFrameStrip frames={item.frames} onPlay={onPlay} compact />
            </div>

            <div className="min-w-[300px] flex-1 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[9.5px] text-dim">
                <span className="text-[10px]">AI 标签</span>
                <span>
                  已选 {selectedPending.length}/{pendingCount}
                </span>
                {pendingCount > 0 ? (
                  <>
                    <button type="button" onClick={selectAllPending} className="hover:text-fg">
                      全选
                    </button>
                    <button type="button" onClick={clearSelected} className="hover:text-fg">
                      清空
                    </button>
                  </>
                ) : null}
              </div>

              {grouped.length === 0 ? <span className="text-[11px] text-dim">没有生成标签</span> : null}
              {grouped.map(([category, tags]) => (
                <div key={category} className="flex flex-wrap items-center gap-1.5">
                  <span className={clsx('rounded border px-1.5 py-0.5 text-[10px]', categoryClass(category))}>
                    {category}
                  </span>
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      className={clsx(
                        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px]',
                        tag.status === 'approved'
                          ? 'border-green/30 bg-green/10 text-green'
                          : tag.status === 'rejected'
                            ? 'border-line bg-panel2 text-dim line-through'
                            : selectedTags.has(tag.id)
                              ? 'border-pink/30 bg-pink/10 text-fg'
                              : 'border-line bg-panel2 text-muted'
                      )}
                    >
                      {tag.status === 'pending' ? (
                        <input
                          type="checkbox"
                          checked={selectedTags.has(tag.id)}
                          onChange={() => toggleTag(tag)}
                          className="h-3 w-3 accent-pink"
                          aria-label={`选择标签 ${tag.name}`}
                        />
                      ) : null}
                      <span>{tag.name}</span>
                      <span className="font-mono text-[9px] text-dim">
                        {formatConfidence(tag.confidence)}
                      </span>
                      <span
                        className={clsx('rounded border px-1 text-[8.5px]', AI_TAG_SOURCE_CLASS[tag.source])}
                      >
                        {AI_TAG_SOURCE_LABEL[tag.source]}
                      </span>
                      {tag.status === 'rejected' ? (
                        <button
                          type="button"
                          onClick={() => onRestoreTag(tag.id)}
                          className="text-dim hover:text-green"
                          aria-label={`恢复标签 ${tag.name}`}
                          title="恢复为待审核"
                        >
                          <RotateCcw size={9} />
                        </button>
                      ) : tag.status !== 'approved' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(tag)}
                            className="text-dim hover:text-fg"
                            aria-label={`编辑标签 ${tag.name}`}
                          >
                            <Pencil size={9} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveTag(tag.id)}
                            className="text-dim hover:text-red"
                            aria-label={`删除标签 ${tag.name}`}
                          >
                            <X size={9} />
                          </button>
                        </>
                      ) : null}
                    </span>
                  ))}
                </div>
              ))}

              {editing ? (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-blue/25 bg-blue/[0.04] p-1.5">
                  <TextInput
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="h-7 w-36 text-[11px]"
                    placeholder="标签名"
                  />
                  <TextInput
                    value={editCategory}
                    onChange={(event) => setEditCategory(event.target.value)}
                    className="h-7 w-24 text-[11px]"
                    placeholder="分类"
                  />
                  <TextInput
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={editConfidence}
                    onChange={(event) => setEditConfidence(event.target.value)}
                    className="h-7 w-20 text-[11px]"
                  />
                  <Button size="sm" variant="subtle" onClick={saveEdit}>
                    保存
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                </div>
              ) : null}

              {adding ? (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel2/60 p-1.5">
                  <TextInput
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    className="h-7 w-36 text-[11px]"
                    placeholder="标签名"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addTag();
                    }}
                  />
                  <TextInput
                    value={newCategory}
                    onChange={(event) => setNewCategory(event.target.value)}
                    className="h-7 w-24 text-[11px]"
                    placeholder="分类"
                  />
                  <Button size="sm" variant="subtle" onClick={addTag}>
                    添加
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    取消
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-1 text-[10.5px] text-dim transition-colors hover:text-fg"
                >
                  <Plus size={10} />
                  添加标签
                </button>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col rounded-lg border border-line/60 bg-panel2/25 p-2">
            {item.summary ? (
              <div>
                <div className="text-[9.5px] font-medium text-dim">摘要</div>
                <p className="mt-0.5 line-clamp-5 text-[10.5px] leading-4 text-muted">{item.summary}</p>
              </div>
            ) : null}

            {item.bgm ? (
              <div className={clsx(item.summary ? 'mt-2 border-t border-line/50 pt-1.5' : '')}>
                <div className="text-[9.5px] font-medium text-dim">BGM</div>
                <div className="mt-0.5 truncate text-[10.5px] text-muted" title={item.bgm.title ?? ''}>
                  {item.bgm.title || '未识别'}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9.5px] text-dim">
                  {item.bgm.artists.length > 0 ? <span>{item.bgm.artists.join('、')}</span> : null}
                  {item.bgm.genres.length > 0 ? <span>· {item.bgm.genres.join('、')}</span> : null}
                  <span className="rounded bg-panel3 px-1 text-[8.5px]">
                    {AI_TAG_SOURCE_LABEL[item.bgm.source]}
                  </span>
                </div>
              </div>
            ) : null}

            {!item.summary && !item.bgm ? (
              <div className="text-[10px] leading-4 text-dim">模型未返回摘要或 BGM 信息。</div>
            ) : null}

            <div className="mt-auto border-t border-line/50 pt-1.5">
              <div className="flex items-center gap-2 text-[9.5px] text-dim">
                <span className="font-mono">
                  {formatTokens(item.inputTokens)} in / {formatTokens(item.outputTokens)} out
                </span>
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 hover:text-fg"
                >
                  {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  {expanded ? '收起 JSON' : 'JSON'}
                </button>
              </div>
              <div className="mt-0.5 text-[9px] text-dim">
                请求 {item.requestCount} 次
                {item.musicRequestCount > 0 ? ` · ACR ${item.musicRequestCount}` : ''}
              </div>
              {expanded ? (
                <pre className="scroll-thin mt-1 max-h-40 overflow-auto rounded border border-line bg-ink/60 p-1.5 font-mono text-[9px] leading-4 text-muted">
                  {JSON.stringify(item, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
