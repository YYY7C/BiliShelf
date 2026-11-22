import { describe, expect, it } from 'vitest';
import {
  downloadUrl,
  parseItemResponse,
  parseSearchResponse,
  pickAssets,
  readInfoJson
} from './archiveOrg';

describe('parseSearchResponse', () => {
  it('reads docs from advancedsearch output', () => {
    const docs = parseSearchResponse({
      response: {
        numFound: 2,
        docs: [
          { identifier: 'BiliBili-BV1xx411c7mD', title: '标题 A', item_size: '123456' },
          { identifier: 'BiliBili-BV1yy411c7mE', title: ['标题 B'], item_size: 0 }
        ]
      }
    });
    expect(docs).toEqual([
      { identifier: 'BiliBili-BV1xx411c7mD', title: '标题 A', itemSize: 123456 },
      { identifier: 'BiliBili-BV1yy411c7mE', title: '标题 B', itemSize: null }
    ]);
  });

  it('tolerates empty or malformed payloads', () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ response: { docs: [null, {}, { identifier: 1 }] } })).toEqual([]);
  });
});

describe('parseItemResponse', () => {
  it('normalizes string sizes and keeps md5', () => {
    const item = parseItemResponse('BiliBili-BV1xx411c7mD', {
      server: 'ia801234.us.archive.org',
      dir: '/12/items/BiliBili-BV1xx411c7mD',
      metadata: { title: '示例标题' },
      files: [
        { name: 'video.mp4', size: '1048576', md5: 'abc', format: 'h.264' },
        { name: 'video.info.json', size: '2048' }
      ]
    });
    expect(item).not.toBeNull();
    expect(item!.title).toBe('示例标题');
    expect(item!.files[0]).toMatchObject({ name: 'video.mp4', size: 1048576, md5: 'abc' });
  });

  it('returns null when there is no file list', () => {
    expect(parseItemResponse('x', {})).toBeNull();
    expect(parseItemResponse('x', null)).toBeNull();
  });
});

describe('pickAssets', () => {
  const item = {
    identifier: 'BiliBili-BV1xx411c7mD',
    title: 't',
    server: null,
    dir: null,
    files: [
      { name: 'BV1xx_p1.jpg', size: 110_700, md5: null, format: 'JPEG', source: 'original' },
      { name: 'BV1xx_p1.ia.mp4', size: 25_888_487, md5: null, format: 'h.264 IA', source: 'original' },
      { name: 'BV1xx_p1.mp4', size: 52_512_680, md5: null, format: 'MPEG4', source: 'original' },
      { name: 'BV1xx_p1.info.json', size: 85_326, md5: null, format: 'JSON', source: 'original' },
      { name: 'BV1xx_p1-弹幕.ass', size: 975_443, md5: null, format: 'Unknown', source: 'original' },
      { name: 'BV1xx_p1-弹幕.pb', size: 735_655, md5: null, format: 'Unknown', source: 'original' }
    ]
  };

  it('picks the original mp4 and skips the .ia.mp4 derivative', () => {
    const assets = pickAssets(item);
    expect(assets.video?.name).toBe('BV1xx_p1.mp4');
    expect(assets.infoJson?.name).toBe('BV1xx_p1.info.json');
    expect(assets.cover?.name).toBe('BV1xx_p1.jpg');
    expect(assets.danmaku?.name).toBe('BV1xx_p1-弹幕.pb');
    expect(assets.subtitle?.name).toBe('BV1xx_p1-弹幕.ass');
  });

  it('prefers original source over a larger derivative', () => {
    const assets = pickAssets({
      ...item,
      files: [
        { name: 'conv.mp4', size: 10, md5: null, format: 'MPEG4', source: 'derivative' },
        { name: 'orig.mp4', size: 5, md5: null, format: 'MPEG4', source: 'original' }
      ]
    });
    expect(assets.video?.name).toBe('orig.mp4');
  });

  it('returns nulls for an empty item', () => {
    const assets = pickAssets({ identifier: 'x', title: null, server: null, dir: null, files: [] });
    expect(assets).toEqual({ video: null, infoJson: null, cover: null, danmaku: null, subtitle: null });
  });
});

describe('downloadUrl', () => {
  it('encodes each path segment but keeps slashes', () => {
    expect(downloadUrl('BiliBili-BV1xx', 'sub dir/video 1.mp4')).toBe(
      'https://archive.org/download/BiliBili-BV1xx/sub%20dir/video%201.mp4'
    );
  });
});

describe('readInfoJson', () => {
  it('reads yt-dlp style info.json', () => {
    expect(
      readInfoJson({ id: 'BV1xx411c7mD', title: 'T', duration: 61.4, uploader: 'UP', upload_date: '20240102' })
    ).toEqual({
      bvid: 'BV1xx411c7mD',
      title: 'T',
      duration: 61.4,
      uploader: 'UP',
      uploadDate: '20240102',
      paid: false
    });
  });

  it('reads the bilibili view payload and repairs mojibake', () => {
    // 「示例歌手」被按 latin1 存成了 utf8 字节
    const mojibake = Buffer.from('示例歌手', 'utf8').toString('latin1');
    const info = readInfoJson({
      code: 0,
      data: {
        View: {
          bvid: 'BV1Hf4y1L7MF',
          title: Buffer.from('夏虫', 'utf8').toString('latin1'),
          duration: 260,
          owner: { name: mojibake },
          rights: { pay: 0 },
          is_upower_exclusive: false
        }
      }
    });
    expect(info).toEqual({
      bvid: 'BV1Hf4y1L7MF',
      title: '夏虫',
      duration: 260,
      uploader: '示例歌手',
      uploadDate: null,
      paid: false
    });
  });

  it('flags supporter-only / paid originals', () => {
    const paid = readInfoJson({ data: { View: { bvid: 'BV1', rights: { pay: 1 } } } });
    expect(paid.paid).toBe(true);
    const exclusive = readInfoJson({ data: { View: { bvid: 'BV1', is_upower_exclusive: true } } });
    expect(exclusive.paid).toBe(true);
  });

  it('falls back to channel and ignores invalid numbers', () => {
    expect(readInfoJson({ channel: 'C', duration: 'abc' })).toMatchObject({
      bvid: null,
      duration: null,
      uploader: 'C',
      paid: false
    });
  });
});
