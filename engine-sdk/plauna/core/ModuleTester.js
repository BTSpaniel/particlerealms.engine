// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlaunaModuleTester - Smoke-test runner for modules/widgets.
 *
 * Module testing pattern:
 * - Verifies module registration and instantiation
 * - Exposes widget properties for console diagnostics
 * - Summarizes complex values for readable output
 * - Tracks widget registry and available widgets
 *
 * Testing features:
 * - Module registration verification
 * - Widget instantiation testing
 * - Property exposure and summarization
 * - Value normalization for comparison
 *
 * Helper functions:
 * - summarizeValue(): Human-readable value summaries
 * - normalizeComparableValue(): Normalize values for comparison
 * - isPlainObject(): Check if value is plain object
 */
import { getAllWidgets, widgetRegistry } from '../widgets/index.js';

let _moduleTesterStorySequence = 0;

function _newModuleTesterStoryId(widgetId, storyName) {
    const normalizedStoryName = storyName.replace(/\s+/g, '-').toLowerCase();
    return `${widgetId}-smoke-${normalizedStoryName}-${Date.now()}-${++_moduleTesterStorySequence}`;
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function summarizeValue(value, depth = 0) {
    if (value === null || value === undefined) {
        return value;
    }

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return { type: 'array', length: value.length };
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) {
        return {
            type: 'HTMLElement',
            tagName: value.tagName?.toLowerCase() || 'unknown',
            id: value.id || null,
            className: value.className || ''
        };
    }

    if (valueType === 'function') {
        return { type: 'function', name: value.name || 'anonymous' };
    }

    if (valueType === 'object') {
        if (value?.id && value?.type) {
            return {
                type: value.type,
                id: value.id,
                className: value.className || ''
            };
        }

        if (depth >= 1) {
            return { type: 'object' };
        }

        const entries = Object.entries(value);
        const summary = {};
        for (const [key, entryValue] of entries.slice(0, 12)) {
            summary[key] = summarizeValue(entryValue, depth + 1);
        }

        if (entries.length > 12) {
            summary.__extraKeys = entries.length - 12;
        }

        return summary;
    }

    return String(value);
}

function normalizeComparableValue(value, depth = 0) {
    if (value === null || value === undefined) {
        return value;
    }

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeComparableValue(entry, depth + 1));
    }

    if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) {
        return {
            __type: 'HTMLElement',
            tagName: value.tagName?.toLowerCase() || 'unknown',
            id: value.id || null,
            className: value.className || ''
        };
    }

    if (valueType === 'function') {
        return {
            __type: 'function',
            name: value.name || 'anonymous'
        };
    }

    if (valueType === 'object') {
        if (value?.id && value?.type) {
            return {
                __type: value.type,
                id: value.id,
                className: value.className || ''
            };
        }

        if (depth >= 1) {
            return { __type: 'object' };
        }

        const normalized = {};
        for (const key of Object.keys(value).sort()) {
            normalized[key] = normalizeComparableValue(value[key], depth + 1);
        }
        return normalized;
    }

    return String(value);
}

function valuesMatch(expected, actual) {
    return JSON.stringify(normalizeComparableValue(expected)) === JSON.stringify(normalizeComparableValue(actual));
}

export class PlaunaModuleTester {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.widgetClasses = options.widgetClasses || getAllWidgets();
        this.coreChecks = Array.isArray(options.coreChecks) ? options.coreChecks : [];
        this.includeStories = options.includeStories !== false;
        this.storyLimit = Number.isInteger(options.storyLimit) ? options.storyLimit : Infinity;
        this.snapshotKeys = options.snapshotKeys || [
            'id',
            'type',
            'variant',
            'size',
            'disabled',
            'loading',
            'text',
            'content',
            'label',
            'title',
            'value',
            'status',
            'shape',
            'showcase',
            'open',
            'isOpen',
            'removable',
            'closable',
            'showStatus',
            'editable',
            'selected',
            'active'
        ];
    }

    async run() {
        const startedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        const report = {
            startedAt: new Date().toISOString(),
            durationMs: 0,
            core: [],
            widgets: [],
            summary: {
                corePassed: 0,
                coreFailed: 0,
                widgetsPassed: 0,
                widgetsFailed: 0,
                widgetStoriesPassed: 0,
                widgetStoriesFailed: 0
            }
        };

        this.logger.info('Plauna module tester started', {
            widgetCount: this.widgetClasses.length,
            coreCheckCount: this.coreChecks.length,
            includeStories: this.includeStories
        });

        for (const check of this.coreChecks) {
            const result = await this.runCoreCheck(check);
            report.core.push(result);
            if (result.passed) {
                report.summary.corePassed += 1;
            } else {
                report.summary.coreFailed += 1;
            }
        }

        for (const WidgetClass of this.widgetClasses) {
            const result = await this.runWidgetCheck(WidgetClass);
            report.widgets.push(result);
            if (result.passed) {
                report.summary.widgetsPassed += 1;
            } else {
                report.summary.widgetsFailed += 1;
            }
            report.summary.widgetStoriesPassed += result.storySummary.passed;
            report.summary.widgetStoriesFailed += result.storySummary.failed;
        }

        const endedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        report.durationMs = Math.round(endedAt - startedAt);

        this.logger.info('Plauna module tester complete', {
            ...report.summary,
            durationMs: report.durationMs,
            totalWidgets: report.widgets.length
        });

        return report;
    }

    async runCoreCheck(check) {
        const name = check?.name || 'Unnamed core check';
        try {
            const outcome = await check.run();
            const passed = outcome !== false && !(isPlainObject(outcome) && outcome.passed === false);
            const details = isPlainObject(outcome) && 'details' in outcome ? outcome.details : outcome;
            const result = {
                type: 'core',
                name,
                passed,
                details: summarizeValue(details)
            };

            if (passed) {
                this.logger.info(`Core check passed: ${name}`, result.details);
            } else {
                this.logger.warn(`Core check failed: ${name}`, result.details);
            }

            return result;
        } catch (error) {
            const result = {
                type: 'core',
                name,
                passed: false,
                error: error?.message || String(error)
            };
            this.logger.error(`Core check error: ${name}`, result);
            return result;
        }
    }

    async runWidgetCheck(WidgetClass) {
        const id = WidgetClass?.id || WidgetClass?.name || 'unknown-widget';
        const name = WidgetClass?.name || id;
        const registryMatch = widgetRegistry.get(id) === WidgetClass;
        const defaultOptions = this.getDefaultOptions(WidgetClass);
        const stories = this.includeStories ? this.getStories(WidgetClass) : {};
        const result = {
            type: 'widget',
            id,
            name,
            category: WidgetClass?.category || 'unknown',
            registryMatch,
            passed: true,
            issues: [],
            defaultOptions: summarizeValue(defaultOptions),
            defaultInstance: null,
            storySummary: { passed: 0, failed: 0 },
            storyResults: []
        };

        if (typeof WidgetClass !== 'function') {
            result.passed = false;
            result.issues.push('Widget export is not a constructor');
            this.logger.error(`Widget check failed: ${name}`, result);
            return result;
        }

        if (!WidgetClass.id) {
            result.passed = false;
            result.issues.push('Missing static id');
        }

        if (!WidgetClass.name) {
            result.passed = false;
            result.issues.push('Missing static name');
        }

        if (!registryMatch) {
            result.passed = false;
            result.issues.push('Widget constructor was not found in the active registry list');
        }

        const defaultInstance = this.safeInstantiate(WidgetClass, `${id}-smoke-default`, defaultOptions);
        if (defaultInstance.ok) {
            result.defaultInstance = this.snapshotInstance(defaultInstance.instance, defaultOptions);
            this.safeDestroy(defaultInstance.instance);
        } else {
            result.passed = false;
            result.issues.push(`Default instantiation failed: ${defaultInstance.error}`);
        }

        if (this.includeStories) {
            let storyIndex = 0;
            for (const [storyName, storyOptions] of Object.entries(stories)) {
                if (storyIndex >= this.storyLimit) {
                    break;
                }
                storyIndex += 1;

                const storyId = _newModuleTesterStoryId(id, storyName);
                const storyInstance = this.safeInstantiate(WidgetClass, storyId, storyOptions);
                if (storyInstance.ok) {
                    const storyResult = {
                        storyName,
                        passed: true,
                        options: summarizeValue(storyOptions),
                        snapshot: this.snapshotInstance(storyInstance.instance, storyOptions)
                    };
                    result.storyResults.push(storyResult);
                    result.storySummary.passed += 1;
                    this.logger.info(`Story check passed: ${name} / ${storyName}`, {
                        options: storyResult.options,
                        snapshot: storyResult.snapshot
                    });
                    this.safeDestroy(storyInstance.instance);
                } else {
                    const storyResult = {
                        storyName,
                        passed: false,
                        options: summarizeValue(storyOptions),
                        error: storyInstance.error
                    };
                    result.storyResults.push(storyResult);
                    result.storySummary.failed += 1;
                    result.passed = false;
                    this.logger.error(`Story check failed: ${name} / ${storyName}`, storyResult);
                }
            }
        }

        if (result.issues.length > 0) {
            this.logger.warn(`Widget smoke test warnings: ${name}`, result.issues);
        }

        if (result.passed && result.storySummary.failed === 0) {
            this.logger.info(`Widget smoke test passed: ${name}`, {
                defaultOptions: result.defaultOptions,
                defaultInstance: result.defaultInstance,
                stories: result.storySummary
            });
        }

        return result;
    }

    getDefaultOptions(WidgetClass) {
        try {
            if (typeof WidgetClass?.getDefaultOptions === 'function') {
                const defaults = WidgetClass.getDefaultOptions();
                return isPlainObject(defaults) ? defaults : {};
            }
        } catch (error) {
            this.logger.warn(`Default options lookup failed for ${WidgetClass?.name || 'unknown widget'}`, {
                message: error?.message || String(error)
            });
        }
        return {};
    }

    getStories(WidgetClass) {
        try {
            if (typeof WidgetClass?.stories === 'function') {
                const stories = WidgetClass.stories();
                return isPlainObject(stories) ? stories : {};
            }
        } catch (error) {
            this.logger.warn(`Stories lookup failed for ${WidgetClass?.name || 'unknown widget'}`, {
                message: error?.message || String(error)
            });
        }
        return {};
    }

    safeInstantiate(WidgetClass, id, options) {
        try {
            const instance = new WidgetClass(id, options);
            return { ok: true, instance };
        } catch (error) {
            return { ok: false, error: error?.message || String(error) };
        }
    }

    snapshotInstance(instance, optionSource = {}) {
        if (!instance) {
            return null;
        }

        const snapshot = {
            info: typeof instance.getInfo === 'function' ? summarizeValue(instance.getInfo()) : null,
            metadata: typeof instance.getMetadata === 'function' ? summarizeValue(instance.getMetadata()) : null,
            debug: typeof instance.getDebugInfo === 'function' ? summarizeValue(instance.getDebugInfo()) : null,
            className: instance.className || '',
            role: instance.role || '',
            ariaLabel: instance.ariaLabel || '',
            textContent: instance.textContent || '',
            childCount: Array.isArray(instance.children) ? instance.children.length : 0
        };

        const keys = new Set([
            ...this.snapshotKeys,
            ...Object.keys(optionSource || {})
        ]);

        snapshot.variables = {};
        snapshot.missingVariables = [];
        snapshot.mismatchedVariables = [];
        snapshot.matchedVariables = [];
        snapshot.observedVariables = [];
        snapshot.variableReport = [];
        for (const key of keys) {
            const hasExpected = Object.prototype.hasOwnProperty.call(optionSource || {}, key);
            const hasActual = key in instance;
            const expected = hasExpected ? optionSource[key] : undefined;
            const actual = hasActual ? instance[key] : undefined;

            const entry = {
                key,
                expected: hasExpected ? summarizeValue(expected) : undefined,
                actual: hasActual ? summarizeValue(actual) : undefined,
                status: 'observed'
            };

            if (hasActual) {
                snapshot.variables[key] = summarizeValue(actual);
                snapshot.observedVariables.push(key);
            }

            if (hasExpected && !hasActual) {
                entry.status = 'missing';
                snapshot.missingVariables.push(key);
            } else if (hasExpected && hasActual) {
                if (valuesMatch(expected, actual)) {
                    entry.status = 'match';
                    snapshot.matchedVariables.push(key);
                } else {
                    entry.status = 'mismatch';
                    snapshot.mismatchedVariables.push(key);
                }
            } else if (hasActual) {
                entry.status = 'observed';
            }

            snapshot.variableReport.push(entry);
        }

        snapshot.optionKeys = Object.keys(optionSource || {});
        snapshot.instanceKeys = Object.keys(instance || {});
        snapshot.variableSummary = {
            total: snapshot.variableReport.length,
            matched: snapshot.matchedVariables.length,
            missing: snapshot.missingVariables.length,
            mismatched: snapshot.mismatchedVariables.length,
            observed: snapshot.observedVariables.length
        };

        return snapshot;
    }

    safeDestroy(instance) {
        try {
            if (instance && typeof instance.destroy === 'function') {
                instance.destroy();
            }
        } catch (error) {
            this.logger.warn('Smoke test cleanup failed', {
                message: error?.message || String(error)
            });
        }
    }
}
