import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectIssues, type AiQualityConfig } from '@shared/aiQuality';
import { anyRuleClause, lowConfidenceClause, ruleClause, selectorSql } from './qualitySql';

// 合成词表：只验证「SQL 与 JS 判定一致」，不涉及任何真实标签方案
const config: AiQualityConfig = {
  lowConfidence: 0.6,
  categoryRules: [],
  musicHints: [],
  rules: [
    { kind: 'pair-tag-prefix', type: 'pair', a: { tags: ['甲'] }, b: { categoryPrefix: '类目乙' } },
    {
      kind: 'pair-tag-suffix',
      type: 'pair',
      a: { tags: ['甲'] },
      b: { categoryEquals: '类目丙', nameSuffixes: ['子'] }
    },
    { kind: 'multi-category', type: 'multi', group: { categoryEquals: '类目丁' }, minCount: 2 },
    { kind: 'multi-tags', type: 'multi', group: { tags: ['戊', '己', '庚'] }, minCount: 2 },
    { kind: 'multi-suffix', type: 'multi', group: { categoryEquals: '类目丙', nameSuffixes: ['子'] }, minCount: 2 }
  ]
};

interface Row {
  run: number;
  tags: Array<{ name: string; category: string; confidence?: number; status?: string }>;
}

const rows: Row[] = [
  { run: 1, tags: [{ name: '甲', category: '人物' }, { name: '乙一', category: '类目乙·颜色' }] },
  { run: 2, tags: [{ name: '甲', category: '人物' }] },
  { run: 3, tags: [{ name: '丁一', category: '类目丁' }, { name: '丁二', category: '类目丁' }] },
  { run: 4, tags: [{ name: '戊', category: '别处' }, { name: '己', category: '别处' }] },
  { run: 5, tags: [{ name: '甲', category: '人物', confidence: 0.4 }] },
  {
    run: 6,
    tags: [
      { name: '甲', category: '人物' },
      { name: '丙子', category: '类目丙' },
      { name: '丙丑子', category: '类目丙' }
    ]
  },
  // 已取代的标签不应参与统计
  { run: 7, tags: [{ name: '甲', category: '人物', status: 'superseded' }, { name: '乙一', category: '类目乙' }] }
];

let db: DatabaseSync;

function count(clause: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ai_runs r JOIN videos v ON v.id = r.video_id WHERE ${clause}`)
    .get() as { c: number };
  return row.c;
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE videos (id INTEGER PRIMARY KEY);
    CREATE TABLE ai_runs (id INTEGER PRIMARY KEY, video_id INTEGER NOT NULL);
    CREATE TABLE ai_run_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      video_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.9,
      status TEXT NOT NULL DEFAULT 'pending'
    );
  `);
  for (const row of rows) {
    db.prepare('INSERT INTO videos (id) VALUES (?)').run(row.run);
    db.prepare('INSERT INTO ai_runs (id, video_id) VALUES (?, ?)').run(row.run, row.run);
    for (const tag of row.tags) {
      db.prepare('INSERT INTO ai_run_tags (run_id, video_id, name, category, confidence, status) VALUES (?,?,?,?,?,?)').run(
        row.run,
        row.run,
        tag.name,
        tag.category,
        tag.confidence ?? 0.9,
        tag.status ?? 'pending'
      );
    }
  }
});

describe('qualitySql', () => {
  it('matches the same runs as detectIssues', () => {
    const expected = rows
      .filter((row) => {
        const live = row.tags
          .filter((tag) => (tag.status ?? 'pending') === 'pending')
          .map((tag) => ({ name: tag.name, category: tag.category, confidence: tag.confidence ?? 0.9 }));
        return detectIssues(live, config).some((kind) => kind !== 'low-confidence');
      })
      .map((row) => row.run);

    expect(count(anyRuleClause(config))).toBe(expected.length);
    for (const rule of config.rules) {
      const hits = rows
        .filter((row) => {
          const live = row.tags
            .filter((tag) => (tag.status ?? 'pending') === 'pending')
            .map((tag) => ({ name: tag.name, category: tag.category, confidence: tag.confidence ?? 0.9 }));
          return detectIssues(live, { rules: [rule], categoryRules: [], musicHints: [], lowConfidence: 0 }).includes(
          rule.kind
        );
        })
        .map((row) => row.run);
      const got = db
        .prepare(
          `SELECT r.id AS id FROM ai_runs r JOIN videos v ON v.id = r.video_id WHERE ${ruleClause(rule)} ORDER BY r.id`
        )
        .all() as Array<{ id: number }>;
      expect(got.map((item) => item.id)).toEqual(hits);
    }
  });

  it('ignores superseded tags', () => {
    for (const rule of config.rules) {
      const got = db
        .prepare(`SELECT r.id FROM ai_runs r JOIN videos v ON v.id = r.video_id WHERE ${ruleClause(rule)}`)
        .all() as Array<{ id: number }>;
      expect(got.some((item) => item.id === 7)).toBe(false);
    }
  });

  it('counts low confidence separately', () => {
    const got = db
      .prepare(
        `SELECT r.id FROM ai_runs r JOIN videos v ON v.id = r.video_id WHERE ${lowConfidenceClause(config)} ORDER BY r.id`
      )
      .all() as Array<{ id: number }>;
    expect(got.map((item) => item.id)).toEqual([5]);
  });

  it('never matches an empty selector or empty rule set', () => {
    expect(selectorSql({})).toBe('0');
    expect(count(anyRuleClause({ rules: [], categoryRules: [], musicHints: [], lowConfidence: 0.6 }))).toBe(0);
  });

  it('escapes quotes in configured words', () => {
    expect(selectorSql({ tags: ["it's"] })).toBe(`t.name IN ('it''s')`);
  });
});
