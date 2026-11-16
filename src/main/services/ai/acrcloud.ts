import { net } from 'electron';
import fs from 'node:fs';
import type { AcrCloudTestResult } from '@shared/types';
import { acrcloudIdentifyEndpoint, buildAcrCloudIdentifyForm } from './acrcloudRequest';
import { countMusicCallsToday, getMusicCache, setMusicCache } from '../../db/ai';
import { getAcrCloudRuntime } from './config';
import { extractAudio, type AudioPosition, type PrepareFrameOptions } from './frames';

export interface MusicIdentifyResult {
  matched: boolean;
  title: string | null;
  artists: string[];
  album: string | null;
  genres: string[];
  releaseDate: string | null;
  score: number | null;
  time: number;
  cached: boolean;
  /** 是否真正向 ACRCloud 发起了识别请求（缓存命中为 false） */
  requested: boolean;
  error?: string;
}

interface AcrCloudResponse {
  status?: { code?: number; msg?: string; version?: string };
  metadata?: {
    music?: Array<{
      title?: string;
      artists?: Array<{ name?: string }>;
      album?: { name?: string };
      genres?: Array<{ name?: string }>;
      release_date?: string;
      score?: number;
    }>;
  };
}

async function callAcrCloud(
  sample: Buffer,
  filename = 'sample.mp3',
  mime = 'audio/mpeg',
  timeoutMs = 30_000
): Promise<AcrCloudResponse> {
  const runtime = getAcrCloudRuntime();
  if (!runtime) throw new Error('ACRCloud 未配置或未启用');
  const timestamp = Math.floor(Date.now() / 1000);
  const form = buildAcrCloudIdentifyForm({
    sample,
    accessKey: runtime.accessKey,
    accessSecret: runtime.accessSecret,
    timestamp,
    filename,
    mime
  });
  const endpoint = acrcloudIdentifyEndpoint(runtime.host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`ACRCloud HTTP ${response.status}：${text.slice(0, 200)}`);
    }
    return JSON.parse(text) as AcrCloudResponse;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('ACRCloud 请求超时', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function identifyMusic(
  videoId: number,
  position: AudioPosition,
  options: PrepareFrameOptions
): Promise<MusicIdentifyResult> {
  const runtime = getAcrCloudRuntime();
  if (!runtime) {
    return {
      matched: false,
      title: null,
      artists: [],
      album: null,
      genres: [],
      releaseDate: null,
      score: null,
      time: 0,
      cached: false,
      requested: false,
      error: 'ACRCloud 未配置或未启用'
    };
  }

  let audio: { absolute: string; hash: string; time: number };
  try {
    audio = await extractAudio(videoId, position, options);
  } catch (error) {
    return {
      matched: false,
      title: null,
      artists: [],
      album: null,
      genres: [],
      releaseDate: null,
      score: null,
      time: 0,
      cached: false,
      requested: false,
      error: (error as Error).message
    };
  }

  const cached = getMusicCache(audio.hash) as MusicIdentifyResult | null;
  if (cached) return { ...cached, cached: true, requested: false };

  try {
    const sample = fs.readFileSync(audio.absolute);
    const response = await callAcrCloud(sample);
    const code = response.status?.code ?? -1;
    if (code === 1001) {
      const result: MusicIdentifyResult = {
        matched: false,
        title: null,
        artists: [],
        album: null,
        genres: [],
        releaseDate: null,
        score: null,
        time: audio.time,
        cached: false,
        requested: true
      };
      setMusicCache(audio.hash, result);
      return result;
    }
    if (code !== 0) {
      return {
        matched: false,
        title: null,
        artists: [],
        album: null,
        genres: [],
        releaseDate: null,
        score: null,
        time: audio.time,
        cached: false,
        requested: true,
        error: `ACRCloud 错误 ${code}：${response.status?.msg ?? '未知错误'}`
      };
    }
    const music = response.metadata?.music?.[0];
    if (!music) {
      const result: MusicIdentifyResult = {
        matched: false,
        title: null,
        artists: [],
        album: null,
        genres: [],
        releaseDate: null,
        score: null,
        time: audio.time,
        cached: false,
        requested: true
      };
      setMusicCache(audio.hash, result);
      return result;
    }
    const result: MusicIdentifyResult = {
      matched: true,
      title: music.title?.trim() || null,
      artists: (music.artists ?? []).map((artist) => artist.name?.trim() ?? '').filter(Boolean),
      album: music.album?.name?.trim() || null,
      genres: (music.genres ?? []).map((genre) => genre.name?.trim() ?? '').filter(Boolean),
      releaseDate: music.release_date?.trim() || null,
      score: Number.isFinite(music.score) ? Number(music.score) : null,
      time: audio.time,
      cached: false,
      requested: true
    };
    setMusicCache(audio.hash, result);
    return result;
  } catch (error) {
    return {
      matched: false,
      title: null,
      artists: [],
      album: null,
      genres: [],
      releaseDate: null,
      score: null,
      time: audio.time,
      cached: false,
      requested: true,
      error: (error as Error).message
    };
  }
}

export function acrCloudCallsToday(): number {
  return countMusicCallsToday();
}

function silentWav(seconds = 3): Buffer {
  const sampleRate = 44100;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = sampleRate * seconds * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export async function testAcrCloud(): Promise<AcrCloudTestResult> {
  const runtime = getAcrCloudRuntime();
  if (!runtime) {
    return {
      ok: false,
      latencyMs: 0,
      status: null,
      message: 'ACRCloud 未配置或未启用',
      code: null
    };
  }
  const started = Date.now();
  try {
    const response = await callAcrCloud(silentWav(), 'sample.wav', 'audio/wav');
    const code = response.status?.code ?? -1;
    if (code === 1001 || code === 0 || code === 2004) {
      return {
        ok: true,
        latencyMs: Date.now() - started,
        status: 200,
        message:
          code === 1001
            ? '鉴权成功（测试样本无匹配结果）'
            : code === 2004
              ? '鉴权成功（测试样本无法生成指纹）'
              : '鉴权成功',
        code
      };
    }
    return {
      ok: false,
      latencyMs: Date.now() - started,
      status: 200,
      message: `ACRCloud 错误 ${code}：${response.status?.msg ?? '未知错误'}`,
      code
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      status: null,
      message: (error as Error).message,
      code: null
    };
  }
}
