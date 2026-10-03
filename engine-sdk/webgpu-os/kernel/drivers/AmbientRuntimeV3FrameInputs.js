// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Live input collector for the Ambient Runtime V3 eight-vec4 frame ABI.
 *
 * Pointer events are observed from the supplied target, but click impulses are
 * admitted only by the caller's interaction filter. This keeps application UI
 * clicks from becoming wallpaper input while still allowing Desktop to admit
 * clicks on its blank interaction surface.
 */

const DEFAULT_PRIMARY = Object.freeze([0.38, 0.91, 1]);
const DEFAULT_SECONDARY = Object.freeze([0.65, 0.40, 1]);

export function createAmbientRuntimeV3FrameInputSource(options = {}) {
    const pointerTarget = options.pointerTarget ?? globalThis.document ?? null;
    const interactionFilter = typeof options.interactionFilter === 'function'
        ? options.interactionFilter
        : () => false;
    const accentProvider = typeof options.accentProvider === 'function'
        ? options.accentProvider
        : () => null;
    const activityProvider = typeof options.activityProvider === 'function'
        ? options.activityProvider
        : () => 0;

    let bound = false;
    let interactionEnabled = true;
    let active = false;
    let pressed = false;
    let shiftKey = false;
    let altKey = false, ctrlKey = false, metaKey = false, buttons = 0;
    let clientX = -1;
    let clientY = -1;
    let velocityX = 0;
    let velocityY = 0;
    let lastMoveAt = null;
    let lastMoveX = -1;
    let lastMoveY = -1;
    let clickX = -1;
    let clickY = -1;
    let clickAt = null;
    let clickSerial = 0;

    const eventTime = event => finite(event?.timeStamp, performance.now());
    const onPointerMove = event => {
        if (!interactionEnabled) return;
        shiftKey = event?.shiftKey === true;
        altKey = event?.altKey === true; ctrlKey = event?.ctrlKey === true; metaKey = event?.metaKey === true;
        buttons = Number.isInteger(event?.buttons) ? event.buttons & 7 : pressed ? 1 : 0;
        const now = eventTime(event);
        const nextX = finite(event?.clientX, clientX);
        const nextY = finite(event?.clientY, clientY);
        if (lastMoveAt !== null && now > lastMoveAt) {
            const elapsedSeconds = Math.max(0.001, (now - lastMoveAt) / 1000);
            velocityX = (nextX - lastMoveX) / elapsedSeconds;
            velocityY = (nextY - lastMoveY) / elapsedSeconds;
        }
        clientX = nextX;
        clientY = nextY;
        lastMoveX = nextX;
        lastMoveY = nextY;
        lastMoveAt = now;
        active = true;
    };
    const onPointerDown = event => {
        if (!interactionEnabled) return;
        onPointerMove(event);
        let admitted = false;
        try { admitted = interactionFilter(event) === true; } catch {}
        pressed = admitted;
        buttons = admitted ? (Number.isInteger(event?.buttons) ? event.buttons & 7 : event?.button === 2 ? 2 : event?.button === 1 ? 4 : 1) : 0;
        if (!admitted) return;
        clickX = clientX;
        clickY = clientY;
        clickAt = eventTime(event);
        clickSerial = clickSerial >= 16_777_215 ? 1 : clickSerial + 1;
    };
    const onPointerUp = event => {
        if (event) onPointerMove(event);
        pressed = false;
        shiftKey = false;
        altKey = ctrlKey = metaKey = false; buttons = 0;
    };
    const onPointerLeave = () => {
        active = false;
        pressed = false;
        shiftKey = altKey = ctrlKey = metaKey = false; buttons = 0;
        clientX = -1;
        clientY = -1;
        velocityX = 0;
        velocityY = 0;
        lastMoveAt = null;
        lastMoveX = -1;
        lastMoveY = -1;
    };
    const discardClick = () => {
        clickX = -1;
        clickY = -1;
        clickAt = null;
        pressed = false;
        shiftKey = false;
        altKey = ctrlKey = metaKey = false; buttons = 0;
        // Keep the event counter monotonic internally. The ABI exports zero
        // until a new click, so a resumed lane cannot replay or alias one.
    };

    const bind = enabled => {
        const next = enabled === true && Boolean(pointerTarget?.addEventListener);
        if (!next) { onPointerLeave(); discardClick(); interactionEnabled = false; }
        if (next === bound) return false;
        bound = next;
        interactionEnabled = next;
        const method = next ? 'addEventListener' : 'removeEventListener';
        pointerTarget?.[method]?.('pointermove', onPointerMove, { passive: true });
        pointerTarget?.[method]?.('pointerdown', onPointerDown, { passive: true });
        pointerTarget?.[method]?.('pointerup', onPointerUp, { passive: true });
        pointerTarget?.[method]?.('pointercancel', onPointerLeave, { passive: true });
        pointerTarget?.[method]?.('pointerleave', onPointerLeave, { passive: true });
        return true;
    };

    const snapshot = frame => {
        const now = finite(frame?.now, performance.now());
        const width = Math.max(1, finite(frame?.width, 1));
        const height = Math.max(1, finite(frame?.height, 1));
        const rect = frame?.rect ?? { left: 0, top: 0, width, height };
        const rectWidth = Math.max(1, finite(rect.width, width));
        const rectHeight = Math.max(1, finite(rect.height, height));
        const settings = frame?.settings ?? {};
        const motionPaused = frame?.motionPaused === true || settings.motionPaused === true;
        const reducedMotion = frame?.reducedMotion === true || motionPaused;
        interactionEnabled = frame?.interactive === true && !reducedMotion;
        if (!interactionEnabled) { onPointerLeave(); discardClick(); }
        const pointerEnabled = interactionEnabled && active && clientX >= 0 && clientY >= 0;
        const pointerX = pointerEnabled ? clamp((clientX - finite(rect.left, 0)) / rectWidth, 0, 1) : -1;
        // Frame pointer coordinates follow the DOM/surface top-left origin.
        // Programs that interpolate NDC UVs (top = 1) convert their own local
        // coordinates; the collector must not mirror this raw input.
        const pointerY = pointerEnabled ? clamp((clientY - finite(rect.top, 0)) / rectHeight, 0, 1) : -1;
        const secondsSinceMove = lastMoveAt === null ? 60 : Math.max(0, (now - lastMoveAt) / 1000);
        const velocityDecay = Math.exp(-Math.max(0, secondsSinceMove - 0.04) * 12);
        const normalizedVelocityX = pointerEnabled ? clamp((velocityX / rectWidth) * velocityDecay, -8, 8) : 0;
        const normalizedVelocityY = pointerEnabled ? clamp((velocityY / rectHeight) * velocityDecay, -8, 8) : 0;
        const dwellSeconds = pointerEnabled && lastMoveAt !== null
            ? clamp(secondsSinceMove, 0, 60)
            : 0;
        const clickPointX = clickAt !== null ? clamp((clickX - finite(rect.left, 0)) / rectWidth, 0, 1) : -1;
        const clickPointY = clickAt !== null ? clamp((clickY - finite(rect.top, 0)) / rectHeight, 0, 1) : -1;
        const clickAge = clickAt !== null ? clamp((now - clickAt) / 1000, 0, 60) : 60;
        const accents = safeProvider(accentProvider, null);
        const primary = colorVector(accents?.primary, frame?.primaryAccent ?? DEFAULT_PRIMARY);
        const secondary = colorVector(accents?.secondary, frame?.secondaryAccent ?? DEFAULT_SECONDARY);
        const activity = motionPaused ? 0 : clamp(safeProvider(activityProvider, 0), 0, 1);
        const reduceTransparency = frame?.reduceTransparency === true;
        const elapsedSeconds = reducedMotion ? 0 : Math.max(0, finite(frame?.elapsedSeconds, 0));
        const deltaSeconds = reducedMotion ? 0 : clamp(frame?.deltaSeconds, 0, 0.1);

        return Object.freeze({
            gesture: Object.freeze({ shiftKey: pointerEnabled && shiftKey, altKey: pointerEnabled && altKey, ctrlKey: pointerEnabled && ctrlKey,
                metaKey: pointerEnabled && metaKey, buttons: pointerEnabled && pressed ? buttons : 0 }),
            resolutionTime: Object.freeze([width, height, elapsedSeconds, deltaSeconds]),
            pointer: Object.freeze([pointerX, pointerY, normalizedVelocityX, normalizedVelocityY]),
            pointerState: Object.freeze([pointerEnabled ? 1 : 0, pressed && pointerEnabled ? 1 : 0, dwellSeconds, clickAt !== null ? clickSerial : 0]),
            clickActivity: Object.freeze([clickPointX, clickPointY, clickAge, activity]),
            accentPrimary: Object.freeze([primary[0], primary[1], primary[2], reduceTransparency ? 1 : 0]),
            accentSecondary: Object.freeze([secondary[0], secondary[1], secondary[2], 0]),
            tone: Object.freeze([
                bounded(settings.speed, 1, 0, 4),
                bounded(settings.intensity, 1, 0, 2) * (reduceTransparency ? 0.82 : 1),
                bounded(settings.exposure, 0, -4, 4),
                bounded(settings.saturation, 1, 0, 3),
            ]),
            effects: Object.freeze([
                bounded(settings.pointerInfluence, 0.25, 0, 1),
                bounded(settings.activityInfluence, 0.25, 0, 1),
                Math.max(0, Math.min(16_777_215, Math.floor(finite(frame?.frameIndex, 0)))),
                reducedMotion ? 1 : 0,
            ]),
        });
    };

    return Object.freeze({
        bind,
        snapshot,
        currentClickSerial() { return clickAt !== null ? clickSerial : 0; },
        dispose() { bind(false); },
    });
}

export function flattenAmbientRuntimeV3FrameInputs(value) {
    const names = [
        'resolutionTime', 'pointer', 'pointerState', 'clickActivity',
        'accentPrimary', 'accentSecondary', 'tone', 'effects',
    ];
    const packed = new Float32Array(32);
    let offset = 0;
    for (const name of names) {
        const vector = Array.isArray(value?.[name]) || ArrayBuffer.isView(value?.[name]) ? value[name] : [];
        for (let index = 0; index < 4; index += 1) packed[offset++] = finite(vector[index], 0);
    }
    return packed;
}

function colorVector(value, fallback) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
        const hex = value.slice(1);
        return [
            parseInt(hex.slice(0, 2), 16) / 255,
            parseInt(hex.slice(2, 4), 16) / 255,
            parseInt(hex.slice(4, 6), 16) / 255,
        ];
    }
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        return [clamp(value[0], 0, 1), clamp(value[1], 0, 1), clamp(value[2], 0, 1)];
    }
    return colorVector(fallback, DEFAULT_PRIMARY);
}

function safeProvider(provider, fallback) {
    try { return provider() ?? fallback; } catch { return fallback; }
}

function bounded(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function clamp(value, minimum, maximum) {
    return bounded(value, minimum, minimum, maximum);
}

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
