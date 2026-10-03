// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ComputedStyle - Style resolution and caching system for Plauna.
 *
 * Style resolution pattern:
 * - Handles style inheritance from parent nodes
 * - Resolves design token references
 * - Computes final style values for rendering
 * - Caches computed styles for performance
 * - Tracks performance statistics
 *
 * Architecture:
 * - cache: Map of computed style results
 * - tokenCache: Map of resolved token values
 * - styleCache: Map of style property resolutions
 * - performanceStats: Metrics for cache hits/misses and timing
 *
 * Style categories:
 * - Position and layout: position, display, flex properties
 * - Sizing: width, height, min/max dimensions, flex basis/grow/shrink
 * - Spacing: margin, padding
 * - Visual: colors, borders, shadows, opacity
 * - Typography: font family, size, weight, line height, alignment
 * - Interaction: pointer events, cursor
 * - Accessibility: visibility, z-index
 * - Transform and animation
 */
import { tokens } from './DesignTokens.js';
import { resolvePlaunaStyleSize } from './StyleSizing.js';
import { legacyStringHash32 } from '../../engine/core/math/ChecksumMath.js';

export class ComputedStyle {
    constructor() {
        this.cache = new Map();
        this.tokenCache = new Map();
        this.styleCache = new Map();
        this.performanceStats = {
            totalComputations: 0,
            totalTime: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }

    /**
     * Compute style for a node.
     *
     * Style computation pattern:
     * - Generates cache key from node and parentStyle
     * - Returns cached result if available
     * - Resolves all style properties with inheritance
     * - Applies design token resolution
     * - Caches result for subsequent calls
     * - Tracks performance statistics
     *
     * @param {UINode} node - Node to compute style for
     * @param {Object} parentStyle - Parent node's computed style
     * @returns {Object} Computed style object
     */
    compute(node, parentStyle = null) {
        const startTime = performance.now();
        
        // Generate cache key
        const cacheKey = this.generateCacheKey(node, parentStyle);
        
        // Check cache
        if (this.cache.has(cacheKey)) {
            this.performanceStats.cacheHits++;
            const result = this.cache.get(cacheKey);
            this.updatePerformanceStats(startTime);
            return result;
        }
        
        this.performanceStats.cacheMisses++;
        
        // Compute style
        const computed = {
            // Position and layout
            position: this.resolvePosition(node, parentStyle),
            display: this.resolveDisplay(node, parentStyle),
            flexDirection: this.resolveFlexDirection(node, parentStyle),
            flexWrap: this.resolveFlexWrap(node, parentStyle),
            justifyContent: this.resolveJustifyContent(node, parentStyle),
            alignItems: this.resolveAlignItems(node, parentStyle),
            gap: this.resolveGap(node, parentStyle),
            
            // Sizing
            width: this.resolveSize(node, parentStyle, 'width'),
            height: this.resolveSize(node, parentStyle, 'height'),
            minWidth: this.resolveSize(node, parentStyle, 'minWidth'),
            minHeight: this.resolveSize(node, parentStyle, 'minHeight'),
            maxWidth: this.resolveSize(node, parentStyle, 'maxWidth'),
            maxHeight: this.resolveSize(node, parentStyle, 'maxHeight'),
            flexBasis: this.resolveFlexBasis(node, parentStyle),
            flexGrow: this.resolveFlexGrow(node, parentStyle),
            flexShrink: this.resolveFlexShrink(node, parentStyle),
            
            // Spacing
            margin: this.resolveSpacing(node, parentStyle, 'margin'),
            padding: this.resolveSpacing(node, parentStyle, 'padding'),
            
            // Visual
            backgroundColor: this.resolveColor(node, parentStyle, 'backgroundColor'),
            color: this.resolveColor(node, parentStyle, 'color'),
            borderColor: this.resolveColor(node, parentStyle, 'borderColor'),
            borderWidth: this.resolveBorderWidth(node, parentStyle),
            borderRadius: this.resolveBorderRadius(node, parentStyle),
            boxShadow: this.resolveBoxShadow(node, parentStyle),
            opacity: this.resolveOpacity(node, parentStyle),
            
            // Typography
            fontFamily: this.resolveFontFamily(node, parentStyle),
            fontSize: this.resolveFontSize(node, parentStyle),
            fontWeight: this.resolveFontWeight(node, parentStyle),
            lineHeight: this.resolveLineHeight(node, parentStyle),
            textAlign: this.resolveTextAlign(node, parentStyle),
            
            // Interaction
            pointerEvents: this.resolvePointerEvents(node, parentStyle),
            cursor: this.resolveCursor(node, parentStyle),
            
            // Accessibility
            visibility: this.resolveVisibility(node, parentStyle),
            zIndex: this.resolveZIndex(node, parentStyle),
            
            // Transform
            transform: this.resolveTransform(node, parentStyle),
            
            // Animation
            transition: this.resolveTransition(node, parentStyle),
            animation: this.resolveAnimation(node, parentStyle)
        };
        
        // Cache result
        this.cache.set(cacheKey, computed);
        
        // Update performance stats
        this.updatePerformanceStats(startTime);
        
        return computed;
    }

    // Resolve position
    resolvePosition(node, parentStyle) {
        const value = node.style.position || (parentStyle?.position);
        return value || 'static';
    }

    // Resolve display
    resolveDisplay(node, parentStyle) {
        const value = node.style.display || (parentStyle?.display);
        return value || 'flex';
    }

    // Resolve flex direction
    resolveFlexDirection(node, parentStyle) {
        const value = node.style.flexDirection || (parentStyle?.flexDirection);
        return value || 'row';
    }

    // Resolve flex wrap
    resolveFlexWrap(node, parentStyle) {
        const value = node.style.flexWrap || (parentStyle?.flexWrap);
        return value || 'nowrap';
    }

    // Resolve justify content
    resolveJustifyContent(node, parentStyle) {
        const value = node.style.justifyContent || (parentStyle?.justifyContent);
        return value || 'flex-start';
    }

    // Resolve align items
    resolveAlignItems(node, parentStyle) {
        const value = node.style.alignItems || (parentStyle?.alignItems);
        return value || 'stretch';
    }

    // Resolve gap
    resolveGap(node, parentStyle) {
        const value = node.style.gap || (parentStyle?.gap);
        
        if (value === undefined) return 0;
        
        // Resolve token values
        if (typeof value === 'string' && tokens.spacing(value)) {
            return tokens.spacing(value);
        }
        
        return this.parseSize(value);
    }

    // Resolve size (width, height, min/max sizes)
    resolveSize(node, parentStyle, property) {
        const value = node.style[property] || (parentStyle?.[property]);
        
        if (value === undefined || value === 'auto') {
            return 'auto';
        }
        
        // Resolve token values
        if (typeof value === 'string') {
            if (tokens.spacing(value)) {
                return tokens.spacing(value);
            }
            if (value.startsWith('token(') && value.endsWith(')')) {
                const tokenPath = value.slice(6, -1);
                return tokens.get(tokenPath);
            }
        }
        
        return this.parseSize(value);
    }

    // Resolve flex basis
    resolveFlexBasis(node, parentStyle) {
        const value = node.style.flexBasis || (parentStyle?.flexBasis);
        return value || 'auto';
    }

    // Resolve flex grow
    resolveFlexGrow(node, parentStyle) {
        const value = node.style.flexGrow || (parentStyle?.flexGrow);
        return value !== undefined ? Number(value) : 0;
    }

    // Resolve flex shrink
    resolveFlexShrink(node, parentStyle) {
        const value = node.style.flexShrink || (parentStyle?.flexShrink);
        return value !== undefined ? Number(value) : 1;
    }

    // Resolve spacing (margin, padding)
    resolveSpacing(node, parentStyle, property) {
        const value = node.style[property] || (parentStyle?.[property]);
        
        if (value === undefined) {
            return { top: 0, right: 0, bottom: 0, left: 0 };
        }
        
        if (typeof value === 'number') {
            return { top: value, right: value, bottom: value, left: value };
        }
        
        if (typeof value === 'string') {
            // Handle token values
            if (tokens.spacing(value)) {
                const spacing = tokens.spacing(value);
                return { top: spacing, right: spacing, bottom: spacing, left: spacing };
            }
            
            // Parse CSS shorthand
            const parts = value.split(/\s+/);
            switch (parts.length) {
                case 1:
                    const v = this.parseSize(parts[0]);
                    return { top: v, right: v, bottom: v, left: v };
                case 2:
                    const v1 = this.parseSize(parts[0]);
                    const v2 = this.parseSize(parts[1]);
                    return { top: v1, right: v2, bottom: v1, left: v2 };
                case 3:
                    const t = this.parseSize(parts[0]);
                    const lr = this.parseSize(parts[1]);
                    const b = this.parseSize(parts[2]);
                    return { top: t, right: lr, bottom: b, left: lr };
                case 4:
                    return {
                        top: this.parseSize(parts[0]),
                        right: this.parseSize(parts[1]),
                        bottom: this.parseSize(parts[2]),
                        left: this.parseSize(parts[3])
                    };
            }
        }
        
        return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    // Resolve color
    resolveColor(node, parentStyle, property) {
        const value = node.style[property] || (parentStyle?.[property]);
        
        if (value === undefined) {
            // Return default colors
            if (property === 'backgroundColor') {
                return 'transparent';
            }
            if (property === 'color') {
                return tokens.color('text.primary');
            }
            if (property === 'borderColor') {
                return tokens.color('text.tertiary');
            }
            return 'transparent';
        }
        
        // Resolve token colors
        if (typeof value === 'string') {
            if (value.startsWith('color(') && value.endsWith(')')) {
                const colorPath = value.slice(6, -1);
                return tokens.color(colorPath);
            }
            if (tokens.color(value)) {
                return tokens.color(value);
            }
        }
        
        return value;
    }

    // Resolve border width
    resolveBorderWidth(node, parentStyle) {
        const value = node.style.borderWidth || (parentStyle?.borderWidth);
        
        if (value === undefined) return 0;
        
        if (typeof value === 'string' && tokens.spacing(value)) {
            return tokens.spacing(value);
        }
        
        return this.parseSize(value);
    }

    // Resolve border radius
    resolveBorderRadius(node, parentStyle) {
        const value = node.style.borderRadius || (parentStyle?.borderRadius);
        
        if (value === undefined) return 0;
        
        if (typeof value === 'string') {
            if (tokens.radius(value)) {
                return tokens.radius(value);
            }
            if (value === 'full') {
                return 9999;
            }
        }
        
        return this.parseSize(value);
    }

    // Resolve box shadow
    resolveBoxShadow(node, parentStyle) {
        const value = node.style.boxShadow || (parentStyle?.boxShadow);
        
        if (value === undefined) return 'none';
        
        if (typeof value === 'string') {
            if (tokens.shadow(value)) {
                return tokens.shadow(value);
            }
        }
        
        return value;
    }

    // Resolve opacity
    resolveOpacity(node, parentStyle) {
        const value = node.style.opacity || (parentStyle?.opacity);
        return value !== undefined ? Number(value) : 1;
    }

    // Resolve font family
    resolveFontFamily(node, parentStyle) {
        const value = node.style.fontFamily || (parentStyle?.fontFamily);
        return value || tokens.typography('fontFamily.primary');
    }

    // Resolve font size
    resolveFontSize(node, parentStyle) {
        const value = node.style.fontSize || (parentStyle?.fontSize);
        
        if (value === undefined) {
            return tokens.typography('scale.3'); // 16px default
        }
        
        if (typeof value === 'string') {
            if (value.startsWith('fontSize(') && value.endsWith(')')) {
                const scaleIndex = parseInt(value.slice(9, -1));
                return tokens.getFontSize(scaleIndex);
            }
            if (tokens.spacing(value)) {
                return tokens.spacing(value);
            }
        }
        
        return this.parseSize(value);
    }

    // Resolve font weight
    resolveFontWeight(node, parentStyle) {
        const value = node.style.fontWeight || (parentStyle?.fontWeight);
        
        if (value === undefined) {
            return tokens.typography('fontWeight.regular');
        }
        
        if (typeof value === 'string') {
            const weight = tokens.typography(`fontWeight.${value}`);
            if (weight !== undefined) return weight;
        }
        
        return Number(value) || 400;
    }

    // Resolve line height
    resolveLineHeight(node, parentStyle) {
        const value = node.style.lineHeight || (parentStyle?.lineHeight);
        
        if (value === undefined) {
            return tokens.typography('lineHeight.normal');
        }
        
        if (typeof value === 'string') {
            const lineHeight = tokens.typography(`lineHeight.${value}`);
            if (lineHeight !== undefined) return lineHeight;
        }
        
        return Number(value) || 1.4;
    }

    // Resolve text align
    resolveTextAlign(node, parentStyle) {
        const value = node.style.textAlign || (parentStyle?.textAlign);
        return value || 'left';
    }

    // Resolve pointer events
    resolvePointerEvents(node, parentStyle) {
        const value = node.style.pointerEvents || (parentStyle?.pointerEvents);
        return value || 'auto';
    }

    // Resolve cursor
    resolveCursor(node, parentStyle) {
        const value = node.style.cursor || (parentStyle?.cursor);
        return value || 'default';
    }

    // Resolve visibility
    resolveVisibility(node, parentStyle) {
        const value = node.style.visibility || (parentStyle?.visibility);
        return value || 'visible';
    }

    // Resolve z-index
    resolveZIndex(node, parentStyle) {
        const value = node.style.zIndex || (parentStyle?.zIndex);
        
        if (value === undefined) return 0;
        
        if (typeof value === 'string') {
            const zIndex = tokens.zIndex(value);
            if (zIndex !== undefined) return zIndex;
        }
        
        return Number(value) || 0;
    }

    // Resolve transform
    resolveTransform(node, parentStyle) {
        const value = node.style.transform || (parentStyle?.transform);
        return value || 'none';
    }

    // Resolve transition
    resolveTransition(node, parentStyle) {
        const value = node.style.transition || (parentStyle?.transition);
        return value || 'none';
    }

    // Resolve animation
    resolveAnimation(node, parentStyle) {
        const value = node.style.animation || (parentStyle?.animation);
        return value || 'none';
    }

    // Parse size value
    parseSize(value) {
        return resolvePlaunaStyleSize(value);
    }

    // Generate cache key
    generateCacheKey(node, parentStyle) {
        const nodeStyleHash = this.hashObject(node.style);
        const parentStyleHash = parentStyle ? this.hashObject(parentStyle) : '';
        return `${node.id}_${nodeStyleHash}_${parentStyleHash}`;
    }

    // Simple object hash
    hashObject(obj) {
        if (!obj) return '';

        const str = JSON.stringify(obj, Object.keys(obj).sort());
        return legacyStringHash32(str).toString(36);
    }

    // Update performance stats
    updatePerformanceStats(startTime) {
        const duration = performance.now() - startTime;
        this.performanceStats.totalComputations++;
        this.performanceStats.totalTime += duration;
    }

    // Get performance stats
    getPerformanceStats() {
        return {
            ...this.performanceStats,
            averageTime: this.performanceStats.totalComputations > 0 ? 
                this.performanceStats.totalTime / this.performanceStats.totalComputations : 0,
            cacheHitRatio: this.performanceStats.cacheHits + this.performanceStats.cacheMisses > 0 ?
                this.performanceStats.cacheHits / (this.performanceStats.cacheHits + this.performanceStats.cacheMisses) : 0
        };
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
        this.tokenCache.clear();
        this.styleCache.clear();
    }

    // Reset performance stats
    resetPerformanceStats() {
        this.performanceStats = {
            totalComputations: 0,
            totalTime: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }

    // Invalidate cache for a node
    invalidateCache(node) {
        // Remove all cache entries that include this node
        for (const [key, value] of this.cache) {
            if (key.startsWith(node.id)) {
                this.cache.delete(key);
            }
        }
    }

    // Validate computed style
    validate(computedStyle) {
        const errors = [];
        
        // Check required properties
        const requiredProps = ['display', 'position', 'color'];
        for (const prop of requiredProps) {
            if (computedStyle[prop] === undefined) {
                errors.push(`Missing computed style property: ${prop}`);
            }
        }
        
        // Check numeric properties
        const numericProps = ['opacity', 'fontSize', 'borderRadius', 'zIndex'];
        for (const prop of numericProps) {
            if (computedStyle[prop] !== undefined && typeof computedStyle[prop] !== 'number') {
                errors.push(`Property ${prop} should be numeric, got ${typeof computedStyle[prop]}`);
            }
        }
        
        return errors;
    }

    // Destroy
    destroy() {
        this.clearCache();
        this.resetPerformanceStats();
    }
}
