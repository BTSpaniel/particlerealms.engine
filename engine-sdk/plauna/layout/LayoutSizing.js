// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uiLayoutValueReport } from '../../engine/core/math/UILayoutMath.js';

export function resolvePlaunaLayoutSize(value, containerSize, options = {}) {
    if (typeof value === 'number') {
        return value;
    }

    const fallback = options.fallback !== undefined ? options.fallback : containerSize;
    const report = uiLayoutValueReport(value, {
        ...options.context,
        percentageBasis: containerSize,
        containerSize
    });

    if (report.valid && report.resolved && Number.isFinite(report.px)) {
        return report.px;
    }

    if (report.kind === 'keyword' && report.keyword === 'auto') {
        return containerSize;
    }

    return fallback;
}

export function resolvePlaunaLayoutConstraints(style = {}, containerSize = 0) {
    const minInput = style.minWidth || 0;
    const maxInput = style.maxWidth !== undefined ? style.maxWidth : Infinity;
    const preferredInput = style.width || containerSize;

    return {
        min: resolvePlaunaLayoutSize(minInput, containerSize, { fallback: containerSize }),
        max: maxInput === Infinity
            ? Infinity
            : resolvePlaunaLayoutSize(maxInput, containerSize, { fallback: containerSize }),
        preferred: resolvePlaunaLayoutSize(preferredInput, containerSize, { fallback: containerSize })
    };
}
