export type SyncMode = 'one-way-left-to-right' | 'two-way';

export type JobKind = 'normal' | 'nas-cache';

export type JobSide = 'nas' | 'local';

export type RunScope = 'full' | 'push-only' | 'pull-only';

export type JobStatus = 'idle' | 'running' | 'success' | 'error';

export interface SyncJob {
  id: string;
  name: string;
  leftPath: string;
  rightPath: string;
  mode: SyncMode;
  kind: JobKind;
  nasSide?: 'left' | 'right';
  schedule?: string;
  deleteMissing: boolean;
  enabled: boolean;
  flushOnExit?: boolean;
  lastRun?: string;
  lastStatus?: JobStatus;
  createdAt: string;
}

export interface SyncAction {
  type: 'copy-left-right' | 'copy-right-left' | 'delete-left' | 'delete-right';
  relativePath: string;
  size?: number;
}

export interface SyncResult {
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: JobStatus;
  actions: SyncAction[];
  errors: string[];
  copiedFiles: number;
  deletedFiles: number;
  totalBytes: number;
}

export interface JobRuntimeInfo {
  jobId: string;
  status: JobStatus;
  progress?: { current: number; total: number; currentFile?: string };
  lastResult?: SyncResult;
}
