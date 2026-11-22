import { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type { JobStatusCounts } from '@shared/types';
import { closeDatabase, openDatabase } from './db/index';
import { recoverInterruptedSyncRuns, repairRescuedItems } from './db/sources';
import { reconcileFileStatus } from './db/videos';
import { registerAppProtocol, registerPrivilegedSchemes } from './protocol';
import { broadcastLibrary, registerIpc } from './ipc';
import { downloadManager } from './services/downloads';
import { aiTaggingManager } from './services/ai/tagging';
import { configureBiliSession } from './services/auth';
import { engineStatusAsync } from './engine/tools';
import { ensureLibraryDirs, fromLibraryRelative, libraryPaths } from './paths';
import { getSettings } from './store';

const DEV_URL = process.env['ELECTRON_RENDERER_URL'];

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = app.isPackaged ? 'warn' : 'info';
log.errorHandler.startCatching({ showDialog: false });

registerPrivilegedSchemes();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayCounts: JobStatusCounts = { active: 0, pausable: 0, queued: 0, paused: 0 };
let traySyncAt = 0;
let trayHintShown = false;
let quitting = false;

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const dev = Boolean(DEV_URL);
    const policy = [
      "default-src 'self'",
      `script-src 'self' ${dev ? "'unsafe-inline' 'unsafe-eval'" : "'wasm-unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: bilishelf: https://*.hdslb.com https://*.bilibili.com https://*.biliimg.com http://*.hdslb.com http://*.bilibili.com http://*.biliimg.com",
      "media-src 'self' blob: bilishelf:",
      "font-src 'self' data:",
      `connect-src 'self' bilishelf: https://*.bilibili.com https://*.hdslb.com${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
      "worker-src 'self' blob:",
      "frame-src 'none'",
      "object-src 'none'"
    ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    });
  });
}

function hardenWindow(window: BrowserWindow): void {
  window.webContents.on('console-message', (...args: unknown[]) => {
    if (app.isPackaged) return;
    const details = args[1] as { level?: string; message?: string } | undefined;
    if (details && typeof details === 'object' && typeof details.message === 'string') {
      log.info('[renderer]', details.level ?? '', details.message);
    } else if (typeof args[2] === 'string') {
      log.info('[renderer]', args[2]);
    }
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('[renderer] process gone', details.reason, details.exitCode);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(url);
    } catch {
      // ignore malformed urls
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** 托盘图标：Windows 直接用多尺寸 .ico，其他平台用 PNG 缩到 16px。 */
function trayIcon(): Electron.NativeImage {
  const base = app.getAppPath();
  const icoPath = path.join(base, 'resources', 'icon.ico');
  const pngPath = path.join(base, 'resources', 'icon.png');
  if (process.platform === 'win32' && fs.existsSync(icoPath)) {
    const ico = nativeImage.createFromPath(icoPath);
    if (!ico.isEmpty()) return ico;
  }
  const png = fs.existsSync(pngPath) ? nativeImage.createFromPath(pngPath) : nativeImage.createEmpty();
  return png.isEmpty() ? png : png.resize({ width: 16, height: 16, quality: 'best' });
}

function buildTrayMenu(): Menu {
  const counts = trayCounts;
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: `进行中 ${counts.active} · 排队 ${counts.queued} · 已暂停 ${counts.paused}`, enabled: false },
    {
      label: '全部暂停下载',
      enabled: counts.pausable + counts.queued > 0,
      click: () => downloadManager.pauseAll()
    },
    { label: '全部开始下载', enabled: counts.paused > 0, click: () => downloadManager.resumeAll() },
    { type: 'separator' },
    { label: '打开素材库目录', click: () => void shell.openPath(libraryPaths().root) },
    { label: '打开日志目录', click: () => void shell.openPath(libraryPaths().logs) },
    { type: 'separator' },
    { label: '退出 BiliShelf', click: () => quitApp() }
  ]);
}

/** 下载进度事件很密集，托盘标题/菜单最多 2 秒刷一次。 */
function syncTray(force = false): void {
  if (!tray) return;
  const now = Date.now();
  if (!force && now - traySyncAt < 2000) return;
  traySyncAt = now;
  const counts = trayCounts;
  tray.setToolTip(`BiliShelf · 下载中 ${counts.active} · 排队 ${counts.queued} · 已暂停 ${counts.paused}`);
  tray.setContextMenu(buildTrayMenu());
}

function quitApp(): void {
  quitting = true;
  app.quit();
}

/** 设置读取失败时保持托盘常驻，避免误把后台下载一起关掉。 */
function closeToTrayEnabled(): boolean {
  try {
    return getSettings().closeToTray !== false;
  } catch {
    return true;
  }
}

function hideToTray(window: BrowserWindow): void {
  window.hide();
  syncTray(true);
  if (trayHintShown) return;
  trayHintShown = true;
  try {
    tray?.displayBalloon({
      title: 'BiliShelf 仍在后台运行',
      content: '下载与打标会继续。点击托盘图标可重新打开，右键可以暂停下载或退出。',
      iconType: 'info'
    });
  } catch (error) {
    log.warn('[app] tray balloon failed', (error as Error).message);
  }
}

function createTray(): void {
  if (tray) return;
  const image = trayIcon();
  if (image.isEmpty()) {
    log.warn('[app] tray icon missing, background mode unavailable');
    return;
  }
  tray = new Tray(image);
  tray.on('click', () => {
    const visible =
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
    if (visible) mainWindow?.hide();
    else showMainWindow();
  });
  syncTray(true);
  log.info('[app] tray ready');
}

function createWindow(): BrowserWindow {
  const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png');
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'BiliShelf',
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webgl: true
    }
  });

  hardenWindow(window);

  window.once('ready-to-show', () => window.show());

  window.on('show', () => syncTray(true));
  window.on('close', (event) => {
    if (quitting) return;
    if (!closeToTrayEnabled()) return;
    event.preventDefault();
    hideToTray(window);
  });

  if (DEV_URL) {
    void window.loadURL(DEV_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.setAppUserModelId('local.bilishelf.app');

  void app.whenReady().then(() => {
    try {
      const paths = ensureLibraryDirs(libraryPaths());
      log.info('[app] library root', paths.root);
      openDatabase();
      const interruptedSyncs = recoverInterruptedSyncRuns();
      if (interruptedSyncs > 0) log.info('[app] recovered interrupted sync runs', interruptedSyncs);
      // 启动时先修一遍「B 站失效但本地有副本」的条目，它们不该继续挂在失效列表里
      const repairedItems = repairRescuedItems();
      if (repairedItems > 0) log.info('[app] repaired rescued items', repairedItems);
      // 日志写进素材库目录，和「设置 → 打开日志目录」保持一致
      log.transports.file.resolvePathFn = () => path.join(libraryPaths().logs, 'main.log');
    } catch (error) {
      log.error('[app] failed to open library', error);
    }

    configureBiliSession();
    registerAppProtocol();
    installContentSecurityPolicy();

    // 原生标题栏跟随应用主题；默认深色，渲染进程加载后会同步用户选择
    nativeTheme.themeSource = 'dark';

    mainWindow = createWindow();
    registerIpc(() => mainWindow);
    createTray();
    downloadManager.onChange((snapshot) => {
      trayCounts = snapshot.counts;
      syncTray();
    });
    downloadManager.start();
    aiTaggingManager.start();

    // 开发自检：BILISHELF_CAPTURE=<png 路径> 时截图后退出
    const captureTarget = process.env['BILISHELF_CAPTURE'];
    if (captureTarget && !app.isPackaged) {
      setTimeout(() => {
        void (async () => {
          try {
            const size = process.env['BILISHELF_CAPTURE_SIZE'];
            if (size && mainWindow) {
              const [width, height] = size.split('x').map((value) => Number(value));
              if (width > 0 && height > 0) mainWindow.setContentSize(width, height);
              await new Promise((resolve) => setTimeout(resolve, 400));
            }
            const script = process.env['BILISHELF_CAPTURE_JS'];
            if (script) {
              const result = await mainWindow?.webContents.executeJavaScript(script, true).catch((error) => {
                log.warn('[dev] capture script failed', error);
                return 'ERROR';
              });
              log.info('[dev] capture script result', JSON.stringify(result));
              const waitMs = Number(process.env['BILISHELF_CAPTURE_WAIT'] ?? 2600);
              await new Promise((resolve) => setTimeout(resolve, Number.isFinite(waitMs) ? waitMs : 2600));
            }
            const image = await mainWindow?.webContents.capturePage();
            if (image) fs.writeFileSync(captureTarget, image.toPNG());
            log.info('[dev] captured', captureTarget);
          } catch (error) {
            log.warn('[dev] capture failed', error);
          } finally {
            if (process.env['BILISHELF_CAPTURE_HOLD'] !== '1') app.quit();
          }
        })();
      }, 4200);
    }

    // 引擎探测放在窗口之后，避免拖慢启动
    setTimeout(() => {
      void engineStatusAsync(true).then((status) => log.info('[app] engine ready =', status.ready));
    }, 1200);

    // 延迟校验文件是否还在（搬移/删除后标记为「文件缺失」）
    setTimeout(() => {
      try {
        const root = libraryPaths().root;
        const changed = reconcileFileStatus((relative) => fs.existsSync(fromLibraryRelative(root, relative)));
        if (changed > 0) {
          broadcastLibrary();
          log.info('[app] marked missing files', changed);
        }
      } catch (error) {
        log.warn('[app] reconcile failed', error);
      }
    }, 3200);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      } else {
        showMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (quitting) return;
    // 收进托盘模式下应用常驻后台继续下载
    if (closeToTrayEnabled()) return;
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    tray?.destroy();
    tray = null;
    downloadManager.shutdown();
    aiTaggingManager.shutdown();
    closeDatabase();
  });
}
