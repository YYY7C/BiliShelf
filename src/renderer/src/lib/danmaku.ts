export interface ParsedDanmaku {
  text: string;
  time: number;
  mode: 'rtl' | 'top' | 'bottom';
  style: {
    fontSize: string;
    color: string;
    textShadow: string;
  };
}

const SHADOW = '-1px -1px #000, -1px 1px #000, 1px -1px #000, 1px 1px #000';

/** 解析 B 站弹幕 XML：<d p="时间,模式,字号,颜色,...">文本</d> */
export function parseBilibiliDanmaku(xml: string): ParsedDanmaku[] {
  if (!xml || !xml.includes('<d ')) return [];
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const nodes = Array.from(doc.querySelectorAll('d'));
  const result: ParsedDanmaku[] = [];

  for (const node of nodes) {
    const raw = node.getAttribute('p') ?? '';
    const [timeRaw, modeRaw, sizeRaw, colorRaw] = raw.split(',');
    const time = Number(timeRaw);
    const mode = Number(modeRaw);
    if (!Number.isFinite(time) || mode < 1 || mode > 5) continue;
    const text = (node.textContent ?? '').trim();
    if (!text) continue;

    const color = Number(colorRaw) || 0xffffff;
    result.push({
      text,
      time,
      mode: mode === 4 ? 'bottom' : mode === 5 ? 'top' : 'rtl',
      style: {
        fontSize: `${Number(sizeRaw) || 25}px`,
        color: `#${color.toString(16).padStart(6, '0')}`,
        textShadow: SHADOW
      }
    });
  }

  return result;
}
