import { app } from 'electron';
import type { AppInfoResponse } from '@shared/types';
import { engineStatusAsync } from './engine/tools';
import { getSettings } from './store';

export async function appInfo(): Promise<AppInfoResponse> {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    libraryRoot: getSettings().libraryRoot,
    userData: app.getPath('userData'),
    dev: !app.isPackaged,
    engines: await engineStatusAsync()
  };
}
