/**
 * 比较用的归一化键：去首尾空白、把连续空白折叠成一个空格、转小写。
 *
 * 标签名与 BGM 名称会在「模型解析」和「写库/查重」两层各自比较，
 * 只要求两边用的是同一个函数，否则同一个标签会因为多一个空格而存成两条。
 */
export function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
