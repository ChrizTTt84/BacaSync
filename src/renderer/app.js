const api = window.bacaApi;

let jobs = [];
let runtime = [];
let selectedId = null;
let editingId = null;

const el = (sel) => document.querySelector(sel);

const MODE_LABEL = {
  'one-way-left-to-right': 'Una via: izquierda → derecha',
  'two-way': 'Dos vias (espejo)',
};
const KIND_LABEL = {
  'normal': 'Estandar',
  'nas-cache': 'Cache NAS',
};
const SCHEDULE_LABEL = {
  '': 'Solo manual',
  '0 * * * *': 'Cada hora',
  '0 */6 * * *': 'Cada 6 horas',
  '0 2 * * *': 'Diario (2 AM)',
  '0 2 * * 0': 'Semanal (domingo 2 AM)',
  '0 0 1 * *': 'Mensual (dia 1)',
};

const STATUS_LABEL = {
  idle: 'Pendiente',
  running: 'Ejecutandose',
  success: 'Exitoso',
  error: 'Con errores',
};

function newId() {
  return 'j_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}
function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

async function refreshAll() {
  jobs = await api.listJobs();
  runtime = await api.getRuntime();
  renderJobs();
  renderDetail();
}

function resolveSides(job) {
  if (job.kind === 'nas-cache') {
    const nasPath = job.nasSide === 'left' ? job.leftPath : job.rightPath;
    const localPath = job.nasSide === 'left' ? job.rightPath : job.leftPath;
    return { nasPath, localPath };
  }
  return { leftPath: job.leftPath, rightPath: job.rightPath };
}

function renderJobs() {
  const list = el('#jobs-list');
  const empty = el('#empty');
  const count = el('#count-label');
  count.textContent = `${jobs.length} ${jobs.length === 1 ? 'tarea' : 'tareas'}`;
  list.innerHTML = '';

  if (jobs.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const job of jobs) {
    const rt = runtime.find(r => r.jobId === job.id);
    const status = rt?.status ?? job.lastStatus ?? 'idle';
    const sides = resolveSides(job);
    const kindTag = job.kind === 'nas-cache'
      ? `<span class="status-pill status-idle" style="margin-right:6px">Modo NAS</span>`
      : '';
    const pathsHtml = job.kind === 'nas-cache'
      ? `
        <div class="path-line">☁️ NAS: ${escapeHtml(sides.nasPath)}</div>
        <div class="path-line">💻 Local: ${escapeHtml(sides.localPath)}</div>
      `
      : `
        <div class="path-line">◀ ${escapeHtml(sides.leftPath)}</div>
        <div class="path-line">▶ ${escapeHtml(sides.rightPath)}</div>
      `;

    const card = document.createElement('div');
    card.className = 'job-card' + (selectedId === job.id ? ' selected' : '');
    card.dataset.id = job.id;
    card.innerHTML = `
      <div class="row-top">
        <div class="name">${kindTag}${escapeHtml(job.name)}</div>
        <span class="status-pill status-${status}">${STATUS_LABEL[status] || status}</span>
      </div>
      <div class="paths">
        ${pathsHtml}
        <div class="path-line" style="margin-top:6px">
          ${MODE_LABEL[job.mode]} · ${SCHEDULE_LABEL[job.schedule] ?? (job.schedule || 'Manual')} · Ultima: ${formatDate(job.lastRun)}
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      selectedId = job.id;
      renderJobs();
      renderDetail();
    });
    list.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

function renderDetail() {
  const detail = el('#detail');
  if (!selectedId) {
    detail.classList.add('empty-detail');
    detail.innerHTML = '<p class="muted centered">Selecciona una tarea para ver el detalle, o crea una nueva.</p>';
    return;
  }
  detail.classList.remove('empty-detail');
  const job = jobs.find(j => j.id === selectedId);
  if (!job) { selectedId = null; renderDetail(); return; }
  const rt = runtime.find(r => r.jobId === job.id);
  const status = rt?.status ?? job.lastStatus ?? 'idle';
  const result = rt?.lastResult;
  const prog = rt?.progress;

  let progHtml = '';
  if (status === 'running' && prog) {
    const pct = prog.total ? Math.round((prog.current / prog.total) * 100) : 0;
    progHtml = `
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-meta">
          <span>Progreso</span><span>${prog.current} / ${prog.total}</span>
        </div>
        ${prog.currentFile ? `<div class="current-file" title="${escapeHtml(prog.currentFile)}">${escapeHtml(prog.currentFile)}</div>` : ''}
      </div>
    `;
  }

  let resultHtml = '';
  if (result) {
    const errors = result.errors?.length ? `
      <div class="section-title">Errores (${result.errors.length})</div>
      <div class="error-list">${result.errors.map(e => escapeHtml(e)).join('<br>')}</div>
    ` : '';
    resultHtml = `
      <div class="section-title">Ultima ejecucion</div>
      <div class="kv">
        <div class="k">Estado</div><div class="v"><span class="status-pill status-${result.status}">${STATUS_LABEL[result.status]}</span></div>
        <div class="k">Inicio</div><div class="v">${formatDate(result.startedAt)}</div>
        <div class="k">Fin</div><div class="v">${formatDate(result.finishedAt)}</div>
      </div>
      <div class="result-stats">
        <div class="stat"><div class="n">${result.copiedFiles}</div><div class="l">Copiados</div></div>
        <div class="stat"><div class="n">${result.deletedFiles}</div><div class="l">Eliminados</div></div>
        <div class="stat"><div class="n">${formatBytes(result.totalBytes)}</div><div class="l">Transferidos</div></div>
      </div>
      ${errors}
    `;
  }

  let actionBtns = '';
  let infoKv = '';
  if (job.kind === 'nas-cache') {
    const sides = resolveSides(job);
    actionBtns = `
      <button class="btn primary" id="btn-run">🔄 Sincronizar (dos vias)</button>
      <button class="btn" id="btn-pull">⬇️ Traer del NAS (Pull)</button>
      <button class="btn" id="btn-push">⬆️ Subir al NAS (Push)</button>
      <button class="btn" id="btn-preview">Vista previa</button>
      <button class="btn" id="btn-edit">Editar</button>
      <button class="btn danger" id="btn-delete">Eliminar</button>
    `;
    infoKv = `
      <div class="k">Tipo</div><div class="v">Modo cache NAS (trabajas local, NAS es copia segura)</div>
      <div class="k">Modo</div><div class="v">${MODE_LABEL[job.mode]}</div>
      <div class="k">Programacion</div><div class="v">${SCHEDULE_LABEL[job.schedule] ?? (job.schedule ? 'Cron: ' + job.schedule : 'Solo manual')}</div>
      <div class="k">Flush al salir</div><div class="v">${job.flushOnExit ? 'Si (Push automatico al cerrar la app)' : 'No'}</div>
      <div class="k">Habilitada</div><div class="v">${job.enabled ? 'Si' : 'No'}</div>
      <div class="k">NAS</div><div class="v">${escapeHtml(sides.nasPath)}
        <button class="btn small" data-open="${escapeHtml(sides.nasPath)}" style="margin-left:6px">Abrir</button></div>
      <div class="k">Carpeta local (trabajo)</div><div class="v">${escapeHtml(sides.localPath)}
        <button class="btn small" data-open="${escapeHtml(sides.localPath)}" style="margin-left:6px">Abrir</button></div>
      <div class="k">Creacion</div><div class="v">${formatDate(job.createdAt)}</div>
    `;
  } else {
    actionBtns = `
      <button class="btn primary" id="btn-run">▶ Sincronizar ahora</button>
      <button class="btn" id="btn-preview">Vista previa</button>
      <button class="btn" id="btn-edit">Editar</button>
      <button class="btn danger" id="btn-delete">Eliminar</button>
    `;
    infoKv = `
      <div class="k">Tipo</div><div class="v">Sincronizacion estandar</div>
      <div class="k">Modo</div><div class="v">${MODE_LABEL[job.mode]}</div>
      <div class="k">Programacion</div><div class="v">${SCHEDULE_LABEL[job.schedule] ?? (job.schedule ? 'Cron: ' + job.schedule : 'Solo manual')}</div>
      <div class="k">Habilitada</div><div class="v">${job.enabled ? 'Si' : 'No'}</div>
      <div class="k">Eliminar faltantes</div><div class="v">${job.deleteMissing ? 'Si' : 'No'}</div>
      <div class="k">Carpeta izq</div><div class="v">${escapeHtml(job.leftPath)}
        <button class="btn small" data-open="${escapeHtml(job.leftPath)}" style="margin-left:6px">Abrir</button></div>
      <div class="k">Carpeta der</div><div class="v">${escapeHtml(job.rightPath)}
        <button class="btn small" data-open="${escapeHtml(job.rightPath)}" style="margin-left:6px">Abrir</button></div>
      <div class="k">Creacion</div><div class="v">${formatDate(job.createdAt)}</div>
    `;
  }

  detail.innerHTML = `
    <h3>${escapeHtml(job.name)}</h3>
    <div class="d-actions">${actionBtns}</div>
    <div class="section-title">Informacion</div>
    <div class="kv">${infoKv}</div>
    ${progHtml}
    ${resultHtml}
  `;

  detail.querySelector('#btn-run')?.addEventListener('click', () => api.runJob(job.id));
  detail.querySelector('#btn-push')?.addEventListener('click', () => api.pushJob(job.id));
  detail.querySelector('#btn-pull')?.addEventListener('click', () => api.pullJob(job.id));
  detail.querySelector('#btn-preview')?.addEventListener('click', () => showPreview(job));
  detail.querySelector('#btn-edit')?.addEventListener('click', () => openModal(job));
  detail.querySelector('#btn-delete')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar la tarea "${job.name}"?`)) return;
    await api.deleteJob(job.id);
    selectedId = null;
    await refreshAll();
  });
  detail.querySelectorAll('[data-open]').forEach(b => {
    b.addEventListener('click', () => api.openPath(b.dataset.open));
  });
}

async function showPreview(job) {
  try {
    const all = await api.previewJob(job.id);
    if (!all.length) {
      alert('No hay cambios pendientes entre ambas carpetas.');
      return;
    }
    let intro = `Acciones a realizar (${all.length}):`;
    if (job.kind === 'nas-cache') {
      const pull = (await api.previewJob(job.id, 'pull-only')).length;
      const push = (await api.previewJob(job.id, 'push-only')).length;
      intro = `Resumen modo NAS:\n  ⬇️ Pull (NAS → Local): ${pull} acciones\n  ⬆️ Push (Local → NAS): ${push} acciones\n\nAcciones a realizar (${all.length}):`;
    }
    const msg = all.slice(0, 80).map(a => `- ${labelAction(a, job)}`).join('\n');
    const extra = all.length > 80 ? `\n... y ${all.length - 80} mas` : '';
    alert(`${intro}\n\n${msg}${extra}`);
  } catch (e) {
    alert('Error al calcular vista previa: ' + (e.message || e));
  }
}

function labelAction(a, job) {
  if (job.kind === 'nas-cache') {
    const nasIsLeft = job.nasSide === 'left';
    const pullDesc = nasIsLeft ? '⬇️ Pull (NAS → Local)' : '⬇️ Pull (NAS → Local)';
    const pushDesc = nasIsLeft ? '⬆️ Push (Local → NAS)' : '⬆️ Push (Local → NAS)';
    if (a.type === 'copy-left-right') return `${nasIsLeft ? pullDesc : pushDesc}: ${a.relativePath}`;
    if (a.type === 'copy-right-left') return `${nasIsLeft ? pushDesc : pullDesc}: ${a.relativePath}`;
    if (a.type === 'delete-right') return `Eliminar en ${nasIsLeft ? 'Local' : 'NAS'}: ${a.relativePath}`;
    if (a.type === 'delete-left') return `Eliminar en ${nasIsLeft ? 'NAS' : 'Local'}: ${a.relativePath}`;
  }
  const map = {
    'copy-left-right': 'Copiar  ⬅️➡️  Izq → Der',
    'copy-right-left': 'Copiar  ⬅️⬅️  Der → Izq',
    'delete-right': 'Eliminar en Derecha',
    'delete-left': 'Eliminar en Izquierda',
  };
  return `${map[a.type] || a.type}: ${a.relativePath}`;
}

function applyKindVisibility() {
  const kind = el('#f-kind').value;
  if (kind === 'nas-cache') {
    el('#fields-normal').classList.add('hidden');
    el('#fields-nas').classList.remove('hidden');
    el('#f-left').required = false;
    el('#f-right').required = false;
  } else {
    el('#fields-normal').classList.remove('hidden');
    el('#fields-nas').classList.add('hidden');
    el('#f-left').required = true;
    el('#f-right').required = true;
  }
}

function openModal(job) {
  editingId = job ? job.id : null;
  el('#modal-title').textContent = job ? 'Editar tarea' : 'Nueva tarea';
  el('#f-name').value = job?.name ?? '';

  if (job?.kind === 'nas-cache') {
    el('#f-kind').value = 'nas-cache';
    const sides = resolveSides(job);
    el('#f-nas').value = sides.nasPath || '';
    el('#f-local').value = sides.localPath || '';
    el('#f-flush-exit').checked = !!job.flushOnExit;
    el('#f-left').value = job.leftPath || '';
    el('#f-right').value = job.rightPath || '';
  } else {
    el('#f-kind').value = 'normal';
    el('#f-left').value = job?.leftPath ?? '';
    el('#f-right').value = job?.rightPath ?? '';
    el('#f-nas').value = '';
    el('#f-local').value = '';
    el('#f-flush-exit').checked = true;
  }
  applyKindVisibility();

  el('#f-mode').value = job?.mode ?? (job?.kind === 'nas-cache' ? 'two-way' : 'one-way-left-to-right');
  el('#f-schedule').value = job?.schedule ?? '';
  el('#f-delete').checked = !!job?.deleteMissing;
  el('#f-enabled').checked = job ? !!job.enabled : true;

  el('#modal').classList.remove('hidden');
  setTimeout(() => el('#f-name').focus(), 50);
}

function closeModal() {
  el('#modal').classList.add('hidden');
  editingId = null;
}

function suggestLocalFolder() {
  const name = el('#f-name').value.trim() || 'CacheNAS';
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const isWin = navigator.userAgent.includes('Windows');
  let base;
  try {
    if (isWin) {
      base = 'C:\\Users\\' + (navigator.userAgentData ? 'TuUsuario' : 'TuUsuario') + '\\BacaSyncCache';
    } else {
      base = '~/BacaSyncCache';
    }
  } catch {
    base = isWin ? 'C:\\BacaSyncCache' : '~/BacaSyncCache';
  }
  const sep = isWin ? '\\' : '/';
  el('#f-local').value = `${base}${sep}${safe}`;
}

async function submitForm(e) {
  e.preventDefault();
  const name = el('#f-name').value.trim();
  const kind = el('#f-kind').value;
  const mode = el('#f-mode').value;
  const schedule = el('#f-schedule').value;
  const deleteMissing = el('#f-delete').checked;
  const enabled = el('#f-enabled').checked;

  let leftPath = '';
  let rightPath = '';
  let nasSide;
  let flushOnExit;

  if (kind === 'nas-cache') {
    const nasPath = el('#f-nas').value.trim();
    const localPath = el('#f-local').value.trim();
    flushOnExit = el('#f-flush-exit').checked;
    if (!name || !nasPath || !localPath) {
      alert('Completa nombre, carpeta NAS y carpeta local.');
      return;
    }
    if (nasPath.toLowerCase() === localPath.toLowerCase()) {
      alert('NAS y carpeta local deben ser distintas.');
      return;
    }
    nasSide = 'left';
    leftPath = nasPath;
    rightPath = localPath;
  } else {
    leftPath = el('#f-left').value.trim();
    rightPath = el('#f-right').value.trim();
    if (!name || !leftPath || !rightPath) {
      alert('Completa nombre y ambas carpetas.');
      return;
    }
    if (leftPath === rightPath) {
      alert('Las carpetas deben ser distintas.');
      return;
    }
  }

  const existing = jobs.find(j => j.id === editingId);
  const job = {
    id: editingId || newId(),
    name, leftPath, rightPath,
    mode: mode,
    kind,
    nasSide,
    schedule: schedule || undefined,
    deleteMissing,
    enabled,
    flushOnExit,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastRun: existing?.lastRun,
    lastStatus: existing?.lastStatus,
  };
  await api.saveJob(job);
  selectedId = job.id;
  closeModal();
  await refreshAll();
}

document.addEventListener('DOMContentLoaded', async () => {
  el('#btn-new').addEventListener('click', () => openModal(null));
  el('#btn-close-modal').addEventListener('click', closeModal);
  el('#btn-cancel').addEventListener('click', closeModal);
  el('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  el('#job-form').addEventListener('submit', submitForm);
  el('#f-kind').addEventListener('change', applyKindVisibility);
  el('#btn-suggest-local').addEventListener('click', suggestLocalFolder);

  document.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = await api.pickFolder();
      if (!p) return;
      const target = btn.dataset.pick;
      if (target === 'left') el('#f-left').value = p;
      else if (target === 'right') el('#f-right').value = p;
      else if (target === 'nas') el('#f-nas').value = p;
      else if (target === 'local') el('#f-local').value = p;
    });
  });

  api.onJobEvent(async () => {
    runtime = await api.getRuntime();
    jobs = await api.listJobs();
    renderJobs();
    renderDetail();
  });

  await refreshAll();
});
