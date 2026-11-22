/**
 * 补档候选打分（纯函数）。
 *
 * 现实约束：B 站收藏夹接口对失效稿件返回的标题就是「已失效视频」，
 * 所以库里大量条目没有可用标题，必须靠 bvid + 时长 + UP 名判断，
 * 标题只能作为加分项，且占位标题必须当作「无标题」处理。
 */

export type MatchTier = 'sure' | 'likely' | 'doubt' | 'reject';

export interface MatchTarget {
  bvid: string;
  title: string | null;
  duration: number | null;
  upName: string | null;
}

export interface MatchCandidate {
  identifier: string;
  /** info.json 里的 bvid：最权威的证据 */
  bvid?: string | null;
  title: string | null;
  duration: number | null;
  uploader: string | null;
  size: number | null;
  /** 来自「按 UP 名检索」：标题不可用时，同 UP + 同长度就是主要证据 */
  fromCreator?: boolean;
}

export interface MatchResult {
  score: number;
  tier: MatchTier;
  /** 人类可读的判据，直接展示在候选列表里 */
  reasons: string[];
}

const PLACEHOLDER_TITLE = /^(已失效(视频)?|已删除(视频)?|稿件不可见|视频已下架|【?已失效】?)$/;

/** B 站对失效稿件会返回占位标题，这种标题不能参与匹配。 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_TITLE.test(trimmed) || /^已失效/.test(trimmed);
}

/** 归一化：全角转半角、小写、去掉 emoji/标点，只保留中日韩文字、字母、数字。 */
export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u{1f000}-\u{1faff}\u{2600}-\u{27bf}]/gu, ' ')
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}a-z0-9]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 拉丁词 + 中文二元组组成的 token 集合。 */
export function tokenize(raw: string | null | undefined): Set<string> {
  const text = normalizeTitle(raw);
  const tokens = new Set<string>();
  if (!text) return tokens;
  for (const segment of text.split(' ')) {
    if (!segment) continue;
    const isCjkOnly = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(segment);
    if (isCjkOnly) {
      if (segment.length === 1) tokens.add(segment);
      for (let index = 0; index + 1 < segment.length; index += 1) {
        tokens.add(segment.slice(index, index + 2));
      }
    } else {
      tokens.add(segment);
    }
  }
  return tokens;
}

/** Jaccard 相似度 0–1。 */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hit = 0;
  for (const token of left) if (right.has(token)) hit += 1;
  return hit / (left.size + right.size - hit);
}

function containsCjk(a: string, b: string): boolean {
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

/**
 * 打分。规则见 docs/rescue.md：
 * - bvid 命中直接 100（identifier 或 info.json 的 id/title 里出现该 BV）
 * - 时长都已知且差 > 30s 直接淘汰（同名不同视频）
 * - 体积很小但时长很长 → 判定为试看片段，淘汰
 * - 通过阈值 60；≥90 确定，70–89 很可能，60–69 存疑
 */
export function scoreCandidate(target: MatchTarget, candidate: MatchCandidate): MatchResult {
  const reasons: string[] = [];
  const bvid = target.bvid.toLowerCase();
  const identifier = candidate.identifier.toLowerCase();
  // info.json 里的 bvid 是最权威的证据；identifier 与标题只是兜底
  if (candidate.bvid && candidate.bvid.toLowerCase() === bvid) {
    return { score: 100, tier: 'sure', reasons: ['info.json 的 bvid 一致'] };
  }
  if (identifier.includes(bvid) || (candidate.title ?? '').toLowerCase().includes(bvid)) {
    return { score: 100, tier: 'sure', reasons: ['identifier 命中 bvid'] };
  }

  const targetDuration = target.duration && target.duration > 0 ? target.duration : null;
  const candidateDuration = candidate.duration && candidate.duration > 0 ? candidate.duration : null;

  if (
    candidate.size != null &&
    candidate.size < 10 * 1024 * 1024 &&
    ((candidateDuration ?? 0) > 300 || (targetDuration ?? 0) > 300)
  ) {
    return { score: 0, tier: 'reject', reasons: [`体积仅 ${Math.round(candidate.size / 1024)}KB，疑似试看片段`] };
  }

  let score = 0;
  if (targetDuration && candidateDuration) {
    const diff = Math.abs(targetDuration - candidateDuration);
    if (diff > 30) {
      return {
        score: 0,
        tier: 'reject',
        reasons: [`时长相差 ${Math.round(diff)}s（>30s）`]
      };
    }
    if (diff <= 2) {
      score += 40;
      reasons.push('时长一致');
    } else if (diff <= 5) {
      score += 25;
      reasons.push(`时长差 ${Math.round(diff)}s`);
    } else {
      score += 8;
      reasons.push(`时长差 ${Math.round(diff)}s`);
    }
  } else {
    reasons.push('时长未知，未计分');
  }

  if (!isPlaceholderTitle(target.title) && !isPlaceholderTitle(candidate.title)) {
    const a = normalizeTitle(target.title);
    const b = normalizeTitle(candidate.title);
    if (a && b) {
      if (a === b) {
        score += 30;
        reasons.push('标题完全一致');
      } else if (containsCjk(a, b)) {
        score += 18;
        reasons.push('标题互相包含');
      } else {
        const ratio = similarity(a, b);
        const gained = Math.round(ratio * 20);
        score += gained;
        reasons.push(`标题相似度 ${(ratio * 100).toFixed(0)}%`);
      }
    }
  } else {
    reasons.push('标题为占位文本，未计分');
  }

  let uploaderMatched = false;
  if (!isPlaceholderTitle(target.upName) && !isPlaceholderTitle(candidate.uploader)) {
    const a = normalizeTitle(target.upName);
    const b = normalizeTitle(candidate.uploader);
    if (a && b) {
      if (a === b) {
        score += 15;
        uploaderMatched = true;
        reasons.push('UP 名一致');
      } else if (a.includes(b) || b.includes(a)) {
        score += 8;
        uploaderMatched = true;
        reasons.push('UP 名包含');
      }
    }
  }

  // 标题不可用时按 UP 名检索，但只有 UP 名也对得上才给补偿分，
  // 否则「同长度」本身太弱，会把不相干的稿件判成候选
  if (candidate.fromCreator && uploaderMatched) {
    score += 20;
    reasons.push('按 UP 名检索命中');
  }

  const capped = Math.min(100, score);
  const tier: MatchTier = capped >= 90 ? 'sure' : capped >= 70 ? 'likely' : capped >= 60 ? 'doubt' : 'reject';
  return { score: capped, tier, reasons };
}

