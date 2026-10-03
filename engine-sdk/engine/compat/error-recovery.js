// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * error-recovery.js — keep a crashing guest from taking down the OS.
 *
 * Installs scoped error capture and drives a recovery ladder when a guest throws
 * repeatedly within a short window:
 *   1. tolerate isolated errors (already recorded),
 *   2. reboot the realm (fresh parse + heal + run),
 *   3. reboot in SAFE MODE (network off, shader-heal off, GPU limits clamped),
 *   4. render an in-realm error panel with a manual Restart — OS stays alive.
 *
 * Errors counted toward escalation: runtime-error, promise-error, script,
 * gpu-device-lost. Benign infos (warnings, clamps, recovery notices) are ignored.
 */

const WINDOW_MS   = 10_000;
const MAX_ERRORS  = 5;     // within WINDOW_MS before escalating
const MAX_REBOOTS = 2;     // auto reboots before showing the panel

const CRASH_TYPES = new Set(['runtime-error', 'promise-error', 'script', 'gpu-device-lost']);

export function installErrorRecovery(app, { win = (typeof window !== 'undefined' ? window : null) } = {}) {
    const state = { times: [], reboots: 0, disposed: false, escalating: false };

    const feed = (info) => {
        if (state.disposed || !info || !CRASH_TYPES.has(info.type)) return;
        const now = Date.now();
        state.times = state.times.filter(t => now - t < WINDOW_MS);
        state.times.push(now);
        if (info.type === 'gpu-device-lost' || state.times.length >= MAX_ERRORS) {
            state.times = [];
            escalate(info);
        }
    };

    async function escalate(info) {
        if (state.escalating || state.disposed) return;
        state.escalating = true;
        try {
            if (state.reboots < MAX_REBOOTS && typeof app.reboot === 'function') {
                const safeMode = state.reboots >= 1;
                state.reboots++;
                app._record('recovery', { message: `repeated errors — rebooting realm${safeMode ? ' (safe mode)' : ''}` });
                await app.reboot({ safeMode });
                return;
            }
            renderErrorPanel(app, info);
        } catch (e) {
            renderErrorPanel(app, { message: `recovery failed: ${e.message}` });
        } finally {
            state.escalating = false;
        }
    }

    const onError      = (e) => app._record('runtime-error', { message: e.message, file: e.filename, line: e.lineno, column: e.colno, stack: e.error?.stack });
    const onRejection  = (e) => app._record('promise-error', { reason: String(e.reason), stack: e.reason?.stack });

    win?.addEventListener('error', onError);
    win?.addEventListener('unhandledrejection', onRejection);

    // Let the app feed non-window errors (script exec, gpu-device-lost) here too.
    app._recoveryFeed = feed;

    return () => {
        state.disposed = true;
        app._recoveryFeed = null;
        win?.removeEventListener('error', onError);
        win?.removeEventListener('unhandledrejection', onRejection);
    };
}

/** A safer variant of a profile used for safe-mode reboots. */
export function makeSafeProfile(profile) {
    const safe = structuredCloneSafe(profile);
    safe._safeMode = true;
    safe.healing = { ...(safe.healing ?? {}), healShaders: false, clampGpuLimits: true };
    safe.permissions = { ...(safe.permissions ?? {}), 'network.fetch': false };
    return safe;
}

/** Render a friendly, non-fatal error panel inside the guest's realm container. */
export function renderErrorPanel(app, info) {
    const container = app.realm?.container ?? app.options?.mount;
    if (!container) return;
    container.querySelector('[data-compat-error]')?.remove();

    const panel = document.createElement('div');
    panel.setAttribute('data-compat-error', '');
    panel.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;'
        + 'justify-content:center;gap:12px;background:rgba(10,12,20,.92);color:#f0f2f8;'
        + 'font-family:system-ui,sans-serif;text-align:center;padding:24px;z-index:99999';
    panel.innerHTML = `<div style="font-size:34px">⚠</div>`
        + `<div style="font-weight:700;font-size:15px">${esc(app.profile?.name ?? app.id)} stopped responding</div>`
        + `<div style="opacity:.7;font-size:12px;max-width:420px;word-break:break-word">${esc(info?.message ?? info?.reason ?? 'A runtime error occurred.')}</div>`;

    const btn = document.createElement('button');
    btn.textContent = '↻ Restart app';
    btn.style.cssText = 'padding:8px 18px;border-radius:8px;border:1px solid rgba(91,124,255,.5);'
        + 'background:rgba(91,124,255,.25);color:#c2cdff;cursor:pointer;font-size:13px';
    btn.addEventListener('click', async () => {
        panel.remove();
        try { await app.reboot?.({ safeMode: true, resetRecovery: true }); } catch {}
    });
    panel.appendChild(btn);
    container.appendChild(panel);
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function structuredCloneSafe(obj) {
    try { return structuredClone(obj); }
    catch { return JSON.parse(JSON.stringify(obj ?? {})); }
}
