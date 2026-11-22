/**
 * 订阅的「时长区间」（秒）。
 * 只对 UP 主投稿生效，且 duration 未知（接口没返回/为 0）的条目视为不限，
 * 否则一次接口缺字段就会把整份清单过滤空。
 */
export interface DurationRange {
  /** null 表示不限 */
  min: number | null;
  /** null 表示不限 */
  max: number | null;
}

export const UNLIMITED_RANGE: DurationRange = { min: null, max: null };

function toSeconds(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  const seconds = Math.round(value);
  return seconds > 0 ? seconds : null;
}

/** 兜底规整：负数/NaN 当不限；min > max 时交换，避免用户手滑后永远匹配不到。 */
export function normalizeRange(
  min: number | null | undefined,
  max: number | null | undefined
): DurationRange {
  const low = toSeconds(min);
  const high = toSeconds(max);
  if (low != null && high != null && low > high) return { min: high, max: low };
  return { min: low, max: high };
}

export function isRangeEmpty(range: DurationRange): boolean {
  return range.min == null && range.max == null;
}

/** 时长未知（null / 0 / 负数）一律视为通过。 */
export function isWithinRange(duration: number | null | undefined, range: DurationRange): boolean {
  if (isRangeEmpty(range)) return true;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return true;
  if (range.min != null && duration < range.min) return false;
  if (range.max != null && duration > range.max) return false;
  return true;
}

/** 给界面展示的一句话，例如 `1:00–10:00`、`≥1:00`、`≤10:00`、`不限`。 */
export function describeRange(range: DurationRange): string {
  const { min, max } = range;
  if (min == null && max == null) return '不限';
  if (min != null && max != null) return `${formatSeconds(min)}–${formatSeconds(max)}`;
  if (min != null) return `≥${formatSeconds(min)}`;
  return `≤${formatSeconds(max as number)}`;
}

/** 秒 → `m:ss` / `h:mm:ss`。 */
export function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.round(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
