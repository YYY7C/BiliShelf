import path from 'node:path';

// Windows 文件名不允许控制字符
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Windows 安全文件名：清洗非法字符、保留名、结尾空格与点，并限制长度。 */
export function safeSegment(input: string, fallback = 'untitled', maxLength = 80): string {
  let name = String(input ?? '')
    .normalize('NFC')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!name) name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  if (name.length > maxLength) name = name.slice(0, maxLength).trim();
  return name || fallback;
}

/** 校验目标路径确实位于库根目录内，防路径穿越。 */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 把任意绝对路径转成库内相对路径（统一用 / 分隔，便于跨机搬库）。 */
export function toLibraryRelative(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join('/');
}

export function fromLibraryRelative(root: string, relative: string): string {
  return path.join(root, relative.split('/').join(path.sep));
}
