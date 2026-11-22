import { AlertTriangle, Play, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AiEnqueueInput,
  AiEnqueueResult,
  AiProviderSummary,
  AiTagProfile,
  AppSettings,
  SourceSummary
} from '@shared/types';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { formatTokens } from '../../lib/ai';
import { Button, Field, Modal, Select, TextInput, Toggle } from '../ui';

type ScopeKind = 'all' | 'filter' | 'source' | 'selection';

interface AiStartModalProps {
  open: boolean;
  settings: AppSettings | null;
  onClose: () => void;
  onStarted: (result: AiEnqueueResult) => void;
  onOpenModels: () => void;
  onOpenProfiles: () => void;
}

export function AiStartModal({
  open,
  settings,
  onClose,
  onStarted,
  onOpenModels,
  onOpenProfiles
}: AiStartModalProps) {
  const pushToast = useUi((state) => state.pushToast);
  const filters = useUi((state) => state.filters);
  const selection = useUi((state) => state.selection);
  const [providers, setProviders] = useState<AiProviderSummary[]>([]);
  const [profiles, setProfiles] = useState<AiTagProfile[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [scope, setScope] = useState<ScopeKind>('all');
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [force, setForce] = useState(false);
  const [limit, setLimit] = useState('');
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [consentHosts, setConsentHosts] = useState<string[] | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 用户在素材库里选好了视频才点「开始打标」时，默认就按选中范围，避免误打整个库
    if (useUi.getState().selection.length > 0) setScope('selection');
    void Promise.all([api.ai.providers.list(), api.ai.profiles.list(), api.sources.list()])
      .then(([nextProviders, nextProfiles, nextSources]) => {
        setProviders(nextProviders);
        setProfiles(nextProfiles);
        setSources(nextSources);
        setSourceId((current) => current ?? nextSources[0]?.id ?? null);
      })
      .catch((error: unknown) => pushToast('error', (error as Error).message));
  }, [open, pushToast]);

  const provider = providers.find((item) => item.isDefault) ?? providers[0] ?? null;

  useEffect(() => {
    if (!open) return;
    if (scope === 'selection') {
      setTotal(selection.length);
      return;
    }
    if (scope === 'source' && !sourceId) {
      // 没有来源时不能退化成「整个素材库」，否则界面写着指定来源、实际打标全库
      setTotal(0);
      return;
    }
    let alive = true;
    const query =
      scope === 'filter'
        ? {
            search: filters.search.trim() || undefined,
            tag: filters.tag ?? undefined,
            aiTag: filters.aiTag ?? undefined,
            folder: filters.folder ?? undefined,
            status: filters.status,
            sourceId: filters.sourceId ?? undefined,
            sort: filters.sort
          }
        : scope === 'source' && sourceId
          ? { status: 'present' as const, sourceId }
          : { status: 'present' as const };
    api.library
      .query({ ...query, limit: 1 })
      .then((result) => {
        if (alive) setTotal(result.total);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [filters, open, scope, selection.length, sourceId]);

  const limitValue = Number(limit);
  const limitCount = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(5000, Math.round(limitValue)) : null;
  const targetCount = limitCount ? Math.min(total, limitCount) : total;
  const frameCount = settings?.aiFrameCount ?? 3;
  const includeCover = settings?.aiIncludeCover !== false;
  const imageCount = targetCount * (frameCount + (includeCover ? 1 : 0));
  const approxTokens = imageCount * 800 + targetCount * 300;

  const buildInput = (): AiEnqueueInput => {
    const input: AiEnqueueInput = {
      profileId: profileId ?? undefined,
      force,
      limit: limitCount ?? undefined
    };
    if (scope === 'selection') input.videoIds = selection;
    else if (scope === 'source' && sourceId) input.scope = { type: 'source', sourceId };
    else if (scope === 'filter')
      input.scope = {
        type: 'filter',
        filter: {
          search: filters.search.trim() || undefined,
          tag: filters.tag ?? undefined,
          aiTag: filters.aiTag ?? undefined,
          folder: filters.folder ?? undefined,
          status: filters.status,
          sourceId: filters.sourceId ?? undefined,
          sort: filters.sort
        }
      };
    else input.scope = { type: 'all' };
    return input;
  };

  const enqueue = async () => {
    setBusy(true);
    try {
      const input = buildInput();
      const result = await api.ai.queue.enqueue(input);
      if (result.queued === 0) {
        pushToast('warn', '没有需要打标的视频（可能已打标或已在队列中）');
        return;
      }
      pushToast('success', `已加入 ${result.queued} 个视频，跳过 ${result.skipped} 个`);
      onStarted(result);
      onClose();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!provider) {
      pushToast('warn', '请先配置一个模型 Provider');
      onOpenModels();
      return;
    }
    setBusy(true);
    try {
      const input = buildInput();
      const preview = await api.ai.queue.consent(input);
      if (preview.required) {
        setConsentHosts(preview.hosts);
        setConsentChecked(false);
        return;
      }
      await enqueue();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmConsent = async () => {
    if (!consentHosts || !consentChecked) return;
    setBusy(true);
    try {
      await api.ai.consent.accept(consentHosts);
      setConsentHosts(null);
      await enqueue();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      title="开始 AI 打标"
      subtitle="选择范围和方案；结果会先进入审核页"
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="space-y-3">
        {!provider ? (
          <div className="flex items-start gap-2 rounded-lg border border-yellow/30 bg-yellow/[0.06] px-3 py-2 text-[11.5px] leading-5 text-yellow">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <div>
              还没有配置 VLM Provider。
              <button type="button" className="ml-1 underline" onClick={onOpenModels}>
                去配置模型
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-2 text-[11.5px] text-muted">
            使用 Provider：<span className="text-fg">{provider.name}</span>
            <span className="ml-2 font-mono text-[10.5px] text-dim">{provider.model}</span>
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-yellow/30 bg-yellow/[0.06] px-3 py-2 text-[11.5px] leading-5 text-yellow">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <div>
              还没有标签方案。
              <button type="button" className="ml-1 underline" onClick={onOpenProfiles}>
                去创建方案
              </button>
            </div>
          </div>
        ) : null}

        <Field label="打标范围">
          <Select
            value={scope}
            onChange={(value) => setScope(value as ScopeKind)}
            options={[
              { value: 'all', label: '整个素材库（已下载可播放）' },
              { value: 'filter', label: '当前筛选结果' },
              { value: 'source', label: '指定来源' },
              { value: 'selection', label: `选中视频（${selection.length}）` }
            ]}
          />
        </Field>

        {scope === 'source' ? (
          <Field label="来源">
            <Select
              value={sourceId ? String(sourceId) : ''}
              onChange={(value) => setSourceId(value ? Number(value) : null)}
              options={sources.map((source) => ({ value: String(source.id), label: source.title }))}
            />
          </Field>
        ) : null}

        <Field label="标签方案" hint="来源有覆盖方案时会自动使用覆盖方案。">
          <Select
            value={profileId ? String(profileId) : 'auto'}
            onChange={(value) => setProfileId(value === 'auto' ? null : Number(value))}
            options={[
              { value: 'auto', label: '自动（来源覆盖 / 全局默认）' },
              ...profiles.map((profile) => ({
                value: String(profile.id),
                label: `${profile.name}${profile.scope === 'source' ? '（来源）' : ''}`
              }))
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="最多处理条数" hint="留空表示不限制。">
            <TextInput
              type="number"
              min={1}
              max={5000}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="不限制"
            />
          </Field>
          <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-2">
            <Toggle
              checked={force}
              onChange={setForce}
              label="强制重跑已打标视频"
              hint="关闭时会跳过同方案已完成的视频。"
            />
          </div>
        </div>

        <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-2 text-[11px] leading-5 text-dim">
          预计：{targetCount} 个视频
          {limitCount && limitCount < total ? `（库内匹配 ${total} 条，按上限截断）` : ''} · {imageCount}{' '}
          张图片 · 约 {formatTokens(approxTokens)} tokens（估算，实际以模型返回为准）
        </div>

        {consentHosts ? (
          <div className="rounded-lg border border-yellow/35 bg-yellow/[0.06] px-3 py-2 text-[11.5px] leading-5 text-yellow">
            <div className="flex items-center gap-1.5 font-medium">
              <Shield size={13} />
              上传确认
            </div>
            <p className="mt-1 text-yellow/90">
              本次打标会把封面/抽帧上传到：{consentHosts.join('、')}。只有你主动发起任务时才会上传。
            </p>
            <label className="mt-2 flex items-center gap-2 text-[11.5px]">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(event) => setConsentChecked(event.target.checked)}
                className="h-3.5 w-3.5 accent-yellow"
              />
              我了解并同意上传到上述服务
            </label>
            <div className="mt-2 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setConsentHosts(null)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void confirmConsent()}
                disabled={!consentChecked || busy}
              >
                确认并开始
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-line2 pt-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void start()}
            disabled={busy || targetCount === 0 || profiles.length === 0}
          >
            <Play size={13} />
            {busy ? '处理中…' : '开始打标'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
