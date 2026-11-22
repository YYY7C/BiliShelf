import type { QualityPreset } from './types';

export function formatSelector(quality: QualityPreset): string {
  switch (quality) {
    case '720':
      return 'bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/bv*[height<=720]+ba/b[height<=720]/b';
    case 'best':
      // 最高可用：4K/8K/高帧率都参与选择，分辨率优先
      return 'bv*+ba/b';
    case 'audio':
      return 'ba/b';
    case 'compat':
    default:
      return 'bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/bv*[height<=1080]+ba/b[height<=1080]/b';
  }
}

/**
 * 网络类失败是否值得自动重试。
 * 412 风控（RATE_LIMIT）、无权限（FORBIDDEN）、已下架（NOT_FOUND）、磁盘满（DISK）都不重试。
 */
export function shouldAutoRetry(code: string, attempts: number, limit: number): boolean {
  if (code !== 'DOWNLOAD') return false;
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return attempts < limit;
}

export function mapYtdlpError(stderr: string): { code: string; message: string } {
  const text = stderr || '';
  if (/412|Too Many Requests|请求过于频繁/i.test(text)) {
    return { code: 'RATE_LIMIT', message: '触发平台限流（412）。已停止该任务，请降低并发或稍后再试。' };
  }
  if (/-352|-799|风控|risk/i.test(text)) {
    return { code: 'RATE_LIMIT', message: '触发平台风控。请不要连续重试，稍后再试。' };
  }
  if (/大会员|会员|premium|vip|付费|充电/i.test(text)) {
    return { code: 'FORBIDDEN', message: '当前账号无权限获取该内容（会员/付费/充电专属），已跳过。' };
  }
  if (/不存在|已删除|404|not found|unavailable/i.test(text)) {
    return { code: 'NOT_FOUND', message: '内容不存在或已下架。' };
  }
  if (/ENOSPC|no space/i.test(text)) {
    return { code: 'DISK', message: '磁盘空间不足。' };
  }
  if (/HTTP Error 424|Failed Dependency/i.test(text)) {
    return {
      code: 'DOWNLOAD',
      message: 'CDN 拒绝下载（HTTP 424，常见于 mcdn/P2P 节点或被代理拦截）。可在 设置 → 下载 把「下载代理」改为直连后重试。'
    };
  }
  if (/mcdn|Read timed out|ConnectionReset|Connection aborted|UNEXPECTED_EOF|RemoteDisconnected/i.test(text)) {
    return {
      code: 'DOWNLOAD',
      message: 'CDN 连接中断（多见于 mcdn/P2P 节点或代理问题）。建议把 设置 → 下载 的「下载代理」改为直连，或稍后重试。'
    };
  }
  if (/more expected|read, \d+ more/i.test(text)) {
    return { code: 'DOWNLOAD', message: '下载被中断（连接提前关闭），可重试；若持续出现请改用直连。' };
  }
  return { code: 'DOWNLOAD', message: text.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || '下载失败' };
}
