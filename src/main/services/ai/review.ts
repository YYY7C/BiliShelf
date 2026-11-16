import type {
  AiReviewDecision,
  AiReviewItem,
  AiReviewResult,
  AiReviewTagAdd,
  AiReviewTagPatch,
  AiReviewTagRemove,
  AiReviewTagRestore,
  AiReviewUnapproveInput
} from '@shared/types';
import {
  addRunTag,
  approveTags,
  rejectTags,
  removeRunTag,
  restoreRunTag,
  unapproveTag,
  updateRunTag
} from '../../db/ai';
import { refreshVideoFts } from '../../db/videos';
import { writeSidecar } from '../library';

async function afterVideoChange(videoIds: number[]): Promise<void> {
  for (const videoId of new Set(videoIds)) {
    try {
      refreshVideoFts(videoId);
      await writeSidecar(videoId);
    } catch {
      // 单个 sidecar 失败不应阻塞审核结果
    }
  }
}

export async function approveReview(decision: AiReviewDecision): Promise<AiReviewResult> {
  const result = approveTags(decision);
  await afterVideoChange(result.videoIds);
  return result;
}

export async function rejectReview(decision: AiReviewDecision): Promise<AiReviewResult> {
  return rejectTags(decision);
}

export async function updateReviewTag(patch: AiReviewTagPatch): Promise<AiReviewItem | null> {
  const item = updateRunTag(patch);
  if (item) await afterVideoChange([item.videoId]);
  return item;
}

export async function addReviewTag(input: AiReviewTagAdd): Promise<AiReviewItem | null> {
  const item = addRunTag(input);
  if (item) await afterVideoChange([item.videoId]);
  return item;
}

export async function removeReviewTag(input: AiReviewTagRemove): Promise<AiReviewItem | null> {
  const item = removeRunTag(input.tagId);
  if (item) await afterVideoChange([item.videoId]);
  return item;
}

export async function restoreReviewTag(input: AiReviewTagRestore): Promise<AiReviewItem | null> {
  return restoreRunTag(input.tagId);
}

export async function unapproveReviewTag(input: AiReviewUnapproveInput): Promise<AiReviewResult> {
  const result = unapproveTag(input.videoId, input.name, input.category);
  await afterVideoChange([result.videoId]);
  return { approved: 0, rejected: 0, affectedVideos: 1, videoIds: [result.videoId] };
}
