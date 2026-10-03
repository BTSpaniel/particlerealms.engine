// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlaunaTextService - DOM-free text measurement and layout
 * Implements Pretext-style text measurement for Plauna
 */

export class PlaunaTextService {
    constructor(options = {}) {
        this.engine = options.engine || 'pretext';
        this.initialized = false;
        
        // Caches
        this.fontCache = new Map();
        this.measureCache = new Map();
        this.layoutCache = new Map();
        
        // Offscreen canvas for measurement
        this.canvas = null;
        this.context = null;
        
        // Font loading
        this.loadedFonts = new Set();
        this.fontObservers = new Map();
    }

    async initialize() {
        console.log('[Plauna] Initializing text service...');
        
        // Create offscreen canvas for measurement
        this.canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(256, 256)
            : document.createElement('canvas');
        this.canvas.width = 256;
        this.canvas.height = 256;
        this.context = this.canvas.getContext('2d');
        
        // Load default fonts
        await this.loadDefaultFonts();
        
        this.initialized = true;
        console.log('[Plauna] Text service initialized');
    }

    async loadDefaultFonts() {
        const defaultFonts = [
            { family: 'Inter', weight: 400, style: 'normal' },
            { family: 'Inter', weight: 600, style: 'normal' },
            { family: 'Inter', weight: 400, style: 'italic' },
            { family: 'monospace', weight: 400, style: 'normal' }
        ];

        for (const font of defaultFonts) {
            await this.loadFont(font);
        }
    }

    async loadFont(fontSpec) {
        const key = this.getFontKey(fontSpec);
        
        if (this.loadedFonts.has(key)) {
            return key;
        }

        try {
            // Prefer already-available system/document fonts in tests and editor.
            if (document?.fonts?.check) {
                const probe = `${fontSpec.style} ${fontSpec.weight} 14px "${fontSpec.family}"`;
                if (document.fonts.check(probe)) {
                    this.loadedFonts.add(key);
                    return key;
                }
            }

            // No packaged font assets are guaranteed for Plauna yet.
            // Mark the font as available and let canvas fall back naturally.
            this.loadedFonts.add(key);
            console.log(`[Plauna] Using fallback font: ${key}`);
            
            return key;
        } catch (error) {
            this.loadedFonts.add(key);
            return key;
        }
    }

    getFontKey(fontSpec) {
        return `${fontSpec.family}-${fontSpec.weight}-${fontSpec.style}`;
    }

    prepare(text, style = {}) {
        if (!this.initialized) {
            throw new Error('Text service not initialized');
        }

        const styleKey = this.getStyleKey(style);
        const cacheKey = `${text.substring(0, 50)}_${styleKey}`;
        
        // Check cache first
        if (this.measureCache.has(cacheKey)) {
            return this.measureCache.get(cacheKey);
        }

        // Prepare text measurement
        const handle = {
            text,
            style: {
                fontFamily: style.fontFamily || 'Inter',
                fontSize: style.fontSize || 14,
                fontWeight: style.fontWeight || 400,
                lineHeight: style.lineHeight || 20,
                ...style
            },
            styleKey,
            cacheKey,
            measured: false,
            metrics: null
        };

        this.measureCache.set(cacheKey, handle);
        return handle;
    }

    layout(handle, width = null, lineHeight = null) {
        if (!handle.measured) {
            this.measure(handle);
        }

        const layoutKey = `${handle.cacheKey}_${width}_${lineHeight}`;
        
        // Check layout cache
        if (this.layoutCache.has(layoutKey)) {
            return this.layoutCache.get(layoutKey);
        }

        // Perform line layout
        const lines = this.breakLines(handle.text, handle.style, width);
        const height = lines.length * (lineHeight || handle.style.lineHeight);
        
        const layout = {
            width: width || this.getMaxLineWidth(lines),
            height,
            lineCount: lines.length,
            lines,
            metrics: {
                ascent: this.getAscent(handle.style),
                descent: this.getDescent(handle.style),
                baseline: this.getBaseline(handle.style)
            }
        };

        this.layoutCache.set(layoutKey, layout);
        return layout;
    }

    measure(handle) {
        if (handle.measured) {
            return handle.metrics;
        }

        // Setup context for measurement
        this.context.font = `${handle.style.fontWeight} ${handle.style.fontSize}px ${handle.style.fontFamily}`;
        this.context.textAlign = 'left';
        this.context.textBaseline = 'alphabetic';

        // Measure text
        const metrics = this.context.measureText(handle.text);
        
        handle.metrics = {
            width: metrics.width,
            height: handle.style.fontSize,
            ascent: metrics.actualBoundingBoxAscent,
            descent: metrics.actualBoundingBoxDescent,
            left: metrics.actualBoundingBoxLeft,
            right: metrics.actualBoundingBoxRight
        };

        handle.measured = true;
        return handle.metrics;
    }

    breakLines(text, style, maxWidth) {
        if (!maxWidth) {
            return [text];
        }

        this.context.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
        
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = this.context.measureText(testLine);
            
            if (metrics.width <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    // Word is longer than max width, break it
                    lines.push(...this.breakLongWord(word, style, maxWidth));
                    currentLine = '';
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    breakLongWord(word, style, maxWidth) {
        this.context.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
        const lines = [];
        let currentLine = '';

        for (const char of word) {
            const testLine = currentLine + char;
            const metrics = this.context.measureText(testLine);
            
            if (metrics.width <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    lines.push(char);
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    getMaxLineWidth(lines) {
        let maxWidth = 0;
        for (const line of lines) {
            const metrics = this.context.measureText(line);
            maxWidth = Math.max(maxWidth, metrics.width);
        }
        return maxWidth;
    }

    getAscent(style) {
        this.context.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
        const metrics = this.context.measureText('M');
        return metrics.actualBoundingBoxAscent;
    }

    getDescent(style) {
        this.context.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
        const metrics = this.context.measureText('g');
        return metrics.actualBoundingBoxDescent;
    }

    getBaseline(style) {
        return style.fontSize * 0.8; // Approximate baseline
    }

    getStyleKey(style) {
        return `${style.fontFamily || 'Inter'}-${style.fontSize || 14}-${style.fontWeight || 400}`;
    }

    // DOM integration helpers
    measureElement(element) {
        const text = element.textContent || '';
        const computedStyle = window.getComputedStyle(element);
        
        const style = {
            fontFamily: computedStyle.fontFamily,
            fontSize: parseFloat(computedStyle.fontSize),
            fontWeight: parseInt(computedStyle.fontWeight) || 400,
            lineHeight: parseFloat(computedStyle.lineHeight) || 20
        };

        const handle = this.prepare(text, style);
        const metrics = this.measure(handle);
        
        // Store metrics on element for later use
        element._plaunaMetrics = metrics;
        return metrics;
    }

    measureSection(section) {
        const elements = section.querySelectorAll('[data-measure-text]');
        const measurements = [];
        
        elements.forEach(element => {
            const metrics = this.measureElement(element);
            measurements.push({ element, metrics });
        });
        
        return measurements;
    }

    enableVirtualScrolling(container) {
        // Add virtual scrolling capabilities
        const items = container.children;
        const itemHeight = this.estimateItemHeight(items[0]);
        
        container._plaunaVirtualScroll = {
            itemHeight,
            totalHeight: items.length * itemHeight,
            visibleRange: { start: 0, end: items.length }
        };

        // Update container for virtual scrolling
        container.style.height = `${container._plaunaVirtualScroll.totalHeight}px`;
    }

    estimateItemHeight(element) {
        if (!element) return 32;
        
        const metrics = this.measureElement(element);
        return metrics.height || 32;
    }

    invalidateFont(styleKey) {
        // Clear caches for this font
        for (const [key, handle] of this.measureCache) {
            if (handle.styleKey === styleKey) {
                handle.measured = false;
                handle.metrics = null;
            }
        }
        
        // Clear layout cache
        for (const [key, layout] of this.layoutCache) {
            if (key.includes(styleKey)) {
                this.layoutCache.delete(key);
            }
        }
    }

    destroy() {
        console.log('[Plauna] Destroying text service...');
        
        // Clear caches
        this.measureCache.clear();
        this.layoutCache.clear();
        this.fontCache.clear();
        
        // Close canvas
        if (this.canvas && typeof this.canvas.close === 'function') {
            this.canvas.close();
            this.canvas = null;
            this.context = null;
        } else if (this.canvas) {
            this.canvas = null;
            this.context = null;
        }
        
        this.initialized = false;
    }
}
