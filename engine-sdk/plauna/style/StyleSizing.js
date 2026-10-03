// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uiLayoutValueReport } from '../../engine/core/math/UILayoutMath.js';

export function resolvePlaunaStyleSize(value, options = {}) {
    if (typeof value === 'number') {
        return value;
    }

    const report = uiLayoutValueReport(value, {
        fontSize: 16,
        rootFontSize: 16,
        ...options.context
    });

    if (report.kind === 'keyword' && report.keyword === 'auto') {
        return 'auto';
    }

    if (report.kind === 'percentage' && Number.isFinite(report.value)) {
        return report.value / 100;
    }

    if (report.valid && report.resolved && Number.isFinite(report.px)) {
        return report.px;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric) || numeric === Infinity || numeric === -Infinity) {
        return numeric;
    }

    return options.fallback !== undefined ? options.fallback : 0;
}
