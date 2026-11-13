import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  LogIn,
  LogOut,
  RefreshCw,
  Shield,
  Terminal,
  Wrench
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfoResponse, AppSettings, AuthStatus, EngineStatus, QualityPreset } from '@shared/types';
import { api } from '../lib/bridge';
import { useUi } from '../lib/store';
import { Button, Chip, Field, Modal, Select, Tag, TextInput, Toggle } from './ui';

interface SettingsDialogProps {
  info: AppInfoResponse | null;
  settings: AppSettings | null;
  auth: AuthStatus | null;
  engines: EngineStatus | null;
  onClose: () => void;
  onReload: () => void;
}

type Tab = 'library' | 'download' | 'engine' | 'account' | 'about';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'library', label: '素材库' },
  { key: 'download', label: '下载' },
  { key: 'engine', label: '引擎' },
  { key: 'account', label: '账号' },
  { key: 'about', label: '关于' }
];

const QUALITY_OPTIONS: Array<{ value: QualityPreset; label: string }> = [
  { value: 'best', label: '最高画质（4K / 8K 优先，推荐）' },
  { value: 'compat', label: '1080P 兼容优先（H.264）' },
  { value: '720', label: '720P 省空间' },
  { value: 'audio', label: '仅音频' }
];

const TOOL_LABEL: Record<string, string> = {
  ytdlp: 'yt-dlp（下载引擎）',
  ffmpeg: 'ffmpeg（合并 / 抽帧）',
  ffprobe: 'ffprobe（媒体探测）'
};

export function SettingsDialog({ info, settings, auth, engines, onClose, onReload }: SettingsDialogProps) {
  const pushToast = useUi((state) => state.pushToast);
  const [tab, setTab] = useState<Tab>('library');
  const [local, setLocal] = useState<AppSettings | null>(settings);
  const [busy, setBusy] = useState(false);

  // 父组件异步加载/刷新设置后同步到本地表单，避免弹窗里显示旧值
  useEffect(() => {
    if (settings) setLocal(settings);
  }, [settings]);

  const update = async (patch: Partial<AppSettings>) => {
    if (!local) return;
    setLocal({ ...local, ...patch });
    try {
      const next = await api.settings.update(patch);
      setLocal(next);
      onReload();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const relocate = async (target?: string) => {
    setBusy(true);
    try {
      const root = await api.settings.relocate(target);
      setLocal((prev) => (prev ? { ...prev, libraryRoot: root } : prev));
      pushToast('success', `素材库已迁移到 ${root}`);
      onReload();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const relocateToPicked = async () => {
    try {
      const target = await api.settings.chooseLibraryRoot();
      if (!target) return;
      await relocate(target);
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    try {
      const result = await api.library.rebuild();
      pushToast('success', `已扫描 ${result.scanned} 个 sidecar，恢复 ${result.restored} 条记录`);
      onReload();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    try {
      const target = await api.library.backup();
      if (target) pushToast('success', `数据库已备份：${target}`);
      else pushToast('warn', '未生成备份，请查看日志');
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refreshEngines = async () => {    setBusy(true);
    try {
      await api.engine.refresh();
      onReload();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickTool = async (kind: 'ytdlp' | 'ffmpeg' | 'ffprobe') => {
    setBusy(true);
    try {
      await api.engine.pick(kind);
      onReload();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setBusy(true);
    try {
      const status = await api.auth.login();
      if (status.loggedIn) pushToast('success', `已登录：${status.name ?? ''}`);
      else pushToast('info', '登录窗口已关闭，仍未检测到登录态');
      onReload();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await api.auth.logout();
      pushToast('info', '已清除本机登录态');
      onReload();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  return (
    <Modal title="设置" subtitle="所有配置保存在本机；不包含任何云端同步" onClose={onClose} width="max-w-4xl">
      <div className="flex gap-5">
        <nav className="w-32 flex-none">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={clsx(
                'mb-0.5 flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                tab === item.key ? 'bg-panel2 text-fg' : 'text-muted hover:bg-panel2/60 hover:text-fg'
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === 'library' ? (
            <div className="space-y-4">
              <Field
                label="素材库目录"
                hint="默认跟随程序启动目录（开发模式即项目目录，打包后在 exe 同级）。媒体、数据库、缓存都放在这里，可整体搬走。"
              >
                <div className="flex items-center gap-2">
                  <TextInput
                    value={local?.libraryRoot ?? ''}
                    readOnly
                    className="min-w-0 flex-1 font-mono text-[11.5px]"
                  />
                  <Button
                    variant="subtle"
                    className="flex-none whitespace-nowrap"
                    onClick={() => void relocateToPicked()}
                    disabled={busy}
                  >
                    <FolderOpen size={13} />
                    迁移到…
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-none whitespace-nowrap"
                    onClick={() => void relocate()}
                    disabled={busy}
                  >
                    用默认位置
                  </Button>
                </div>
              </Field>

              <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-2">
                <div className="text-[12px] font-medium text-fg">维护</div>
                <p className="mt-1 text-[11px] leading-4 text-dim">
                  从每个视频目录的 metadata.json 重建索引，适合搬库或数据库损坏时使用。不会移动/删除视频文件。
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="subtle" size="sm" onClick={() => void rebuild()} disabled={busy}>
                    <RefreshCw size={12} className={busy ? 'animate-spin' : undefined} />
                    重建索引
                  </Button>
                  <Button variant="subtle" size="sm" onClick={() => void backup()} disabled={busy}>
                    <HardDrive size={12} />
                    备份数据库
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void api.app.openLogs()}>
                    <Terminal size={12} />
                    打开日志目录
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-2 text-[11px] leading-5 text-dim">
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-fg">
                  <Shield size={13} className="text-green" />
                  使用边界
                </div>
                本工具仅用于个人、本地备份你自己有权访问的内容；不绕过登录态、会员/付费内容或平台风控，不提供分享/再分发功能。
                请遵守平台条款与著作权法规。
              </div>
            </div>
          ) : null}

          {tab === 'download' ? (
            <div className="space-y-4">
              <Field label="默认画质" hint="下载任务可在加入队列时单独覆盖。">
                <Select
                  value={local?.defaultQuality ?? 'compat'}
                  onChange={(value) => void update({ defaultQuality: value as QualityPreset })}
                  options={QUALITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="并发下载数" hint="太多容易触发平台风控，建议 1–2。">
                  <TextInput
                    type="number"
                    min={1}
                    max={4}
                    value={local?.concurrency ?? 2}
                    onChange={(event) => void update({ concurrency: Number(event.target.value) || 1 })}
                  />
                </Field>
                <Field label="请求间隔（毫秒）" hint="列表拉取的串行间隔，600ms 较稳妥。">
                  <TextInput
                    type="number"
                    min={200}
                    max={5000}
                    step={100}
                    value={local?.requestDelayMs ?? 600}
                    onChange={(event) => void update({ requestDelayMs: Number(event.target.value) || 600 })}
                  />
                </Field>
              </div>

              <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-1">
                <Toggle
                  checked={local?.writeNfo ?? false}
                  onChange={(next) => void update({ writeNfo: next })}
                  label="生成 NFO / poster"
                  hint="开启后会被 Emby / Jellyfin 识别为媒体库；默认关闭以保持目录干净。"
                />
                <div className="h-px bg-line2" />
                <Toggle
                  checked={local?.autoTagSource ?? true}
                  onChange={(next) => void update({ autoTagSource: next })}
                  label="自动打来源标签"
                  hint="用收藏夹/稍后再看名称作为自动标签，可随时删除。"
                />
                <div className="h-px bg-line2" />
                <Toggle
                  checked={local?.autoTagUp ?? true}
                  onChange={(next) => void update({ autoTagUp: next })}
                  label="自动打 UP 主标签"
                />
                <div className="h-px bg-line2" />
                <Toggle
                  checked={local?.autoTagZone ?? true}
                  onChange={(next) => void update({ autoTagZone: next })}
                  label="自动打平台标签"
                  hint="使用视频公开标签（最多 8 个），仅供本地检索。"
                />
              </div>
            </div>
          ) : null}

          {tab === 'engine' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11.5px] leading-5 text-dim">
                  引擎以独立进程运行，可随时替换。推荐把 yt-dlp.exe 与 ffmpeg.exe / ffprobe.exe 放在同一目录。
                </p>
                <Button variant="subtle" size="sm" onClick={() => void refreshEngines()} disabled={busy}>
                  <RefreshCw size={12} className={busy ? 'animate-spin' : undefined} />
                  重新检测
                </Button>
              </div>

              {engines?.tools.map((tool) => (
                <div key={tool.kind} className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {tool.ok ? (
                      <CheckCircle2 size={13} className="text-green" />
                    ) : (
                      <AlertTriangle size={13} className="text-yellow" />
                    )}
                    <span className="text-[12.5px] text-fg">{TOOL_LABEL[tool.kind] ?? tool.kind}</span>
                    {tool.ok ? (
                      <Tag tone="green">{tool.version}</Tag>
                    ) : (
                      <Tag tone="yellow">未找到</Tag>
                    )}
                    {tool.origin !== 'missing' ? (
                      <Tag tone="default">
                        {tool.origin === 'bundled' ? '内置' : tool.origin === 'path' ? 'PATH' : '自定义'}
                      </Tag>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => void pickTool(tool.kind)}
                      disabled={busy}
                    >
                      <Wrench size={12} />
                      选择
                    </Button>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10.5px] text-dim" title={tool.path ?? ''}>
                    {tool.path ?? '尚未配置'}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === 'account' ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'h-2 w-2 rounded-full',
                      auth?.loggedIn ? 'bg-green' : 'bg-yellow'
                    )}
                  />
                  <span className="text-[13px] text-fg">
                    {auth?.loggedIn ? auth.name ?? '已登录' : '未登录'}
                  </span>
                  {auth?.mid ? <Tag tone="default">UID {auth.mid}</Tag> : null}
                  <div className="ml-auto flex gap-1.5">
                    <Button variant="primary" size="sm" onClick={() => void login()} disabled={busy}>
                      <LogIn size={12} />
                      登录
                    </Button>
                    <Button variant="subtle" size="sm" onClick={() => void logout()} disabled={!auth?.loggedIn}>
                      <LogOut size={12} />
                      退出
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-dim">
                  登录在独立窗口完成，凭据仅保存在本机（Electron 加密存储）；不会上传，也不保存密码。
                  只有登录后才能读取你的收藏夹与稍后再看。
                </p>
              </div>

              <div className="rounded-lg border border-line/70 bg-panel2/40 px-3 py-2 text-[11px] leading-5 text-dim">
                <div className="mb-1 text-[12px] font-medium text-fg">同步策略</div>
                当前版本只支持手动同步：先拉列表，再由你勾选需要下载的条目。不会自动追更，也不会在后台批量请求。
              </div>
            </div>
          ) : null}

          {tab === 'about' ? (
            <div className="space-y-3 text-[12px] leading-6 text-muted">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="text-dim">版本</div>
                <div className="font-mono">{info?.version ?? '—'}</div>
                <div className="text-dim">Electron</div>
                <div className="font-mono">{info?.electron ?? '—'}</div>
                <div className="text-dim">Chromium</div>
                <div className="font-mono">{info?.chrome ?? '—'}</div>
                <div className="text-dim">Node</div>
                <div className="font-mono">{info?.node ?? '—'}</div>
                <div className="text-dim">平台</div>
                <div className="font-mono">{info?.platform ?? '—'}</div>
                <div className="text-dim">素材库</div>
                <div className="truncate font-mono" title={info?.libraryRoot ?? ''}>
                  {info?.libraryRoot ?? '—'}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                <Chip>本地优先</Chip>
                <Chip>SQLite FTS5</Chip>
                <Chip>Artplayer</Chip>
                <Chip>yt-dlp</Chip>
                <Chip>FFmpeg</Chip>
              </div>

              <p className="pt-1 text-[11px] leading-5 text-dim">
                非官方个人工具，与哔哩哔哩无关联。请仅用于备份自己有权访问的内容，不要公开传播下载内容或绕过任何访问控制。
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
