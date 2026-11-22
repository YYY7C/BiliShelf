import crypto from 'node:crypto';
import type { AiTagProfile, VideoItem } from '@shared/types';
import { OUTPUT_SCHEMA_JSON } from '@shared/aiDefaults';
import type { StoredAiFrame } from './frames';

export interface PromptVideo {
  title: string;
  upName: string | null;
  description: string | null;
  duration: number | null;
  sourceName: string | null;
  tags: string[];
}

export interface RenderedPrompt {
  system: string;
  user: string;
  hash: string;
}

let musicKeywords: string[] = [];

/** 由 qualityRules 从素材库的 ai-quality.json 读入；为空时不会主动提示调用音乐识别 */
export function setMusicKeywords(list: string[]): void {
  musicKeywords = list;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '未知';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatTaxonomy(profile: AiTagProfile): string {
  return profile.taxonomy.categories
    .map((category) => {
      const examples = category.examples?.length ? ` 示例：${category.examples.join('、')}` : '';
      return `- ${category.name}：${category.description || '无描述'}${examples}`;
    })
    .join('\n');
}

export function buildBgmHint(video: PromptVideo): string {
  const haystack = [video.title, video.description ?? '', ...(video.tags ?? [])].join(' ');
  const matched = musicKeywords.filter((keyword) => keyword && haystack.includes(keyword));
  const quoted = Array.from(haystack.matchAll(/《([^》]{1,60})》/g))
    .map((match) => match[1]?.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (matched.length > 0 || quoted.length > 0) {
    const hints = [
      matched.length > 0 ? `命中音乐线索：${Array.from(new Set(matched)).slice(0, 6).join('、')}` : '',
      quoted.length > 0 ? `标题/标签中的曲名候选：${quoted.join('、')}` : ''
    ]
      .filter(Boolean)
      .join('；');
    return `${hints}。建议调用 identify_music 确认 BGM；如果工具无结果，不要编造曲名。`;
  }
  return '未发现明显的音乐/舞蹈线索；如果画面明显是音乐、舞蹈、演奏、翻唱或 MV，可以调用 identify_music，否则不要调用。';
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match;
  });
}

export function renderPrompt(
  profile: AiTagProfile,
  video: PromptVideo,
  frames: StoredAiFrame[]
): RenderedPrompt {
  const timestamps = frames
    .map((frame) => (frame.index === -1 ? '封面' : formatDuration(frame.time)))
    .join(' / ');
  const values: Record<string, string> = {
    title: video.title || '未知',
    upName: video.upName || '未知',
    duration: formatDuration(video.duration),
    sourceName: video.sourceName || '未知',
    description: (video.description || '').trim().slice(0, 1200) || '无',
    originalTags: video.tags.length > 0 ? video.tags.join('、') : '无',
    bgmHint: buildBgmHint(video),
    focus: profile.focus.length > 0 ? profile.focus.join('、') : '无',
    taxonomy: formatTaxonomy(profile),
    maxTags: String(profile.maxTags),
    minConfidence: String(profile.minConfidence),
    language: profile.language,
    frameTimestamps: timestamps || '无',
    schema: OUTPUT_SCHEMA_JSON
  };
  const user = renderTemplate(profile.promptTemplate, values);
  const system = renderTemplate(profile.systemPrompt, values);
  const hash = crypto
    .createHash('sha1')
    .update(system)
    .update('\n---\n')
    .update(user)
    .update('\n---\n')
    .update(profile.id ? String(profile.id) : profile.name)
    .update('\n---\n')
    .update(frames.map((frame) => `${frame.index}:${frame.time}`).join(','))
    .digest('hex');
  return { system, user, hash };
}

export function promptForVideo(video: VideoItem): PromptVideo {
  return {
    title: video.title,
    upName: video.upName,
    description: video.description,
    duration: video.duration,
    sourceName: video.sourceName,
    tags: video.tags
  };
}
