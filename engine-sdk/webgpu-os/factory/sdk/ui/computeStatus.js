// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { el } from './dom.js';
import { sectionHeader, statusBadge } from './components.js';
import { button, input, select } from './controls.js';
import { createRebuildViewStateAdapter } from './rebuildViewState.js';

const BACKENDS = Object.freeze([
    ['js', 'JavaScript', 'Reference operations in background workers.'],
    ['wasm-scalar', 'Wasm scalar', 'Compiled CPU kernels for eligible operations.'],
    ['wasm-simd', 'Wasm SIMD', 'Vector kernels for supported bulk operations.'],
    ['wasm-threads', 'Wasm threads', 'Partitioned work across reserved workers.'],
    ['wasm-threads-simd', 'Wasm threads + SIMD', 'Partitioned work with vector kernels.'],
    ['webgpu', 'WebGPU', 'GPU operations with declared float32 precision.'],
]);
const OPERATION_NAMES = Object.freeze({
    'stats.summary': 'Statistics summary', 'robust.compensated-sum': 'Compensated sum',
    'geometry.attribute-bounds': 'Attribute bounds', 'geometry.transform-points': 'Point transforms',
    'image.histogram': 'Image histogram', 'image.luminance': 'Image luminance', 'image.document-analysis': 'Document image analysis',
    'matrix.multiply': 'Matrix multiplication', 'signal.fft': 'Fast Fourier transform (FFT)', 'signal.ifft': 'Inverse FFT',
    'audio.waveform-peaks': 'Waveform peaks', 'audio.windowed-rms': 'Windowed RMS',
    'binary.crc32': 'CRC32 checksum', 'binary.histogram': 'Byte histogram', 'compression.entropy': 'Entropy estimate',
});
const DOMAIN_NAMES = Object.freeze({ numeric: 'Numbers', geometry: 'Geometry', image: 'Images', audio: 'Audio & signal', binary: 'Binary', compression: 'Compression' });
const backendLabel = backend => BACKENDS.find(([id]) => id === backend)?.[1] ?? backend;
const operationName = operation => OPERATION_NAMES[operation.name] ?? String(operation.name ?? operation.id ?? 'Unnamed operation').replace(/[.-]/g, ' ');
const isReady = state => state?.supported === true && state.deployed === true && state.enabled === true;

function scrollViewport(host) {
    for (let node = host.parentElement ?? host.getRootNode?.()?.host; node; node = node.parentElement ?? node.getRootNode?.()?.host) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    }
    return host.ownerDocument?.scrollingElement;
}

const VIEW_STATE = createRebuildViewStateAdapter({ scrollTargets: { host: node => node, viewport: scrollViewport },
    focus: { attributes: ['data-fx-compute-focus'] }, restoreAfterFocus: ['host', 'viewport'] });

function backendCondition(report, backend) {
    const state = report?.backends?.[backend];
    if (!state) return ['unknown', 'Unknown', 'Capability metadata has not been received.'];
    if (state.supported === false) return ['unavailable', 'Unsupported', backend.includes('threads') && report.supported?.crossOriginIsolated === false
        ? 'Shared workers require a cross-origin isolated page. Private-memory backends remain separate options.'
        : 'This browser does not expose the features required by this backend.'];
    if (state.deployed === false) return report.deploymentError && backend.startsWith('wasm-')
        ? ['error', 'Unverified', 'Release metadata could not be read. Refresh capabilities after checking the installation.']
        : ['missing', 'Not deployed', 'This backend is not present in the current host or release.'];
    if (state.enabled === false) return report.enabled?.acceleration === false && backend !== 'js'
        ? ['disabled', 'Paused', 'Acceleration is off. Automatic jobs continue through JavaScript.']
        : ['disabled', 'Unavailable', 'The current runtime or device state does not admit this backend.'];
    return isReady(state) ? ['available', 'Ready', 'The platform can select this backend for eligible operations.']
        : ['unknown', 'Unknown', 'Browser support, deployment and runtime enablement must all be reported before readiness is known.'];
}

function appAccess(report, backend) {
    const permitted = report?.backends?.[backend]?.permitted;
    if (permitted === true) return { state: 'available', value: 'Permitted' };
    const execution = report?.access?.execution;
    const decision = execution?.granted === true && backend === 'webgpu' ? report.access.gpu : execution;
    if (permitted === false && decision?.state === 'not-requested' && decision?.declared === false) {
        return { state: 'unknown', value: 'Not requested', detail: 'This application did not request this execution capability.' };
    }
    return { state: permitted === false ? 'denied' : 'unknown', value: permitted === false ? 'Not permitted' : 'Unknown' };
}

function operationCoverage(operation) {
    if (!Array.isArray(operation.backends)) return 'Coverage not reported';
    const groups = [];
    if (operation.backends.includes('js')) groups.push('JavaScript');
    const wasm = operation.backends.filter(name => name.startsWith('wasm-')).length;
    if (wasm) groups.push(`Wasm · ${wasm} ${wasm === 1 ? 'variant' : 'variants'}`);
    if (operation.backends.includes('webgpu')) groups.push('WebGPU');
    return groups.join(' / ') || 'No backend declared';
}

function operationContract(operation) {
    const fields = el('dl', { class: 'fx-compute-contract__fields' });
    const field = (name, value) => { if (value != null) fields.append(el('dt', { text: name }), el('dd', { text: value })); };
    field('Operation ID', operation.id);
    field('Inputs', Array.isArray(operation.inputs) ? operation.inputs.join(', ') : null);
    field('Default precision', operation.defaultPrecision);
    if (Array.isArray(operation.backends)) for (const backend of operation.backends) {
        const precisions = backend === 'webgpu' ? operation.gpuPrecisions : operation.precisions;
        field(backendLabel(backend), Array.isArray(precisions) && precisions.length ? precisions.join(' / ') : 'Precision not reported');
    }
    const body = el('div', { class: 'fx-compute-contract' }, fields);
    if (operation.result?.semantics) body.append(el('p', { class: 'fx-compute-note', text: operation.result.semantics }));
    for (const [label, value] of [['Declared result', operation.result ? { value: operation.result.value, outputs: operation.result.outputs } : null],
        ['Comparison contract', operation.comparison ?? operation.result?.comparison]]) {
        if (value != null) body.append(el('h4', { text: label }), el('pre', { class: 'fx-compute-contract__json', text: JSON.stringify(value, null, 2) }));
    }
    return body;
}

function operationCatalog(operations) {
    const reported = Array.isArray(operations), items = reported ? operations : [];
    const search = input({ type: 'search', placeholder: 'Search name, domain or operation ID' });
    search.dataset.fxComputeFocus = 'catalog-search'; search.dataset.computeSearch = ''; search.setAttribute('aria-label', 'Search compute operations');
    search.maxLength = 512; search.disabled = !reported;
    const filter = select({ value: 'all', options: [{ value: 'all', label: 'All backends' }, ...BACKENDS.map(([value, label]) => ({ value, label }))] });
    filter.dataset.fxComputeFocus = 'catalog-backend'; filter.dataset.computeFilter = ''; filter.setAttribute('aria-label', 'Filter operations by backend');
    filter.disabled = !reported;
    const count = el('p', { class: 'fx-compute-note', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', dataset: { computeMatches: '' } });
    const list = el('div', { class: 'fx-compute-catalog__list' });
    const rows = items.map(operation => {
        const name = operationName(operation), domain = DOMAIN_NAMES[operation.domain] ?? operation.domain ?? 'Domain not reported';
        const row = el('details', { class: 'fx-compute-operation', dataset: { computeOperation: operation.id, computeDetail: `operation:${operation.id}` } }, [
            el('summary', { dataset: { fxComputeFocus: `operation:${operation.id}` } }, [
                el('span', { class: 'fx-compute-operation__name' }, [el('strong', { text: name }), el('span', { text: domain })]),
                el('span', { class: 'fx-compute-operation__coverage', text: operationCoverage(operation) }),
                el('span', { class: 'fx-compute-precision', title: 'Declared precision', text: operation.precisions?.join(' / ') || 'Unknown precision' }),
            ]), operationContract(operation),
        ]);
        list.append(row);
        return { row, operation, search: `${name} ${operation.name ?? ''} ${domain} ${operation.domain ?? ''} ${operation.id ?? ''}`.toLocaleLowerCase() };
    });
    const empty = el('p', { class: 'fx-compute-catalog__empty', dataset: { computeEmpty: '' } });
    const render = () => {
        const query = search.value.trim().toLocaleLowerCase(), backend = filter.value;
        let matches = 0;
        for (const item of rows) {
            item.row.hidden = !((backend === 'all' || item.operation.backends?.includes(backend)) && item.search.includes(query));
            const precision = item.row.querySelector('.fx-compute-precision');
            const values = backend === 'webgpu' ? item.operation.gpuPrecisions : item.operation.precisions;
            precision.textContent = Array.isArray(values) && values.length ? values.join(' / ') : 'Unknown precision';
            precision.title = backend === 'all' ? 'Declared precision' : `${backendLabel(backend)} precision`;
            if (!item.row.hidden) matches++;
        }
        count.textContent = reported ? `${matches} of ${items.length} operations${backend === 'all' ? '' : ` · ${backendLabel(backend)}`}` : 'Operation coverage has not been reported.';
        empty.hidden = matches > 0;
        empty.textContent = !reported ? 'Refresh capabilities to inspect the approved operation catalog.'
            : !items.length ? 'No approved operations were reported.' : 'No operations match these filters. Clear the filters or try another name, domain or ID.';
    };
    const clear = button({ label: 'Clear filters', size: 'sm', variant: 'ghost', disabled: !reported,
        onClick: () => { search.value = ''; filter.value = 'all'; render(); search.focus({ preventScroll: true }); } });
    clear.dataset.fxComputeFocus = 'catalog-clear'; clear.dataset.computeClear = '';
    search.addEventListener('input', render); filter.addEventListener('change', render);
    const root = el('section', { class: 'fx-panel fx-compute-catalog', 'aria-label': 'Approved operation catalog', dataset: { computeCatalog: '' } }, [
        el('div', { class: 'fx-compute-catalog__heading' }, [el('h3', { text: 'Operation catalog' }), count]),
        el('div', { class: 'fx-compute-catalog__tools' }, [search, filter, clear]),
        el('p', { class: 'fx-compute-note fx-compute-catalog__hint', text: 'Declared implementations and precision. Expand an operation for its contract; availability and app access are checked separately.' }), list, empty,
    ]);
    render();
    return { root, browse: backend => {
        search.value = ''; filter.value = backend; render(); root.scrollIntoView({ block: 'start', behavior: 'instant' }); search.focus({ preventScroll: true });
    } };
}

/** Device readiness is independent from the browser's WebGPU support flag. */
export function gpuStatusRows(stats = {}) {
    const states = { active: 'Active', ready: 'Active', uninitialized: 'Not acquired', initializing: 'Initializing',
        unavailable: 'Unavailable', lost: 'Lost', recovering: 'Recovering', degraded: 'Degraded', destroyed: 'Stopped' };
    return [['Status', Object.hasOwn(states, stats.device) ? states[stats.device] : 'Unknown'],
        ['WebGPU support', typeof stats.supported === 'boolean' ? stats.supported ? 'Available' : 'Unavailable' : 'Unknown']];
}

/** Shared diagnostics: browser support never implies deployment or app authority. */
export function computeStatus({ report = null, loading = false, error = null, updatedAt = null } = {}, { compact = false } = {}) {
    const host = el('section', { class: `fx-compute-status${compact ? ' fx-compute-status--compact' : ''}`, 'aria-label': 'Compute backend status' });
    const enabled = report?.enabled?.acceleration;
    const acceleration = statusBadge('Acceleration', { state: typeof enabled === 'boolean' ? enabled ? 'available' : 'disabled' : loading ? 'checking' : 'unknown',
        value: typeof enabled === 'boolean' ? enabled ? 'On' : 'Off' : null });
    const ready = BACKENDS.filter(([name]) => isReady(report?.backends?.[name])).length;
    const monitor = report?.access?.mode === 'inspect-only' && report?.access?.execution?.state === 'not-requested';
    if (compact) {
        host.append(acceleration, el('span', { text: report ? `${error ? 'Last reported: ' : ''}${ready} / ${BACKENDS.length} backends ready${Array.isArray(report.operations) ? ` · ${report.operations.length} operations` : ''}`
            : loading ? 'Checking runtime metadata…' : 'Runtime metadata has not been checked.' }));
        if (monitor) host.append(el('span', { class: 'fx-compute-note', text: 'Monitoring access · execution not requested' }));
        if (error || report?.deploymentError) host.append(el('span', { role: 'status', class: 'fx-compute-error', text: error
            ? `${report ? 'Previous result · ' : ''}${error.message ?? String(error)}` : 'Deployment metadata could not be verified.' }));
        return host;
    }
    host.append(sectionHeader({ eyebrow: 'Execution', title: 'Compute backends',
        description: report ? `${error ? 'Last reported: ' : ''}${ready} of ${BACKENDS.length} backends ready${Array.isArray(report.operations) ? ` · ${report.operations.length} approved operations` : ''}.`
            : loading ? 'Checking browser support, release metadata, and application access.' : 'Capability metadata has not been checked.', meta: acceleration }));
    if (monitor) host.append(el('p', { class: 'fx-compute-context', dataset: { computeAccess: 'inspect-only' },
        text: 'Monitoring access · this view inspects capabilities only. Apps request their own execution permissions.' }));
    else if (report?.access?.execution?.state === 'denied') host.append(el('p', { class: 'fx-compute-error', text: 'This app’s execution request is denied. Platform readiness does not override that decision.' }));
    if (error) host.append(el('p', { role: 'status', class: 'fx-compute-error', text: `${report ? 'Showing the previous capability report. Refresh failed: ' : ''}${error.message ?? String(error)}` }));
    if (report?.deploymentError) host.append(el('p', { role: 'status', class: 'fx-compute-error', text: `Deployment metadata could not be verified (${report.deploymentError}). Browser support remains independently reported.` }));
    const grid = el('div', { class: 'fx-compute-backends' }), catalog = operationCatalog(report?.operations);
    for (const [backend, label, description] of BACKENDS) {
        const status = report?.backends?.[backend];
        const unknown = loading && !report ? 'checking' : 'unknown';
        const state = (key, no) => typeof status?.[key] === 'boolean' ? status[key] ? 'available' : no : unknown;
        const [condition, value, reason] = backendCondition(report, backend);
        const badges = [
            statusBadge('Browser', { state: state('supported', 'unavailable'), value: typeof status?.supported === 'boolean' ? status.supported ? 'Supported' : 'Unsupported' : null }),
            statusBadge('Deployment', { state: backend.startsWith('wasm-') && status?.deployed === false && report?.deploymentError ? 'error' : state('deployed', 'missing') }),
            statusBadge('Runtime', { state: state('enabled', 'disabled'), value: typeof status?.enabled === 'boolean' ? status.enabled ? 'Enabled' : 'Disabled' : null }),
            statusBadge('This app', appAccess(report, backend)),
        ];
        const operations = Array.isArray(report?.operations) ? report.operations.filter(operation => operation.backends?.includes(backend)) : null;
        const browse = button({ label: 'Browse operations', variant: 'ghost', size: 'sm', disabled: operations === null,
            onClick: () => catalog.browse(backend) });
        browse.dataset.fxComputeFocus = `browse:${backend}`; browse.dataset.computeBrowse = backend;
        browse.setAttribute('aria-label', `Browse ${label} operations`);
        const facts = el('details', { class: 'fx-compute-facts-detail', dataset: { computeDetail: backend } }, [
            el('summary', { dataset: { fxComputeFocus: `facts:${backend}` }, text: 'Status details' }),
            el('div', { class: 'fx-compute-facts' }, badges),
        ]);
        grid.append(el('article', { class: 'fx-panel fx-compute-backend', dataset: { computeBackend: backend } }, [
            el('div', { class: 'fx-compute-backend__heading' }, [el('h3', { text: label }), statusBadge('', { state: loading && !report ? 'checking' : condition, value: loading && !report ? 'Checking' : value })]),
            el('p', { class: 'fx-compute-note', text: condition === 'available' ? description : reason }),
            el('div', { class: 'fx-compute-backend__actions' }, [el('span', { class: 'fx-compute-count', dataset: { computeCoverageCount: '' },
                text: operations === null ? 'Coverage unknown' : `${operations.length} ${operations.length === 1 ? 'operation' : 'operations'}` }), browse]), facts,
        ]));
    }
    host.append(grid, catalog.root, el('p', { class: 'fx-compute-note fx-compute-footnote', text: `${loading ? 'Refreshing metadata… ' : updatedAt ? `Checked ${new Date(updatedAt).toLocaleTimeString()}. ` : ''}Readiness describes the platform, not permission to execute. Executable files are verified when used; automatic selection measures eligible workloads.` }));
    return host;
}

/** Replace a shared report while preserving catalog filters, disclosures, focus, and scroll. */
export function updateComputeStatus(host, state, options) {
    const view = VIEW_STATE.capture(host);
    const opened = new Set([...host.querySelectorAll('details[data-compute-detail][open]')].map(node => node.dataset.computeDetail));
    const search = host.querySelector('[data-compute-search]'), filter = host.querySelector('[data-compute-filter]');
    const catalog = { query: search?.value ?? '', backend: filter?.value ?? 'all', start: search?.selectionStart, end: search?.selectionEnd };
    host.replaceChildren(computeStatus(state, options));
    const currentSearch = host.querySelector('[data-compute-search]'), currentFilter = host.querySelector('[data-compute-filter]');
    if (currentSearch && currentFilter) {
        currentSearch.value = catalog.query; currentFilter.value = catalog.backend;
        currentSearch.dispatchEvent(new Event('input'));
        if (catalog.start != null && catalog.end != null) currentSearch.setSelectionRange(catalog.start, catalog.end);
    }
    for (const node of host.querySelectorAll('details[data-compute-detail]')) node.open = opened.has(node.dataset.computeDetail);
    VIEW_STATE.restore(host, view);
}

/** Coalesce visible-view metadata reads and suppress results after unmount. */
export function createComputeStatusReader(read, onChange) {
    let state = { report: null, loading: false, error: null, updatedAt: null }, closed = false, pending = null, updated = -Infinity;
    return Object.freeze({
        get state() { return state; },
        refresh(force = false) {
            if (closed || state.loading || pending || !force && performance.now() - updated < 15000) return pending ?? Promise.resolve();
            state = { ...state, loading: true }; onChange(state);
            pending = Promise.resolve().then(() => closed ? null : read()).then(report => {
                if (!report || typeof report !== 'object') throw new Error('Compute capability report is unavailable');
                return report;
            }).then(report => {
                if (!closed) { state = { report, loading: false, error: null, updatedAt: Date.now() }; onChange(state); }
            }, error => {
                if (!closed) { state = { ...state, loading: false, error }; onChange(state); }
            }).finally(() => { updated = performance.now(); pending = null; });
            return pending;
        },
        dispose() { closed = true; },
    });
}
