import { contextBridge, ipcRenderer } from 'electron';
import type { SyncJob, SyncAction, JobRuntimeInfo, RunScope } from './types';

type PreviewArg = string | { id: string; scope?: RunScope };

contextBridge.exposeInMainWorld('bacaApi', {
  listJobs: (): Promise<SyncJob[]> => ipcRenderer.invoke('jobs:list'),
  saveJob: (job: SyncJob): Promise<SyncJob> => ipcRenderer.invoke('jobs:save', job),
  deleteJob: (id: string): Promise<void> => ipcRenderer.invoke('jobs:delete', id),
  runJob: (id: string): Promise<void> => ipcRenderer.invoke('jobs:run', id),
  pushJob: (id: string): Promise<void> => ipcRenderer.invoke('jobs:push', id),
  pullJob: (id: string): Promise<void> => ipcRenderer.invoke('jobs:pull', id),
  previewJob: (arg: PreviewArg, scope?: RunScope): Promise<SyncAction[]> => {
    if (typeof arg === 'string') {
      return ipcRenderer.invoke('jobs:preview', { id: arg, scope: scope ?? 'full' });
    }
    return ipcRenderer.invoke('jobs:preview', arg);
  },
  getRuntime: (): Promise<JobRuntimeInfo[]> => ipcRenderer.invoke('jobs:runtime'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  openPath: (p: string): void => ipcRenderer.send('shell:openPath', p),
  onJobEvent: (cb: (evt: any) => void) => {
    const listener = (_e: any, d: any) => cb(d);
    ipcRenderer.on('job:event', listener);
    return () => ipcRenderer.removeListener('job:event', listener);
  },
});

declare global {
  interface Window {
    bacaApi: {
      listJobs(): Promise<SyncJob[]>;
      saveJob(job: SyncJob): Promise<SyncJob>;
      deleteJob(id: string): Promise<void>;
      runJob(id: string): Promise<void>;
      pushJob(id: string): Promise<void>;
      pullJob(id: string): Promise<void>;
      previewJob(arg: string | { id: string; scope?: RunScope }, scope?: RunScope): Promise<SyncAction[]>;
      getRuntime(): Promise<JobRuntimeInfo[]>;
      pickFolder(): Promise<string | null>;
      openPath(p: string): void;
      onJobEvent(cb: (evt: any) => void): () => void;
    };
  }
}
