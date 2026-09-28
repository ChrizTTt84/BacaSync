import * as fs from 'fs';
import * as path from 'path';
import * as cron from 'node-cron';
import { EventEmitter } from 'events';
import type { SyncJob, SyncAction, SyncResult, JobStatus, JobRuntimeInfo, RunScope } from '../types';
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

  constructor(userDataDir: string) {
    this.dataDir = userDataDir;
    this.jobsFile = path.join(this.dataDir, 'bacasync-jobs.json');
    this.ensureDataDir();
    this.load();
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
        this.jobs = JSON.parse(raw) as SyncJob[];
      }
    } catch {
      this.jobs = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.jobsFile, JSON.stringify(this.jobs, null, 2), 'utf-8');
    this.emitter.emit('event', { type: 'list-changed' });
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
}
