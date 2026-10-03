// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    cssColorParseReport,
    hslToRgb as mathHslToRgb,
    rgbToHex as mathRgbToHex,
    rgbToHsl as mathRgbToHsl,
} from '../../../../engine/core/math/MathColor.js';

function parseHexBytes(hex) {
    const raw = String(hex ?? '#000000').trim();
    const body = raw.startsWith('#') ? raw.slice(1) : raw;
    if (/^[0-9a-fA-F]{3}$/.test(body) || /^[0-9a-fA-F]{6}$/.test(body)) {
        const report = cssColorParseReport(`#${body}`);
        if (report.valid && Array.isArray(report.rgb)) {
            return report.rgb.map(value => clampByte(value * 255));
        }
    }
    const legacy = body.length === 3
        ? body.split('').map(char => char + char).join('')
        : body.padEnd(6, '0').slice(0, 6);
    const n = Number.parseInt(legacy, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToRgba(hex, alpha = 255) {
    return [...parseHexBytes(hex), clampByte(alpha)];
}

export function rgbaToHex(r, g, b) {
    return mathRgbToHex([r, g, b].map(value => clampByte(value) / 255));
}

export function hexToHsl(hex) {
    const [r, g, b] = parseHexBytes(hex).map(value => value / 255);
    const [h, s, l] = mathRgbToHsl([r, g, b]);
    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
    };
}

export function hslToHex(h, s, l) {
    const hue = (((Number(h) || 0) % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
    const light = Math.max(0, Math.min(100, Number(l) || 0)) / 100;
    const [r, g, b] = mathHslToRgb([hue / 360, sat, light]);
    return rgbaToHex(r * 255, g * 255, b * 255);
}

export function hexToHsv(hex) {
    const [r, g, b] = parseHexBytes(hex).map(value => value / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max;
    const d = max - min;
    const s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

export function hsvToHex(h, s, v) {
    const hue = (((Number(h) || 0) % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
    const val = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return rgbaToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function normalizeHexColor(value, fallback = '#000000') {
    const raw = String(value ?? '').trim();
    const body = raw.startsWith('#') ? raw.slice(1) : raw;
    if (/^[0-9a-fA-F]{3}$/.test(body)) return `#${body.split('').map(char => char + char).join('').toLowerCase()}`;
    if (/^[0-9a-fA-F]{6}$/.test(body)) return `#${body.toLowerCase()}`;
    return fallback;
}

export function colorDistance(a, b) {
    return Math.abs(a[0] - b[0])
        + Math.abs(a[1] - b[1])
        + Math.abs(a[2] - b[2])
        + Math.abs((a[3] ?? 255) - (b[3] ?? 255));
}

export function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

export function cssColor(hex, alpha = 1) {
    const [r, g, b] = hexToRgba(hex);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
}
