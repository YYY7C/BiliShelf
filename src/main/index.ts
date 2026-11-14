import { app, BrowserWindow, nativeTheme, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { closeDatabase, openDatabase } from './db/index';
import { recoverInterruptedSyncRuns } from './db/sources';
import { reconcileFileStatus } from './db/videos';
import { registerAppProtocol, registerPrivilegedSchemes } from './protocol';
import { broadcastLibrary, registerIpc } from './ipc';
import { downloadManager } from './services/downloads';
import { biliSession, configureBiliSession, getAuthStatus } from './services/auth';
import { engineStatusAsync } from './engine/tools';
import { ensureLibraryDirs, fromLibraryRelative, libraryPaths } from './paths';

const DEV_URL = process.env['ELECTRON_RENDERER_URL'];

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = app.isPackaged ? 'warn' : 'info';
log.errorHandler.startCatching({ showDialog: false });

registerPrivilegedSchemes();

let mainWindow: BrowserWindow | null = null;

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
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setAppUserModelId('local.bilishelf.app');

  void app.whenReady().then(() => {
    try {
      const paths = ensureLibraryDirs(libraryPaths());
      log.info('[app] library root', paths.root);
      openDatabase();
      const interruptedSyncs = recoverInterruptedSyncRuns();
      if (interruptedSyncs > 0) log.info('[app] recovered interrupted sync runs', interruptedSyncs);
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
    downloadManager.start();

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

    // 临时调试：打印收藏夹接口原始响应（仅未打包时）
    const debugFav = process.env['BILISHELF_DEBUG_FAV'];
    if (debugFav && !app.isPackaged) {
      setTimeout(() => {
        void (async () => {
          try {
            const status = await getAuthStatus();
            log.info('[debug] auth', JSON.stringify({ loggedIn: status.loggedIn, mid: status.mid }));
            const mid = status.mid ?? Number(debugFav);
            const headers = { Referer: 'https://www.bilibili.com/' };
            const response = await biliSession().fetch(
              `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}&jsonp=jsonp`,
              { headers }
            );
            const body = await response.text();
            log.info(`[debug] fav -> http ${response.status} ${body.slice(0, 400)}`);
          } catch (error) {
            log.warn('[debug] fav failed', error);
          } finally {
            app.quit();
          }
        })();
      }, 2600);
    }

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
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    downloadManager.shutdown();
    closeDatabase();
  });
}
