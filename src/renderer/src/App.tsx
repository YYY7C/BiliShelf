import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppInfoResponse,
  AppSettings,
  AuthStatus,
  EngineStatus,
  FolderSummary,
  ImportProgress,
  LibraryStats,
  SmartCollection,
  SourceSummary,
  TagSummary,
  VideoItem
} from '@shared/types';
import { api, isDemo } from './lib/bridge';
import { useUi } from './lib/store';
import { Inspector } from './components/Inspector';
import { FocusBackdrop } from './components/FocusBackdrop';
import { QualityUpgradeModal } from './components/QualityUpgradeModal';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { SourcesView } from './components/SourcesView';
import { TasksView } from './components/TasksView';
import { ToastHost } from './components/ToastHost';
import { TopBar } from './components/TopBar';
import { VideoGrid } from './components/VideoGrid';
import { Button, Field, Modal, TextInput } from './components/ui';

type BulkKind = 'tag' | 'folder' | 'rate' | 'delete' | null;

const PAGE_SIZE = 120;

// Artplayer / Danmaku 体积较大，播放器按需加载，避免拖慢首屏
const PlayerOverlay = lazy(() =>
  import('./components/PlayerOverlay').then((module) => ({ default: module.PlayerOverlay }))
);

export default function App() {
  const view = useUi((state) => state.view);
  const setView = useUi((state) => state.setView);
  const filters = useUi((state) => state.filters);
  const selection = useUi((state) => state.selection);
  const selectedId = useUi((state) => state.selectedId);
  const selectionClear = useUi((state) => state.clearSelection);
  const select = useUi((state) => state.select);
  const inspectorOpen = useUi((state) => state.inspectorOpen);
  const setInspectorOpen = useUi((state) => state.setInspectorOpen);
  const settingsOpen = useUi((state) => state.settingsOpen);
  const setSettingsOpen = useUi((state) => state.setSettingsOpen);
  const playerId = useUi((state) => state.playerId);
  const openPlayer = useUi((state) => state.openPlayer);
  const closePlayer = useUi((state) => state.closePlayer);
  const bumpLibrary = useUi((state) => state.bumpLibrary);
  const libraryVersion = useUi((state) => state.libraryVersion);
  const sourcesVersion = useUi((state) => state.sourcesVersion);
  const bumpSources = useUi((state) => state.bumpSources);
  const jobs = useUi((state) => state.jobs);
  const jobsTotal = useUi((state) => state.jobsTotal);
  const setJobsSnapshot = useUi((state) => state.setJobsSnapshot);
  const pushToast = useUi((state) => state.pushToast);

  const [info, setInfo] = useState<AppInfoResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [engines, setEngines] = useState<EngineStatus | null>(null);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [smart, setSmart] = useState<SmartCollection[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [items, setItems] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [layout, setLayout] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('bilishelf-layout') === 'list' ? 'list' : 'grid'
  );
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);
  const [bulkKind, setBulkKind] = useState<BulkKind>(null);
  const [bulkValue, setBulkValue] = useState('');
  const [selectedItem, setSelectedItem] = useState<VideoItem | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('bilishelf-theme') === 'light' ? 'light' : 'dark'
  );
  const metaTimer = useRef<number | null>(null);

  const refreshMeta = useCallback(async () => {
    try {
      const [nextTags, nextFolders, nextSmart, nextStats, nextInfo] = await Promise.all([
        api.tags.list(),
        api.folders.list(),
        api.smart.list(),
        api.library.stats(),
        api.app.info()
      ]);
      setTags(nextTags);
      setFolders(nextFolders);
      setSmart(nextSmart);
      setStats(nextStats);
      setInfo(nextInfo);
      setEngines(nextInfo.engines);
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  }, [pushToast]);

  const refreshSources = useCallback(async () => {
    try {
      setSources(await api.sources.list());
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  }, [pushToast]);

  const refreshJobs = useCallback(async () => {
    try {
      setJobsSnapshot(await api.jobs.list());
    } catch {
      // ignore
    }
  }, [setJobsSnapshot]);

  // 下载完成可能连续触发素材库事件，合并 500ms 再刷新标签/统计
  const scheduleMetaRefresh = useCallback(() => {
    if (metaTimer.current) return;
    metaTimer.current = window.setTimeout(() => {
      metaTimer.current = null;
      void refreshMeta();
    }, 500);
  }, [refreshMeta]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('bilishelf-theme', theme);
    void api.app.setTheme(theme);
  }, [theme]);

  // 外观参数实时写入 CSS 变量，设置面板拖动滑杆即可预览
  useEffect(() => {
    const root = document.documentElement;
    const blur = settings?.coverBackdropBlur ?? 6;
    const opacity = (settings?.coverBackdropOpacity ?? 82) / 100;
    const dim = (settings?.coverBackdropDim ?? 55) / 100;
    const sidebarTransparent = settings?.sidebarTransparent !== false;
    root.style.setProperty('--cover-backdrop-blur', `${blur}px`);
    root.style.setProperty('--cover-backdrop-opacity', String(opacity));
    root.style.setProperty('--cover-veil-opacity', String(dim));
    root.style.setProperty('--sidebar-alpha', sidebarTransparent ? '20%' : '60%');
    root.style.setProperty('--sidebar-blur', sidebarTransparent ? '12px' : '0px');
  }, [settings]);

  useEffect(() => {
    return () => {
      if (metaTimer.current) window.clearTimeout(metaTimer.current);
    };
  }, []);

  // 首次加载
  useEffect(() => {
    void (async () => {
      try {
        const [nextSettings, nextAuth, nextInfo] = await Promise.all([
          api.settings.get(),
          api.auth.status(),
          api.app.info()
        ]);
        setSettings(nextSettings);
        setAuth(nextAuth);
        setInfo(nextInfo);
        setEngines(nextInfo.engines);
      } catch (error) {
        pushToast('error', (error as Error).message);
      }
      await Promise.all([refreshMeta(), refreshSources(), refreshJobs()]);
    })();
  }, [pushToast, refreshMeta, refreshSources, refreshJobs]);

  // 事件订阅
  useEffect(() => {
    const offLibrary = api.events.onLibrary(() => {
      bumpLibrary();
      scheduleMetaRefresh();
    });
    const offSources = api.events.onSources(() => {
      bumpSources();
      void refreshSources();
    });
    const offJobs = api.events.onJobs((snapshot) => setJobsSnapshot(snapshot));
    const offToast = api.events.onToast((toast) => pushToast(toast.kind, toast.message));
    const offAuth = api.events.onAuth((status) => setAuth(status));
    const offImport = api.events.onImportProgress((progress) => setImportProgress(progress));
    return () => {
      offLibrary();
      offSources();
      offJobs();
      offToast();
      offAuth();
      offImport();
    };
  }, [bumpLibrary, bumpSources, pushToast, refreshSources, scheduleMetaRefresh, setJobsSnapshot]);

  useEffect(() => {
    void refreshSources();
  }, [sourcesVersion, refreshSources]);

  // 素材查询
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.library
        .query({
          search: filters.search.trim() || undefined,
          tag: filters.tag ?? undefined,
          folder: filters.folder ?? undefined,
          status: filters.status,
          sourceId: filters.sourceId ?? undefined,
          sort: filters.sort,
          limit,
          offset: 0
        })
        .then((result) => {
          if (!alive) return;
          setItems(result.items);
          setTotal(result.total);
        })
        .catch((error: unknown) => {
          if (alive) pushToast('error', (error as Error).message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [filters, limit, libraryVersion, pushToast]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [filters.search, filters.tag, filters.folder, filters.status, filters.sort, filters.sourceId]);

  // 选中项的详情（可能不在当前页）
  useEffect(() => {
    let alive = true;
    if (selectedId === null) {
      setSelectedItem(null);
      return;
    }
    const fromList = items.find((item) => item.id === selectedId);
    if (fromList) {
      setSelectedItem(fromList);
      return;
    }
    api.library
      .get(selectedId)
      .then((video) => {
        if (alive) setSelectedItem(video);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [selectedId, items, libraryVersion]);

  const toggleLayout = () => {
    const next = layout === 'grid' ? 'list' : 'grid';
    setLayout(next);
    localStorage.setItem('bilishelf-layout', next);
  };

  const importFiles = async () => {
    try {
      const result = await api.library.importFiles();
      if (!result) return;
      pushToast(
        result.failed > 0 ? 'warn' : 'success',
        `导入完成：成功 ${result.imported}，跳过 ${result.skipped}，失败 ${result.failed}`
      );
      bumpLibrary();
      await refreshMeta();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setImportProgress(null);
    }
  };

  const importFolder = async () => {
    try {
      const result = await api.library.importFolder();
      if (!result) return;
      pushToast(
        result.failed > 0 ? 'warn' : 'success',
        `导入完成：成功 ${result.imported}，跳过 ${result.skipped}，失败 ${result.failed}`
      );
      bumpLibrary();
      await refreshMeta();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setImportProgress(null);
    }
  };

  const refreshAll = async () => {
    bumpLibrary();
    await refreshMeta();
    await refreshJobs();
    await refreshSources();
  };

  const applyBulk = async (action: 'retag' | 'refolder') => {
    const value = bulkValue.trim();
    if (!value) return;
    try {
      const ids = selection.length > 0 ? selection : selectedId ? [selectedId] : [];
      const result = await api.library.bulk({
        ids,
        action,
        tag: action === 'retag' ? value : undefined,
        folder: action === 'refolder' ? value : undefined
      });
      pushToast('success', `已更新 ${result.affected} 个素材`);
      setBulkKind(null);
      setBulkValue('');
      selectionClear();
      bumpLibrary();
      await refreshMeta();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const applyRate = async (rating: number) => {
    try {
      const ids = selection.length > 0 ? selection : selectedId ? [selectedId] : [];
      await api.library.bulk({ ids, action: 'rate', rating });
      pushToast('success', `已设置 ${ids.length} 个素材的评分`);
      setBulkKind(null);
      selectionClear();
      bumpLibrary();
      await refreshMeta();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const trashSelection = useCallback(async () => {
    try {
      await api.library.bulk({ ids: selection, action: 'trash' });
      pushToast('info', `已将 ${selection.length} 个素材移入回收站`);
      selectionClear();
      select(null);
      bumpLibrary();
      await refreshMeta();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  }, [bumpLibrary, pushToast, refreshMeta, select, selection, selectionClear]);

  const restoreSelection = async () => {
    try {
      await api.library.bulk({ ids: selection, action: 'restore' });
      pushToast('success', `已恢复 ${selection.length} 个素材`);
      selectionClear();
      bumpLibrary();
      await refreshMeta();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const deleteSelection = async () => {
    try {
      await api.library.bulk({ ids: selection, action: 'delete' });
      pushToast('info', `已从素材库移除 ${selection.length} 条记录（不会删除磁盘文件）`);
      setBulkKind(null);
      selectionClear();
      select(null);
      bumpLibrary();
      await refreshMeta();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const activeJobs = useMemo(
    () => jobs.filter((job) => ['downloading', 'postprocessing', 'resolving'].includes(job.status)).length,
    [jobs]
  );

  const tagNames = useMemo(() => tags.map((tag) => tag.name), [tags]);
  const folderNames = useMemo(() => folders.map((folder) => folder.name), [folders]);
  const engineReady = engines?.ready ?? false;
  const filtered = Boolean(filters.search || filters.tag || filters.folder || filters.sourceId);

  // 全局快捷键：Ctrl+K 搜索、空格播放、Delete 回收站
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        Boolean(target) &&
        (target!.tagName === 'INPUT' ||
          target!.tagName === 'TEXTAREA' ||
          target!.tagName === 'SELECT' ||
          target!.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('library-search')?.focus();
        return;
      }
      if (typing) return;
      if (event.code === 'Space' && playerId === null && view === 'library' && selectedId !== null) {
        event.preventDefault();
        openPlayer(selectedId);
      }
      if (event.key === 'Delete' && playerId === null && view === 'library' && selection.length > 0) {
        event.preventDefault();
        void trashSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPlayer, playerId, selection, selectedId, view, trashSelection]);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-ink text-fg">
      <FocusBackdrop
        item={view === 'library' && settings?.coverBackdrop !== false ? selectedItem : null}
      />
      <Sidebar
        view={view}
        onView={setView}
        stats={stats}
        tags={tags}
        folders={folders}
        smart={smart}
        sources={sources}
        auth={auth}
        engines={engines}
        activeJobs={activeJobs}
        activeSourceId={activeSourceId}
        version={info?.version}
        onSelectSource={(id) => {
          setActiveSourceId(id);
          setView('sources');
        }}
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar
          total={total}
          loading={loading}
          view={view}
          grid={layout === 'grid'}
          onToggleGrid={toggleLayout}
          onRefresh={() => void refreshAll()}
          onQualityUpgrade={() => setQualityOpen(true)}
          onImportFiles={() => void importFiles()}
          onImportFolder={() => void importFolder()}
          onBulkTag={() => {
            setBulkKind('tag');
            setBulkValue('');
          }}
          onBulkFolder={() => {
            setBulkKind('folder');
            setBulkValue('');
          }}
          onBulkRate={() => setBulkKind('rate')}
          onBulkTrash={() => void trashSelection()}
          onBulkRestore={() => void restoreSelection()}
          onBulkDelete={() => setBulkKind('delete')}
          onClearSelection={selectionClear}
          theme={theme}
          onToggleTheme={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
        />

        {isDemo ? (
          <div className="flex-none border-b border-blue/20 bg-blue/[0.07] px-4 py-1.5 text-[11px] text-blue/90">
            演示模式：当前在浏览器中预览界面，数据为示例；在 Electron 中运行即可连接本地素材库。
          </div>
        ) : null}

        {importProgress && importProgress.total > 0 ? (
          <div className="flex flex-none items-center gap-2 border-b border-blue/20 bg-blue/[0.05] px-4 py-1.5 text-[11px] text-blue/90">
            <span className="font-mono">
              导入中 {importProgress.done}/{importProgress.total}
            </span>
            <span className="min-w-0 flex-1 truncate text-dim">{importProgress.current}</span>
            <div className="h-1 w-40 overflow-hidden rounded bg-panel3">
              <div
                className="h-full bg-blue transition-all"
                style={{ width: `${(importProgress.done / Math.max(importProgress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        <main className="min-h-0 flex-1">
          {view === 'library' ? (
            <VideoGrid
              items={items}
              total={total}
              layout={layout}
              loading={loading}
              hasMore={items.length < total}
              onLoadMore={() => setLimit((value) => value + PAGE_SIZE)}
              onOpen={(id) => {
                select(id);
                openPlayer(id);
              }}
              onImport={() => void importFiles()}
              filtered={filtered}
            />
          ) : null}

          {view === 'sources' ? (
            <SourcesView
              sources={sources}
              activeSourceId={activeSourceId}
              onSelectSource={setActiveSourceId}
              loggedIn={auth?.loggedIn ?? false}
              engineReady={engineReady}
              defaultQuality={settings?.defaultQuality ?? 'best'}
              onLogin={() => setSettingsOpen(true)}
              onChanged={() => {
                bumpSources();
                bumpLibrary();
                void refreshMeta();
              }}
            />
          ) : null}

          {view === 'tasks' ? (
            <TasksView
              jobs={jobs}
              total={jobsTotal}
              engineReady={engineReady}
              onRefresh={() => void refreshJobs()}
            />
          ) : null}
        </main>
      </div>

      {inspectorOpen && selectedId !== null ? (
        <Inspector
          item={selectedItem}
          tagSuggestions={tagNames}
          folderSuggestions={folderNames}
          onClose={() => setInspectorOpen(false)}
          onRefresh={() => {
            bumpLibrary();
            void refreshMeta();
          }}
          onPlay={(id) => openPlayer(id)}
        />
      ) : null}

      {playerId !== null ? (
        <Suspense fallback={<div className="fixed inset-0 z-40 bg-black/92" />}>
          <PlayerOverlay id={playerId} onClose={closePlayer} />
        </Suspense>
      ) : null}

      {qualityOpen ? (
        <QualityUpgradeModal loggedIn={auth?.loggedIn ?? false} onClose={() => setQualityOpen(false)} />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          info={info}
          settings={settings}
          auth={auth}
          engines={engines}
          onClose={() => setSettingsOpen(false)}
          onPreview={(patch) => setSettings((prev) => (prev ? { ...prev, ...patch } : prev))}
          onReload={() => {
            void (async () => {
              const [nextSettings, nextAuth, nextInfo] = await Promise.all([
                api.settings.get(),
                api.auth.status(),
                api.app.info()
              ]);
              setSettings(nextSettings);
              setAuth(nextAuth);
              setInfo(nextInfo);
              setEngines(nextInfo.engines);
              await refreshMeta();
            })();
          }}
        />
      ) : null}

      {bulkKind === 'tag' || bulkKind === 'folder' ? (
        <Modal
          title={bulkKind === 'tag' ? '批量添加标签' : '批量移入文件夹'}
          subtitle={`将应用到 ${Math.max(selection.length, selectedId ? 1 : 0)} 个素材`}
          onClose={() => setBulkKind(null)}
          width="max-w-md"
        >
          <div className="space-y-3">
            <Field
              label={bulkKind === 'tag' ? '标签名称' : '文件夹名称'}
              hint={bulkKind === 'tag' ? '已存在的标签会直接复用' : '不存在的文件夹会自动创建'}
            >
              <TextInput
                autoFocus
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void applyBulk(bulkKind === 'tag' ? 'retag' : 'refolder');
                }}
                list={bulkKind === 'tag' ? 'bulk-tag-list' : 'bulk-folder-list'}
                placeholder={bulkKind === 'tag' ? '例如：项目A/参考' : '例如：项目 A'}
              />
            </Field>
            <datalist id="bulk-tag-list">
              {tagNames.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
            <datalist id="bulk-folder-list">
              {folderNames.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setBulkKind(null)}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void applyBulk(bulkKind === 'tag' ? 'retag' : 'refolder')}
              >
                应用
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {bulkKind === 'rate' ? (
        <Modal
          title="批量评分"
          subtitle={`将应用到 ${Math.max(selection.length, selectedId ? 1 : 0)} 个素材`}
          onClose={() => setBulkKind(null)}
          width="max-w-sm"
        >
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((rating) => (
              <Button key={rating} variant={rating === 0 ? 'subtle' : 'primary'} size="sm" onClick={() => void applyRate(rating)}>
                {rating === 0 ? '清除评分' : `${rating} 星`}
              </Button>
            ))}
          </div>
        </Modal>
      ) : null}

      {bulkKind === 'delete' ? (
        <Modal
          title="从素材库彻底删除？"
          subtitle="只删除数据库记录，不会删除磁盘上的视频文件"
          onClose={() => setBulkKind(null)}
          width="max-w-md"
        >
          <div className="space-y-3">
            <p className="text-[12px] leading-5 text-muted">
              将移除 <span className="font-mono text-pink">{selection.length}</span> 条记录及其标签/文件夹关联。
              视频文件仍会保留在素材库目录中；如需彻底清理，请手动删除对应文件夹。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setBulkKind(null)}>
                取消
              </Button>
              <Button variant="danger" size="sm" onClick={() => void deleteSelection()}>
                确认删除记录
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ToastHost />
    </div>
  );
}
