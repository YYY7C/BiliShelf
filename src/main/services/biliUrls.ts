import type { SourceKind } from '@shared/types';

/**
 * 可订阅的 B 站来源目标。
 * 这里的形态与数据库里 sources.remote_id 的规范写法一一对应，
 * 目的是让「同一个 UP / 同一个合集」无论用哪种链接粘贴进来都落到同一行。
 */
export type BiliTarget =
  | { kind: 'space'; mid: number }
  | { kind: 'season'; mid: number; sid: number }
  | { kind: 'series'; mid: number; sid: number }
  | { kind: 'medialist'; mediaId: number }
  | { kind: 'favorite'; mediaId: number; ownerMid: number | null }
  | { kind: 'short'; url: string };

export type ParseOutcome = { ok: true; target: BiliTarget } | { ok: false; error: string };

const SPACE_HOSTS = new Set(['space.bilibili.com', 'm.bilibili.com', 'www.bilibili.com', 'bilibili.com']);
const SHORT_HOSTS = new Set(['b23.tv', 'bili2233.cn']);

function positiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeInput(raw: string): string {
  // 去掉零宽字符与首尾空白，用户从地址栏复制时常带 \u200b
  return raw.replace(/[\u200b-\u200d\ufeff]/g, '').trim();
}

function withScheme(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (/^\/\//.test(input)) return `https:${input}`;
  return `https://${input}`;
}

/** 纯数字输入按 UID 处理；`uid:123` / `mid:123` 也接受。 */
function bareId(input: string): number | null {
  const direct = positiveInt(input);
  if (direct) return direct;
  const tagged = input.match(/^(?:uid|mid)\s*[:：=]\s*(\d+)$/i);
  return tagged ? positiveInt(tagged[1]) : null;
}

function fromSpace(host: string, url: URL): ParseOutcome {
  const segments = url.pathname.split('/').filter(Boolean);
  // 移动端是 m.bilibili.com/space/<mid>
  if (segments[0] === 'space') segments.shift();
  if (segments[0]?.toLowerCase() === 'video') {
    return {
      ok: false,
      error: '这是单个视频链接；订阅请填写 UP 主 UID / 空间链接 / 合集链接，单个视频请用素材导入或直接下载'
    };
  }
  const mid = positiveInt(segments[0]);

  if (!mid) {
    if (host === 'www.bilibili.com' || host === 'bilibili.com') {
      return { ok: false, error: '看起来不是空间链接：请填写 UP 主 UID 或 space.bilibili.com/UID' };
    }
    return { ok: false, error: '链接里缺少 UP 主 UID' };
  }

  const rest = segments.slice(1);

  // /channel/collectiondetail?sid=  or  /channel/seriesdetail?sid=
  const channel = rest[0] === 'channel' ? rest[1]?.toLowerCase() : null;
  if (channel === 'collectiondetail' || channel === 'seriesdetail') {
    const sid = positiveInt(url.searchParams.get('sid'));
    if (!sid) {
      return { ok: false, error: `${channel === 'collectiondetail' ? '合集' : '系列'}链接缺少 sid 参数` };
    }
    return {
      ok: true,
      target: channel === 'collectiondetail' ? { kind: 'season', mid, sid } : { kind: 'series', mid, sid }
    };
  }

  // /lists/<sid>?type=season|series
  if (rest[0] === 'lists') {
    const sid = positiveInt(rest[1] ?? url.searchParams.get('sid'));
    if (!sid) return { ok: false, error: '列表链接缺少 sid 参数' };
    const type = (url.searchParams.get('type') ?? 'season').toLowerCase();
    return {
      ok: true,
      target: type === 'series' ? { kind: 'series', mid, sid } : { kind: 'season', mid, sid }
    };
  }

  if (rest[0] === 'favlist') {
    const fid = positiveInt(url.searchParams.get('fid'));
    if (!fid) return { ok: false, error: '收藏夹链接缺少 fid 参数' };
    return { ok: true, target: { kind: 'favorite', mediaId: fid, ownerMid: mid } };
  }

  return { ok: true, target: { kind: 'space', mid } };
}

function fromWeb(host: string, url: URL): ParseOutcome {
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());

  if (segments[0] === 'medialist' && segments[1] === 'detail') {
    const match = (segments[2] ?? '').match(/^ml(\d+)$/);
    const mediaId = positiveInt(match?.[1]);
    if (!mediaId) return { ok: false, error: '视频列表链接格式不对，应为 medialist/detail/ml<数字>' };
    return { ok: true, target: { kind: 'medialist', mediaId } };
  }

  if (segments[0] === 'list') {
    const match = (segments[1] ?? '').match(/^ml(\d+)$/);
    const mediaId = positiveInt(match?.[1]);
    if (!mediaId) return { ok: false, error: '视频列表链接格式不对，应为 /list/ml<数字>' };
    return { ok: true, target: { kind: 'medialist', mediaId } };
  }

  if (segments[0] === 'video') {
    return {
      ok: false,
      error: '这是单个视频链接；订阅请填写 UP 主 UID / 空间链接 / 合集链接，单个视频请用素材导入或直接下载'
    };
  }

  if (host === 'space.bilibili.com' || host === 'm.bilibili.com') {
    return fromSpace(host, url);
  }

  return { ok: false, error: '暂不支持这个链接，请粘贴 UP 主空间、合集/系列或视频列表链接' };
}

/**
 * 解析用户输入。同步返回；短链（b23.tv）返回 kind=short 由上层发请求跟随跳转后再解析。
 */
export function parseBiliInput(raw: string): ParseOutcome {
  const input = normalizeInput(raw);
  if (!input) return { ok: false, error: '请输入 UP 主 UID、空间链接或合集链接' };

  const uid = bareId(input);
  if (uid) return { ok: true, target: { kind: 'space', mid: uid } };

  let url: URL;
  try {
    url = new URL(withScheme(input));
  } catch {
    return { ok: false, error: '无法识别的链接格式' };
  }

  const host = url.hostname.toLowerCase();
  // 纯数字/省略 scheme 的输入会被 URL 解析成 IP，这里直接给出可读提示
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return { ok: false, error: '无法识别的链接格式：请粘贴完整的 B 站链接（含 https://）或 UP 主 UID' };
  }
  if (SHORT_HOSTS.has(host)) {
    return { ok: true, target: { kind: 'short', url: url.toString() } };
  }
  if (host === 'space.bilibili.com' || host === 'm.bilibili.com') {
    return fromSpace(host, url);
  }
  // bilibili.com/space/<mid> 也当作空间链接
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments[0] === 'space') {
    return fromSpace(host, url);
  }
  if (SPACE_HOSTS.has(host)) {
    return fromWeb(host, url);
  }
  return { ok: false, error: `不支持的站点：${host}。请粘贴 B 站链接` };
}

/** sources.remote_id 的规范写法。 */
export function targetKey(target: BiliTarget): string {
  switch (target.kind) {
    case 'space':
      return `mid:${target.mid}`;
    case 'season':
      return `season:${target.mid}:${target.sid}`;
    case 'series':
      return `series:${target.mid}:${target.sid}`;
    case 'medialist':
      return `medialist:${target.mediaId}`;
    case 'favorite':
      return String(target.mediaId);
    case 'short':
      return target.url;
  }
}

/** 「在 B 站打开」使用的规范 URL。 */
export function targetUrl(target: BiliTarget): string | null {
  switch (target.kind) {
    case 'space':
      return `https://space.bilibili.com/${target.mid}/video`;
    case 'season':
      return `https://space.bilibili.com/${target.mid}/channel/collectiondetail?sid=${target.sid}`;
    case 'series':
      return `https://space.bilibili.com/${target.mid}/channel/seriesdetail?sid=${target.sid}`;
    case 'medialist':
      return `https://www.bilibili.com/medialist/detail/ml${target.mediaId}`;
    case 'favorite':
      return target.ownerMid
        ? `https://space.bilibili.com/${target.ownerMid}/favlist?fid=${target.mediaId}`
        : `https://www.bilibili.com/medialist/detail/ml${target.mediaId}`;
    case 'short':
      return target.url;
  }
}

/**
 * 把库里已存的 remote_id 还原成目标。
 * 兼容旧数据：space / collection 早期直接把整条 URL 存进了 remote_id。
 */
export function parseStoredTarget(kind: SourceKind, remoteId: string): BiliTarget | null {
  const value = normalizeInput(remoteId);
  if (!value) return null;

  if (kind === 'favorite') {
    const mediaId = positiveInt(value);
    return mediaId ? { kind: 'favorite', mediaId, ownerMid: null } : null;
  }
  if (kind === 'watch_later' || kind === 'manual') return null;

  const space = value.match(/^mid:(\d+)$/);
  if (space) return { kind: 'space', mid: Number(space[1]) };

  const season = value.match(/^season:(\d+):(\d+)$/);
  if (season) return { kind: 'season', mid: Number(season[1]), sid: Number(season[2]) };

  const series = value.match(/^series:(\d+):(\d+)$/);
  if (series) return { kind: 'series', mid: Number(series[1]), sid: Number(series[2]) };

  const medialist = value.match(/^medialist:(\d+)$/);
  if (medialist) return { kind: 'medialist', mediaId: Number(medialist[1]) };

  const parsed = parseBiliInput(value);
  if (!parsed.ok || parsed.target.kind === 'short' || parsed.target.kind === 'favorite') return null;
  return parsed.target;
}

/** 给来源列表展示用的一句话说明。 */
export function describeTarget(target: BiliTarget | null, kind: SourceKind): string {
  if (!target) return kind === 'watch_later' ? '当前账号的稍后再看' : '手动来源';
  switch (target.kind) {
    case 'space':
      return `UP 投稿 · UID ${target.mid}`;
    case 'season':
      return `合集 · SID ${target.sid}`;
    case 'series':
      return `系列 · SID ${target.sid}`;
    case 'medialist':
      return `视频列表 · ML ${target.mediaId}`;
    case 'favorite':
      return `收藏夹 · ID ${target.mediaId}`;
    case 'short':
      return '短链';
  }
}
