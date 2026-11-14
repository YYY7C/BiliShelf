import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FolderOpen,
  HardDrive,
  Inbox,
  LogIn,
  Settings,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  User,
  XCircle
} from 'lucide-react';
import type {
  AuthStatus,
  EngineStatus,
  FolderSummary,
  LibraryStats,
  SmartCollection,
  SourceSummary,
  TagSummary
} from '@shared/types';
import type { View } from '../lib/store';
import { useUi } from '../lib/store';
import { SectionLabel } from './ui';

interface SidebarProps {
  view: View;
  onView: (view: View) => void;
  stats: LibraryStats | null;
  tags: TagSummary[];
  folders: FolderSummary[];
  smart: SmartCollection[];
  sources: SourceSummary[];
  auth: AuthStatus | null;
  engines: EngineStatus | null;
  activeJobs: number;
  activeSourceId: number | null;
  version?: string;
  onSelectSource: (id: number | null) => void;
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  count?: number | string;
  active?: boolean;
  onClick: () => void;
  tone?: 'default' | 'warn' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[12.5px] transition-colors',
        active
          ? 'border-line bg-panel2 text-fg'
          : 'text-muted hover:border-line/60 hover:bg-panel2/60 hover:text-fg'
      )}
    >
      <span
        className={clsx(
          'flex h-6 w-6 flex-none items-center justify-center rounded-md',
          active ? 'bg-pink/15 text-pink' : tone === 'danger' ? 'text-red/80' : tone === 'warn' ? 'text-yellow/90' : 'text-dim'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count !== 0 ? (
        <span className="flex-none font-mono text-[10.5px] text-dim">{count}</span>
      ) : null}
    </button>
  );
}

export function Sidebar({
  view,
  onView,
  stats,
  tags,
  folders,
  smart,
  sources,
  auth,
  engines,
  activeJobs,
  activeSourceId,
  version,
  onSelectSource
}: SidebarProps) {
  const filters = useUi((state) => state.filters);
  const patchFilters = useUi((state) => state.patchFilters);
  const setSettingsOpen = useUi((state) => state.setSettingsOpen);

  const topTags = [...tags].sort((a, b) => b.count - a.count).slice(0, 10);
  const engineOk = engines?.ready ?? false;

  /** 标签/文件夹/来源属于「细分筛选」，一旦启用就不再高亮左侧的作用域，保证同时只高亮一项。 */
  const facetActive = Boolean(filters.tag || filters.folder || filters.sourceId);

  /** 作用域：状态 + 排序的组合，互斥。 */
  const pickStatus = (
    status: 'all' | 'present' | 'missing' | 'unavailable' | 'trashed',
    sort: 'added' | 'recent' = 'added'
  ) => {
    onView('library');
    patchFilters({ status, sort, sourceId: null, tag: null, folder: null });
  };

  const scopeActive = (status: string) =>
    view === 'library' && !facetActive && filters.status === status;

  return (
    <aside className="sidebar-glass relative z-10 flex h-full w-[236px] flex-none flex-col border-r border-line2">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink to-blue text-[15px] font-black text-white shadow-lg shadow-pink/20">
          B
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold leading-4 text-fg">BiliShelf</div>
          <div className="truncate text-[10.5px] leading-4 text-dim">本地素材库 · v{version ?? '0.2.2'}</div>
        </div>
      </div>

      <nav className="px-2">
        <NavItem
          icon={<Inbox size={14} />}
          label="来源清单"
          count={sources.length || undefined}
          active={view === 'sources' && activeSourceId === null}
          onClick={() => onSelectSource(null)}
        />
        <NavItem
          icon={<Download size={14} />}
          label="下载任务"
          count={activeJobs || undefined}
          active={view === 'tasks'}
          onClick={() => onView('tasks')}
        />
      </nav>

      <div className="scroll-thin mt-1 flex-1 overflow-y-auto px-2 pb-3">
        <SectionLabel>素材库</SectionLabel>
        <NavItem
          icon={<CheckCircle2 size={14} />}
          label="全部可播放"
          count={stats?.present}
          active={scopeActive('present') && filters.sort !== 'recent'}
          onClick={() => pickStatus('present')}
        />
        <NavItem
          icon={<Clock size={14} />}
          label="最近添加"
          active={scopeActive('present') && filters.sort === 'recent'}
          onClick={() => pickStatus('present', 'recent')}
        />
        <NavItem
          icon={<AlertTriangle size={14} />}
          label="文件缺失"
          count={stats?.missing}
          tone="warn"
          active={scopeActive('missing')}
          onClick={() => pickStatus('missing')}
        />
        <NavItem
          icon={<XCircle size={14} />}
          label="源已失效"
          count={stats?.unavailable}
          tone="danger"
          active={scopeActive('unavailable')}
          onClick={() => pickStatus('unavailable')}
        />
        <NavItem
          icon={<Trash2 size={14} />}
          label="回收站"
          count={stats?.trashed}
          active={scopeActive('trashed')}
          onClick={() => pickStatus('trashed')}
        />

        <SectionLabel>来源</SectionLabel>
        {sources.length === 0 ? (
          <p className="px-2 pb-1 text-[11px] leading-4 text-dim">还没有来源，去「来源清单」拉取收藏夹。</p>
        ) : (
          sources.map((source) => (
            <NavItem
              key={source.id}
              icon={<HardDrive size={14} />}
              label={source.title}
              count={source.itemCount || undefined}
              active={view === 'sources' && activeSourceId === source.id}
              onClick={() => onSelectSource(source.id)}
            />
          ))
        )}

        {folders.length > 0 ? (
          <>
            <SectionLabel>文件夹</SectionLabel>
            {folders.slice(0, 8).map((folder) => (
              <NavItem
                key={folder.id}
                icon={<FolderOpen size={14} />}
                label={folder.name}
                count={folder.count || undefined}
                active={view === 'library' && filters.folder === folder.name}
                onClick={() => {
                  onView('library');
                  patchFilters({
                    folder: filters.folder === folder.name ? null : folder.name,
                    tag: null,
                    sourceId: null
                  });
                }}
              />
            ))}
          </>
        ) : null}

        {smart.length > 0 ? (
          <>
            <SectionLabel>智能收藏夹</SectionLabel>
            {smart.map((collection) => (
              <NavItem
                key={collection.id}
                icon={<Sparkles size={14} />}
                label={collection.name}
                active={false}
                onClick={() => {
                  onView('library');
                  patchFilters({
                    tag: collection.query.tag ?? null,
                    folder: collection.query.folder ?? null,
                    status: collection.query.status ?? 'all',
                    sort: collection.query.sort ?? 'added',
                    search: collection.query.search ?? '',
                    sourceId: null
                  });
                }}
              />
            ))}
          </>
        ) : null}

        {topTags.length > 0 ? (
          <>
            <SectionLabel>标签</SectionLabel>
            <div className="flex flex-wrap gap-1 px-2 pt-1">
              {topTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    onView('library');
                    patchFilters({
                      tag: filters.tag === tag.name ? null : tag.name,
                      folder: null,
                      sourceId: null
                    });
                  }}
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors',
                    filters.tag === tag.name
                      ? 'border-pink/40 bg-pink/15 text-pink'
                      : 'border-line/60 bg-panel2/60 text-muted hover:text-fg'
                  )}
                  title={`${tag.count} 个素材`}
                >
                  <TagIcon size={9} />
                  {tag.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="border-t border-line2 px-2 py-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={clsx(
            'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
            engineOk ? 'text-muted hover:bg-panel2 hover:text-fg' : 'text-yellow hover:bg-yellow/10'
          )}
          title={engineOk ? '引擎就绪' : '引擎未就绪，点击设置'}
        >
          <span className={clsx('h-1.5 w-1.5 flex-none rounded-full', engineOk ? 'bg-green' : 'bg-yellow')} />
          <span className="min-w-0 flex-1 truncate">
            {engineOk ? '引擎就绪' : '引擎未配置'}
          </span>
          <Settings size={13} />
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-panel2 hover:text-fg"
        >
          {auth?.loggedIn ? (
            <>
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-blue/15 text-[10px] text-blue">
                {auth.name?.slice(0, 1) ?? <User size={11} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{auth.name ?? '已登录'}</span>
            </>
          ) : (
            <>
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-panel3 text-dim">
                <LogIn size={11} />
              </span>
              <span className="min-w-0 flex-1 truncate">未登录 · 点击设置</span>
            </>
          )}
          <Settings size={13} className="opacity-60" />
        </button>
      </div>
    </aside>
  );
}
