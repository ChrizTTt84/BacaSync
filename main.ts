import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import * as cron from 'node-cron';
import type { AppSettings, JobRuntimeInfo, SyncJob, TreeNode } from './types';
import { JobManager } from './core/JobManager';
import { SettingsManager } from './core/SettingsManager';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settingsManager: SettingsManager | null = null;

const quitting: { flag: boolean } = { flag: false };

const jobManager = new JobManager();

/**
 * Resuelve la ruta de renderer (index.html, styles.css, app.js) con FALLBACK MULTI-RUTA.
 * En produccion (app.asar empaquetado por electron-builder) __dirname vive dentro
 * de <resources>/app.asar/dist. Pero a veces electron-builder coloca los archivos
 * con estructuras ligeramente distintas dependiendo de la version. Probamos todos.
 * Si no existe NINGUNO, devuelve null y la UI lo notifica al usuario.
 */
function resolveRendererFile(filename: 'index.html' | 'styles.css' | 'app.js' | 'preload.js'): string | null {
  const candidates = [
    // Caso estandar: dist/main.js, asi que renderer es el hermano dist/renderer/
    path.join(__dirname, 'renderer', filename),
    // Caso electron-builder que aplana la salida:
    path.join(__dirname, '..', 'renderer', filename),
    // Caso super aplanado (archivos directamente en la raiz del asar):
    path.join(__dirname, '..', filename),
    // Caso app esta en resources/app/:
    path.join(process.resourcesPath, 'app', 'dist', 'renderer', filename),
    path.join(process.resourcesPath, 'app', 'renderer', filename),
    // Caso NO empaquetado (desarrollo npm start):
    path.join(__dirname, '..', '..', 'src', 'renderer', filename),
    path.join(__dirname, '..', '..', 'dist', 'renderer', filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore EPERM etc, sigue con el siguiente candidato.
    }
  }
  return null;
}

/**
 * Carga el HTML del renderer. Usa loadURL + pathToFileURL (es MUCHO mas fiable
 * en app.asar empaquetado que loadFile, que a veces resuelve mal las rutas).
 * Ademas atrapa fallos con did-fail-load y muestra al usuario un mensaje claro.
 */
function loadRendererUI(w: BrowserWindow): void {
  const idx = resolveRendererFile('index.html');
  const preload = resolveRendererFile('preload.js');
  if (!idx) {
    const msg =
      'No se encontraron los archivos de la interfaz (index.html).\n' +
      'Esto indica un error al empaquetar o instalar BacaSync.\n' +
      'Por favor desinstala y vuelve a instalar la aplicacion.\n\n' +
      'Ruta esperada: ' + path.join(__dirname, 'renderer', 'index.html') + '\n' +
      '__dirname (main.js): ' + __dirname + '\n' +
      'isPackaged: ' + String(app.isPackaged) + '\n' +
      'resourcesPath: ' + process.resourcesPath;
    console.error('[BacaSync Main] Missing renderer file: index.html. Details:', {
      __dirname,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      preload,
    });
    try { dialog.showErrorBox('BacaSync: Error al iniciar (archivos UI faltantes)', msg); } catch {}
    try { w.loadURL('about:blank'); } catch {}
    return;
  }

  const fileUrl = url.pathToFileURL(idx).href;
  console.log('[BacaSync Main] Loading UI:', idx, '-> URL:', fileUrl, '(preload:', preload ?? 'n/a', ')');
  w.webContents.once('did-fail-load', (_e, errCode, errDesc, validatedUrl) => {
    const msg =
      'No se pudo cargar la interfaz de BacaSync.\n' +
      'Codigo error: ' + errCode + ' (' + (errDesc || '') + ')\n' +
      'URL: ' + (validatedUrl || fileUrl) + '\n\n' +
      'Acciones recomendadas:\n' +
      '1) Desinstala y vuelve a instalar BacaSync desde el ZIP nuevo.\n' +
      '2) Comprueba que el antivirus no borro archivos dentro de resources/app.asar.\n\n' +
      'Detalles tecnicos:\n' +
      '__dirname: ' + __dirname + '\n' +
      'index encontrado en: ' + idx + '\n' +
      'resourcesPath: ' + process.resourcesPath;
    console.error('[BacaSync Main] did-fail-load renderer:', { errCode, errDesc, validatedUrl, idx, __dirname, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });
    try { dialog.showErrorBox('BacaSync: Pantalla blanca - fallo al cargar UI', msg); } catch {}
  });
  w.loadURL(fileUrl).catch((err) => {
    console.error('[BacaSync Main] loadURL threw (unhandled):', err && err.message || err);
  });
}

function createWindow() {
  const preloadCandidate = resolveRendererFile('preload.js') ?? path.join(__dirname, 'preload.js');
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: !settingsManager?.get().startMinimized,
    autoHideMenuBar: true,
    icon: getWindowIcon(),
    webPreferences: {
      preload: preloadCandidate,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (settingsManager?.get().startMinimized) {
    mainWindow.hide();
  }

  try {
    const wic = getWindowIcon();
    if (wic && !wic.isEmpty()) {
      mainWindow.setIcon(wic);
      if (process.platform === 'darwin') app.dock?.setIcon(wic);
    }
  } catch {
    /* ignore icon assignment errors */
  }

  loadRendererUI(mainWindow);

  mainWindow.on('close', async (e) => {
    if (quitting.flag || !mainWindow) return;
    e.preventDefault();
    try {
      await jobManager.flushOnExitJobs();
    } catch {
      /* ignore flush errors on close */
    }
    mainWindow.hide();
    ensureTray();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function ensureTray() {
  try {
    const ico = buildTrayIcon();
    if (!tray) {
      tray = new Tray(ico);
    } else {
      tray.setImage(ico);
    }
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Abrir BacaSync', click: () => showMain() },
      { type: 'separator' },
      { label: 'Salir', click: () => quitApp() },
    ]);
    tray.setToolTip('BacaSync');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => showMain());
    try {
      if (process.platform === 'darwin') {
        const pressed = buildTrayIcon();
        tray.setPressedImage(pressed);
      }
    } catch { /* ignore */ }
  } catch (e) {
    // Tray unavailable in some dev environments — ignore.
  }
}

function resolveAssetPath(...sub: string[]): string {
  if (app.isPackaged) {
    // electron-builder copia assets/ a resources/icons via extraResources
    return path.join(process.resourcesPath, 'icons', ...sub);
  }
  return path.join(__dirname, '..', 'assets', ...sub);
}

let cachedFallbackPng: { b16: Buffer; b32: Buffer } | null = null;
function getFallbackPng() {
  if (cachedFallbackPng) return cachedFallbackPng;
  try {
    // Primero .js (GitHub Actions es case-sensitive y prefiere .js)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modAny = require(resolveAssetPath('icon-fallback.js'));
    const mod = modAny as any;
    if (mod && typeof mod.base64_16 === 'string' && typeof mod.base64_32 === 'string') {
      cachedFallbackPng = {
        b16: Buffer.from(mod.base64_16, 'base64'),
        b32: Buffer.from(mod.base64_32, 'base64'),
      };
      return cachedFallbackPng;
    }
  } catch {
    try {
      // Compatibilidad con versiones antiguas (icon-fallback.cjs)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(resolveAssetPath('icon-fallback.cjs')) as any;
      if (mod && typeof mod.base64_16 === 'string' && typeof mod.base64_32 === 'string') {
        cachedFallbackPng = {
          b16: Buffer.from(mod.base64_16, 'base64'),
          b32: Buffer.from(mod.base64_32, 'base64'),
        };
        return cachedFallbackPng;
      }
    } catch { /* ignore */ }
  }
  // Ultimo recurso: genera un mini PNG 16x16 y 32x32 a "mano" (morado/azul) sin archivos.
  // De esta forma el usuario NUNCA vera un icono en blanco / vacio.
  cachedFallbackPng = {
    b16: makeMinimalPng(16, (x, y) => {
      const cx = 7.5, cy = 7.5, r = 7;
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) return [0, 0, 0, 0];
      const t = d / r;
      const R = Math.round(124 - 92 * t), G = Math.round(107 + 16 * t), B = 255;
      return [R, G, B, 255];
    }),
    b32: makeMinimalPng(32, (x, y) => {
      const cx = 15.5, cy = 15.5, r = 14.5;
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) return [0, 0, 0, 0];
      const t = d / r;
      const R = Math.round(124 - 92 * t), G = Math.round(107 + 16 * t), B = 255;
      // flechas minimalistas blancas en centro (pixel-art 32x32: dos flechas opuestas)
      const nx = x - cx, ny = y - cy;
      const inUpperArc = Math.abs(Math.hypot(nx, ny) - 7.5) < 1.6 && ny < 0 && nx < 7;
      const inLowerArc = Math.abs(Math.hypot(nx, ny) - 7.5) < 1.6 && ny > 0 && nx > -7;
      // puntas flechas
      const tipR = nx > 9 && ny > -4.5 && ny < -1 && Math.abs(ny + 2.5) < 3 && Math.abs(nx - 11) < 2;
      const tipL = nx < -9 && ny > 1 && ny < 4.5 && Math.abs(ny - 2.5) < 3 && Math.abs(nx + 11) < 2;
      if (inUpperArc || inLowerArc || tipR || tipL) return [255, 255, 255, 255];
      return [R, G, B, 255];
    }),
  };
  return cachedFallbackPng;
}

/** Make an RGBA PNG in pure JS (no dependencies). Used only as last-resort fallback. */
function makeMinimalPng(size: number, rgba: (x: number, y: number) => [number, number, number, number]): Buffer {
  const w = size, h = size;
  const zlib = require('zlib') as typeof import('zlib');
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = rgba(x, y);
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const crc32 = (buf: Buffer, from: number, to: number) => {
    let c = 0xffffffff;
    for (let i = from; i < to; i++) {
      c = (-306674912 ^ ((c ^ buf[i]) & 0xff) >>> 0) >>> 0;
      for (let k = 1; k < 8; k++) c = ((c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)) >>> 0;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const tBuf = Buffer.from(type, 'ascii');
    const piece = Buffer.concat([tBuf, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(piece, 0, piece.length), 0);
    return Buffer.concat([len, piece, crc]);
  };
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function buildTrayIcon() {
  const candidates = [
    resolveAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon-32.png'),
    resolveAssetPath('icon-32.png'),
    resolveAssetPath('icon-16.png'),
    resolveAssetPath('icon.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch { /* ignore */ }
  }
  // Fallback: buffer PNG hardcodeado (32x32, siempre visible, sin archivos).
  try {
    const fb = getFallbackPng();
    const img = nativeImage.createFromBuffer(fb.b32);
    if (!img.isEmpty()) return img;
  } catch { /* ignore */ }
  try {
    return nativeImage.createFromBuffer(getFallbackPng().b16);
  } catch {
    return nativeImage.createEmpty();
  }
}

function getWindowIcon() {
  const candidates = [
    resolveAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    resolveAssetPath('icon.png'),
    resolveAssetPath('icon-32.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch { /* ignore */ }
  }
  try {
    return nativeImage.createFromBuffer(getFallbackPng().b32);
  } catch {
    return undefined;
  }
}

function showMain() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function quitApp() {
  quitting.flag = true;
  try {
    await jobManager.flushOnExitJobs();
  } catch {
    /* ignore */
  }
  app.quit();
}

async function applyAutoStart(settings: AppSettings) {
  try {
    const pathToExe = process.execPath;
    const args = ['--hidden'];
    await app.setLoginItemSettings({
      openAtLogin: !!settings.autoStartOnBoot,
      openAsHidden: !!(settings.launchMinimizedToTray || settings.startMinimized),
      path: pathToExe,
      args: settings.autoStartOnBoot ? args : [],
    });
    try {
      const status = app.getLoginItemSettings();
      console.log('[BacaSync Main] Auto-Start settings:', JSON.stringify(status));
    } catch { /* macOS older versions may throw on getLoginItemSettings */ }
  } catch (e) {
    const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as any).message) : String(e);
    console.warn('[BacaSync Main] applyAutoStart no disponible (plataforma/OS viejo?):', msg);
  }
}

app.whenReady().then(async () => {
  settingsManager = new SettingsManager();

  try {
    await applyAutoStart(settingsManager.get());
  } catch {
    /* ignore */
  }

  jobManager.on((evt) => {
    mainWindow?.webContents.send('job:event', evt);
  });
  jobManager.rescheduleAll();

  const launchHidden = process.argv.includes('--hidden') || !!settingsManager.get().startMinimized;
  if (!launchHidden) {
    createWindow();
  } else {
    createWindow();
    mainWindow?.hide();
    ensureTray();
  }

  if (process.platform === 'darwin') {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        showMain();
      }
    });
  }
});

app.on('before-quit', async () => {
  quitting.flag = true;
  try {
    await jobManager.flushOnExitJobs();
  } catch {
    /* ignore */
  }
});

app.on('window-all-closed', () => {
  // Mantener corriendo en bandeja. Solo salir via menu Salir / quitApp()
});

/* =============== IPC Handlers =============== */

ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.on('shell:openPath', (_e, p) => {
  if (typeof p === 'string') shell.openPath(p);
});

ipcMain.handle('settings:get', () => settingsManager?.get() ?? {
  autoStartOnBoot: false,
  startMinimized: false,
  launchMinimizedToTray: false,
});

ipcMain.handle('settings:set', async (_e, patch: Partial<AppSettings>) => {
  if (!settingsManager) throw new Error('Settings not ready');
  const updated = settingsManager.update(patch);
  try {
    await applyAutoStart(updated);
  } catch {
    /* ignore */
  }
  try {
    ensureTray();
  } catch { /* ignore */ }
  return updated;
});

ipcMain.handle('jobs:list', () => jobManager.listJobs());
ipcMain.handle('jobs:save', (_e, job: SyncJob) => jobManager.saveJob(job));
ipcMain.handle('jobs:delete', (_e, id: string) => jobManager.deleteJob(id));

function notifyError(err: any): void {
  try {
    const msg = err && typeof err === 'object' && err.message ? String(err.message) : String(err);
    console.error('[BacaSync Main] Sync error:', err);
    mainWindow?.webContents.send('job:error', msg);
  } catch { /* ignore */ }
}

ipcMain.handle('jobs:run', async (_e, id: string) => {
  try { return await jobManager.runJob(id); } catch (err) { notifyError(err); throw err; }
});
ipcMain.handle('jobs:push', async (_e, id: string) => {
  try { return await jobManager.pushJob(id); } catch (err) { notifyError(err); throw err; }
});
ipcMain.handle('jobs:pull', async (_e, id: string) => {
  try { return await jobManager.pullJob(id); } catch (err) { notifyError(err); throw err; }
});

ipcMain.handle('jobs:listNasTree', (_e, id: string) => jobManager.getNasTree(id));

ipcMain.handle('jobs:saveIncludedPaths', (_e, payload: { id: string; includeAll: boolean; includeFiles: string[] }) =>
  jobManager.saveIncludedPaths(payload.id, payload.includeAll, payload.includeFiles)
);

function nextRunAtFromCron(expr?: string): string | undefined {
  if (!expr) return undefined;
  try {
    if (!cron.validate(expr)) return undefined;
    const task = cron.schedule(expr, () => {}, { scheduled: false });
    const anyTask = task as any;
    if (typeof anyTask.nextDates !== 'function') return undefined;
    const dates = anyTask.nextDates(1);
    const raw = Array.isArray(dates) ? dates[0] : dates;
    if (!raw) return undefined;
    const d = raw instanceof Date ? raw : raw.toDate ? raw.toDate() : new Date(String(raw));
    return d.toISOString();
  } catch {
    return undefined;
  }
}

ipcMain.handle('jobs:runtime', (): JobRuntimeInfo[] => {
  const base = jobManager.getRuntimeInfo();
  const jobs = jobManager.listJobs();
  return base.map((r) => {
    const j = jobs.find((x) => x.id === r.jobId);
    const next = j?.enabled ? nextRunAtFromCron(j.schedule) : undefined;
    return { ...r, nextRunAt: next };
  });
});

ipcMain.handle('jobs:preview', (_e, payload) => {
  if (payload && typeof payload === 'object' && payload.id) {
    return jobManager.previewJob(payload.id, payload.scope);
  }
  return jobManager.previewJob(payload as string);
});
