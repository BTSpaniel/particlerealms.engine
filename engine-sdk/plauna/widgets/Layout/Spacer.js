// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spacer - Flexible spacing utility widget for Plauna
 * Provides flexible sizing with token integration
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _spacerSequence = 0;

function _newSpacerId() {
    return `spacer-${Date.now()}-${++_spacerSequence}`;
}

export class Spacer extends UINode {
    // Widget metadata
    static id = 'spacer';
    static name = 'Spacer';
    static category = 'layout';
    static icon = '⬜';
    static description = 'Spacing element';
    static tags = ['layout', 'spacer'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            size: 'md',
            direction: 'vertical'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Spacer(_newSpacerId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSpacerId(), options = {}) {
        super(id, 'spacer');
        
        // Spacer-specific properties
        this.size = options.size || 'md'; // xs, sm, md, lg, xl, 2xl, 3xl, 4xl, or custom value
        this.width = options.width || null; // null = auto
        this.height = options.height || null; // null = auto
        this.minWidth = options.minWidth || '0';
        this.minHeight = options.minHeight || '0';
        this.maxWidth = options.maxWidth || null;
        this.maxHeight = options.maxHeight || null;
        this.grow = options.grow || false; // flex-grow
        this.shrink = options.shrink || false; // flex-shrink
        this.basis = options.basis || 'auto'; // flex-basis
        this.direction = options.direction || 'vertical'; // vertical, horizontal, both
        this.responsive = options.responsive || null; // responsive breakpoints
        this.collapsible = options.collapsible || false; // can collapse on small screens
        
        // Set accessibility
        this.role = 'presentation';
        this.ariaHidden = 'true';
        
        // Set default styles
        this.setupStyles();
        
        // Setup responsive styles if needed
        if (this.responsive) {
            this.setupResponsiveStyles();
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const flexStyles = this.getFlexStyles();
        const directionStyles = this.getDirectionStyles();
        
        this.setStyles({
            display: 'block',
            ...sizeStyles,
            ...flexStyles,
            ...directionStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            '2xl': tokens.get('spacing.xxl'),
            '3xl': tokens.get('spacing.xxxl'),
            '4xl': tokens.get('spacing.xxxxl')
        };
        
        const sizeValue = sizes[this.size] || this.size;
        
        const styles = {};
        
        // Apply size based on direction
        if (this.direction === 'horizontal' || this.direction === 'both') {
            if (this.width !== null) {
                styles.width = this.parseSizeValue(this.width);
            } else {
                styles.width = sizeValue;
            }
        }
        
        if (this.direction === 'vertical' || this.direction === 'both') {
            if (this.height !== null) {
                styles.height = this.parseSizeValue(this.height);
            } else {
                styles.height = sizeValue;
            }
        }
        
        // Apply min/max constraints
        if (this.minWidth) {
            styles.minWidth = this.parseSizeValue(this.minWidth);
        }
        
        if (this.minHeight) {
            styles.minHeight = this.parseSizeValue(this.minHeight);
        }
        
        if (this.maxWidth) {
            styles.maxWidth = this.parseSizeValue(this.maxWidth);
        }
        
        if (this.maxHeight) {
            styles.maxHeight = this.parseSizeValue(this.maxHeight);
        }
        
        return styles;
    }
    
    getFlexStyles() {
        const styles = {};
        
        if (this.grow || this.shrink || this.basis !== 'auto') {
            styles.display = 'flex';
            styles.flex = `${this.grow ? 1 : 0} ${this.shrink ? 1 : 0} ${this.basis}`;
        }
        
        return styles;
    }
    
    getDirectionStyles() {
        const styles = {};
        
        if (this.direction === 'horizontal') {
            styles.flexDirection = 'row';
        } else if (this.direction === 'vertical') {
            styles.flexDirection = 'column';
        } else if (this.direction === 'both') {
            styles.flexDirection = 'column';
        }
        
        return styles;
    }
    
    parseSizeValue(value) {
        if (typeof value === 'number') {
            return value + 'px';
        }
        
        if (typeof value === 'string') {
            // Handle token-based values
            if (tokens.get(value)) {
                return tokens.get(value);
            }
            
            // Handle common spacing tokens
            const spacingTokens = {
                xs: tokens.get('spacing.xs'),
                sm: tokens.get('spacing.sm'),
                md: tokens.get('spacing.md'),
                lg: tokens.get('spacing.lg'),
                xl: tokens.get('spacing.xl'),
                '2xl': tokens.get('spacing.xxl'),
                '3xl': tokens.get('spacing.xxxl'),
                '4xl': tokens.get('spacing.xxxxl')
            };
            
            return spacingTokens[value] || value;
        }
        
        return value;
    }
    
    setupResponsiveStyles() {
        // Generate responsive CSS for breakpoints
        const responsiveCSS = this.generateResponsiveCSS();
        
        if (responsiveCSS) {
            // Add responsive styles to the document
            this.addResponsiveStyles(responsiveCSS);
        }
    }
    
    generateResponsiveCSS() {
        let css = '';
        
        // Breakpoint definitions
        const breakpoints = {
            xs: '480px',
            sm: '768px',
            md: '1024px',
            lg: '1280px',
            xl: '1536px'
        };
        
        // Generate media queries for each breakpoint
        Object.entries(this.responsive).forEach(([breakpoint, config]) => {
            if (!config) return;
            
            const mediaQuery = `@media (max-width: ${breakpoints[breakpoint]})`;
            const spacerStyles = this.getBreakpointSpacerStyles(config);
            
            css += `${mediaQuery} {\n`;
            css += `    #${this.id} {\n`;
            css += `        ${spacerStyles}\n`;
            css += `    }\n`;
            css += `}\n\n`;
        });
        
        return css;
    }
    
    getBreakpointSpacerStyles(config) {
        const styles = [];
        
        if (config.size) {
            const sizeValue = this.parseSizeValue(config.size);
            
            if (config.direction === 'horizontal' || config.direction === 'both') {
                styles.push(`width: ${config.width || sizeValue};`);
            }
            
            if (config.direction === 'vertical' || config.direction === 'both') {
                styles.push(`height: ${config.height || sizeValue};`);
            }
        }
        
        if (config.collapsible) {
            styles.push('display: none;');
        }
        
        return styles.join('\n        ');
    }
    
    addResponsiveStyles(css) {
        // Create or update style element
        let styleElement = document.getElementById(`spacer-responsive-${this.id}`);
        
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = `spacer-responsive-${this.id}`;
            document.head.appendChild(styleElement);
        }
        
        styleElement.textContent = css;
    }
    
    // Setter methods
    setSize(size) {
        if (size !== this.size) {
            this.size = size;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setWidth(width) {
        if (width !== this.width) {
            this.width = width;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setHeight(height) {
        if (height !== this.height) {
            this.height = height;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setMinWidth(minWidth) {
        if (minWidth !== this.minWidth) {
            this.minWidth = minWidth;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setMinHeight(minHeight) {
        if (minHeight !== this.minHeight) {
            this.minHeight = minHeight;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setMaxWidth(maxWidth) {
        if (maxWidth !== this.maxWidth) {
            this.maxWidth = maxWidth;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setMaxHeight(maxHeight) {
        if (maxHeight !== this.maxHeight) {
            this.maxHeight = maxHeight;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setGrow(grow) {
        if (grow !== this.grow) {
            this.grow = grow;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setShrink(shrink) {
        if (shrink !== this.shrink) {
            this.shrink = shrink;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setBasis(basis) {
        if (basis !== this.basis) {
            this.basis = basis;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setDirection(direction) {
        if (direction !== this.direction) {
            this.direction = direction;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setResponsive(responsive) {
        this.responsive = responsive;
        this.setupResponsiveStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setCollapsible(collapsible) {
        if (collapsible !== this.collapsible) {
            this.collapsible = collapsible;
            this.setupResponsiveStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    // Static factory methods for common spacer types
    static createVerticalSpacer(id, size = 'md', options = {}) {
        return new Spacer(id, {
            size,
            direction: 'vertical',
            ...options
        });
    }
    
    static createHorizontalSpacer(id, size = 'md', options = {}) {
        return new Spacer(id, {
            size,
            direction: 'horizontal',
            ...options
        });
    }
    
    static createFlexibleSpacer(id, options = {}) {
        return new Spacer(id, {
            grow: true,
            shrink: true,
            basis: 'auto',
            ...options
        });
    }
    
    static createFixedSpacer(id, width, height, options = {}) {
        return new Spacer(id, {
            width,
            height,
            direction: 'both',
            ...options
        });
    }
    
    static createResponsiveSpacer(id, options = {}) {
        return new Spacer(id, {
            size: 'md',
            responsive: {
                xs: { size: 'sm', collapsible: true },
                sm: { size: 'md' },
                md: { size: 'lg' }
            },
            ...options
        });
    }
    
    static createSectionSpacer(id, options = {}) {
        return new Spacer(id, {
            size: 'xl',
            direction: 'vertical',
            ...options
        });
    }
    
    static createInlineSpacer(id, options = {}) {
        return new Spacer(id, {
            size: 'sm',
            direction: 'horizontal',
            ...options
        });
    }
    
    static createParagraphSpacer(id, options = {}) {
        return new Spacer(id, {
            size: 'lg',
            direction: 'vertical',
            ...options
        });
    }
    
    // Utility methods for common spacing patterns
    static createGapSpacer(id, gap = 'md', options = {}) {
        return new Spacer(id, {
            size: gap,
            ...options
        });
    }
    
    static createMarginSpacer(id, margin = 'md', options = {}) {
        return new Spacer(id, {
            size: margin,
            direction: 'vertical',
            ...options
        });
    }
    
    static createPaddingSpacer(id, padding = 'md', options = {}) {
        return new Spacer(id, {
            size: padding,
            direction: 'both',
            ...options
        });
    }
    
    // Spacer information
    getSpacerInfo() {
        return {
            size: this.size,
            width: this.width,
            height: this.height,
            direction: this.direction,
            grow: this.grow,
            shrink: this.shrink,
            basis: this.basis,
            responsive: this.responsive,
            collapsible: this.collapsible
        };
    }
    
    // Cleanup
    destroy() {
        // Remove responsive styles
        const styleElement = document.getElementById(`spacer-responsive-${this.id}`);
        if (styleElement) {
            styleElement.remove();
        }
        
        // Clear content
        this.innerHTML = '';
    }
}
