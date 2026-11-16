import fs from 'node:fs';
import { z } from 'zod';
import type {
  AiAnalysisEstimate,
  AiAnalysisInput,
  AiAnalysisProgress,
  AiAnalysisResult,
  AiAnalysisRun,
  AiAnalysisSample,
  AiTagProfile,
  AiTagProfileInput
} from '@shared/types';
import {
  DEFAULT_FOCUS,
  DEFAULT_MAX_TAGS,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TAXONOMY
} from '@shared/aiDefaults';
import { all } from '../../db/index';
import {
  createAnalysisRun,
  getAnalysisRun,
  listAnalysisRuns,
  saveProfile,
  updateAnalysisRun
} from '../../db/ai';
import { getVideo } from '../../db/videos';
import { getSettings } from '../../store';
import { fromLibraryRelative, libraryPaths } from '../../paths';
import { getProviderRuntime } from './config';
import { createAdapter, type AiContentPart } from './providers';
import { prepareFrames } from './frames';
import { extractJson } from './normalize';

const analysisSchema = z.object({
  summary: z.string().max(1000).optional().default(''),
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        description: z.string().max(300).optional().default(''),
        tags: z.array(z.string().max(60)).max(50).optional().default([]),
        coverage: z.number().min(0).max(1).optional()
      })
    )
    .max(20)
    .optional()
    .default([]),
  focus: z.array(z.string().max(40)).max(30).optional().default([]),
  stopwords: z.array(z.string().max(40)).max(100).optional().default([]),
  aliases: z.record(z.string(), z.string()).optional().default({}),
  systemPrompt: z.string().max(8000).optional().default(''),
  promptTemplate: z.string().max(12000).optional().default(''),
  notes: z.array(z.string().max(300)).max(20).optional().default([])
});

type ParsedAnalysis = z.infer<typeof analysisSchema>;

const TEXT_SYSTEM =
  '你是视频素材库的策展人，擅长从标题、UP 主、简介和原始标签中归纳主题与标签体系。只输出 JSON。';

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

function uniqueIds(ids: number[] | undefined): number[] {
  return Array.from(new Set((ids ?? []).filter((id) => Number.isFinite(id) && id > 0)));
}

function sampleIds(input: AiAnalysisInput): number[] {
  const size = clamp(input.sampleSize, 1, 200, 24);
  const manual = uniqueIds(input.videoIds);
  if (manual.length > 0) return manual.slice(0, size);
  const rows = all<{ id: number; source_id: number | null; up_mid: number | null }>(
    "SELECT id, source_id, up_mid FROM videos WHERE status = 'present' ORDER BY created_at DESC"
  );
  if (rows.length === 0) return [];
  if (input.sampleMode === 'random' || size >= rows.length) {
    return shuffle(rows)
      .slice(0, size)
      .map((row) => row.id);
  }
  const key = input.sampleMode === 'up' ? 'up_mid' : 'source_id';
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const groupKey = String(row[key] ?? 'unknown');
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(row);
  }
  const buckets = shuffle(Array.from(groups.values()));
  const picked: number[] = [];
  let cursor = 0;
  while (picked.length < size && buckets.some((bucket) => cursor < bucket.length)) {
    for (const bucket of buckets) {
      const row = bucket[cursor];
      if (row && picked.length < size) picked.push(row.id);
    }
    cursor += 1;
  }
  return picked;
}

function samplesFor(input: AiAnalysisInput): {
  samples: AiAnalysisSample[];
  videos: ReturnType<typeof getVideo>[];
} {
  const ids = sampleIds(input);
  const videos = ids.map((id) => getVideo(id));
  const samples: AiAnalysisSample[] = [];
  for (const video of videos) {
    if (!video) continue;
    samples.push({ videoId: video.id, title: video.title, coverUrl: video.thumbUrl ?? video.coverUrl });
  }
  return { samples, videos };
}

export function estimateAnalysis(input: AiAnalysisInput): AiAnalysisEstimate {
  const ids = sampleIds(input);
  const count = ids.length;
  const textRequests = input.mode === 'vision' ? 0 : Math.ceil(count / 60);
  const visionRequests =
    input.mode === 'text'
      ? 0
      : Math.min(10, Math.max(2, Math.ceil(count / 3))) + (input.mode === 'hybrid' ? 2 : 0);
  const imageCount = visionRequests * 3;
  const approxInputTokens = textRequests * 800 + count * 80 + imageCount * 800;
  const warnings: string[] = [];
  if (count === 0) warnings.push('当前没有可分析的已下载视频');
  if (input.mode !== 'text' && count > 60) warnings.push('视觉分析只选取代表视频，不会逐条发送全部视频');
  if (count > 200) warnings.push('样本上限为 200 条');
  return {
    videos: count,
    requests: textRequests + visionRequests,
    imageCount,
    approxInputTokens,
    approxOutputTokens: 2500,
    warnings
  };
}

function parseAnalysis(raw: string): ParsedAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error('分析模型没有返回合法 JSON');
  }
  return analysisSchema.parse(parsed);
}

function mergeAnalysis(base: AiAnalysisResult, next: ParsedAnalysis): AiAnalysisResult {
  const categories = new Map(base.categories.map((category) => [category.name, { ...category }]));
  for (const category of next.categories) {
    const existing = categories.get(category.name);
    if (!existing) {
      categories.set(category.name, {
        name: category.name,
        description: category.description,
        tags: category.tags,
        coverage: category.coverage
      });
    } else {
      existing.description = existing.description || category.description;
      existing.tags = Array.from(new Set([...existing.tags, ...category.tags])).slice(0, 30);
      existing.coverage =
        category.coverage !== undefined
          ? Math.max(existing.coverage ?? 0, category.coverage)
          : existing.coverage;
    }
  }
  return {
    summary: next.summary && next.summary.length > base.summary.length ? next.summary : base.summary,
    categories: Array.from(categories.values()),
    focus: Array.from(new Set([...base.focus, ...next.focus])).slice(0, 30),
    stopwords: Array.from(new Set([...base.stopwords, ...next.stopwords])).slice(0, 100),
    aliases: { ...base.aliases, ...next.aliases },
    systemPrompt: next.systemPrompt || base.systemPrompt,
    promptTemplate: next.promptTemplate || base.promptTemplate,
    notes: Array.from(new Set([...base.notes, ...next.notes])).slice(0, 20)
  };
}

function metadataLine(video: NonNullable<ReturnType<typeof getVideo>>): string {
  const duration = video.duration ? `${Math.round(video.duration)}s` : '未知';
  return `- ${video.title} | UP:${video.upName ?? '未知'} | 来源:${video.sourceName ?? '未知'} | 时长:${duration} | 标签:${video.tags.join('、') || '无'}`;
}

function textPrompt(videos: NonNullable<ReturnType<typeof getVideo>>[], instructions?: string): string {
  return `下面是 ${videos.length} 个视频的元数据（标题/UP/简介/原始标签/来源/时长）：
${videos.map(metadataLine).join('\n')}

请完成：
1. 用 3–6 句话概括这个库的主题分布（例如：舞蹈、美食、教程、动画参考）。
2. 设计一套适合全库的标签分类体系：4–8 个分类，每个分类给 5–12 个候选标签。
3. 给出打标时应重点关注的内容维度（人物形象/服饰/动作/场景/风格/BGM/情绪等，按库的实际内容取舍）。
4. 给出应过滤的泛词/无信息标签。
${instructions?.trim() ? `额外要求：${instructions.trim()}\n` : ''}只输出 JSON：
{"summary":"...","categories":[{"name":"人物","description":"...","tags":["..."]}],"focus":["..."],"stopwords":["..."],"aliases":{}}`;
}

function visionPrompt(
  video: NonNullable<ReturnType<typeof getVideo>>,
  current: AiAnalysisResult,
  instructions?: string
): string {
  const taxonomy = current.categories
    .map((category) => `- ${category.name}：${category.description || ''} 示例：${category.tags.join('、')}`)
    .join('\n');
  return `这是从素材库挑选的代表视频。
标题：${video.title}
UP 主：${video.upName ?? '未知'}
简介：${(video.description ?? '').slice(0, 600) || '无'}
原始标签：${video.tags.join('、') || '无'}

第一阶段的分类体系：
${taxonomy || '（空）'}

请基于封面和抽帧校正分类体系，并生成一套可直接用于逐视频打标的模板。
要求：
- 分类要贴合画面实际内容，不要照搬通用分类。
- 为每个分类给出 5–12 个具体标签示例。
- 明确 BGM 关注点：只有音乐/舞蹈/演奏/翻唱/MV 才建议调用 ACRCloud。
- 生成 systemPrompt 和 promptTemplate；模板必须包含 {{title}} {{originalTags}} {{focus}} {{taxonomy}} {{maxTags}} {{minConfidence}} {{schema}} 变量。
${instructions?.trim() ? `- 额外要求：${instructions.trim()}\n` : ''}- 只输出 JSON：
{"summary":"...","categories":[{"name":"人物","description":"...","tags":["..."],"coverage":0.8}],"focus":["..."],"stopwords":["..."],"aliases":{},"systemPrompt":"...","promptTemplate":"...","notes":["..."]}`;
}

function representativeVideos(
  videos: NonNullable<ReturnType<typeof getVideo>>[],
  categories: number
): NonNullable<ReturnType<typeof getVideo>>[] {
  const limit = Math.min(8, Math.max(2, categories || 6));
  const picked: NonNullable<ReturnType<typeof getVideo>>[] = [];
  if (videos.length <= limit) return [...videos];
  const step = Math.max(1, Math.floor(videos.length / limit));
  for (let index = 0; index < videos.length && picked.length < limit; index += step) {
    const video = videos[index];
    if (video) picked.push(video);
  }
  return picked;
}

async function imagesFor(videoId: number): Promise<AiContentPart[]> {
  const settings = getSettings();
  const frames = await prepareFrames(videoId, {
    count: 2,
    width: settings.aiFrameWidth,
    includeCover: true
  });
  const images: AiContentPart[] = [];
  for (const frame of frames) {
    const absolute = fromLibraryRelative(libraryPaths().root, frame.path);
    try {
      const data = fs.readFileSync(absolute).toString('base64');
      images.push({ type: 'image', mime: 'image/jpeg', data });
    } catch {
      // skip unreadable frame
    }
  }
  return images;
}

export async function runAnalysis(
  input: AiAnalysisInput,
  onProgress?: (progress: AiAnalysisProgress) => void
): Promise<AiAnalysisRun> {
  const runtime = getProviderRuntime(input.providerId);
  if (!runtime) throw new Error('请先配置一个模型 Provider');
  const { samples, videos } = samplesFor(input);
  const usable = videos.filter((video): video is NonNullable<typeof video> => Boolean(video));
  if (usable.length === 0) throw new Error('没有可分析的已下载视频');
  const adapter = createAdapter(runtime);
  const settings = getSettings();
  const analysisId = createAnalysisRun({
    providerId: runtime.summary.id,
    providerName: runtime.summary.name,
    model: runtime.summary.model,
    mode: input.mode,
    sample: samples
  });
  updateAnalysisRun(analysisId, { status: 'running' });

  let result: AiAnalysisResult = {
    summary: '',
    categories: [],
    focus: [],
    stopwords: [],
    aliases: {},
    systemPrompt: '',
    promptTemplate: '',
    notes: []
  };
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    if (input.mode !== 'vision') {
      const batches: NonNullable<ReturnType<typeof getVideo>>[][] = [];
      for (let index = 0; index < usable.length; index += 60) {
        batches.push(usable.slice(index, index + 60));
      }
      for (let index = 0; index < batches.length; index += 1) {
        onProgress?.({
          stage: 'text',
          done: index,
          total: batches.length,
          message: `文本聚类 ${index + 1}/${batches.length}`
        });
        const response = await adapter.chat({
          system: TEXT_SYSTEM,
          messages: [
            { role: 'user', parts: [{ type: 'text', text: textPrompt(batches[index]!, input.instructions) }] }
          ],
          temperature: 0.2,
          maxTokens: 2400,
          jsonMode: runtime.summary.capabilities.jsonMode,
          imageDetail: 'low',
          timeoutMs: settings.aiTimeoutMs
        });
        inputTokens += response.usage.inputTokens;
        outputTokens += response.usage.outputTokens;
        result = mergeAnalysis(result, parseAnalysis(response.text));
      }
      onProgress?.({ stage: 'text', done: batches.length, total: batches.length, message: '文本聚类完成' });
    }

    if (input.mode !== 'text') {
      const reps = representativeVideos(usable, result.categories.length);
      const extra = shuffle(usable.filter((video) => !reps.includes(video))).slice(0, 2);
      const targets = [...reps, ...extra];
      for (let index = 0; index < targets.length; index += 1) {
        const video = targets[index]!;
        onProgress?.({
          stage: 'vision',
          done: index,
          total: targets.length,
          message: `视觉校验 ${index + 1}/${targets.length}：${video.title}`
        });
        const images = await imagesFor(video.id);
        if (images.length === 0) continue;
        const response = await adapter.chat({
          system: TEXT_SYSTEM,
          messages: [
            {
              role: 'user',
              parts: [{ type: 'text', text: visionPrompt(video, result, input.instructions) }, ...images]
            }
          ],
          temperature: 0.2,
          maxTokens: 3000,
          jsonMode: runtime.summary.capabilities.jsonMode,
          imageDetail: runtime.summary.imageDetail,
          timeoutMs: settings.aiTimeoutMs
        });
        inputTokens += response.usage.inputTokens;
        outputTokens += response.usage.outputTokens;
        result = mergeAnalysis(result, parseAnalysis(response.text));
      }
      onProgress?.({ stage: 'vision', done: targets.length, total: targets.length, message: '视觉校验完成' });
    }

    if (result.categories.length === 0) {
      result.categories = DEFAULT_TAXONOMY.categories.map((category) => ({
        name: category.name,
        description: category.description ?? '',
        tags: category.examples ?? []
      }));
    }
    if (result.focus.length === 0) result.focus = [...DEFAULT_FOCUS];
    if (result.stopwords.length === 0) result.stopwords = [...DEFAULT_TAXONOMY.stopwords];
    if (!result.systemPrompt) result.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (!result.promptTemplate) result.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
    if (!result.summary) result.summary = `共分析 ${usable.length} 条视频。`;

    updateAnalysisRun(analysisId, {
      status: 'done',
      resultJson: JSON.stringify(result),
      inputTokens,
      outputTokens,
      finishedAt: new Date().toISOString()
    });
    onProgress?.({ stage: 'merge', done: 1, total: 1, message: '分析完成' });
    return getAnalysisRun(analysisId)!;
  } catch (error) {
    updateAnalysisRun(analysisId, {
      status: 'failed',
      error: (error as Error).message,
      inputTokens,
      outputTokens,
      finishedAt: new Date().toISOString()
    });
    throw error;
  }
}

export function analysisHistory(): AiAnalysisRun[] {
  return listAnalysisRuns();
}

export function analysisRun(id: number): AiAnalysisRun | null {
  return getAnalysisRun(id);
}

export function saveAnalysisAsProfile(input: {
  runId: number;
  name: string;
  scope: 'global' | 'source';
  sourceId?: number | null;
  isDefault?: boolean;
}): AiTagProfile[] {
  const run = getAnalysisRun(input.runId);
  if (!run?.result) throw new Error('分析结果不存在');
  const result = run.result;
  const categories =
    result.categories.length > 0
      ? result.categories
      : DEFAULT_TAXONOMY.categories.map((category) => ({
          name: category.name,
          description: category.description ?? '',
          tags: category.examples ?? []
        }));
  const profileInput: AiTagProfileInput = {
    name: input.name,
    description: result.summary.slice(0, 200),
    scope: input.scope,
    sourceId: input.scope === 'source' ? (input.sourceId ?? null) : null,
    isDefault: Boolean(input.isDefault),
    focus: result.focus.length > 0 ? result.focus : [...DEFAULT_FOCUS],
    taxonomy: {
      categories: categories.map((category) => ({
        name: category.name,
        description: category.description,
        examples: category.tags
      })),
      stopwords: result.stopwords,
      aliases: result.aliases
    },
    systemPrompt: result.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    promptTemplate: result.promptTemplate || DEFAULT_PROMPT_TEMPLATE,
    maxTags: DEFAULT_MAX_TAGS,
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    language: 'zh-CN',
    useAcrcloud: true,
    useBilibiliTags: true
  };
  return saveProfile(profileInput);
}
