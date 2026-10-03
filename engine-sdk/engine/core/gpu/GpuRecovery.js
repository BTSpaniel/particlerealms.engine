// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GpuRecovery.js — Automatic GPU device loss recovery (cross-browser)
 *
 * Handles the full lifecycle of device loss and recovery:
 *   1. Detects device loss (unexpected crash vs intentional destroy)
 *   2. Attempts automatic recovery with exponential backoff
 *   3. Reconfigures canvas context with the new device
 *   4. Fires callbacks so the app can re-upload resources
 *   5. Shows user notification if recovery fails
 *
 * Based on: https://toji.dev/webgpu-best-practices/device-loss.html
 *
 * Browser support:
 *   Chrome 113+ (Win/Mac/ChromeOS), 121+ (Android), 144+ (Linux)
 *   Firefox 141+ (Windows), 145+ (macOS ARM64) — wgpu/Rust backend
 *   Safari 26+ (macOS Tahoe, iOS 26, iPadOS 26, visionOS 26) — Metal backend
 *
 * Chrome crash limits:
 *   - 1st crash: adapter available immediately
 *   - 2nd crash within 2 min: adapter blocked for that page
 *   - 3rd crash within 2 min: all pages blocked
 *   - 3-6 crashes in 5 min: GPU process stops entirely
 * Firefox/Safari: crash limits are different/unknown — recovery still works.
 *
 * device.lost reason values:
 *   Chrome: 'destroyed' (intentional) or 'unknown' (crash)
 *   Firefox/Safari: may use 'destroyed' or '' — we check for 'destroyed' only
 */

import { GpuDevice, detectGpuPlatform, recoverGpuDevice } from './GpuDevice.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;

export class GpuRecovery {
    /**
     * @param {object} options
     * @param {GPUDevice} [options.device] - Current raw GPU device to monitor
     * @param {import('./GpuDevice.js').GpuDevice} [options.gpuDevice] - Current Engine wrapper
     * @param {HTMLCanvasElement} [options.canvas] - Canvas to reconfigure on recovery
     * @param {GPUCanvasContext} [options.context] - Canvas context to reconfigure
     * @param {string} [options.format] - Preferred canvas format
     * @param {string} [options.alphaMode] - Canvas alpha mode
     * @param {object} [options.deviceDescriptor] - Features/limits to request on new device
     * @param {object} [options.adapterOptions] - Adapter selection options to preserve
     * @param {string} [options.profile] - Engine capability profile to preserve
     * @param {Function} [options.acquireDevice] - Injectable replacement acquisition
     * @param {boolean} [options.sharedDeviceCache=false] - Explicitly recover through the shared profile cache
     * @param {boolean} [options.configureContext=true] - Configure the canvas before publication
     * @param {number} [options.baseDelayMs=500] - Initial retry delay
     * @param {number} [options.maxDelayMs=8000] - Maximum retry delay
     * @param {number} [options.maxRetries] - Max recovery attempts (default 3)
     * @param {Function} [options.onLost] - Called immediately on device loss
     * @param {Function} [options.onRecoveryStart] - Called before each recovery attempt
     * @param {Function} [options.onRecovered] - Called with { device, adapter } on success
     * @param {Function} [options.onRecoveryFailed] - Called when all retries exhausted
     */
    constructor(options = {}) {
        this.gpuDevice = options.gpuDevice || null;
        this.device = options.device || this.gpuDevice?.getDevice?.() || null;
        this.canvas = options.canvas || null;
        this.context = options.context || null;
        this.format = options.format || null;
        this.alphaMode = options.alphaMode || 'opaque';
        const acquisition = this.gpuDevice?.getAcquisitionOptions?.() || null;
        this.deviceDescriptor = options.deviceDescriptor ?? acquisition?.deviceDescriptor ?? null;
        this.adapterOptions = options.adapterOptions ?? acquisition?.adapterOptions;
        this.profile = options.profile ?? acquisition?.profile ?? this.gpuDevice?.profile ?? 'default';
        this.acquireDevice = typeof options.acquireDevice === 'function' ? options.acquireDevice : null;
        this.sharedDeviceCache = options.sharedDeviceCache === true;
        this.configureContext = options.configureContext !== false;
        this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.baseDelayMs = Number.isFinite(Number(options.baseDelayMs))
            ? Math.max(0, Number(options.baseDelayMs))
            : DEFAULT_BASE_DELAY_MS;
        this.maxDelayMs = Number.isFinite(Number(options.maxDelayMs))
            ? Math.max(this.baseDelayMs, Number(options.maxDelayMs))
            : DEFAULT_MAX_DELAY_MS;

        // Callbacks
        this.onLost = options.onLost || null;
        this.onRecoveryStart = options.onRecoveryStart || null;
        this.onRecovered = options.onRecovered || null;
        this.onRecoveryFailed = options.onRecoveryFailed || null;

        // State
        this._recovering = false;
        this._retryCount = 0;
        this._destroyed = false;
        this._lifecycleGeneration = 0;
        this._recoveryPromise = null;
        this._queuedLoss = null;
        this._activeCandidate = null;
        this._lifecycleCancellationResolve = null;
        this._lifecycleCancellation = new Promise(resolve => {
            this._lifecycleCancellationResolve = resolve;
        });
        this._platform = detectGpuPlatform();

        // Start monitoring
        if (this.device) {
            this._watchDevice(this.device);
        }
    }

    /**
     * Attach device.lost listener
     */
    _watchDevice(device) {
        if (!device || !device.lost) return;
        device.lost.then((info) => {
            if (this._destroyed || device !== this.device) return;
            this._handleLoss(info, device);
        }).catch(() => {});
    }

    /**
     * Handle device loss event
     */
    async _handleLoss(info, lostDevice = this.device) {
        const reason = info.reason || 'unknown';
        const message = info.message || '';

        console.error(`[GpuRecovery] Device lost — reason: ${reason}, message: ${message}`);

        // Intentional destroy (reason='destroyed') — don't recover
        if (reason === 'destroyed' && !this._simulatedLoss) {
            console.log('[GpuRecovery] Intentional destroy, skipping recovery');
            return;
        }
        this._simulatedLoss = false;

        // Fire loss callback
        if (this.onLost) {
            try { this.onLost(info); } catch (_) {}
        }

        // A replacement can itself be lost during the final microtasks of an
        // active recovery flight. Queue one follow-up after that flight clears
        // instead of returning the single-flight promise and swallowing loss.
        const activeRecovery = this._recoveryPromise;
        if (activeRecovery) {
            const queued = { info, device: lostDevice };
            this._queuedLoss = queued;
            try { await activeRecovery; } catch (_) {}
            if (this._destroyed || this._queuedLoss !== queued) return;
            this._queuedLoss = null;
            if (this.device !== lostDevice) return;
        }

        await this._attemptRecovery();
    }

    async _acquireReplacement(attempt) {
        const request = Object.freeze({
            attempt,
            profile: this.profile,
            gpuDevice: this.gpuDevice,
            adapterOptions: this.adapterOptions,
            deviceDescriptor: this.deviceDescriptor,
        });
        if (this.acquireDevice) {
            const replacement = await this.acquireDevice(request);
            return { replacement, owned: replacement?.owned !== false };
        }
        if (this.gpuDevice) {
            if (this.sharedDeviceCache) {
                const replacement = await recoverGpuDevice({
                    gpuDevice: this.gpuDevice,
                    profile: this.profile,
                    adapterOptions: this.adapterOptions,
                    deviceDescriptor: this.deviceDescriptor,
                });
                return { replacement, owned: false };
            }
            const replacement = await GpuDevice.create({
                profile: this.profile,
                adapterOptions: this.adapterOptions,
                deviceDescriptor: this.deviceDescriptor,
                generation: (this.gpuDevice.generation ?? 0) + 1,
            });
            return { replacement, owned: true };
        }

        const adapter = await navigator.gpu.requestAdapter(this.adapterOptions);
        if (!adapter) return { replacement: null, owned: true };
        const device = await adapter.requestDevice(this.deviceDescriptor || {});
        return { replacement: { adapter, device }, owned: true };
    }

    _normalizeReplacement(replacement, owned = true) {
        const gpuDevice = replacement?.gpuDevice
            ?? (typeof replacement?.getDevice === 'function' ? replacement : null);
        const device = replacement?.device
            ?? gpuDevice?.getDevice?.()
            ?? (replacement?.queue ? replacement : null);
        const adapter = replacement?.adapter ?? gpuDevice?.getAdapter?.() ?? null;
        return { gpuDevice, device, adapter, owned: owned !== false, retired: false };
    }

    _destroyReplacement(replacement) {
        if (!replacement || replacement.retired) return false;
        replacement.retired = true;
        if (replacement.owned === false) return false;
        try {
            if (replacement.gpuDevice?.destroy) replacement.gpuDevice.destroy();
            else replacement.device?.destroy?.();
        } catch (_) {}
        return true;
    }

    _cancellationError() {
        const error = new Error('GPU recovery lifecycle was cancelled');
        error.code = 'GPU_RECOVERY_CANCELLED';
        return error;
    }

    async _awaitLifecycle(promise, lifecycleGeneration, options = {}) {
        let cancelledFirst = false;
        const operation = Promise.resolve(promise).then(
            value => {
                if (cancelledFirst) {
                    try { options.onLateValue?.(value); } catch (_) {}
                }
                return { type: 'value', value };
            },
            error => ({ type: 'error', error }),
        );
        const cancellation = this._lifecycleCancellation.then(() => {
            cancelledFirst = true;
            return { type: 'cancelled' };
        });
        const outcome = await Promise.race([operation, cancellation]);
        if (outcome.type === 'cancelled'
            || this._destroyed
            || lifecycleGeneration !== this._lifecycleGeneration) {
            if (outcome.type === 'value') {
                try { options.onLateValue?.(outcome.value); } catch (_) {}
            }
            throw this._cancellationError();
        }
        if (outcome.type === 'error') throw outcome.error;
        return outcome.value;
    }

    async _waitForRetryDelay(delay, lifecycleGeneration) {
        let timer = null;
        const pending = new Promise(resolve => {
            timer = setTimeout(resolve, delay);
        });
        try {
            await this._awaitLifecycle(pending, lifecycleGeneration);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    _candidateLossGuard(candidate) {
        const guard = { lost: false, info: null };
        if (!candidate?.device?.lost) return guard;
        Promise.resolve(candidate.device.lost).then(
            info => {
                guard.lost = true;
                guard.info = info || { reason: 'unknown', message: '' };
            },
            error => {
                guard.lost = true;
                guard.info = { reason: 'unknown', message: error?.message || String(error || '') };
            },
        );
        return guard;
    }

    _assertCandidateLive(candidate, guard) {
        if (!candidate?.device || guard?.lost || candidate.gpuDevice?.lost
            || candidate.gpuDevice?.destroyed) {
            const error = new Error(
                guard?.info?.message || candidate?.gpuDevice?.lossInfo?.message
                || 'Replacement GPU device was lost before publication',
            );
            error.code = 'GPU_RECOVERY_CANDIDATE_LOST';
            error.info = guard?.info ?? candidate?.gpuDevice?.lossInfo ?? null;
            throw error;
        }
    }

    /**
     * Attempt to get a new adapter + device with exponential backoff
     */
    async _attemptRecovery() {
        if (this._recoveryPromise) return this._recoveryPromise;
        const lifecycleGeneration = this._lifecycleGeneration;
        this._recovering = true;
        this._retryCount = 0;

        const run = async () => {
          while (this._retryCount < this.maxRetries) {
            if (this._destroyed || lifecycleGeneration !== this._lifecycleGeneration) return false;
            this._retryCount += 1;
            const delay = Math.min(
                this.baseDelayMs * Math.pow(2, this._retryCount - 1),
                this.maxDelayMs
            );

            console.log(`[GpuRecovery] Recovery attempt ${this._retryCount}/${this.maxRetries} (delay: ${delay}ms)`);

            if (this.onRecoveryStart) {
                try {
                    await this._awaitLifecycle(
                        this.onRecoveryStart(this._retryCount, this.maxRetries),
                        lifecycleGeneration,
                    );
                } catch (error) {
                    if (error?.code === 'GPU_RECOVERY_CANCELLED') return false;
                }
            }

            // Wait before retry (Chrome needs time after GPU process crash)
            try {
                await this._waitForRetryDelay(delay, lifecycleGeneration);
            } catch (error) {
                if (error?.code === 'GPU_RECOVERY_CANCELLED') return false;
                throw error;
            }

            if (this._destroyed || lifecycleGeneration !== this._lifecycleGeneration) return false;

            let candidate = null;
            try {
                const acquired = await this._awaitLifecycle(
                    this._acquireReplacement(this._retryCount),
                    lifecycleGeneration,
                    {
                        onLateValue: lateAcquired => {
                            const lateCandidate = this._normalizeReplacement(
                                lateAcquired?.replacement,
                                lateAcquired?.owned,
                            );
                            this._destroyReplacement(lateCandidate);
                        },
                    },
                );
                candidate = this._normalizeReplacement(acquired?.replacement, acquired?.owned);
                if (!candidate.device) {
                    candidate.retired = true;
                    console.warn(`[GpuRecovery] Attempt ${this._retryCount}: adapter unavailable (Chrome may be blocking after repeated crashes)`);
                    continue;
                }
                this._activeCandidate = candidate;
                if (this._destroyed || lifecycleGeneration !== this._lifecycleGeneration) {
                    this._destroyReplacement(candidate);
                    if (this._activeCandidate === candidate) this._activeCandidate = null;
                    return false;
                }
                const candidateLoss = this._candidateLossGuard(candidate);
                await Promise.resolve();
                this._assertCandidateLive(candidate, candidateLoss);

                // Reconfigure canvas context if provided
                // Safari/Metal may not support COPY_DST on swapchain textures
                if (this.configureContext && this.context && this.canvas) {
                    const fmt = this.format || navigator.gpu.getPreferredCanvasFormat();
                    this.context.configure({
                        device: candidate.device,
                        format: fmt,
                        usage: this._platform.safeCanvasUsage,
                        alphaMode: this.alphaMode,
                    });
                    this.format = fmt;
                }

                if (this.onRecovered) {
                    const accepted = await this._awaitLifecycle(
                        this.onRecovered({
                            device: candidate.device,
                            adapter: candidate.adapter,
                            gpuDevice: candidate.gpuDevice,
                        }),
                        lifecycleGeneration,
                    );
                    if (accepted === false) {
                        throw new Error('Recovered GPU generation was rejected by its resource owner');
                    }
                }

                await Promise.resolve();
                this._assertCandidateLive(candidate, candidateLoss);

                if (this._destroyed || lifecycleGeneration !== this._lifecycleGeneration) {
                    this._destroyReplacement(candidate);
                    if (this._activeCandidate === candidate) this._activeCandidate = null;
                    return false;
                }
                if (this._activeCandidate === candidate) this._activeCandidate = null;
                this.gpuDevice = candidate.gpuDevice;
                this.device = candidate.device;
                this.deviceDescriptor = candidate.gpuDevice?.getAcquisitionOptions?.().deviceDescriptor
                    ?? this.deviceDescriptor;
                this.adapterOptions = candidate.gpuDevice?.getAcquisitionOptions?.().adapterOptions
                    ?? this.adapterOptions;
                this._watchDevice(candidate.device);
                console.log('[GpuRecovery] Recovery successful');
                return true;

            } catch (err) {
                if (candidate?.device) this._destroyReplacement(candidate);
                if (this._activeCandidate === candidate) this._activeCandidate = null;
                if (err?.code === 'GPU_RECOVERY_CANCELLED') return false;
                console.warn(`[GpuRecovery] Attempt ${this._retryCount} failed:`, err.message || err);
            }
          }

          if (this._destroyed || lifecycleGeneration !== this._lifecycleGeneration) return false;

          // All retries exhausted
          console.error('[GpuRecovery] All recovery attempts failed');

          if (this.onRecoveryFailed) {
              try {
                  await this._awaitLifecycle(
                      this.onRecoveryFailed(this._retryCount),
                      lifecycleGeneration,
                  );
              } catch (error) {
                  if (error?.code === 'GPU_RECOVERY_CANCELLED') return false;
              }
          }
          return false;
        };

        let tracked;
        tracked = run().finally(() => {
            if (this._recoveryPromise === tracked) this._recoveryPromise = null;
            this._recovering = false;
        });
        this._recoveryPromise = tracked;
        return tracked;
    }

    /**
     * Simulate a device loss for testing.
     * Calls device.destroy() which triggers device.lost with reason='destroyed'.
     * We set a flag so our handler treats it as unexpected.
     * See: https://toji.dev/webgpu-best-practices/device-loss.html#testing
     */
    simulateLoss() {
        if (!this.device) return;
        console.log('[GpuRecovery] Simulating device loss...');
        this._simulatedLoss = true;
        this.device.destroy();
    }

    /**
     * Check if recovery is currently in progress
     */
    get isRecovering() {
        return this._recovering;
    }

    /**
     * Stop monitoring and clean up
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._lifecycleGeneration += 1;
        const activeCandidate = this._activeCandidate;
        this._activeCandidate = null;
        this._destroyReplacement(activeCandidate);
        this._lifecycleCancellationResolve?.();
        this._lifecycleCancellationResolve = null;
        this._queuedLoss = null;
        this._recovering = false;
        this.onLost = null;
        this.onRecoveryStart = null;
        this.onRecovered = null;
        this.onRecoveryFailed = null;
        this.acquireDevice = null;
        this.sharedDeviceCache = false;
        this.gpuDevice = null;
        this.device = null;
    }
}

/**
 * Create a user-facing recovery notification overlay.
 * Shows status during recovery and a "please refresh" message on failure.
 *
 * @param {HTMLElement} container - Parent element to attach overlay to
 * @returns {{ show, update, hide, showFailed }} overlay controller
 */
export function createRecoveryOverlay(container) {
    let overlay = null;
    let messageEl = null;

    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:10000;pointer-events:auto;';

        const box = document.createElement('div');
        box.style.cssText = 'text-align:center;color:#e2e8f0;font-family:system-ui,sans-serif;max-width:400px;padding:32px;';

        const icon = document.createElement('div');
        icon.style.cssText = 'font-size:48px;margin-bottom:16px;';
        icon.textContent = '\u26A0\uFE0F';

        const title = document.createElement('div');
        title.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:8px;';
        title.textContent = 'GPU Disconnected';

        messageEl = document.createElement('div');
        messageEl.style.cssText = 'font-size:14px;color:#94a3b8;line-height:1.5;';

        box.appendChild(icon);
        box.appendChild(title);
        box.appendChild(messageEl);
        overlay.appendChild(box);
    }

    return {
        show(attempt, maxRetries) {
            ensureOverlay();
            messageEl.textContent = `Recovering... (attempt ${attempt}/${maxRetries})`;
            if (!overlay.parentNode) {
                (container || document.body).appendChild(overlay);
            }
        },

        update(text) {
            if (messageEl) messageEl.textContent = text;
        },

        showFailed() {
            ensureOverlay();
            messageEl.innerHTML = 'Recovery failed. Please <a href="javascript:location.reload()" style="color:#38bdf8;text-decoration:underline;">refresh the page</a>.<br><small style="color:#64748b;margin-top:8px;display:block;">If this keeps happening, restart your browser.</small>';
            if (!overlay.parentNode) {
                (container || document.body).appendChild(overlay);
            }
        },

        hide() {
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        },
    };
}
