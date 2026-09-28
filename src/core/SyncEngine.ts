import * as fs from 'fs';
import * as path from 'path';
import type { SyncJob, SyncAction, SyncResult, JobStatus, RunScope } from '../types';

interface FileEntry {
  relativePath: string;
  size: number;
  mtime: number;
}

export type ProgressCallback = (
  stage: 'scanning' | 'copying' | 'deleting',
  current: number,
  total: number,
  currentFile?: string
) => void;

export class SyncEngine {
  private async walkDir(baseDir: string): Promise<Map<string, FileEntry>> {
    const entries = new Map<string, FileEntry>();
    if (!fs.existsSync(baseDir)) return entries;

    const walk = async (dir: string) => {
      const files = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const f of files) {
        const full = path.join(dir, f.name);
        const rel = path.relative(baseDir, full).split(path.sep).join('/');
        if (!rel) continue;
        if (f.isDirectory()) {
          await walk(full);
        } else if (f.isFile()) {
          try {
            const stat = await fs.promises.stat(full);
            entries.set(rel, {
              relativePath: rel,
              size: stat.size,
              mtime: stat.mtime.getTime(),
            });
          } catch {
            /* skip files we cannot stat */
          }
        }
      }
    };

    await walk(baseDir);
    return entries;
  }

  private filesDiffer(a: FileEntry, b: FileEntry): boolean {
    if (a.size !== b.size) return true;
    const diffMs = Math.abs(a.mtime - b.mtime);
    return diffMs > 2000;
  }

  async computeActions(
    job: SyncJob,
    scope: RunScope = 'full'
  ): Promise<SyncAction[]> {
    const actions: SyncAction[] = [];

    const [leftMap, rightMap] = await Promise.all([
      this.walkDir(job.leftPath),
      this.walkDir(job.rightPath),
    ]);

    const all = new Set<string>();
    leftMap.forEach((_, k) => all.add(k));
    rightMap.forEach((_, k) => all.add(k));

    for (const key of all) {
      const inL = leftMap.has(key);
      const inR = rightMap.has(key);
      const l = leftMap.get(key);
      const r = rightMap.get(key);

      if (inL && inR && l && r) {
        if (!this.filesDiffer(l, r)) continue;
        if (job.mode === 'two-way') {
          if (l.mtime > r.mtime) {
            actions.push({ type: 'copy-left-right', relativePath: key, size: l.size });
          } else {
            actions.push({ type: 'copy-right-left', relativePath: key, size: r.size });
          }
        } else {
          actions.push({ type: 'copy-left-right', relativePath: key, size: l.size });
        }
      } else if (inL && !inR) {
        actions.push({
          type: 'copy-left-right',
          relativePath: key,
          size: l?.size ?? 0,
        });
      } else if (!inL && inR) {
        if (job.mode === 'two-way') {
          actions.push({
            type: 'copy-right-left',
            relativePath: key,
            size: r?.size ?? 0,
          });
        } else if (job.deleteMissing) {
          actions.push({ type: 'delete-right', relativePath: key });
        }
      }
    }

    return this.applyScope(job, actions, scope);
  }

  private applyScope(job: SyncJob, actions: SyncAction[], scope: RunScope): SyncAction[] {
    if (scope === 'full') return actions;
    if (job.kind !== 'nas-cache' || !job.nasSide) return actions;

    const nasIsLeft = job.nasSide === 'left';
    return actions.filter((a) => {
      const isPull = nasIsLeft
        ? a.type === 'copy-left-right' || a.type === 'delete-right'
        : a.type === 'copy-right-left' || a.type === 'delete-left';
      const isPush = !isPull;
      return scope === 'pull-only' ? isPull : isPush;
    });
  }

  private async ensureParent(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
  }

  private async copyFileWithFallback(src: string, dst: string): Promise<void> {
    await this.ensureParent(dst);
    try {
      await fs.promises.copyFile(src, dst, fs.constants.COPYFILE_FICLONE);
    } catch {
      await fs.promises.copyFile(src, dst);
    }
    try {
      const st = await fs.promises.stat(src);
      await fs.promises.utimes(dst, st.atime, st.mtime);
    } catch {
      /* ignore utimes errors */
    }
  }

  async execute(
    job: SyncJob,
    actions: SyncAction[],
    onProgress?: ProgressCallback
  ): Promise<SyncResult> {
    const result: SyncResult = {
      jobId: job.id,
      startedAt: new Date().toISOString(),
      status: 'running' as JobStatus,
      actions,
      errors: [],
      copiedFiles: 0,
      deletedFiles: 0,
      totalBytes: 0,
    };

    const total = actions.length;
    let idx = 0;

    for (const action of actions) {
      idx++;
      onProgress?.('copying', idx, total, action.relativePath);
      try {
        if (action.type === 'copy-left-right') {
          const src = path.join(job.leftPath, action.relativePath);
          const dst = path.join(job.rightPath, action.relativePath);
          await this.copyFileWithFallback(src, dst);
          result.copiedFiles++;
          result.totalBytes += action.size ?? 0;
        } else if (action.type === 'copy-right-left') {
          const src = path.join(job.rightPath, action.relativePath);
          const dst = path.join(job.leftPath, action.relativePath);
          await this.copyFileWithFallback(src, dst);
          result.copiedFiles++;
          result.totalBytes += action.size ?? 0;
        } else if (action.type === 'delete-right') {
          const dst = path.join(job.rightPath, action.relativePath);
          await fs.promises.rm(dst, { force: true });
          result.deletedFiles++;
        } else if (action.type === 'delete-left') {
          const dst = path.join(job.leftPath, action.relativePath);
          await fs.promises.rm(dst, { force: true });
          result.deletedFiles++;
        }
      } catch (err: any) {
        result.errors.push(`${action.type} ${action.relativePath}: ${err?.message ?? err}`);
      }
    }

    result.finishedAt = new Date().toISOString();
    result.status = result.errors.length === 0 ? 'success' : 'error';
    return result;
  }
}
