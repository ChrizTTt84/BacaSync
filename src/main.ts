import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import { JobManager } from './core/JobManager';

let mainWindow: BrowserWindow | null = null;
let jobManager: JobManager;
let isQuitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'BacaSync',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const indexPath = path.join(app.getAppPath(), 'src', 'renderer', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('close', async (e) => {
    if (isQuitting) return;
    e.preventDefault();
    const w = mainWindow;
    isQuitting = true;
    try {
      await jobManager.flushOnExitJobs();
    } catch {
      /* ignore */
    }
    w?.destroy();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  jobManager = new JobManager(app.getPath('userData'));
  jobManager.onEvent((evt) => {
    mainWindow?.webContents.send('job:event', evt);
  });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc(): void {
  ipcMain.handle('jobs:list', () => jobManager.listJobs());

  ipcMain.handle('jobs:save', (_e, job) => jobManager.saveJob(job));

  ipcMain.handle('jobs:delete', (_e, id: string) => jobManager.deleteJob(id));

  ipcMain.handle('jobs:run', (_e, id: string) => jobManager.runJob(id));

  ipcMain.handle('jobs:push', (_e, id: string) => jobManager.pushJob(id));

  ipcMain.handle('jobs:pull', (_e, id: string) => jobManager.pullJob(id));

  ipcMain.handle('jobs:preview', (_e, payload) => {
    if (payload && typeof payload === 'object') {
      return jobManager.previewJob(payload.id, payload.scope);
    }
    return jobManager.previewJob(payload as string);
  });

  ipcMain.handle('jobs:runtime', () => jobManager.getRuntimeInfo());

  ipcMain.handle('dialog:openFolder', async () => {
    if (!mainWindow) return null;
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  ipcMain.on('shell:openPath', (_e, p: string) => {
    if (p) shell.openPath(p);
  });
}
