import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type { AiQualityConfig } from '@shared/aiQuality';
import { EMPTY_QUALITY_CONFIG, sanitizeQualityConfig } from '@shared/aiQuality';
import { libraryPaths } from '../paths';
import { setCategoryRules } from './ai/analysisParse';
import { setMusicKeywords } from './ai/prompt';

/** 规则文件放在素材库根目录，跟着库走但不入库（已在 .gitignore） */
export const QUALITY_RULES_FILE = 'ai-quality.json';

interface CacheEntry {
  root: string;
  mtimeMs: number;
  size: number;
  config: AiQualityConfig;
}

let cache: CacheEntry | null = null;

/**
 * 读取并校验 `<素材库>/ai-quality.json`。
 * 文件缺失/损坏时返回空规则：质量检查显示 0，不影响审核与打标本身。
 * 用 mtime + size 做缓存，切换素材库或手改文件后自动重新加载。
 */
export function getQualityConfig(): AiQualityConfig {
  let root: string;
  try {
    root = libraryPaths().root;
  } catch {
    return EMPTY_QUALITY_CONFIG;
  }
  const file = path.join(root, QUALITY_RULES_FILE);
  try {
    const stat = fs.statSync(file);
    if (cache && cache.root === root && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
      return cache.config;
    }
    const config = sanitizeQualityConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    cache = { root, mtimeMs: stat.mtimeMs, size: stat.size, config };
    setCategoryRules(config.categoryRules);
    setMusicKeywords(config.musicHints);
    if (config.rules.length === 0) log.warn('[quality]', file, '没有可用的规则');
    return config;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') log.warn('[quality]', file, '读取失败：', (error as Error).message);
    cache = null;
    return EMPTY_QUALITY_CONFIG;
  }
}
