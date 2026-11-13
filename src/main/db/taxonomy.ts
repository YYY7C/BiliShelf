import type { FolderSummary, LibraryQuery, SmartCollection, TagSummary } from '@shared/types';
import { all, one, run } from './index';
import { refreshVideoFts } from './videos';

function now(): string {
  return new Date().toISOString();
}

/* ---------------------------------- tags --------------------------------- */

interface TagRow {
  id: number;
  name: string;
  color: string | null;
  parent_id: number | null;
  count: number;
  manual_count: number;
  auto_count: number;
}

export function listTags(): TagSummary[] {
  const rows = all<TagRow>(`SELECT t.id, t.name, t.color, t.parent_id,
      (SELECT COUNT(*) FROM video_tags vt JOIN videos v ON v.id = vt.video_id
        WHERE vt.tag_id = t.id AND v.status <> 'trashed') AS count,
      (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id AND vt.source = 'manual') AS manual_count,
      (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id AND vt.source = 'auto') AS auto_count
    FROM tags t
    ORDER BY count DESC, t.name COLLATE NOCASE`);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    parentId: row.parent_id,
    count: row.count,
    source: row.manual_count > 0 && row.auto_count > 0 ? 'mixed' : row.auto_count > 0 ? 'auto' : 'manual'
  }));
}

export function createTag(name: string, parentId: number | null = null): TagSummary[] {
  const value = name.trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('标签不能为空');
  const existing = one<{ id: number }>('SELECT id FROM tags WHERE name = ?', [value]);
  if (!existing) {
    run('INSERT INTO tags (name, normalized_name, parent_id, created_at) VALUES (?,?,?,?)', [
      value,
      value.toLocaleLowerCase(),
      parentId,
      now()
    ]);
  }
  return listTags();
}

export function renameTag(id: number, name: string): TagSummary[] {
  const value = name.trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('标签不能为空');
  run('UPDATE tags SET name = ?, normalized_name = ? WHERE id = ?', [value, value.toLocaleLowerCase(), id]);
  const affected = all<{ video_id: number }>('SELECT video_id FROM video_tags WHERE tag_id = ?', [id]);
  affected.forEach((row) => refreshVideoFts(row.video_id));
  return listTags();
}

export function deleteTag(id: number): TagSummary[] {
  const affected = all<{ video_id: number }>('SELECT video_id FROM video_tags WHERE tag_id = ?', [id]);
  run('DELETE FROM tags WHERE id = ?', [id]);
  affected.forEach((row) => refreshVideoFts(row.video_id));
  return listTags();
}

export function mergeTag(sourceId: number, targetId: number): TagSummary[] {
  if (sourceId === targetId) return listTags();
  const affected = all<{ video_id: number }>('SELECT video_id FROM video_tags WHERE tag_id = ?', [sourceId]);
  run(
    `INSERT INTO video_tags (video_id, tag_id, source)
     SELECT video_id, ?, source FROM video_tags WHERE tag_id = ?
     ON CONFLICT(video_id, tag_id) DO NOTHING`,
    [targetId, sourceId]
  );
  run('DELETE FROM tags WHERE id = ?', [sourceId]);
  affected.forEach((row) => refreshVideoFts(row.video_id));
  return listTags();
}

/* --------------------------------- folders -------------------------------- */

export function listFolders(): FolderSummary[] {
  const rows = all<{
    id: number;
    name: string;
    parent_id: number | null;
    sort: number;
    count: number;
  }>(`SELECT f.id, f.name, f.parent_id, f.sort,
      (SELECT COUNT(*) FROM video_folders vf JOIN videos v ON v.id = vf.video_id
        WHERE vf.folder_id = f.id AND v.status <> 'trashed') AS count
    FROM folders f
    ORDER BY f.sort ASC, f.name COLLATE NOCASE`);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sort: row.sort,
    count: row.count
  }));
}

export function createFolder(name: string, parentId: number | null = null): FolderSummary[] {
  const value = name.trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('文件夹名不能为空');
  const existing = one<{ id: number }>(
    'SELECT id FROM folders WHERE name = ? AND parent_id IS ?',
    [value, parentId]
  );
  if (!existing) {
    run('INSERT INTO folders (name, parent_id, created_at) VALUES (?,?,?)', [value, parentId, now()]);
  }
  return listFolders();
}

export function renameFolder(id: number, name: string): FolderSummary[] {
  const value = name.trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('文件夹名不能为空');
  run('UPDATE folders SET name = ? WHERE id = ?', [value, id]);
  return listFolders();
}

export function deleteFolder(id: number): FolderSummary[] {
  run('DELETE FROM folders WHERE id = ?', [id]);
  return listFolders();
}

/* ----------------------------- smart collections -------------------------- */

export function listSmartCollections(): SmartCollection[] {
  const rows = all<{ id: number; name: string; query_json: string; icon: string | null; sort: number }>(
    'SELECT id, name, query_json, icon, sort FROM smart_collections ORDER BY sort ASC, id ASC'
  );
  const result: SmartCollection[] = [];
  for (const row of rows) {
    try {
      result.push({
        id: row.id,
        name: row.name,
        query: JSON.parse(row.query_json) as LibraryQuery,
        icon: row.icon,
        sort: row.sort
      });
    } catch {
      // 忽略损坏的规则，避免整个列表不可用
    }
  }
  return result;
}

export function saveSmartCollection(input: {
  id?: number;
  name: string;
  query: LibraryQuery;
  icon?: string | null;
}): SmartCollection[] {
  const name = input.name.trim();
  if (!name) throw new Error('名称不能为空');
  const json = JSON.stringify(input.query ?? {});
  if (input.id) {
    run('UPDATE smart_collections SET name = ?, query_json = ?, icon = ? WHERE id = ?', [
      name,
      json,
      input.icon ?? null,
      input.id
    ]);
  } else {
    run('INSERT INTO smart_collections (name, query_json, icon, created_at) VALUES (?,?,?,?)', [
      name,
      json,
      input.icon ?? null,
      now()
    ]);
  }
  return listSmartCollections();
}

export function deleteSmartCollection(id: number): SmartCollection[] {
  run('DELETE FROM smart_collections WHERE id = ?', [id]);
  return listSmartCollections();
}
