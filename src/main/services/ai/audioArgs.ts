export function audioExtractArgs(video: string, time: number, output: string): string[] {
  return [
    '-ss',
    String(time),
    '-i',
    video,
    '-t',
    '15',
    '-vn',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-b:a',
    '128k',
    '-f',
    'mp3',
    '-y',
    output
  ];
}
