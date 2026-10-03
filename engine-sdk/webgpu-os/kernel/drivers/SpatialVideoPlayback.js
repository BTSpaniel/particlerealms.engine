// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createVideoSurface } from '../../../engine/surfaces/MediaSurface.js';
import { normalizeSpatialSourceClip } from '../../factory/apps/ambient-studio/spatial/SpatialCore.js';

const decodedDurations = new WeakMap();
export function spatialVideoDuration(video) { return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : decodedDurations.get(video); }

/** Local recorder WebM may omit duration. Ask its decoder for the bounded end,
 * then restore the original frame; imported metadata and playback share this. */
export async function ensureSpatialVideoDuration(video, { signal, maxDurationSeconds = 86400, timeoutMs = 15000 } = {}) {
    signal?.throwIfAborted();
    const check = duration => { if (!Number.isFinite(duration) || duration <= 0 || duration > maxDurationSeconds) throw new RangeError(`Video duration must be positive and no longer than ${maxDurationSeconds} seconds.`); return duration; };
    const known = spatialVideoDuration(video);
    if (Number.isFinite(known) && known > 0) return check(known);
    const restoreTime = Math.max(0, Number(video.currentTime) || 0);
    video.pause();
    const duration = await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); for (const name of ['durationchange', 'seeked']) video.removeEventListener(name, inspect); video.removeEventListener('error', failed); signal?.removeEventListener('abort', abort); };
        const finish = (error, value) => { cleanup(); error ? reject(error) : resolve(value); };
        const inspect = event => {
            let value = Number(video.duration);
            if ((!Number.isFinite(value) || value <= 0) && event.type === 'seeked' && video.seekable?.length) value = video.seekable.end(video.seekable.length - 1);
            if (Number.isFinite(value) && value > 0) { try { finish(null, check(value)); } catch (error) { finish(error); } }
        };
        const failed = () => finish(new Error('Video duration could not be decoded.'));
        const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('Video duration discovery timed out.')), timeoutMs);
        for (const name of ['durationchange', 'seeked']) video.addEventListener(name, inspect);
        video.addEventListener('error', failed); signal?.addEventListener('abort', abort, { once: true });
        try { video.currentTime = maxDurationSeconds + 1; } catch (error) { finish(error); }
    });
    decodedDurations.set(video, duration);
    await seekSpatialVideoFrame(video, Math.min(restoreTime, duration - Math.min(.001, duration * .001)), signal, timeoutMs);
    return duration;
}

/** Resolve an authored trim against decoded metadata. Empty clips fail visibly. */
export function resolveSpatialVideoClip(settings, duration) {
    if (!Number.isFinite(duration) || duration <= 0) throw new TypeError('Video duration must be finite and positive before clip playback.');
    const clip = settings.sourceClip == null ? { startSeconds: 0, endSeconds: null } : normalizeSpatialSourceClip(settings.sourceClip);
    const endSeconds = Math.min(duration, clip.endSeconds ?? duration), startSeconds = Math.min(duration, clip.startSeconds);
    if (startSeconds >= endSeconds) throw new RangeError('Video clip is empty after applying the decoded source duration. Move its start before the end.');
    return { startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds };
}

// Seeking to duration can decode no frame. Keep the endpoint inside the clip,
// including sub-millisecond clips, without changing the saved trim values.
function lastFrameTime(clip) { return clip.endSeconds - Math.min(.001, clip.durationSeconds * .001); }
function targetWithin(clip, seconds) { return Math.max(clip.startSeconds, Math.min(lastFrameTime(clip), seconds)); }

/** Deterministic clip-local source time for manual inspection and ping-pong. */
export function sampleSpatialVideoTime(settings, time, duration) {
    const clip = resolveSpatialVideoClip(settings, duration), rate = settings.sourceRate ?? 1;
    if (!Number.isFinite(time) || !Number.isFinite(rate) || rate <= 0) throw new TypeError('Video source time and playback rate must be finite and positive.');
    if (settings.sourcePlayback === 'scrub') return targetWithin(clip, clip.startSeconds + clip.durationSeconds * Math.max(0, Math.min(1, settings.sourceScrub ?? 0)));
    const elapsed = Math.max(0, time) * rate;
    if (settings.sourcePlayback === 'pingpong') {
        const phase = elapsed % (2 * clip.durationSeconds);
        return targetWithin(clip, clip.startSeconds + (phase <= clip.durationSeconds ? phase : 2 * clip.durationSeconds - phase));
    }
    return targetWithin(clip, clip.startSeconds + (settings.sourceLoop === false ? Math.min(elapsed, clip.durationSeconds) : elapsed % clip.durationSeconds));
}

/** Asset preparation waits for the chosen frame, before a GPU lane exists. */
export async function prepareSpatialVideoFrame(video, settings, signal) {
    signal?.throwIfAborted();
    const duration = await ensureSpatialVideoDuration(video, { signal }), target = sampleSpatialVideoTime(settings, 0, duration);
    video.pause();
    return seekSpatialVideoFrame(video, target, signal);
}

async function seekSpatialVideoFrame(video, target, signal, timeoutMs = 15000) {
    signal?.throwIfAborted();
    if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) < 1e-7) return target;
    await new Promise((resolve, reject) => {
        const done = error => { clearTimeout(timer); video.removeEventListener('seeked', ready); video.removeEventListener('error', failed); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        const ready = () => { if (!video.seeking && video.readyState >= 2) done(); };
        const failed = () => done(new Error('Video source frame could not decode.'));
        const abort = () => done(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        const timer = setTimeout(() => done(new Error('Video source frame seek timed out.')), timeoutMs);
        video.addEventListener('seeked', ready); video.addEventListener('error', failed); signal?.addEventListener('abort', abort, { once: true });
        try { video.currentTime = target; } catch (error) { done(error); }
    });
    signal?.throwIfAborted(); return video.currentTime;
}

/** Decode-aware playback owned by one lane. Queue/GPU work stays with its caller. */
export function createSpatialVideoPlayback(video, settings) {
    const duration = spatialVideoDuration(video), clip = resolveSpatialVideoClip(settings, duration), mode = settings.sourcePlayback ?? 'timeline';
    const nativeLoop = settings.sourceLoop !== false && clip.startSeconds === 0 && clip.endSeconds === duration;
    video.loop = mode === 'timeline' && nativeLoop;
    let disposed = false, revision = 0, consumed = -1, decodedTime = null, consumedTime = null, playPending = false, playFailed = false, stopped = false;
    const decoded = (_surface, metadata) => { if (!disposed && !video.seeking && video.readyState >= 2) { revision++; decodedTime = Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime : video.currentTime; } };
    const surface = createVideoSurface({ element: video, autoplay: false, onFrame: decoded });
    const seeked = () => { surface.dirty = true; decoded(); };
    video.addEventListener('seeked', seeked);
    decoded();
    const seek = target => {
        if (video.seeking || Math.abs(video.currentTime - target) < Math.min(.025, clip.durationSeconds * .01)) return false;
        video.currentTime = target; return true;
    };
    return {
        update(time, { frozen = false } = {}) {
            if (disposed) return;
            video.playbackRate = settings.sourceRate ?? 1;
            if (frozen) { video.pause(); playFailed = false; return; }
            if (mode === 'scrub' || mode === 'pingpong') {
                video.pause();
                // Present a completed seek before scheduling the next one.
                // Otherwise a busy ping-pong source can seek on every tick and
                // never expose its newly decoded pixels to the render lane.
                if (consumed === revision) seek(sampleSpatialVideoTime(settings, time, duration));
                return;
            }
            if (video.seeking) return;
            if (video.currentTime < clip.startSeconds) { seek(clip.startSeconds); return; }
            if (video.currentTime >= clip.endSeconds || video.ended) {
                if (settings.sourceLoop === false) { video.pause(); stopped = true; seek(lastFrameTime(clip)); return; }
                stopped = false; seek(clip.startSeconds); return;
            }
            if (!stopped && video.paused && !playPending && !playFailed) {
                playPending = true;
                Promise.resolve(video.play()).catch(error => { if (!disposed && error?.name !== 'AbortError') { playFailed = true; console.debug('[SpatialVideoPlayback][play-blocked]', error.message); } }).finally(() => { playPending = false; });
            }
        },
        consumeFrame() {
            if (disposed || video.seeking || !surface.isReady()) return null;
            // Browsers without decoded-frame callbacks need the existing engine
            // polling fallback, but requested seek times are never sampled.
            if (!video.requestVideoFrameCallback) {
                surface.render();
                if (surface.dirty && (decodedTime !== video.currentTime || revision === 0)) decoded();
            }
            if (consumed === revision) return null;
            surface.dirty = false; consumed = revision; consumedTime = decodedTime;
            return { revision, time: consumedTime };
        },
        suspend() { video.pause(); playFailed = false; },
        diagnostics() { return { mediaCurrentTime: video.currentTime, mediaDecodedTime: consumedTime, mediaDuration: duration, mediaSeeking: video.seeking, mediaClipStart: clip.startSeconds, mediaClipEnd: clip.endSeconds, mediaFrameRevision: consumed, mediaPlayBlocked: playFailed }; },
        dispose() { if (disposed) return; disposed = true; video.pause(); video.removeEventListener('seeked', seeked); surface.dispose(); },
    };
}
