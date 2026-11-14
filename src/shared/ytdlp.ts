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
  return { code: 'DOWNLOAD', message: text.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || '下载失败' };
}
