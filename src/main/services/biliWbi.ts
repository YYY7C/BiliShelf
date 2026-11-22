import crypto from 'node:crypto';

/**
 * B 站 WBI 签名。
 *
 * `/x/space/wbi/arc/search` 这类接口要求 wts + w_rid：
 * 1) 从 `/x/web-interface/nav` 的 wbi_img 里取出 img_key / sub_key（URL 文件名）；
 * 2) 按固定表重排拼接后取前 32 位作为 mixin key；
 * 3) 参数按 key 排序、去掉 !'()* 后拼成 query，w_rid = md5(query + mixinKey)。
 */
const MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20,
  34, 44, 52
];

export function mixinKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`;
  return MIXIN_KEY_TABLE.map((index) => raw[index] ?? '').join('').slice(0, 32);
}

function fileNameKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const last = value.split('/').pop() ?? '';
  const base = last.split('.')[0] ?? '';
  return base || null;
}

export function extractWbiKeys(nav: unknown): { imgKey: string; subKey: string } | null {
  const img = nav as { data?: { wbi_img?: { img_url?: unknown; sub_url?: unknown } } } | null | undefined;
  const imgKey = fileNameKey(img?.data?.wbi_img?.img_url);
  const subKey = fileNameKey(img?.data?.wbi_img?.sub_url);
  if (!imgKey || !subKey) return null;
  return { imgKey, subKey };
}

function encodeValue(value: string | number): string {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ''));
}

export function signWbiQuery(params: Record<string, string | number>, key: string, wts: number): string {
  const entries = Object.entries({ ...params, wts })
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = entries.map(([name, value]) => `${encodeURIComponent(name)}=${encodeValue(value)}`).join('&');
  const wRid = crypto.createHash('md5').update(`${query}${key}`).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

interface CachedKey {
  key: string;
  at: number;
}

let cache: CachedKey | null = null;

/** 清空缓存：签名失败或切换账号后调用，下一次请求会重新取 key。 */
export function resetWbiKeyCache(): void {
  cache = null;
}

/**
 * 取 mixin key，默认缓存 30 分钟。
 * `fetchNav` 由调用方提供，便于复用带 Cookie 的会话与测试注入。
 */
export async function getWbiKey(fetchNav: () => Promise<unknown>, ttlMs = 30 * 60_000): Promise<string> {
  if (cache && Date.now() - cache.at < ttlMs) return cache.key;
  const nav = await fetchNav();
  const keys = extractWbiKeys(nav);
  if (!keys) throw new Error('读取 WBI 密钥失败（nav 接口没有返回 wbi_img）');
  const key = mixinKey(keys.imgKey, keys.subKey);
  cache = { key, at: Date.now() };
  return key;
}
