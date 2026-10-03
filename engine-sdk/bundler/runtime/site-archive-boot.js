// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// The original document remains inert until normal URL requests can resolve.
(() => {
  const script = document.currentScript;
  const version = script.dataset.version;
  const osWorker = script.dataset.osWorker === 'true';
  const status = document.getElementById('pe-site-status');
  const payload = document.getElementById('pe-site-document').textContent.trim();
  const attemptsKey = `particle-site-boot-${version}`;
  const meter = document.getElementById('pe-site-progress');
  const fill = document.getElementById('pe-site-progress-fill');
  const phaseLabel = document.getElementById('pe-site-phase');
  const countLabel = document.getElementById('pe-site-count');
  const retry = document.getElementById('pe-site-retry');
  const phases = {
    checking: ['CHECKING', 'Checking site files on this device…'],
    downloading: ['DOWNLOADING', 'Downloading site files…'],
    verifying: ['VERIFYING', 'Verifying downloaded files…'],
    caching: ['PREPARING', 'Preparing files for this device…'],
    ready: ['READY', 'Opening Particle Realms…'],
    activating: ['STARTING', 'Starting your local site cache…'],
  };

  function showProgress(phase, completedFiles = null, totalFiles = null) {
    const [label, description] = phases[phase] || phases.activating;
    if (status.textContent !== description) status.textContent = description;
    if (phaseLabel) phaseLabel.textContent = label;
    const measurable = Number.isSafeInteger(totalFiles) && totalFiles > 0
      && Number.isSafeInteger(completedFiles) && completedFiles >= 0 && completedFiles <= totalFiles;
    const determinate = measurable && (completedFiles > 0 || phase === 'caching' || phase === 'ready');
    if (meter && fill) {
      if (determinate) {
        const percent = Math.floor(completedFiles / totalFiles * 100);
        meter.setAttribute('aria-valuenow', String(percent));
        fill.style.width = `${percent}%`;
      } else {
        meter.removeAttribute('aria-valuenow');
        fill.style.removeProperty('width');
      }
      meter.setAttribute('aria-valuetext', measurable
        ? `${description} ${completedFiles} of ${totalFiles} files prepared` : description);
    }
    if (countLabel) countLabel.textContent = measurable ? `${completedFiles} / ${totalFiles} FILES` : 'PLEASE WAIT';
  }

  retry?.addEventListener('click', () => {
    sessionStorage.removeItem(attemptsKey);
    location.reload();
  });

  function workerStatus(worker) {
    if (!worker) return Promise.resolve(null);
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data ?? null);
      };
      worker.postMessage({ type: 'PE_SITE_ARCHIVE_VERSION' }, [channel.port2]);
    });
  }

  async function activate(url, scope) {
    showProgress('activating');
    const registration = await navigator.serviceWorker.register(url, {
      scope, type: 'module', updateViaCache: 'none',
    });
    // register() already starts the update check. Queuing update() here can
    // wait for installation to finish, hiding every download-progress message.
    const deadline = performance.now() + 60000;
    while (performance.now() < deadline) {
      if (registration.waiting) registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      const candidate = registration.installing || registration.waiting || registration.active;
      const snapshot = await workerStatus(candidate);
      if (snapshot?.version === version) {
        const progress = snapshot.progress;
        if (progress?.phase === 'failed') throw new Error('Site files could not be verified or saved. Check your connection and available storage.');
        if (progress && progress.phase !== 'idle') {
          showProgress(progress.phase, progress.completedFiles, progress.totalFiles);
        }
        if (candidate === registration.active && candidate.state === 'activated') return;
      }
      if (candidate?.state === 'redundant') throw new Error('Site archive worker installation failed');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Site archive worker did not activate within 60 seconds');
  }

  async function boot() {
    if (!isSecureContext || !navigator.serviceWorker) {
      throw new Error('This release needs service workers over HTTPS (or localhost).');
    }
    if ((await workerStatus(navigator.serviceWorker.controller))?.version !== version) {
      await activate('/site-archive-sw.js', '/');
      if (osWorker) await activate('/webgpu-os/sw.js', '/webgpu-os/');
      if ((await workerStatus(navigator.serviceWorker.controller))?.version !== version) {
        const attempts = Number(sessionStorage.getItem(attemptsKey) || 0);
        if (attempts >= 2) throw new Error('The site archive worker could not control this page. Close older site tabs and reload.');
        sessionStorage.setItem(attemptsKey, String(attempts + 1));
        location.reload();
        return;
      }
    }
    sessionStorage.removeItem(attemptsKey);
    showProgress('ready');
    const bytes = Uint8Array.from(atob(payload), character => character.charCodeAt(0));
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    console.info('[Site archive] Starting verified release', version);
    // A fresh parser preserves classic/module/defer ordering, document-relative
    // URLs and DOMContentLoaded, unlike dynamically re-inserting script tags.
    document.open();
    document.write(source);
    document.close();
  }

  boot().catch(error => {
    document.getElementById('pe-site-preload')?.setAttribute('data-state', 'failed');
    document.getElementById('pe-site-main')?.setAttribute('aria-busy', 'false');
    const heading = document.getElementById('pe-site-heading');
    if (heading) heading.textContent = 'Let’s try that again';
    status.textContent = `Cannot start this release: ${error.message}`;
    meter?.setAttribute('aria-valuetext', 'Site preparation failed');
    if (phaseLabel) phaseLabel.textContent = 'CONNECTION PAUSED';
    if (countLabel) countLabel.textContent = 'RETRY WHEN READY';
    if (retry) retry.hidden = false;
    console.error('[Site archive] Startup failed', error);
  });
})();
