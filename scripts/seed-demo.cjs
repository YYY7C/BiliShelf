/* 本地联调用：生成测试视频 + 缩略图，并写入素材库数据库。用完可删除本文件。 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = process.env.BILISHELF_ROOT || path.join(process.env.USERPROFILE, 'BiliShelf');
const MEDIA = path.join(ROOT, 'media', 'test');
const THUMBS = path.join(ROOT, 'cache', 'thumbnails');
const DB = path.join(ROOT, 'library.db');

fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(THUMBS, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'backups'), { recursive: true });

const samples = [
  ['赛博朋克 作画赏析', '作画研究所', ['动画', '作画', '参考'], 0],
  ['Blender 硬表面建模 全流程', '三维笔记', ['教程', 'Blender', '3D'], 40],
  ['为什么你的 UI 看起来不高级', '设计档案馆', ['UI', '设计', '拆解'], 90],
  ['城市夜景延时摄影', '夜色工作室', ['摄影', '延时', '城市'], 140],
  ['从零实现光线追踪渲染器', '图形学小站', ['技术', '图形学', 'Rust'], 200],
  ['动画分镜的节奏设计', '动画拆解室', ['动画', '分镜', '节奏'], 260],
  ['配色理论：高级感从哪来', '设计档案馆', ['设计', '配色', '理论'], 310],
  ['像素画的色彩限制', '作画研究所', ['像素', '色彩', '技法'], 20]
];

const now = new Date().toISOString();
const db = new DatabaseSync(DB);
db.exec('PRAGMA journal_mode = WAL;');

db.prepare(
  `INSERT INTO sources (kind, remote_id, title, owner_mid, last_synced_at, sync_enabled, created_at)
   VALUES ('favorite','990001','测试收藏夹',1000,?,1,?)
   ON CONFLICT(kind, remote_id) DO NOTHING`
).run(now, now);
const sourceId = db.prepare("SELECT id FROM sources WHERE remote_id='990001'").get().id;

samples.forEach(([title, up, tags, hue], index) => {
  const file = path.join(MEDIA, `sample-${index + 1}.mp4`);
  const thumb = path.join(THUMBS, `v${100 + index}.webp`);
  if (!fs.existsSync(file)) {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=1280x720:rate=30`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440',
        '-t',
        '8',
        '-vf',
        `hue=h=${hue}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '30',
        '-c:a',
        'aac',
        '-shortest',
        file
      ],
      { stdio: 'ignore' }
    );
  }
  if (!fs.existsSync(thumb)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-ss', '2', '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', thumb],
      { stdio: 'ignore' }
    );
  }

  const key = `local:seed-${index + 1}`;
  const size = fs.statSync(file).size;
  db.prepare(
    `INSERT INTO videos (video_key, origin, bvid, cid, page, title, up_name, description, file_path, file_size,
      duration, width, height, vcodec, acodec, quality_label, status, rating, note, downloaded_at, created_at, updated_at, source_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(video_key) DO NOTHING`
  ).run(
    key,
    index % 2 === 0 ? 'bilibili' : 'local',
    index % 2 === 0 ? `BV1seed${String(index + 1).padStart(4, '0')}` : '',
    1000 + index,
    1,
    title,
    up,
    '用于本地界面联调的测试素材，可随时删除。',
    path.relative(ROOT, file).split(path.sep).join('/'),
    size,
    8,
    1280,
    720,
    'h264',
    'aac',
    '720P',
    'present',
    index % 3 === 0 ? 5 : index % 2 === 0 ? 4 : 0,
    index === 0 ? '注意第 3 秒的镜头切换。' : '',
    now,
    now,
    now,
    sourceId
  );

  const row = db.prepare('SELECT id FROM videos WHERE video_key = ?').get(key);
  if (!row) return;
  const videoId = row.id;

  db.prepare(
    `INSERT INTO assets (video_id, type, path, mime, size) VALUES (?,?,?,?,?)
     ON CONFLICT(video_id, type) DO UPDATE SET path = excluded.path, size = excluded.size`
  ).run(videoId, 'video', path.relative(ROOT, file).split(path.sep).join('/'), 'video/mp4', size);
  db.prepare(
    `INSERT INTO assets (video_id, type, path, mime, size) VALUES (?,?,?,?,?)
     ON CONFLICT(video_id, type) DO UPDATE SET path = excluded.path, size = excluded.size`
  ).run(videoId, 'thumb', path.relative(ROOT, thumb).split(path.sep).join('/'), 'image/webp', fs.statSync(thumb).size);

  for (const tag of tags) {
    db.prepare('INSERT INTO tags (name, normalized_name, created_at) VALUES (?,?,?) ON CONFLICT(name) DO NOTHING').run(
      tag,
      tag.toLowerCase(),
      now
    );
    const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
    db.prepare('INSERT INTO video_tags (video_id, tag_id, source) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(
      videoId,
      tagRow.id,
      'manual'
    );
  }

  if (index % 3 === 0) {
    db.prepare('INSERT INTO folders (name, created_at) VALUES (?,?) ON CONFLICT DO NOTHING').run('测试项目', now);
    const folder = db.prepare('SELECT id FROM folders WHERE name = ?').get('测试项目');
    db.prepare('INSERT INTO video_folders (video_id, folder_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(videoId, folder.id);
  }

  db.prepare('DELETE FROM videos_fts WHERE rowid = ?').run(videoId);
  db.prepare('INSERT INTO videos_fts (rowid, title, up_name, description, tags_text, note) VALUES (?,?,?,?,?,?)').run(
    videoId,
    title,
    up,
    '用于本地界面联调的测试素材，可随时删除。',
    tags.join(' '),
    ''
  );
});

console.log('seeded videos:', db.prepare('SELECT COUNT(*) AS c FROM videos').get().c);
db.close();
