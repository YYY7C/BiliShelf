import clsx from 'clsx';
import { Copy, Plus, Save, Sparkles, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AiTagProfile, AiTagProfileInput, SourceSummary } from '@shared/types';
import {
  DEFAULT_FOCUS,
  DEFAULT_MAX_TAGS,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TAXONOMY
} from '@shared/aiDefaults';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { Button, Field, Modal, Select, TextArea, TextInput, Toggle } from '../ui';

function newProfile(): AiTagProfileInput {
  return {
    name: '新方案',
    description: '',
    scope: 'global',
    sourceId: null,
    isDefault: false,
    focus: [...DEFAULT_FOCUS],
    taxonomy: {
      categories: DEFAULT_TAXONOMY.categories.map((category) => ({
        ...category,
        examples: [...(category.examples ?? [])]
      })),
      stopwords: [...DEFAULT_TAXONOMY.stopwords],
      aliases: { ...DEFAULT_TAXONOMY.aliases }
    },
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    maxTags: DEFAULT_MAX_TAGS,
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    language: 'zh-CN',
    useAcrcloud: true,
    useBilibiliTags: true
  };
}

function fromProfile(profile: AiTagProfile): AiTagProfileInput {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    scope: profile.scope,
    sourceId: profile.sourceId,
    isDefault: profile.isDefault,
    focus: [...profile.focus],
    taxonomy: {
      categories: profile.taxonomy.categories.map((category) => ({
        ...category,
        examples: [...(category.examples ?? [])]
      })),
      stopwords: [...profile.taxonomy.stopwords],
      aliases: { ...profile.taxonomy.aliases }
    },
    systemPrompt: profile.systemPrompt,
    promptTemplate: profile.promptTemplate,
    maxTags: profile.maxTags,
    minConfidence: profile.minConfidence,
    language: profile.language,
    useAcrcloud: profile.useAcrcloud,
    useBilibiliTags: profile.useBilibiliTags
  };
}

const VARIABLES = [
  '{{title}}',
  '{{upName}}',
  '{{duration}}',
  '{{sourceName}}',
  '{{description}}',
  '{{originalTags}}',
  '{{bgmHint}}',
  '{{focus}}',
  '{{taxonomy}}',
  '{{maxTags}}',
  '{{minConfidence}}',
  '{{frameTimestamps}}',
  '{{schema}}'
];

export function AiProfileView() {
  const pushToast = useUi((state) => state.pushToast);
  const [profiles, setProfiles] = useState<AiTagProfile[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<AiTagProfileInput | null>(null);
  const [focusInput, setFocusInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = async (select?: number | null) => {
    try {
      const [nextProfiles, nextSources] = await Promise.all([api.ai.profiles.list(), api.sources.list()]);
      setProfiles(nextProfiles);
      setSources(nextSources);
      const target =
        select !== undefined
          ? (nextProfiles.find((profile) => profile.id === select) ?? nextProfiles[0])
          : (nextProfiles.find((profile) => profile.id === selectedId) ??
            nextProfiles.find((profile) => profile.isDefault) ??
            nextProfiles[0]);
      if (target) {
        setSelectedId(target.id);
        setDraft(fromProfile(target));
      } else {
        setSelectedId(null);
        setDraft(newProfile());
      }
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;

  const update = (patch: Partial<AiTagProfileInput>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      pushToast('warn', '方案名称不能为空');
      return;
    }
    setBusy(true);
    try {
      const next = await api.ai.profiles.save(draft);
      pushToast('success', '方案已保存');
      await load(draft.id ?? null);
      const saved =
        next.find((profile) => profile.id === draft.id) ??
        next.find((profile) => profile.name === draft.name);
      if (saved) {
        setSelectedId(saved.id);
        setDraft(fromProfile(saved));
      }
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    setSelectedId(null);
    setDraft(newProfile());
  };

  const duplicate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await api.ai.profiles.duplicate(selected.id);
      pushToast('success', '已复制方案');
      setProfiles(next);
      const copy = next.find(
        (profile) => profile.name.includes('副本') && profile.name.startsWith(selected.name)
      );
      if (copy) {
        setSelectedId(copy.id);
        setDraft(fromProfile(copy));
      }
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(`确定删除方案「${selected.name}」？`)) return;
    setBusy(true);
    try {
      const next = await api.ai.profiles.remove(selected.id);
      pushToast('info', '方案已删除');
      setProfiles(next);
      const target = next.find((profile) => profile.isDefault) ?? next[0];
      if (target) {
        setSelectedId(target.id);
        setDraft(fromProfile(target));
      } else {
        create();
      }
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await api.ai.profiles.setDefault(selected.id);
      pushToast('success', '已设为默认方案');
      setProfiles(next);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addFocus = () => {
    if (!draft) return;
    const value = focusInput.trim();
    if (!value) return;
    update({ focus: Array.from(new Set([...draft.focus, value])) });
    setFocusInput('');
  };

  const preview = useMemo(() => {
    if (!draft) return '';
    const values: Record<string, string> = {
      title: '示例视频标题',
      upName: '示例 UP 主',
      duration: '3:24',
      sourceName: '示例收藏夹',
      description: '示例简介',
      originalTags: '舞蹈、宅舞、音乐',
      bgmHint: '命中音乐线索：舞蹈、音乐。建议调用 identify_music 确认 BGM。',
      focus: draft.focus.join('、') || '无',
      taxonomy: draft.taxonomy.categories
        .map(
          (category) =>
            `- ${category.name}：${category.description ?? ''} 示例：${(category.examples ?? []).join('、')}`
        )
        .join('\n'),
      maxTags: String(draft.maxTags),
      minConfidence: String(draft.minConfidence),
      language: draft.language,
      frameTimestamps: '封面 / 0:30 / 1:42 / 2:55',
      schema: '{"summary":"...","tags":[{"name":"...","category":"...","confidence":0.9}],"bgm":null}'
    };
    return draft.promptTemplate.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match
    );
  }, [draft]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[240px] flex-none flex-col border-r border-line2">
        <div className="flex items-center gap-2 border-b border-line2 px-3 py-2">
          <span className="text-[12px] font-medium text-fg">标签方案</span>
          <button
            type="button"
            onClick={create}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[10.5px] text-muted hover:text-fg"
          >
            <Plus size={10} />
            新建
          </button>
        </div>
        <div className="scroll-thin scroll-stable min-h-0 flex-1 overflow-y-auto p-2">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => {
                setSelectedId(profile.id);
                setDraft(fromProfile(profile));
              }}
              className={clsx(
                'mb-1 w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
                selectedId === profile.id
                  ? 'border-pink/35 bg-pink/[0.05]'
                  : 'border-transparent hover:border-line/60 hover:bg-panel2/50'
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg">{profile.name}</span>
                {profile.isDefault ? (
                  <Star size={10} className="flex-none text-yellow" fill="currentColor" />
                ) : null}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-dim">
                {profile.scope === 'source' ? `来源：${profile.sourceName ?? '未知'}` : '全局方案'} ·{' '}
                {profile.taxonomy.categories.length} 个分类
              </div>
            </button>
          ))}
          {profiles.length === 0 ? (
            <div className="px-2 py-4 text-[11px] leading-5 text-dim">
              还没有方案。点击「新建」或去「库级分析」让 AI 生成一套。
            </div>
          ) : null}
        </div>
      </div>

      <div className="scroll-thin scroll-stable min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {draft ? (
          <div className="space-y-3">
            <div className="sticky top-0 z-10 -mx-4 -mt-3 mb-3 flex flex-wrap items-center gap-2 border-b border-line2 bg-panel/95 px-4 py-2 backdrop-blur">
              <div className="text-[13px] font-medium text-fg">{selected ? '编辑方案' : '新建方案'}</div>
              <div className="ml-auto flex items-center gap-1.5">
                {selected ? (
                  <>
                    {selected.scope === 'global' && !selected.isDefault ? (
                      <Button size="sm" variant="ghost" onClick={() => void setDefault()} disabled={busy}>
                        <Star size={11} />
                        设为默认
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => void duplicate()} disabled={busy}>
                      <Copy size={11} />
                      复制
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
                      <Trash2 size={11} />
                      删除
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="subtle" onClick={() => setPreviewOpen(true)}>
                  预览提示词
                </Button>
                <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>
                  <Save size={11} />
                  保存
                </Button>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="方案名称">
                    <TextInput
                      value={draft.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </Field>
                  <Field label="适用范围" hint="来源方案会覆盖该来源的全局默认方案。">
                    <div className="flex gap-2">
                      <Select
                        value={draft.scope}
                        onChange={(value) => update({ scope: value as 'global' | 'source' })}
                        options={[
                          { value: 'global', label: '全局' },
                          { value: 'source', label: '指定来源' }
                        ]}
                      />
                      {draft.scope === 'source' ? (
                        <Select
                          value={draft.sourceId ? String(draft.sourceId) : ''}
                          onChange={(value) => update({ sourceId: value ? Number(value) : null })}
                          options={sources.map((source) => ({
                            value: String(source.id),
                            label: source.title
                          }))}
                        />
                      ) : null}
                    </div>
                  </Field>
                </div>

                <Field label="描述">
                  <TextInput
                    value={draft.description ?? ''}
                    onChange={(event) => update({ description: event.target.value })}
                    placeholder="这个方案适合什么内容？"
                  />
                </Field>

                <Field label="关注点" hint="模型会重点关注这些维度；可自定义。">
                  <div className="flex flex-wrap gap-1.5">
                    {draft.focus.map((focus) => (
                      <span
                        key={focus}
                        className="inline-flex items-center gap-1 rounded border border-pink/25 bg-pink/10 px-1.5 py-0.5 text-[11px] text-pink"
                      >
                        {focus}
                        <button
                          type="button"
                          onClick={() => update({ focus: draft.focus.filter((item) => item !== focus) })}
                          aria-label={`移除关注点 ${focus}`}
                        >
                          <X size={9} />
                        </button>
                      </span>
                    ))}
                    <div className="flex items-center gap-1">
                      <TextInput
                        value={focusInput}
                        onChange={(event) => setFocusInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') addFocus();
                        }}
                        placeholder="添加关注点"
                        className="h-7 w-32 text-[11px]"
                      />
                      <Button size="sm" variant="ghost" onClick={addFocus}>
                        <Plus size={10} />
                      </Button>
                    </div>
                  </div>
                </Field>

                <div className="rounded-xl border border-line/70 bg-panel/35 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-fg">分类体系</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() =>
                        update({
                          taxonomy: {
                            ...draft.taxonomy,
                            categories: [
                              ...draft.taxonomy.categories,
                              { name: '新分类', description: '', examples: [] }
                            ]
                          }
                        })
                      }
                    >
                      <Plus size={10} />
                      添加分类
                    </Button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {draft.taxonomy.categories.map((category, index) => (
                      <div
                        key={`${category.name}-${index}`}
                        className="rounded-lg border border-line/60 bg-panel2/40 p-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <TextInput
                            value={category.name}
                            onChange={(event) => {
                              const categories = [...draft.taxonomy.categories];
                              categories[index] = { ...category, name: event.target.value };
                              update({ taxonomy: { ...draft.taxonomy, categories } });
                            }}
                            className="h-7 w-28 text-[11px]"
                            placeholder="分类名"
                          />
                          <TextInput
                            value={category.description ?? ''}
                            onChange={(event) => {
                              const categories = [...draft.taxonomy.categories];
                              categories[index] = { ...category, description: event.target.value };
                              update({ taxonomy: { ...draft.taxonomy, categories } });
                            }}
                            className="h-7 min-w-0 flex-1 text-[11px]"
                            placeholder="分类说明"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              update({
                                taxonomy: {
                                  ...draft.taxonomy,
                                  categories: draft.taxonomy.categories.filter(
                                    (_, itemIndex) => itemIndex !== index
                                  )
                                }
                              })
                            }
                            className="text-dim hover:text-red"
                            aria-label={`删除分类 ${category.name}`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                        <TextInput
                          value={(category.examples ?? []).join('、')}
                          onChange={(event) => {
                            const categories = [...draft.taxonomy.categories];
                            categories[index] = {
                              ...category,
                              examples: event.target.value
                                .split(/[、,，]/)
                                .map((item) => item.trim())
                                .filter(Boolean)
                            };
                            update({ taxonomy: { ...draft.taxonomy, categories } });
                          }}
                          className="mt-1 h-7 text-[11px]"
                          placeholder="示例标签，用、分隔"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <Field label="停用词" hint="用、或逗号分隔；命中这些词的标签会被丢弃。">
                  <TextInput
                    value={draft.taxonomy.stopwords.join('、')}
                    onChange={(event) =>
                      update({
                        taxonomy: {
                          ...draft.taxonomy,
                          stopwords: event.target.value
                            .split(/[、,，]/)
                            .map((item) => item.trim())
                            .filter(Boolean)
                        }
                      })
                    }
                    placeholder="视频、B站、二次元…"
                  />
                </Field>
              </div>
              <div className="space-y-3">
                <div className="grid gap-3">
                  <Field label="系统提示词">
                    <TextArea
                      value={draft.systemPrompt}
                      onChange={(event) => update({ systemPrompt: event.target.value })}
                      className="min-h-[160px] font-mono text-[11px]"
                    />
                  </Field>
                  <Field label="用户模板">
                    <TextArea
                      value={draft.promptTemplate}
                      onChange={(event) => update({ promptTemplate: event.target.value })}
                      className="min-h-[160px] font-mono text-[11px]"
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-1.5 rounded-lg border border-line/60 bg-panel2/40 px-2 py-1.5">
                  <span className="text-[10.5px] text-dim">可用变量：</span>
                  {VARIABLES.map((variable) => (
                    <code
                      key={variable}
                      className="rounded bg-panel3 px-1 py-0.5 font-mono text-[9.5px] text-muted"
                    >
                      {variable}
                    </code>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="最多标签数">
                    <TextInput
                      type="number"
                      min={1}
                      max={50}
                      value={draft.maxTags}
                      onChange={(event) => update({ maxTags: Number(event.target.value) || 1 })}
                    />
                  </Field>
                  <Field label="最低置信度">
                    <TextInput
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draft.minConfidence}
                      onChange={(event) => update({ minConfidence: Number(event.target.value) || 0 })}
                    />
                  </Field>
                  <Field label="标签语言">
                    <TextInput
                      value={draft.language}
                      onChange={(event) => update({ language: event.target.value })}
                    />
                  </Field>
                </div>

                <div className="rounded-xl border border-line/70 bg-panel/35 px-3 py-1">
                  <Toggle
                    checked={draft.useAcrcloud}
                    onChange={(next) => update({ useAcrcloud: next })}
                    label="允许调用 ACRCloud 识别 BGM"
                    hint="仅在 Provider 支持工具调用且 ACRCloud 已配置时生效。"
                  />
                  <div className="h-px bg-line2" />
                  <Toggle
                    checked={draft.useBilibiliTags}
                    onChange={(next) => update({ useBilibiliTags: next })}
                    label="把原始标签作为 BGM/内容线索"
                    hint="原始标签会随提示词一起发送给模型。"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-[12px] text-dim">
            <Sparkles size={14} className="mr-1" />
            选择或新建一个方案
          </div>
        )}
      </div>

      {previewOpen && draft ? (
        <Modal
          title="提示词预览"
          subtitle="使用示例视频数据渲染"
          onClose={() => setPreviewOpen(false)}
          width="max-w-3xl"
        >
          <div className="space-y-2">
            <div className="text-[11px] text-dim">系统提示词</div>
            <pre className="scroll-thin max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel2/40 p-2 font-mono text-[10px] leading-4 text-muted">
              {draft.systemPrompt}
            </pre>
            <div className="text-[11px] text-dim">用户提示词</div>
            <pre className="scroll-thin max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel2/40 p-2 font-mono text-[10px] leading-4 text-muted">
              {preview}
            </pre>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
