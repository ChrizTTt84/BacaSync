import * as fs from 'fs';
import * as path from 'path';
import * as cron from 'node-cron';
import { EventEmitter } from 'events';
import { app } from 'electron';
import type { SyncJob, SyncAction, SyncResult, JobStatus, JobRuntimeInfo, RunScope, TreeNode } from '../types';
import { SyncEngine } from './SyncEngine';

type JobEvent =
  | { type: 'status'; jobId: string; status: JobStatus; progress?: JobRuntimeInfo['progress'] }
  | { type: 'result'; jobId: string; result: SyncResult }
  | { type: 'list-changed' };

export class JobManager {
  private dataDir: string;
  private jobsFile: string;
  private jobs: SyncJob[] = [];
  private engine: SyncEngine = new SyncEngine();
  private emitter = new EventEmitter();
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private runtime: Map<string, JobRuntimeInfo> = new Map();
  private lastResult: Map<string, SyncResult> = new Map();

  constructor(userDataDir?: string) {
    try {
      this.dataDir = userDataDir || app.getPath('userData');
    } catch {
      this.dataDir = userDataDir || path.resolve(process.cwd(), 'bacasync-data');
    }
    this.jobsFile = path.join(this.dataDir, 'bacasync-jobs.json');
    this.ensureDataDir();
    this.load();
    this.scheduleAll();
  }

  on(listener: (evt: JobEvent) => void): () => void {
    const wrapped = (d: any) => listener(d);
    this.emitter.on('event', wrapped);
    return () => this.emitter.off('event', wrapped);
  }

  rescheduleAll(): void {
    this.scheduleAll();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.jobsFile)) {
        const raw = fs.readFileSync(this.jobsFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.jobs = parsed.map((rawJob: any) => this.migrateJob(rawJob));
        } else {
          this.jobs = [];
        }
      }
    } catch (err) {
      console.warn('[JobManager] No se pudieron cargar los jobs, se resetea a lista vacía:', err);
      this.jobs = [];
    }
  }

  private migrateJob(raw: any): SyncJob {
    const base: SyncJob = {
      id: String(raw.id || ('legacy_' + Math.random().toString(36).slice(2, 8))),
      name: String(raw.name || 'Tarea importada'),
      leftPath: String(raw.leftPath || raw.leftFolder || raw.source || ''),
      rightPath: String(raw.rightPath || raw.rightFolder || raw.dest || ''),
      mode: (raw.mode === 'two-way' || raw.mode === 'one-way-left-to-right' ? raw.mode : 'one-way-left-to-right') as SyncJob['mode'],
      kind: (raw.kind === 'nas-cache' || raw.kind === 'normal' ? raw.kind : 'normal') as SyncJob['kind'],
      schedule: typeof raw.schedule === 'string' && raw.schedule.length ? raw.schedule : undefined,
      deleteMissing: typeof raw.deleteMissing === 'boolean' ? raw.deleteMissing : false,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt.length
        ? raw.createdAt
        : new Date().toISOString(),
    };
    if (base.kind === 'nas-cache') {
      base.nasSide = (raw.nasSide === 'left' || raw.nasSide === 'right') ? raw.nasSide : 'left';
      base.flushOnExit = typeof raw.flushOnExit === 'boolean' ? raw.flushOnExit : true;
      base.includeAll = typeof raw.includeAll === 'boolean' ? raw.includeAll : true;
      if (Array.isArray(raw.includeFiles)) base.includeFiles = raw.includeFiles.map(String);
    }
    if (typeof raw.lastRun === 'string') base.lastRun = raw.lastRun;
    if (typeof raw.lastStatus === 'string') base.lastStatus = raw.lastStatus as any;
    return base;
  }

  private save(): void {
    const data = JSON.stringify(this.jobs, null, 2);
    const wrote = this.atomicWriteTextFile(this.jobsFile, data);
    if (!wrote) {
      // Si despues de reintentos no podemos escribir, intentamos un writeFileSync normal
      // como ultimo recurso, y si aun asi falla, se ignora (no se mata la app por un log).
      try {
        fs.writeFileSync(this.jobsFile, data, 'utf-8');
      } catch (err) {
        console.warn('[JobManager] No se pudo escribir bacasync-jobs.json despues de reintentos:', err);
      }
    }
    this.emitter.emit('event', { type: 'list-changed' });
  }

  private atomicWriteTextFile(target: string, text: string): boolean {
    const dir = path.dirname(target);
    const tmp = path.join(dir, '.' + path.basename(target) + '.tmp-' + process.pid + '-' + Date.now().toString(36));
    const delays = [50, 100, 200, 400, 800, 1600];
    for (let i = 0; i <= delays.length; i++) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, text, 'utf-8');
        fs.renameSync(tmp, target);
        return true;
      } catch (err: any) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
        const code = err && typeof err === 'object' && err.code ? String(err.code) : '';
        const retriable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EEXIST';
        if (!retriable || i >= delays.length) return false;
        const ms = delays[i];
        const start = Date.now();
        // busy-wait corto (max 1.6s total) porque writeFileSync es sync y el caller espera;
        // para un JSON de 100 tareas esto es despreciable frente a EPERM aleatorio de Windows.
        while (Date.now() - start < ms) {
          // yield to event loop no es posible en sync; at-short-spin is OK.
          // (Aprox 1.6s worst case en 6 intentos.)
        }
      }
    }
    return false;
  }

  private scheduleAll(): void {
    for (const job of this.jobs) this.scheduleOne(job);
  }

  private scheduleOne(job: SyncJob): void {
    this.stopSchedule(job.id);
    if (!job.enabled || !job.schedule) return;
    try {
      if (!cron.validate(job.schedule)) return;
      const task = cron.schedule(job.schedule, () => {
        void this.runJob(job.id);
      }, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      this.tasks.set(job.id, task);
    } catch {
      /* ignore invalid cron */
    }
  }

  private stopSchedule(jobId: string): void {
    const t = this.tasks.get(jobId);
    if (t) {
      t.stop();
      this.tasks.delete(jobId);
    }
  }

  onEvent(cb: (evt: JobEvent) => void): () => void {
    const listener = (e: JobEvent) => cb(e);
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  listJobs(): SyncJob[] {
    return [...this.jobs];
  }

  getRuntimeInfo(): JobRuntimeInfo[] {
    const out: JobRuntimeInfo[] = [];
    for (const job of this.jobs) {
      const existing = this.runtime.get(job.id);
      out.push({
        jobId: job.id,
        status: existing?.status ?? 'idle',
        progress: existing?.progress,
        lastResult: this.lastResult.get(job.id),
      });
    }
    return out;
  }

  saveJob(job: SyncJob): SyncJob {
    const existing = this.jobs.find((j) => j.id === job.id);
    if (existing) {
      Object.assign(existing, job);
    } else {
      job.createdAt = job.createdAt || new Date().toISOString();
      this.jobs.push(job);
    }
    this.save();
    this.scheduleOne(job);
    return job;
  }

  deleteJob(id: string): void {
    this.stopSchedule(id);
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.runtime.delete(id);
    this.lastResult.delete(id);
    this.save();
  }

  async previewJob(id: string, scope: RunScope = 'full'): Promise<SyncAction[]> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found');
    return this.engine.computeActions(job, scope);
  }

  async runJob(id: string, scope: RunScope = 'full'): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found');
    const current = this.runtime.get(id);
    if (current?.status === 'running') return;

    this.runtime.set(id, { jobId: id, status: 'running' });
    this.emitter.emit('event', { type: 'status', jobId: id, status: 'running' });

    try {
      const actions = await this.engine.computeActions(job, scope);
      this.emitter.emit('event', {
        type: 'status',
        jobId: id,
        status: 'running',
        progress: { current: 0, total: actions.length },
      });

      const result = await this.engine.execute(job, actions, (stage, cur, tot, file) => {
        const info = this.runtime.get(id);
        if (info) {
          info.progress = { current: cur, total: tot, currentFile: file };
          this.emitter.emit('event', {
            type: 'status',
            jobId: id,
            status: 'running',
            progress: info.progress,
          });
        }
      });

      this.lastResult.set(id, result);
      job.lastRun = result.finishedAt;
      job.lastStatus = result.status;
      this.save();

      this.runtime.set(id, {
        jobId: id,
        status: result.status,
        lastResult: result,
      });
      this.emitter.emit('event', { type: 'result', jobId: id, result });
      this.emitter.emit('event', { type: 'status', jobId: id, status: result.status });
    } catch (err: any) {
      const errResult: SyncResult = {
        jobId: id,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'error',
        actions: [],
        errors: [err?.message ?? String(err)],
        copiedFiles: 0,
        deletedFiles: 0,
        totalBytes: 0,
      };
      this.lastResult.set(id, errResult);
      job.lastRun = errResult.finishedAt;
      job.lastStatus = 'error';
      this.save();
      this.runtime.set(id, { jobId: id, status: 'error', lastResult: errResult });
      this.emitter.emit('event', { type: 'result', jobId: id, result: errResult });
      this.emitter.emit('event', { type: 'status', jobId: id, status: 'error' });
    }
  }

  async flushOnExitJobs(): Promise<void> {
    const targets = this.jobs.filter((j) => j.kind === 'nas-cache' && !!j.flushOnExit);
    for (const job of targets) {
      await this.runJob(job.id, 'push-only');
    }
  }

  async pushJob(id: string): Promise<void> {
    return this.runJob(id, 'push-only');
  }

  async pullJob(id: string): Promise<void> {
    return this.runJob(id, 'pull-only');
  }

  async getNasTree(id: string): Promise<TreeNode | null> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found');
    const nasPath = job.nasSide === 'left' ? job.leftPath : job.rightPath;
    return this.engine.buildTree(nasPath);
  }

  async saveIncludedPaths(id: string, includeAll: boolean, includeFiles: string[]): Promise<SyncJob> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found');
    job.includeAll = includeAll;
    job.includeFiles = includeAll ? undefined : [...includeFiles];
    this.save();
    return job;
  }
}
