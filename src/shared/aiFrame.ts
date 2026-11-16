function roundTime(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 均匀取帧：避开片头片尾，短于 6 秒的视频取中点。 */
export function planFrameTimes(duration: number | null | undefined, count: number): number[] {
  const total = Number(duration);
  const amount = Math.min(8, Math.max(0, Math.round(count)));
  if (!Number.isFinite(total) || total <= 0 || amount === 0) return [];
  if (total <= 6) return [roundTime(total / 2)];
  const start = Math.max(1, total * 0.15);
  const end = Math.min(total - 1, total * 0.85);
  if (end <= start) return [roundTime(total / 2)];
  if (amount === 1) return [roundTime((start + end) / 2)];
  const step = (end - start) / (amount - 1);
  const times: number[] = [];
  for (let index = 0; index < amount; index += 1) {
    const time = roundTime(start + step * index);
    if (!times.includes(time)) times.push(time);
  }
  return times;
}
