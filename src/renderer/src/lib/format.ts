// 渲染进程统一从 shared 复用格式化逻辑，避免主进程 / 渲染进程两套实现不一致。
export {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatEta,
  formatExact,
  formatRelative,
  formatSpeed,
  shorten,
  resolutionShortSide,
  qualityLabelText,
  resolutionLabel,
  codecLabel
} from '@shared/format';
