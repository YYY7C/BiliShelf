import fs from 'node:fs';
import log from 'electron-log/main';
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
  DEFAULT_TAXONOMY,
  MAX_ANALYSIS_CATEGORIES,
  MAX_ANALYSIS_SAMPLES,
  MIN_SAMPLES_PER_GROUP
} from '@shared/aiDefaults';
import { all } from '../../db/index';
import {
  createAnalysisRun,
  getAnalysisRun,
  listAnalysisRuns,
  saveProfile,
  updateAnalysisRun
} from '../../db/ai';
import { getVideo, getVideos } from '../../db/videos';
import { getSettings } from '../../store';
import { fromLibraryRelative, libraryPaths } from '../../paths';
import { getProviderRuntime } from './config';
import {
  AiChatError,
  createAdapter,
  type AiChatRequest,
  type AiChatResponse,
  type AiContentPart,
  type AiProviderAdapter
} from './providers';
import { prepareFrames } from './frames';
import { planStratified } from './analysisSample';
import { TOKENS_PER_SAMPLE, MAX_VISION_TARGETS, VISION_RANDOM_EXTRA, textBatchSize } from './analysisBudget';
import { parseAnalysis, pruneMergedAnalysis, type ParsedAnalysis } from './analysisParse';

/**
 * 模型输出只当启发式数据处理：字段缺失、类型不对、字符串过长都就地修正，
 * 见 analysisParse.ts 的 sanitizeAnalysis。
 */
const TEXT_SYSTEM =
  '你是视频素材库的策展人，擅长从标题、UP 主、简介和原始标签中归纳主题与标签体系。只输出 JSON。';

/**
 * 分析要输出一整套 JSON（summary + 分类 + 标签 + 提示词），比逐视频打标长得多。
 * 推理模型还会先消耗一段 reasoning tokens：实测 deepseek-v4.1-flash 在 50 条样本下
 * 需要约 2.8k tokens（推理 1.1k + 正文 1.7k），但同一提示词也可能推理到 5k 以上，
 * 原来固定 2400 必然把额度全烧在推理上。文本聚类只有一次调用、产出最长，直接给 16k；
 * 视觉校验单条产出较短，8k 起步；两者失败时都还能继续加倍。
 */
const ANALYSIS_TEXT_TOKENS = 16000;
const ANALYSIS_VISION_TOKENS = 12000;
const ANALYSIS_TOKEN_CEILING = 32000;
const ANALYSIS_ATTEMPTS = 3;

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

interface SamplePlan {
  ids: number[];
  /** 分层采样时的分组数；随机/手动为 0 */
  groups: number;
  /** 每个分组的保底条数 */
  perGroup: number;
  /** 用户设置的采样数量 */
  requested: number;
  /** 为了满足保底，样本数被自动提升过 */
  expanded: boolean;
}

function planSample(input: AiAnalysisInput): SamplePlan {
  const requested = clamp(input.sampleSize, 1, MAX_ANALYSIS_SAMPLES, 24);
  const manual = uniqueIds(input.videoIds);
  if (manual.length > 0) {
    return {
      ids: manual.slice(0, MAX_ANALYSIS_SAMPLES),
      groups: 0,
      perGroup: 0,
      requested,
      expanded: false
    };
  }
  const rows = all<{ id: number; source_id: number | null; up_mid: number | null }>(
    "SELECT id, source_id, up_mid FROM videos WHERE status = 'present' ORDER BY created_at DESC"
  );
  if (rows.length === 0) {
    return { ids: [], groups: 0, perGroup: 0, requested, expanded: false };
  }
  if (input.sampleMode === 'random' || requested >= rows.length) {
    return {
      ids: shuffle(rows)
        .slice(0, requested)
        .map((row) => row.id),
      groups: 0,
      perGroup: 0,
      requested,
      expanded: false
    };
  }

  const key = input.sampleMode === 'up' ? 'up_mid' : 'source_id';
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const groupKey = String(row[key] ?? 'unknown');
    const bucket = grouped.get(groupKey);
    if (bucket) bucket.push(row.id);
    else grouped.set(groupKey, [row.id]);
  }
  const buckets = shuffle(Array.from(grouped.values()).map((ids) => shuffle(ids)));
  const plan = planStratified(buckets, requested);
  return {
    ids: plan.ids,
    groups: buckets.length,
    perGroup: plan.perGroup,
    requested,
    expanded: plan.expanded
  };
}

function samplesFor(input: AiAnalysisInput): {
  samples: AiAnalysisSample[];
  videos: ReturnType<typeof getVideo>[];
} {
  const plan = planSample(input);
  const videos: ReturnType<typeof getVideo>[] = getVideos(plan.ids);
  const samples: AiAnalysisSample[] = [];
  for (const video of videos) {
    if (!video) continue;
    samples.push({ videoId: video.id, title: video.title, coverUrl: video.thumbUrl ?? video.coverUrl });
  }
  return { samples, videos };
}

export function estimateAnalysis(input: AiAnalysisInput): AiAnalysisEstimate {
  const plan = planSample(input);
  const count = plan.ids.length;
  const runtime = input.providerId ? getProviderRuntime(input.providerId) : null;
  const batchSize = textBatchSize(runtime?.summary.contextWindow);
  const textRequests = input.mode === 'vision' ? 0 : Math.ceil(count / batchSize);
  // 视觉模式的分类体系为空，代表视频按默认分类数取；文本/混合用「分类数 ≈ 样本数/3」估算，
  // 但分类合并后最多 12 个（prune 上限），估算也要跟着封顶，否则大样本会高估请求数
  const categoryGuess =
    input.mode === 'vision'
      ? DEFAULT_TAXONOMY.categories.length
      : Math.min(MAX_ANALYSIS_CATEGORIES, Math.max(2, Math.ceil(count / 3)));
  const visionRequests =
    input.mode === 'text'
      ? 0
      : Math.min(MAX_VISION_TARGETS - VISION_RANDOM_EXTRA, categoryGuess) + VISION_RANDOM_EXTRA;
  const imageCount = visionRequests * 2;
  const approxInputTokens = textRequests * 400 + count * TOKENS_PER_SAMPLE + imageCount * 800;
  const warnings: string[] = [];
  if (count === 0) warnings.push('当前没有可分析的已下载视频');
  if (plan.expanded) {
    const label = input.sampleMode === 'up' ? 'UP 主' : '来源';
    warnings.push(
      `按${label}保底 ${plan.perGroup} 条，样本已从 ${plan.requested} 提升到 ${count} 条（共 ${plan.groups} 组）`
    );
  }
  if (plan.groups > 0 && plan.perGroup < MIN_SAMPLES_PER_GROUP) {
    warnings.push(
      `分组有 ${plan.groups} 个、样本上限 ${MAX_ANALYSIS_SAMPLES} 条，只能给每组 ${plan.perGroup} 条`
    );
  }
  if (input.mode !== 'text' && count > 60) warnings.push('视觉分析只选取代表视频，不会逐条发送全部视频');
  if (count >= MAX_ANALYSIS_SAMPLES) warnings.push(`样本上限为 ${MAX_ANALYSIS_SAMPLES} 条`);
  if (input.mode !== 'text' && visionRequests >= 8) {
    const concurrency = Math.max(1, Math.min(10, getSettings().aiConcurrency || 1));
    const minutes = Math.max(1, Math.round((visionRequests / concurrency) * 1.5));
    warnings.push(
      `视觉校验约 ${visionRequests} 次请求（并发 ${concurrency}，预计 ${minutes} 分钟）；只想快速看结构可先用「仅文本」`
    );
  }
  return {
    videos: count,
    requests: textRequests + visionRequests,
    imageCount,
    approxInputTokens,
    approxOutputTokens: 3000,
    warnings
  };
}

interface JsonCallResult<T> {
  value: T;
  inputTokens: number;
  outputTokens: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 跳过项要写进结果备注，避免把整段 400 响应或 zod 明细塞进结果 */
function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const single = message.replace(/\s+/g, ' ').trim();
  return single.length > 200 ? `${single.slice(0, 200)}…` : single;
}

/**
 * 发送一次 JSON 请求，失败时按策略重试：
 * - 输出被截断 / 正文为空 → 翻倍输出预算（并同步放宽超时）
 * - JSON 本身解析不了（模型跑了题）→ 原样重试一次
 * 同时把原始响应片段写进日志，避免只留下“没有返回合法 JSON”这种无法排查的错误。
 */
async function chatJson<T>(
  adapter: AiProviderAdapter,
  request: AiChatRequest,
  parse: (raw: string) => T,
  label: string,
  fallbackBudget: number
): Promise<JsonCallResult<T>> {
  let budget = request.maxTokens;
  const initialBudget = budget;
  let lastBudget = budget;
  let lastError: unknown = null;
  let inputTokens = 0;
  let outputTokens = 0;
  // 超时往往是并发排队 + 推理太长导致，重试时直接给更多墙钟时间，而不是削减输出
  let timeoutFactor = 1;

  for (let attempt = 0; attempt < ANALYSIS_ATTEMPTS; attempt += 1) {
    lastBudget = budget;
    // 输出预算越大生成越慢；分析又是多图长任务，给一个不低于 180s 的下限，避免必然超时
    const baseTimeout = Math.max(request.timeoutMs, 180_000);
    const timeoutMs = Math.round(Math.min(600_000, baseTimeout * timeoutFactor * (budget / initialBudget)));
    let response: AiChatResponse;
    try {
      response = await adapter.chat({ ...request, maxTokens: budget, timeoutMs });
    } catch (error) {
      lastError = error;
      const message = (error as Error).message ?? String(error);
      log.warn(
        '[ai] analysis request failed',
        label,
        `attempt=${attempt + 1}`,
        `maxTokens=${budget}`,
        message
      );
      const kind = error instanceof AiChatError ? error.kind : 'http';
      const retryable = error instanceof AiChatError ? error.retryable : false;
      if (!retryable) throw error;
      if (kind === 'truncated') {
        // 预算撞满但返回了正文：加倍再试
        budget = Math.min(ANALYSIS_TOKEN_CEILING, budget * 2);
      } else if (kind === 'timeout') {
        // 超时：给更多时间再试，预算保持不变
        timeoutFactor *= 1.5;
      } else if (kind === 'http') {
        if (/max_tokens|max_completion_tokens|too large|exceed/i.test(message)) {
          // 网关明确拒绝过大的 max_tokens：退回 Provider 配置值
          budget = Math.min(budget, fallbackBudget);
        } else {
          budget = Math.min(ANALYSIS_TOKEN_CEILING, budget * 2);
        }
      }
      // empty：保持预算，加倍只会更慢
      // 高并发下 429 很常见，重试前退避，避免把所有泳道一起打满
      if (attempt + 1 < ANALYSIS_ATTEMPTS) await sleep(700 * 2 ** attempt);
      continue;
    }

    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;

    try {
      return { value: parse(response.text), inputTokens, outputTokens };
    } catch (error) {
      lastError = error;
      const truncated = response.finishReason === 'length';
      log.warn(
        '[ai] analysis json invalid',
        label,
        `attempt=${attempt + 1}`,
        `maxTokens=${budget}`,
        `finish=${response.finishReason ?? 'unknown'}`,
        `chars=${response.text.length}`,
        `reason=${(error as Error).message}`,
        `head=${JSON.stringify(response.text.slice(0, 160))}`,
        `tail=${JSON.stringify(response.text.slice(-160))}`
      );
      // 只有截断才值得加大预算；模型跑题时加大预算只会更慢
      if (truncated) budget = Math.min(ANALYSIS_TOKEN_CEILING, budget * 2);
      if (attempt + 1 < ANALYSIS_ATTEMPTS) await sleep(700 * 2 ** attempt);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `分析失败：${detail}（已尝试 ${ANALYSIS_ATTEMPTS} 次，最后一次输出上限 ${lastBudget} tokens）。` +
      '可减少采样数量、改用非推理模型，或在「模型与工具」里提高该 Provider 的输出上限。'
  );
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
  const intro = (video.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `- ${video.title} | UP:${video.upName ?? '未知'} | 来源:${video.sourceName ?? '未知'} | 时长:${duration} | 标签:${video.tags.join('、') || '无'} | 简介:${intro || '无'}`;
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
  categories: number,
  max: number
): NonNullable<ReturnType<typeof getVideo>>[] {
  const limit = Math.min(max, Math.max(2, categories || 6));
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
  // 库级分析只需要判断「这类内容长什么样」，封面 + 1 帧足够；3 张图会让单次视觉请求经常跑超时
  const frames = await prepareFrames(videoId, {
    count: 1,
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
  let succeeded = 0;
  let lastError: unknown = null;
  const skipped: string[] = [];
  const fallbackBudget = Math.min(
    ANALYSIS_TOKEN_CEILING,
    Math.max(128, runtime.summary.maxTokens || ANALYSIS_VISION_TOKENS)
  );

  try {
    if (input.mode !== 'vision') {
      const batchSize = textBatchSize(runtime.summary.contextWindow);
      const batches: NonNullable<ReturnType<typeof getVideo>>[][] = [];
      for (let index = 0; index < usable.length; index += batchSize) {
        batches.push(usable.slice(index, index + batchSize));
      }
      // 文本批之间互不依赖，按并发开泳道；1000 条样本也不会排成一条长队
      const textLanes = Math.max(1, Math.min(settings.aiConcurrency || 1, batches.length, 6));
      let nextBatch = 0;
      let doneBatch = 0;

      const runBatch = async (index: number): Promise<void> => {
        const label = `text ${index + 1}/${batches.length}`;
        onProgress?.({
          stage: 'text',
          done: doneBatch,
          total: batches.length,
          message: `文本聚类 ${doneBatch + 1}/${batches.length}`
        });
        try {
          const call = await chatJson(
            adapter,
            {
              system: TEXT_SYSTEM,
              messages: [
                {
                  role: 'user',
                  parts: [{ type: 'text', text: textPrompt(batches[index]!, input.instructions) }]
                }
              ],
              temperature: 0.2,
              maxTokens: ANALYSIS_TEXT_TOKENS,
              jsonMode: runtime.summary.capabilities.jsonMode,
              imageDetail: 'low',
              reasoningEffort: runtime.summary.reasoningEffort,
              timeoutMs: settings.aiTimeoutMs
            },
            parseAnalysis,
            label,
            fallbackBudget
          );
          inputTokens += call.inputTokens;
          outputTokens += call.outputTokens;
          succeeded += 1;
          result = mergeAnalysis(result, call.value);
        } catch (error) {
          lastError = error;
          skipped.push(`文本聚类 ${index + 1}：${shortError(error)}`);
          log.warn('[ai] text batch skipped', index + 1, (error as Error).message);
        }
        doneBatch += 1;
        onProgress?.({
          stage: 'text',
          done: doneBatch,
          total: batches.length,
          message: `文本聚类 ${doneBatch}/${batches.length} 完成`
        });
      };

      const textLane = async (): Promise<void> => {
        for (;;) {
          const index = nextBatch;
          nextBatch += 1;
          if (index >= batches.length) return;
          await runBatch(index);
        }
      };

      await Promise.all(Array.from({ length: textLanes }, () => textLane()));
      onProgress?.({
        stage: 'text',
        done: batches.length,
        total: batches.length,
        message: skipped.length > 0 ? `文本聚类完成（${skipped.length} 批失败）` : '文本聚类完成'
      });
    }

    if (input.mode !== 'text') {
      const reps = representativeVideos(
        usable,
        result.categories.length,
        MAX_VISION_TARGETS - VISION_RANDOM_EXTRA
      );
      const extra = shuffle(usable.filter((video) => !reps.includes(video))).slice(0, VISION_RANDOM_EXTRA);
      const targets = [...reps, ...extra];
      // 单个视觉请求要带 2 张图，串行跑十来个会拖到十几分钟；按「AI 并发数」开泳道（上限 10）
      const lanes = Math.max(1, Math.min(10, settings.aiConcurrency || 1, targets.length));
      let nextIndex = 0;
      let doneCount = 0;

      const runVision = async (index: number): Promise<void> => {
        const video = targets[index]!;
        onProgress?.({
          stage: 'vision',
          done: doneCount,
          total: targets.length,
          message: `视觉校验 ${index + 1}/${targets.length}：${video.title}`
        });
        const images = await imagesFor(video.id);
        if (images.length > 0) {
          try {
            const call = await chatJson(
              adapter,
              {
                system: TEXT_SYSTEM,
                messages: [
                  {
                    role: 'user',
                    parts: [
                      { type: 'text', text: visionPrompt(video, result, input.instructions) },
                      ...images
                    ]
                  }
                ],
                temperature: 0.2,
                maxTokens: ANALYSIS_VISION_TOKENS,
                jsonMode: runtime.summary.capabilities.jsonMode,
                imageDetail: runtime.summary.imageDetail,
                reasoningEffort: runtime.summary.reasoningEffort,
                timeoutMs: settings.aiTimeoutMs
              },
              parseAnalysis,
              `vision ${index + 1}/${targets.length}`,
              fallbackBudget
            );
            inputTokens += call.inputTokens;
            outputTokens += call.outputTokens;
            succeeded += 1;
            result = mergeAnalysis(result, call.value);
          } catch (error) {
            lastError = error;
            skipped.push(`视觉校验「${video.title}」：${shortError(error)}`);
            log.warn('[ai] vision call skipped', video.id, (error as Error).message);
          }
        }
        doneCount += 1;
        onProgress?.({
          stage: 'vision',
          done: doneCount,
          total: targets.length,
          message: `视觉校验 ${doneCount}/${targets.length} 完成`
        });
      };

      const lane = async (): Promise<void> => {
        for (;;) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= targets.length) return;
          await runVision(index);
        }
      };

      await Promise.all(Array.from({ length: lanes }, () => lane()));
      onProgress?.({
        stage: 'vision',
        done: targets.length,
        total: targets.length,
        message: skipped.length > 0 ? `视觉校验完成（${skipped.length} 项失败）` : '视觉校验完成'
      });
    }

    // 一次都没成功时整轮无意义，抛出最后一次错误让运行记录显示失败原因
    if (succeeded === 0 && lastError) throw lastError;
    if (skipped.length > 0) result.notes = [...result.notes, ...skipped].slice(0, 20);

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
    result = pruneMergedAnalysis(result);

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
