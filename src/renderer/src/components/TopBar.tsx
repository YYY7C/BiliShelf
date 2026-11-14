import clsx from 'clsx';
import {
  ArrowDownWideNarrow,
  FolderPlus,
  LayoutGrid,
  List,
  PanelRight,
  RefreshCw,
  Moon,
  RotateCcw,
  Search,
  Settings,
  Star,
  Sun,
  Tag,
  Trash2,
  TrendingUp,
  X
} from 'lucide-react';
import type { SortKey } from '@shared/types';
import { useUi } from '../lib/store';
import { Button, IconButton, Kbd, Select } from './ui';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'added', label: '添加时间' },
  { value: 'recent', label: '最近更新' },
  { value: 'title', label: '标题' },
  { value: 'duration', label: '时长' },
  { value: 'size', label: '文件大小' },
  { value: 'rating', label: '评分' }
];

const STATUS_LABEL: Record<string, string> = {
  present: '可播放',
  missing: '文件缺失',
  unavailable: '源已失效',
  trashed: '回收站',
  importing: '导入中'
};

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-blue/30 bg-blue/10 px-1.5 py-0.5 text-[11px] text-blue">
      {label}
      <button type="button" aria-label={`清除筛选 ${label}`} onClick={onClear} className="opacity-70 hover:opacity-100">
        <X size={10} />
      </button>
    </span>
  );
}

interface TopBarProps {
  total: number;
  loading: boolean;
  view: 'library' | 'sources' | 'tasks';
  grid: boolean;
  onToggleGrid: () => void;
  onRefresh: () => void;
  onQualityUpgrade: () => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onBulkTag: () => void;
  onBulkFolder: () => void;
  onBulkRate: () => void;
  onBulkTrash: () => void;
  onBulkRestore: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function TopBar({
  total,
  loading,
  view,
  grid,
  onToggleGrid,
  onRefresh,
  onQualityUpgrade,
  onImportFiles,
  onImportFolder,
  onBulkTag,
  onBulkFolder,
  onBulkRate,
  onBulkTrash,
  onBulkRestore,
  onBulkDelete,
  onClearSelection,
  theme,
  onToggleTheme
}: TopBarProps) {
  const filters = useUi((state) => state.filters);
  const patchFilters = useUi((state) => state.patchFilters);
  const selection = useUi((state) => state.selection);
  const setSettingsOpen = useUi((state) => state.setSettingsOpen);
  const inspectorOpen = useUi((state) => state.inspectorOpen);
  const setInspectorOpen = useUi((state) => state.setInspectorOpen);
  const selectedId = useUi((state) => state.selectedId);

  const selectedCount = selection.length;
  const hasFilter =
    !['all', 'present'].includes(filters.status) ||
    Boolean(filters.tag) ||
    Boolean(filters.folder) ||
    Boolean(filters.sourceId) ||
    Boolean(filters.search.trim());

  const clearAllFilters = () =>
    patchFilters({ status: 'present', tag: null, folder: null, sourceId: null, search: '' });

  return (
    <header className="flex-none border-b border-line2 bg-panel/40">
      <div className="flex h-12 items-center gap-2 px-3">
        {view === 'library' ? (
          <>
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
              <input
                id="library-search"
                value={filters.search}
                onChange={(event) => patchFilters({ search: event.target.value })}
                placeholder="搜索标题、UP 主、标签、备注…"
                className="h-8 w-full rounded-lg border border-line bg-panel2 pl-8 pr-16 text-[12.5px] text-fg placeholder:text-dim focus:border-blue/40 focus:outline-none focus:ring-2 focus:ring-blue/10"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {filters.search ? (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => patchFilters({ search: '' })}
                    className="pointer-events-auto rounded p-0.5 text-dim hover:text-fg"
                  >
                    <X size={12} />
                  </button>
                ) : (
                  <Kbd>Ctrl K</Kbd>
                )}
              </span>
            </div>

            <Select
              value={filters.sort}
              onChange={(value) => patchFilters({ sort: value as SortKey })}
              options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              icon={<ArrowDownWideNarrow size={13} />}
              title="排序"
            />

            <div className="hidden items-center gap-1 rounded-lg border border-line bg-panel2 px-1 md:flex">
              <IconButton
                label="网格视图"
                className={clsx('h-7 w-7', grid && 'bg-panel3 text-fg')}
                onClick={onToggleGrid}
              >
                <LayoutGrid size={13} />
              </IconButton>
              <IconButton
                label="列表视图"
                className={clsx('h-7 w-7', !grid && 'bg-panel3 text-fg')}
                onClick={onToggleGrid}
              >
                <List size={13} />
              </IconButton>
            </div>
          </>
        ) : (
          <div className="flex-1">
            <div className="text-[13px] font-medium text-fg">
              {view === 'sources' ? '来源清单' : '下载任务'}
            </div>
            <div className="text-[11px] text-dim">
              {view === 'sources'
                ? '先拉取列表与元数据，再在本地挑选要同步的条目'
                : '队列、进度与失败原因；暂停不会删除已下载内容'}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {view === 'library' ? (
            <span className="mr-1 hidden font-mono text-[11px] text-dim lg:inline">
              {loading ? '…' : `${total} 条`}
            </span>
          ) : null}
          {view === 'library' && selectedId !== null ? (
            <IconButton
              label={inspectorOpen ? '隐藏详情' : '显示详情'}
              className={inspectorOpen ? 'bg-panel3 text-fg' : undefined}
              onClick={() => setInspectorOpen(!inspectorOpen)}
            >
              <PanelRight size={15} />
            </IconButton>
          ) : null}
          <IconButton label="检查画质升级" onClick={onQualityUpgrade}>
            <TrendingUp size={15} />
          </IconButton>
          <IconButton label="刷新" onClick={onRefresh}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
          </IconButton>
          {view === 'library' ? (
            <>
              <Button variant="subtle" size="sm" onClick={onImportFiles} title="导入本地视频文件">
                <FolderPlus size={13} />
                导入
              </Button>
              <Button variant="ghost" size="sm" onClick={onImportFolder} title="导入文件夹（递归）">
                文件夹
              </Button>
            </>
          ) : null}
          <IconButton label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>
          <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
          </IconButton>
        </div>
      </div>

      {view === 'library' && hasFilter ? (
        <div className="flex h-9 items-center gap-1.5 border-t border-line2 bg-panel2/30 px-3">
          <span className="text-[11px] text-dim">筛选</span>
          {!['all', 'present'].includes(filters.status) ? (
            <FilterChip
              label={`状态：${STATUS_LABEL[filters.status] ?? filters.status}`}
              onClear={() => patchFilters({ status: 'present' })}
            />
          ) : null}
          {filters.tag ? <FilterChip label={`标签：${filters.tag}`} onClear={() => patchFilters({ tag: null })} /> : null}
          {filters.folder ? (
            <FilterChip label={`文件夹：${filters.folder}`} onClear={() => patchFilters({ folder: null })} />
          ) : null}
          {filters.sourceId ? (
            <FilterChip label="来源筛选" onClear={() => patchFilters({ sourceId: null })} />
          ) : null}
          {filters.search.trim() ? (
            <FilterChip label={`搜索：${filters.search.trim()}`} onClear={() => patchFilters({ search: '' })} />
          ) : null}
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-auto text-[11px] text-dim transition-colors hover:text-fg"
          >
            清除全部
          </button>
        </div>
      ) : null}

      {selectedCount > 0 && view === 'library' ? (        <div className="flex h-10 items-center gap-2 border-t border-line2 bg-pink/[0.06] px-3">
          <span className="text-[12px] text-pink">已选 {selectedCount}</span>
          <div className="ml-1 flex items-center gap-1">
            <Button size="sm" variant="subtle" onClick={onBulkTag}>
              <Tag size={12} />
              加标签
            </Button>
            <Button size="sm" variant="subtle" onClick={onBulkFolder}>
              <FolderPlus size={12} />
              移入文件夹
            </Button>
            <Button size="sm" variant="subtle" onClick={onBulkRate}>
              <Star size={12} />
              评分
            </Button>
            <Button size="sm" variant="subtle" onClick={onBulkRestore}>
              <RotateCcw size={12} />
              恢复
            </Button>
            {filters.status === 'trashed' ? (
              <Button size="sm" variant="danger" onClick={onBulkDelete}>
                <Trash2 size={12} />
                彻底删除
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={onBulkTrash}>
                <Trash2 size={12} />
                回收站
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="ml-auto flex items-center gap-1 text-[11.5px] text-dim hover:text-fg"
          >
            <X size={12} />
            取消选择
          </button>
        </div>
      ) : null}
    </header>
  );
}
