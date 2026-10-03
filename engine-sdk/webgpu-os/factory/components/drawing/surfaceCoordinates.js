// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { degreesToRadians } from '../../../../engine/core/math/UnitMath.js';

/** Resolve a pointer against a front-facing orthographic document surface. */
export function hitCanvasSurface({ clientX, clientY, stage, documentWidth, documentHeight, workspaceBounds = null, rotation = 0, mirrorX = false, mirrorY = false, displayWidth: surfaceWidth = null, displayHeight: surfaceHeight = null, scale = 1 }) {
    const rect = stage?.getBoundingClientRect?.();
    const displayWidth = Number(surfaceWidth) || Number(stage?.offsetWidth) || Number.parseFloat(stage?.style?.width) || 0;
    const displayHeight = Number(surfaceHeight) || Number(stage?.offsetHeight) || Number.parseFloat(stage?.style?.height) || 0;
    const width = Math.max(1, Number(documentWidth) || 1);
    const height = Math.max(1, Number(documentHeight) || 1);
    const workspace = normalizeWorkspaceBounds(workspaceBounds, width, height);
    if (!rect || displayWidth <= 0 || displayHeight <= 0 || !Number.isFinite(scale) || scale <= 0) return missResult();

    const screenX = (Number(clientX) - (rect.left + rect.width * 0.5)) / scale;
    const screenY = (Number(clientY) - (rect.top + rect.height * 0.5)) / scale;
    const radians = degreesToRadians(Number(rotation) || 0);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const scaledX = screenX / (mirrorX ? -1 : 1);
    const scaledY = screenY / (mirrorY ? -1 : 1);
    const localX = cos * scaledX + sin * scaledY + displayWidth * 0.5;
    const localY = -sin * scaledX + cos * scaledY + displayHeight * 0.5;
    const workspaceU = localX / displayWidth;
    const workspaceV = localY / displayHeight;
    const hit = workspaceU >= 0 && workspaceU <= 1 && workspaceV >= 0 && workspaceV <= 1;
    const workspaceX = workspaceU * workspace.width;
    const workspaceY = workspaceV * workspace.height;
    const x = workspace.x + workspaceX;
    const y = workspace.y + workspaceY;
    const u = x / width;
    const v = y / height;
    const insideCanvas = hit && x >= 0 && x < width && y >= 0 && y < height;
    return {
        hit,
        insideCanvas,
        x,
        y,
        u,
        v,
        workspaceX,
        workspaceY,
        workspaceU,
        workspaceV,
        ray: { eye: [u, 1 - v, 1], dir: [0, 0, -1] },
        position: insideCanvas ? [u, 1 - v, 0] : null,
        normal: insideCanvas ? [0, 0, 1] : null,
        surface: insideCanvas ? 'canvas' : 'pasteboard',
    };
}

function missResult() {
    return { hit: false, insideCanvas: false, x: Number.NaN, y: Number.NaN, u: Number.NaN, v: Number.NaN, workspaceX: Number.NaN, workspaceY: Number.NaN, workspaceU: Number.NaN, workspaceV: Number.NaN, ray: null, position: null, normal: null, surface: 'pasteboard' };
}

function normalizeWorkspaceBounds(bounds, width, height) {
    return {
        x: finiteNumber(bounds?.x, 0),
        y: finiteNumber(bounds?.y, 0),
        width: Math.max(Number.EPSILON, finiteNumber(bounds?.width, width)),
        height: Math.max(Number.EPSILON, finiteNumber(bounds?.height, height)),
    };
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
