// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Browser-media producers for RenderSurface. These sources only expose pixels
// that the caller explicitly supplies or requests; camera capture is never
// started implicitly and owned MediaStreams are always stopped on dispose.

function waitForEvent(element, success, failure = 'error', signal = null) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => { cleanup(); resolve(element); };
    const onFailure = () => { cleanup(); reject(element.error || new Error(`MediaSurface: ${failure}`)); };
    const onAbort = () => { cleanup(); reject(signal.reason || new DOMException('Media surface disposed', 'AbortError')); };
    const cleanup = () => {
      element.removeEventListener(success, onSuccess);
      element.removeEventListener(failure, onFailure);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal?.aborted) { onAbort(); return; }
    element.addEventListener(success, onSuccess, { once: true });
    element.addEventListener(failure, onFailure, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wrap an ImageBitmap, image element, canvas, or URL as a static pixel source.
 * URL-created images default to anonymous CORS and expose a `ready` promise.
 */
export function createImageSurface(opts = {}) {
  let element = opts.element || opts.source || null;
  let ownsElement = false;
  if (!element && opts.url) {
    if (typeof Image === 'undefined') throw new Error('MediaSurface: Image is unavailable');
    element = new Image();
    element.crossOrigin = opts.crossOrigin ?? 'anonymous';
    element.decoding = opts.decoding ?? 'async';
    element.src = String(opts.url);
    ownsElement = true;
  }
  if (!element) throw new TypeError('createImageSurface requires element, source, or url');

  const alreadyReady = Number(element.width) > 0
    && (typeof element.complete !== 'boolean' || element.complete);
  const ready = alreadyReady ? Promise.resolve(element) : waitForEvent(element, 'load');
  const self = {
    element,
    sourceType: 'image',
    flipY: !!opts.flipY,
    dirty: true,
    ready,
    isReady() {
      if (typeof element.complete === 'boolean') return element.complete && element.naturalWidth > 0;
      return Number(element.width) > 0 && Number(element.height) > 0;
    },
    render() {},
    resize() { self.dirty = true; },
    dispose() {
      if (opts.closeOnDispose || (ownsElement && typeof element.close === 'function')) element.close?.();
      if (ownsElement && 'src' in element) element.src = '';
    },
  };
  ready.then(() => { self.dirty = true; }, () => { self.dirty = true; });
  return self;
}

/** Wrap an HTMLVideoElement or create one from a URL/MediaStream. */
export function createVideoSurface(opts = {}) {
  let element = opts.element || null;
  let ownsElement = false;
  if (!element) {
    if (typeof document === 'undefined') throw new Error('MediaSurface: video requires a DOM');
    element = document.createElement('video');
    ownsElement = true;
    element.muted = opts.muted !== false;
    element.loop = opts.loop !== false;
    element.playsInline = true;
    element.preload = opts.preload ?? 'auto';
    if (opts.crossOrigin !== false) element.crossOrigin = opts.crossOrigin ?? 'anonymous';
    if (opts.stream) element.srcObject = opts.stream;
    else if (opts.url) element.src = String(opts.url);
    else throw new TypeError('createVideoSurface requires element, stream, or url');
  }

  let disposed = false;
  const readiness = new AbortController();
  let callbackId = null;
  let lastTime = -1;
  const self = {
    element,
    sourceType: 'video',
    flipY: !!opts.flipY,
    dirty: true,
    isReady: () => element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0,
    render() {
      if (!self.isReady()) return;
      if (element.currentTime !== lastTime) {
        lastTime = element.currentTime;
        self.dirty = true;
      }
    },
    resize() { self.dirty = true; },
    dispose() {
      if (disposed) return;
      disposed = true;
      readiness.abort(new DOMException('Media surface disposed', 'AbortError'));
      if (callbackId !== null && element.cancelVideoFrameCallback) element.cancelVideoFrameCallback(callbackId);
      if (opts.stopTracks) for (const track of element.srcObject?.getTracks?.() || []) track.stop();
      if (ownsElement) {
        element.pause?.();
        element.srcObject = null;
        element.removeAttribute?.('src');
        element.load?.();
      }
    },
  };

  const onFrame = (now, metadata) => {
    if (disposed) return;
    self.dirty = true;
    // Consumers that cache decoded pixels can distinguish mediaTime from a
    // requested seek timestamp; existing single-argument callbacks are intact.
    opts.onFrame?.(self, metadata, now);
    if (!disposed) callbackId = element.requestVideoFrameCallback?.(onFrame) ?? null;
  };
  if (element.requestVideoFrameCallback) callbackId = element.requestVideoFrameCallback(onFrame);
  self.ready = self.isReady() ? Promise.resolve(element) : waitForEvent(element, 'loadeddata', 'error', readiness.signal);
  // Observe disposal even if a producer's consumer never awaited readiness.
  self.ready.catch(() => {});
  if (opts.autoplay !== false) self.ready.then(() => { if (!disposed) return element.play?.(); }).catch((error) => { if (!disposed) opts.onPlayError?.(error); });
  return self;
}

/**
 * Request a camera only after an explicit caller action, then expose it as a
 * video source. The returned source owns and stops every acquired track.
 */
export async function createCameraSurface(opts = {}) {
  if (!globalThis.isSecureContext) throw new Error('MediaSurface: camera capture requires a secure context');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('MediaSurface: getUserMedia is unavailable');
  }
  const stream = await navigator.mediaDevices.getUserMedia(opts.constraints || { video: true, audio: false });
  try {
    const source = createVideoSurface({
      ...opts,
      element: null,
      stream,
      muted: true,
      autoplay: true,
      loop: false,
      stopTracks: true,
      crossOrigin: false,
    });
    source.sourceType = 'camera';
    await source.ready;
    return source;
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
}
