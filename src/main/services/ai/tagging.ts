import fs from 'node:fs';
import log from 'electron-log/main';
import type {
  AiEnqueueInput,
  AiEnqueueResult,
  AiProgress,
  AiQueueSnapshot,
  AiRunDetail,
  AiTagProfile
} from '@shared/types';
import { getSettings } from '../../store';
import {
  batchSnapshot,
  createBatch,
  createRun,
  getEffectiveProfile,
  getNextQueuedRun,
  getProfile,
  getRun,
  recomputeRunReviewStatus,
  recoverInterruptedRuns,
  replaceRunTags,
  requeueFailedRuns,
  updateBatch,
  updateRun
} from '../../db/ai';
import { getVideo, queryVideoIds } from '../../db/videos';
import { all, one, run } from '../../db/index';
import { fromLibraryRelative, libraryPaths } from '../../paths';
import {
  getAcrCloudRuntime,
  getDefaultProvider,
  getProviderRuntime,
  hasConsentForHosts,
  hostOf,
  isLocalHost,
  rememberConsentHosts
} from './config';
import { identifyMusic } from './acrcloud';
import { prepareFrames, type PrepareFrameOptions, type StoredAiFrame } from './frames';
import { normalizeResult, parseAiResult } from './normalize';
import { promptForVideo, renderPrompt } from './prompt';
import {
  AiChatError,
  createAdapter,
  type AiChatRequest,
  type AiChatResponse,
  type AiContentPart,
  type AiMessage,
  type AiToolDefinition
} from './providers';

function now(): string {
  return new Date().toISOString();
}

/**
 * 逐视频打标的输出上限：模型常给每个标签写一段 evidence，
 * 2000 tokens 的输出很容易被截断成半句 JSON。截断时按阶梯放大重试。
 */
const TAG_TOKEN_CEILING = 16000;
const TAG_TRUNCATION_RETRIES = 2;

/** 自动重跑失败项前的等待时间，避免网关限流时立刻再撞一次 */
const AUTO_RETRY_DELAY_MS = 5000;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms)
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function uniqueIds(ids: number[] | undefined): number[] {
  return Array.from(new Set((ids ?? []).filter((id) => Number.isFinite(id) && id > 0)));
}

function musicTool(): AiToolDefinition {
  return {
    name: 'identify_music',
    description:
      '识别视频中某一段的背景音乐。仅在视频明显是音乐、舞蹈、演奏、翻唱、MV，或需要确认 BGM 时调用；普通视频不要调用。可对不同时间段最多调用 3 次。',
    parameters: {
      type: 'object',
      properties: {
        position: {
          type: 'string',
          enum: ['start', 'middle', 'end'],
          description: '采样位置'
        }
      },
      required: ['position']
    }
  };
}

export class AiTaggingManager {
  private queueListeners = new Set<(snapshot: AiQueueSnapshot) => void>();
  private progressListeners = new Set<(progress: AiProgress) => void>();
  private reviewListeners = new Set<() => void>();
  private controllers = new Map<number, AbortController>();
  private active = new Set<number>();
  private pumping = false;
  private started = false;
  private stopping = false;
  private queueTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  onQueue(listener: (snapshot: AiQueueSnapshot) => void): () => void {
    this.queueListeners.add(listener);
    return () => this.queueListeners.delete(listener);
  }

  onProgress(listener: (progress: AiProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  onReviewChanged(listener: () => void): () => void {
    this.reviewListeners.add(listener);
    return () => this.reviewListeners.delete(listener);
  }

  snapshot(): AiQueueSnapshot {
    return batchSnapshot();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const recovered = recoverInterruptedRuns();
    if (recovered > 0) log.info('[ai] recovered interrupted runs', recovered);
    this.emitQueue();
    this.pump();
  }

  shutdown(): void {
    this.stopping = true;
    for (const [runId, controller] of this.controllers) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
      try {
        updateRun(runId, { status: 'queued', stage: null, startedAt: null });
      } catch {
        // ignore
      }
    }
    this.controllers.clear();
    this.active.clear();
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  enqueue(input: AiEnqueueInput): AiEnqueueResult {
    const provider = getDefaultProvider();
    if (!provider) throw new Error('请先在「模型与工具」中配置一个 VLM Provider');
    const hasHeaderAuth = provider.headerKeys.some((key) => /authorization|api[-_]?key|token/i.test(key));
    if (!provider.hasApiKey && !hasHeaderAuth && !isLocalHost(hostOf(provider.baseUrl))) {
      throw new Error('当前 Provider 未配置 API Key 或鉴权请求头');
    }
    const profile = this.resolveProfile(input);
    const consent = this.consentPreview(input);
    if (consent.required) {
      throw new Error(`需要先确认上传到：${consent.hosts.join('、')}`);
    }
    const ids = this.resolveVideoIds(input);
    if (ids.length === 0) return { batchId: 0, queued: 0, skipped: 0 };

    let queued = 0;
    let skipped = 0;
    const runnable: number[] = [];
    for (const videoId of ids) {
      if (this.hasActiveRun(videoId, profile.id)) {
        skipped += 1;
        continue;
      }
      if (!input.force && this.hasDoneRun(videoId, profile.id)) {
        skipped += 1;
        continue;
      }
      runnable.push(videoId);
    }
    if (runnable.length === 0) {
      this.emitQueue();
      return { batchId: 0, queued: 0, skipped };
    }

    const batchId = createBatch({
      profileId: profile.id,
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
      scope: input.scope ?? { type: input.videoIds?.length ? 'selection' : 'all' },
      total: runnable.length
    });
    for (const videoId of runnable) {
      createRun({
        batchId,
        videoId,
        profileId: profile.id,
        providerId: provider.id,
        providerName: provider.name,
        protocol: provider.protocol,
        model: provider.model
      });
      queued += 1;
    }
    this.emitQueue();
    this.pump();
    return { batchId, queued, skipped };
  }

  pause(batchId: number): void {
    updateBatch(batchId, { status: 'paused' });
    this.emitQueue();
  }

  resume(batchId: number): void {
    updateBatch(batchId, { status: 'queued' });
    this.emitQueue();
    this.pump();
  }

  cancel(batchId: number): void {
    updateBatch(batchId, { status: 'canceled', finishedAt: now() });
    run("UPDATE ai_runs SET status = 'canceled', finished_at = ? WHERE batch_id = ? AND status = 'queued'", [
      now(),
      batchId
    ]);
    const running = all<{ id: number }>("SELECT id FROM ai_runs WHERE batch_id = ? AND status = 'running'", [
      batchId
    ]);
    for (const row of running) {
      this.controllers.get(row.id)?.abort();
    }
    this.emitQueue();
    this.pump();
  }

  retryFailed(batchId: number): void {
    run(
      `UPDATE ai_runs SET status = 'queued', stage = NULL, error = NULL, finished_at = NULL
        WHERE batch_id = ? AND status = 'failed'`,
      [batchId]
    );
    updateBatch(batchId, { status: 'queued', finishedAt: null });
    this.emitQueue();
    this.pump();
  }

  consentHosts(providerId: string | null | undefined, profile: AiTagProfile): string[] {
    const runtime = getProviderRuntime(providerId);
    const hosts: string[] = [];
    if (runtime) {
      const host = hostOf(runtime.summary.baseUrl);
      if (host && !isLocalHost(host)) hosts.push(host);
    }
    if (profile.useAcrcloud) {
      const acrcloud = getAcrCloudRuntime();
      if (acrcloud?.host) {
        const acrHost = /^https?:\/\//i.test(acrcloud.host)
          ? hostOf(acrcloud.host)
          : acrcloud.host.split(':')[0];
        if (acrHost && !isLocalHost(acrHost)) hosts.push(acrHost);
      }
    }
    return Array.from(new Set(hosts));
  }

  needsConsent(providerId: string | null | undefined, profile: AiTagProfile): boolean {
    const hosts = this.consentHosts(providerId, profile);
    return hosts.length > 0 && !hasConsentForHosts(hosts);
  }

  rememberConsent(providerId: string | null | undefined, profile: AiTagProfile): void {
    rememberConsentHosts(this.consentHosts(providerId, profile));
  }

  consentPreview(input: AiEnqueueInput): { hosts: string[]; required: boolean } {
    const provider = getDefaultProvider();
    if (!provider) return { hosts: [], required: false };
    const profile = this.resolveProfile(input);
    const hosts = this.consentHosts(provider.id, profile);
    return { hosts, required: hosts.length > 0 && !hasConsentForHosts(hosts) };
  }

  private resolveProfile(input: AiEnqueueInput): AiTagProfile {
    if (input.profileId) {
      const profile = getProfile(input.profileId);
      if (!profile) throw new Error('标签方案不存在');
      return profile;
    }
    const sourceId = input.scope?.sourceId ?? input.scope?.filter?.sourceId ?? null;
    return getEffectiveProfile(sourceId);
  }

  private resolveVideoIds(input: AiEnqueueInput): number[] {
    let ids = uniqueIds(input.videoIds);
    if (ids.length === 0) {
      const scope = input.scope ?? { type: 'all' as const };
      if (scope.type === 'source' && scope.sourceId) {
        ids = queryVideoIds({ status: 'present', sourceId: scope.sourceId });
      } else if (scope.type === 'filter') {
        ids = queryVideoIds({ ...(scope.filter ?? {}), status: scope.filter?.status ?? 'present' });
      } else {
        ids = queryVideoIds({ status: 'present' });
      }
    }
    if (input.limit && input.limit > 0) ids = ids.slice(0, input.limit);
    return ids;
  }

  private hasActiveRun(videoId: number, profileId: number): boolean {
    return Boolean(
      one<{ id: number }>(
        `SELECT id FROM ai_runs WHERE video_id = ? AND profile_id IS ? AND status IN ('queued','running') LIMIT 1`,
        [videoId, profileId]
      )
    );
  }

  private hasDoneRun(videoId: number, profileId: number): boolean {
    return Boolean(
      one<{ id: number }>(
        `SELECT id FROM ai_runs WHERE video_id = ? AND profile_id IS ? AND status = 'done' LIMIT 1`,
        [videoId, profileId]
      )
    );
  }

  private pump(): void {
    if (this.pumping || this.stopping) return;
    this.pumping = true;
    try {
      const settings = getSettings();
      const limit = Math.min(10, Math.max(1, settings.aiConcurrency));
      while (this.active.size < limit) {
        const row = getNextQueuedRun();
        if (!row) break;
        const controller = new AbortController();
        this.controllers.set(row.id, controller);
        this.active.add(row.id);
        updateRun(row.id, { status: 'running', stage: 'frames', startedAt: now(), error: null });
        updateBatch(row.batch_id ?? 0, { status: 'running', startedAt: now() });
        this.emitQueue();
        void this.runOne(row.id, controller.signal)
          .catch((error: unknown) => {
            log.warn('[ai] run failed', row.id, (error as Error).message);
          })
          .finally(() => {
            this.controllers.delete(row.id);
            this.active.delete(row.id);
            if (row.batch_id) this.refreshBatchStatus(row.batch_id);
            this.emitQueue();
            this.emitReviewChanged();
            this.pump();
          });
      }
    } finally {
      this.pumping = false;
    }
  }

  private async runOne(runId: number, signal: AbortSignal): Promise<void> {
    const run = getRun(runId);
    if (!run) return;
    const video = getVideo(run.videoId);
    if (!video) throw new Error('视频不存在');
    const profile = run.profileId ? getProfile(run.profileId) : getEffectiveProfile(video.sourceId);
    if (!profile) throw new Error('标签方案不存在');
    const providerRuntime = getProviderRuntime(run.providerId) ?? getProviderRuntime();
    if (!providerRuntime) throw new Error('Provider 不存在或已删除');
    const adapter = createAdapter(providerRuntime);
    const settings = getSettings();
    const options: PrepareFrameOptions = {
      count: settings.aiFrameCount,
      width: settings.aiFrameWidth,
      includeCover: settings.aiIncludeCover
    };
    const toolRounds = Math.min(5, Math.max(0, settings.aiMaxToolRounds));
    const maxRetries = Math.min(5, Math.max(0, settings.aiMaxRetries));
    let frames: StoredAiFrame[];
    let usage = { inputTokens: 0, outputTokens: 0 };
    let toolCalls: AiRunDetail['toolCalls'] = [];
    let modelRequests = run.requestCount ?? 0;
    let musicRequests = run.musicRequestCount ?? 0;

    try {
      this.emitProgress(run, 'frames', 0, 1);
      frames = await prepareFrames(video.id, options);
      if (signal.aborted) throw new Error('已取消');
      updateRun(runId, { framesJson: JSON.stringify(frames), stage: 'request' });
      this.emitProgress(run, 'request', 1, 1);

      const promptVideo = promptForVideo(video);
      if (!profile.useBilibiliTags) promptVideo.tags = [];
      const prompt = renderPrompt(profile, promptVideo, frames);
      updateRun(runId, {
        promptHash: prompt.hash,
        systemPrompt: prompt.system,
        userPrompt: prompt.user
      });

      const images: AiContentPart[] = frames.flatMap((frame) => {
        const absolute = fromLibraryRelative(libraryPaths().root, frame.path);
        try {
          const data = fs.readFileSync(absolute).toString('base64');
          return [{ type: 'image' as const, mime: 'image/jpeg', data }];
        } catch {
          return [];
        }
      });
      if (images.length === 0) throw new Error('没有可用的抽帧图片');

      const tools =
        profile.useAcrcloud && providerRuntime.summary.capabilities.tools && getAcrCloudRuntime()
          ? [musicTool()]
          : [];
      const messages: AiMessage[] = [
        {
          role: 'user',
          parts: [{ type: 'text', text: prompt.user }, ...images]
        }
      ];

      let finalText = '';
      let musicCalls = 0;
      for (let round = 0; round <= toolRounds; round += 1) {
        if (signal.aborted) throw new Error('已取消');
        if (settings.aiRequestDelayMs > 0) await wait(settings.aiRequestDelayMs, signal);
        const response = await this.chatWithRetry(
          adapter,
          {
            system: prompt.system,
            messages,
            tools,
            temperature: providerRuntime.summary.temperature,
            maxTokens: providerRuntime.summary.maxTokens,
            jsonMode: providerRuntime.summary.capabilities.jsonMode,
            imageDetail: providerRuntime.summary.imageDetail,
            reasoningEffort: providerRuntime.summary.reasoningEffort,
            timeoutMs: settings.aiTimeoutMs,
            signal
          },
          maxRetries,
          signal,
          () => {
            modelRequests += 1;
            updateRun(runId, { requestCount: modelRequests });
          }
        );
        usage = {
          inputTokens: usage.inputTokens + response.usage.inputTokens,
          outputTokens: usage.outputTokens + response.usage.outputTokens
        };
        if (response.toolCalls.length === 0) {
          finalText = response.text;
          break;
        }
        if (round >= toolRounds) {
          finalText = response.text;
          break;
        }
        messages.push({
          role: 'assistant',
          parts: response.toolCalls.map((call): AiContentPart => ({
            type: 'tool_call',
            id: call.id,
            name: call.name,
            args: call.args
          }))
        });
        const results: AiContentPart[] = [];
        for (const call of response.toolCalls) {
          if (call.name === 'identify_music' && musicCalls < 3) {
            musicCalls += 1;
            const positionValue = String(call.args['position'] ?? 'middle');
            const position = positionValue === 'start' || positionValue === 'end' ? positionValue : 'middle';
            updateRun(runId, { stage: 'tools', toolCallsJson: JSON.stringify(toolCalls) });
            this.emitProgress(run, 'tools', 1, 1);
            const result = await identifyMusic(video.id, position, options);
            if (result.requested) {
              musicRequests += 1;
              updateRun(runId, { musicRequestCount: musicRequests });
            }
            toolCalls = [
              ...toolCalls,
              { id: call.id, name: call.name, args: call.args, result, error: result.error }
            ];
            results.push({ type: 'tool_result', id: call.id, name: call.name, result });
          } else {
            const result = { error: '工具不可用或调用次数已达上限' };
            toolCalls = [
              ...toolCalls,
              { id: call.id, name: call.name, args: call.args, result, error: result.error }
            ];
            results.push({ type: 'tool_result', id: call.id, name: call.name, result });
          }
        }
        updateRun(runId, { toolCallsJson: JSON.stringify(toolCalls) });
        messages.push({ role: 'tool', parts: results });
      }

      if (!finalText.trim() && tools.length > 0) {
        const finalResponse = await this.chatWithRetry(
          adapter,
          {
            system: prompt.system,
            messages: [
              ...messages,
              {
                role: 'user',
                parts: [{ type: 'text', text: '请基于以上信息输出最终 JSON，不要调用工具。' }]
              }
            ],
            tools: [],
            temperature: providerRuntime.summary.temperature,
            maxTokens: providerRuntime.summary.maxTokens,
            jsonMode: providerRuntime.summary.capabilities.jsonMode,
            imageDetail: providerRuntime.summary.imageDetail,
            reasoningEffort: providerRuntime.summary.reasoningEffort,
            timeoutMs: settings.aiTimeoutMs,
            signal
          },
          maxRetries,
          signal,
          () => {
            modelRequests += 1;
            updateRun(runId, { requestCount: modelRequests });
          }
        );
        usage = {
          inputTokens: usage.inputTokens + finalResponse.usage.inputTokens,
          outputTokens: usage.outputTokens + finalResponse.usage.outputTokens
        };
        finalText = finalResponse.text;
      }

      if (!finalText.trim()) throw new Error('模型没有返回可解析的内容');
      updateRun(runId, {
        stage: 'parse',
        rawResponse: finalText,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens
      });
      this.emitProgress(run, 'parse', 1, 1);

      const parsed = parseAiResult(finalText);
      const normalized = normalizeResult(parsed, profile);
      replaceRunTags(runId, video.id, profile.id, normalized.tags);
      updateRun(runId, {
        status: 'done',
        stage: 'done',
        resultJson: JSON.stringify(normalized),
        rawResponse: finalText,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        requestCount: modelRequests,
        musicRequestCount: musicRequests,
        toolCallsJson: JSON.stringify(toolCalls),
        finishedAt: now()
      });
      recomputeRunReviewStatus(runId);
      this.emitProgress(run, 'done', 1, 1);
      this.emitReviewChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.stopping) {
        updateRun(runId, { status: 'queued', stage: null, startedAt: null });
      } else if (signal.aborted || message === '已取消') {
        updateRun(runId, { status: 'canceled', error: '已取消', finishedAt: now() });
      } else {
        updateRun(runId, {
          status: 'failed',
          error: message,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          requestCount: modelRequests,
          musicRequestCount: musicRequests,
          toolCallsJson: JSON.stringify(toolCalls),
          finishedAt: now()
        });
        log.warn('[ai] run error', runId, message);
      }
      throw error;
    }
  }

  private async chatWithRetry(
    adapter: ReturnType<typeof createAdapter>,
    request: AiChatRequest,
    retries: number,
    signal: AbortSignal,
    onRequest?: () => void
  ): Promise<AiChatResponse> {
    let lastError: unknown = null;
    let budget = request.maxTokens;
    let truncations = 0;
    let attempt = 0;
    while (attempt <= retries) {
      try {
        onRequest?.();
        const response = await adapter.chat({ ...request, maxTokens: budget });
        // finish_reason=length：正文被切在半句，JSON 必然不完整，放大预算重来
        if (response.finishReason === 'length' && response.toolCalls.length === 0) {
          if (truncations < TAG_TRUNCATION_RETRIES && budget < TAG_TOKEN_CEILING) {
            truncations += 1;
            budget = Math.min(TAG_TOKEN_CEILING, budget * 2);
            log.warn('[ai] 输出被截断，放大 max_tokens 重试', request.maxTokens, '→', budget);
            continue;
          }
        }
        return response;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof AiChatError ? error.retryable : false;
        if (!retryable || attempt >= retries || signal.aborted) break;
        attempt += 1;
        await wait(800 * 2 ** attempt, signal);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private refreshBatchStatus(batchId: number): void {
    const row = one<{
      total: number;
      done: number;
      failed: number;
      active: number;
      canceled: number;
    }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled
         FROM ai_runs WHERE batch_id = ?`,
      [batchId]
    );
    if (!row || row.total === 0) return;
    if (row.active > 0) {
      updateBatch(batchId, { status: 'running' });
      return;
    }
    // 还有失败项时先按设置自动重跑，重试用完才收尾
    const autoRetry = Math.min(5, Math.max(0, getSettings().aiAutoRetry));
    const requeued = row.failed > 0 ? requeueFailedRuns(batchId, autoRetry) : 0;
    if (requeued > 0) {
      updateBatch(batchId, { status: 'running', finishedAt: null });
      log.info('[ai] 自动重跑失败项', batchId, requeued);
      this.scheduleAutoRetry();
      return;
    }
    const status = row.canceled === row.total ? 'canceled' : 'done';
    updateBatch(batchId, { status, finishedAt: now() });
  }

  /** 自动重跑前留一点间隔，避免网关限流时立刻再撞一次 */
  private scheduleAutoRetry(): void {
    if (this.retryTimer || this.stopping) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.emitQueue();
      this.pump();
    }, AUTO_RETRY_DELAY_MS);
  }

  private emitQueue(): void {
    if (this.queueTimer) return;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      const snapshot = batchSnapshot();
      for (const listener of this.queueListeners) {
        try {
          listener(snapshot);
        } catch {
          // ignore listener errors
        }
      }
    }, 300);
  }

  private emitProgress(
    run: { id: number; batchId: number | null; videoId: number },
    stage: AiProgress['stage'],
    done: number,
    total: number
  ): void {
    const title = getVideo(run.videoId)?.title ?? '';
    const progress: AiProgress = {
      batchId: run.batchId ?? 0,
      runId: run.id,
      videoId: run.videoId,
      title,
      stage,
      done,
      total
    };
    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch {
        // ignore
      }
    }
  }

  private emitReviewChanged(): void {
    for (const listener of this.reviewListeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }
}

export const aiTaggingManager = new AiTaggingManager();
