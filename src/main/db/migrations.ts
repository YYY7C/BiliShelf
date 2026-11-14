export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * 迁移只追加、不修改。每条迁移在事务内执行并记录到 schema_migrations。
 * 约定：库内路径一律存相对路径（/ 分隔），只有 userData 配置存绝对路径。
 */
export const migrations: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: /* sql */ `
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        remote_id TEXT NOT NULL,
        title TEXT NOT NULL,
        cover TEXT,
        owner_mid INTEGER,
        note TEXT,
        last_synced_at TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        config_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (kind, remote_id)
      );

      CREATE TABLE IF NOT EXISTS remote_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        item_key TEXT NOT NULL,
        bvid TEXT NOT NULL,
        cid INTEGER,
        page INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        cover_url TEXT,
        duration INTEGER,
        up_name TEXT,
        up_mid INTEGER,
        pub_time TEXT,
        fav_time TEXT,
        tags_json TEXT,
        state TEXT NOT NULL DEFAULT 'unknown',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE (source_id, item_key)
      );

      CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_key TEXT NOT NULL UNIQUE,
        origin TEXT NOT NULL DEFAULT 'bilibili',
        bvid TEXT NOT NULL DEFAULT '',
        cid INTEGER,
        page INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        up_name TEXT,
        up_mid INTEGER,
        description TEXT,
        cover_url TEXT,
        source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
        remote_item_id INTEGER REFERENCES remote_items(id) ON DELETE SET NULL,
        file_path TEXT,
        file_size INTEGER,
        duration REAL,
        width INTEGER,
        height INTEGER,
        vcodec TEXT,
        acodec TEXT,
        bitrate INTEGER,
        container TEXT,
        hash TEXT,
        quality_label TEXT,
        status TEXT NOT NULL DEFAULT 'present',
        rating INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        play_position REAL NOT NULL DEFAULT 0,
        played_at TEXT,
        downloaded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        mime TEXT,
        size INTEGER,
        hash TEXT,
        meta_json TEXT,
        UNIQUE (video_id, type)
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        normalized_name TEXT NOT NULL,
        parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
        color TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_tags (
        video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'manual',
        confidence REAL,
        PRIMARY KEY (video_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (name, parent_id)
      );

      CREATE TABLE IF NOT EXISTS video_folders (
        video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        PRIMARY KEY (video_id, folder_id)
      );

      CREATE TABLE IF NOT EXISTS smart_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        query_json TEXT NOT NULL,
        icon TEXT,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS download_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_key TEXT NOT NULL,
        bvid TEXT NOT NULL,
        cid INTEGER,
        page INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
        remote_item_id INTEGER REFERENCES remote_items(id) ON DELETE SET NULL,
        quality TEXT NOT NULL DEFAULT 'compat',
        status TEXT NOT NULL DEFAULT 'queued',
        progress REAL NOT NULL DEFAULT 0,
        speed INTEGER,
        eta INTEGER,
        error_code TEXT,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        stats_json TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
      CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source_id);
      CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_videos_downloaded ON videos(downloaded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_videos_bvid ON videos(bvid);
      CREATE INDEX IF NOT EXISTS idx_remote_source ON remote_items(source_id);
      CREATE INDEX IF NOT EXISTS idx_remote_bvid ON remote_items(bvid);
      CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_video_folders_folder ON video_folders(folder_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON download_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_video ON download_jobs(video_key);

      CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
        title,
        up_name,
        description,
        tags_text,
        note,
        tokenize = 'trigram'
      );
    `
  },
  {
    id: 2,
    name: 'folder_unique_and_dedupe',
    sql: /* sql */ `
      CREATE TEMP TABLE IF NOT EXISTS folder_map AS
        SELECT f1.id AS old_id,
               (SELECT MIN(f2.id) FROM folders f2
                 WHERE f2.name = f1.name
                   AND IFNULL(f2.parent_id, 0) = IFNULL(f1.parent_id, 0)) AS new_id
        FROM folders f1;

      UPDATE OR IGNORE video_folders
        SET folder_id = (SELECT new_id FROM folder_map WHERE old_id = video_folders.folder_id);

      DELETE FROM video_folders
        WHERE folder_id IN (
          SELECT id FROM folders
          WHERE id NOT IN (SELECT MIN(id) FROM folders GROUP BY name, IFNULL(parent_id, 0))
        );

      DELETE FROM folders
        WHERE id NOT IN (SELECT MIN(id) FROM folders GROUP BY name, IFNULL(parent_id, 0));

      DROP TABLE IF EXISTS folder_map;

      CREATE UNIQUE INDEX IF NOT EXISTS ux_folders_name_parent
        ON folders(name, IFNULL(parent_id, 0));
    `
  },
  {
    id: 3,
    name: 'normalize_cover_urls',
    sql: /* sql */ `
      UPDATE remote_items
        SET cover_url = 'https://' || substr(cover_url, 8)
        WHERE cover_url LIKE 'http://%';
    `
  },
  {
    id: 4,
    name: 'remote_cover_cache',
    sql: /* sql */ `
      ALTER TABLE remote_items ADD COLUMN local_cover TEXT;
    `
  },
  {
    id: 5,
    name: 'download_upgrade_video',
    sql: /* sql */ `
      ALTER TABLE download_jobs ADD COLUMN upgrade_video_id INTEGER;
    `
  },
  {
    id: 6,
    name: 'video_quality_checked',
    sql: /* sql */ `
      ALTER TABLE videos ADD COLUMN quality_checked_at TEXT;
    `
  },
  {
    id: 7,
    name: 'drop_unused_settings_table',
    sql: /* sql */ `
      DROP TABLE IF EXISTS settings;
    `
  },
  {
    id: 8,
    name: 'normalize_video_keys',
    sql: /* sql */ `
      UPDATE videos
         SET video_key = 'bv:' || bvid || ':' || page
       WHERE bvid <> '' AND video_key <> 'bv:' || bvid || ':' || page;
      UPDATE download_jobs
         SET video_key = 'bv:' || bvid || ':' || page
       WHERE video_key <> 'bv:' || bvid || ':' || page;
    `
  }
];
