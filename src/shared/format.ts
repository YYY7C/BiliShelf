export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : digits)} ${units[index]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** 列表角标用的紧凑数字：12345 → 1.2 万 */
export function formatCount(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '0';
  if (value < 10000) return String(value);
  const wan = value / 10000;
  if (wan < 100) return `${wan.toFixed(1).replace(/\.0$/, '')} 万`;
  return `${Math.round(wan)} 万`;
}

/** 完整数字，用于 title 提示 */
export function formatExact(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('zh-CN');
}

export function formatEta(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m ${secs}s`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(iso)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '从未';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(iso);
}

export function shorten(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 竖屏视频用短边作为画质档位，避免 1080×1920 被标成 1920P。 */
export function resolutionShortSide(width: number | null | undefined, height: number | null | undefined): number | null {
  if (!height || !Number.isFinite(height) || height <= 0) return null;
  if (!width || !Number.isFinite(width) || width <= 0) return Math.round(height);
  return Math.round(Math.min(width, height));
}

export function qualityLabelText(
  width: number | null | undefined,
  height: number | null | undefined
): string | null {
  const short = resolutionShortSide(width, height);
  if (!short) return null;
  if (short >= 2160) return '4K';
  if (short >= 1440) return '2K';
  if (short >= 1080) return '1080P';
  if (short >= 720) return '720P';
  return `${short}P`;
}

export function resolutionLabel(
  width: number | null | undefined,
  height: number | null | undefined
): string {
  const label = qualityLabelText(width, height);
  if (!label) return '—';
  const vertical = Boolean(width && height && height > width);
  return vertical ? `${label} · 竖屏` : label;
}

export function codecLabel(vcodec: string | null): string {
  if (!vcodec) return '—';
  const value = vcodec.toLowerCase();
  if (value.includes('avc') || value.includes('h264')) return 'H.264';
  if (value.includes('hevc') || value.includes('h265') || value.includes('hev1') || value.includes('hvc1')) {
    return 'H.265';
  }
  if (value.includes('av1') || value.includes('av01')) return 'AV1';
  if (value.includes('vp9') || value.includes('vp09')) return 'VP9';
  return vcodec.toUpperCase();
}
