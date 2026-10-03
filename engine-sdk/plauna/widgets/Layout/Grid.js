// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Grid - CSS Grid wrapper widget for Plauna
 * Provides responsive breakpoints and template areas support
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _gridSequence = 0;

function _newGridId() {
    return `grid-${Date.now()}-${++_gridSequence}`;
}

export class Grid extends UINode {
    // Widget metadata
    static id = 'grid';
    static name = 'Grid';
    static category = 'layout';
    static icon = '⊞';
    static description = 'Grid layout';
    static tags = ['layout', 'grid'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            columns: 3,
            gap: 'md',
            variant: 'default'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Grid(_newGridId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newGridId(), options = {}) {
        super(id, 'grid');
        
        // Grid-specific properties
        this.columns = options.columns || 'auto'; // number, string (auto-fit, auto-fill), array
        this.rows = options.rows || 'auto'; // number, string, array
        this.gap = options.gap || 'md'; // xs, sm, md, lg, xl, or custom string
        this.columnGap = options.columnGap || null;
        this.rowGap = options.rowGap || null;
        this.templateAreas = options.templateAreas || null;
        this.autoFlow = options.autoFlow || 'row'; // row, column, dense, row dense, column dense
        this.justifyItems = options.justifyItems || 'stretch'; // start, end, center, stretch
        this.alignItems = options.alignItems || 'stretch'; // start, end, center, stretch
        this.justifyContent = options.justifyContent || 'start'; // start, end, center, stretch, space-around, space-between, space-evenly
        this.alignContent = options.alignContent || 'start'; // start, end, center, stretch, space-around, space-between, space-evenly
        
        // Responsive breakpoints
        this.breakpoints = options.breakpoints || {
            xs: options.xs || null,
            sm: options.sm || null,
            md: options.md || null,
            lg: options.lg || null,
            xl: options.xl || null
        };
        
        // Set accessibility
        this.role = 'grid';
        this.ariaLabel = options.ariaLabel || 'Grid layout';
        
        // Set default styles
        this.setupStyles();
        
        // Setup responsive styles
        this.setupResponsiveStyles();
    }
    
    setupStyles() {
        const gridStyles = this.getGridStyles();
        const gapStyles = this.getGapStyles();
        
        this.setStyles({
            display: 'grid',
            ...gridStyles,
            ...gapStyles
        });
    }
    
    getGridStyles() {
        const styles = {};
        
        // Grid template columns
        if (this.columns !== null) {
            styles.gridTemplateColumns = this.parseGridValue(this.columns);
        }
        
        // Grid template rows
        if (this.rows !== null) {
            styles.gridTemplateRows = this.parseGridValue(this.rows);
        }
        
        // Grid template areas
        if (this.templateAreas) {
            styles.gridTemplateAreas = this.parseTemplateAreas(this.templateAreas);
        }
        
        // Grid auto flow
        if (this.autoFlow) {
            styles.gridAutoFlow = this.autoFlow;
        }
        
        // Grid alignment
        if (this.justifyItems) {
            styles.justifyItems = this.justifyItems;
        }
        
        if (this.alignItems) {
            styles.alignItems = this.alignItems;
        }
        
        if (this.justifyContent) {
            styles.justifyContent = this.justifyContent;
        }
        
        if (this.alignContent) {
            styles.alignContent = this.alignContent;
        }
        
        return styles;
    }
    
    getGapStyles() {
        const styles = {};
        
        // Column gap
        if (this.columnGap !== null) {
            styles.gridColumnGap = this.parseGapValue(this.columnGap);
        }
        
        // Row gap
        if (this.rowGap !== null) {
            styles.gridRowGap = this.parseGapValue(this.rowGap);
        }
        
        // Combined gap (if individual gaps not set)
        if (this.columnGap === null && this.rowGap === null && this.gap !== null) {
            styles.gap = this.parseGapValue(this.gap);
        }
        
        return styles;
    }
    
    parseGridValue(value) {
        if (typeof value === 'number') {
            return `repeat(${value}, 1fr)`;
        }
        
        if (typeof value === 'string') {
            // Handle common grid patterns
            if (value === 'auto') {
                return 'auto';
            }
            
            if (value === 'auto-fit' || value === 'auto-fill') {
                return `repeat(${value}, minmax(200px, 1fr))`;
            }
            
            if (value.includes('repeat')) {
                return value;
            }
            
            // Handle space-separated values
            if (value.includes(' ')) {
                return value;
            }
            
            // Handle unitless numbers
            if (!isNaN(value)) {
                return `repeat(${value}, 1fr)`;
            }
            
            return value;
        }
        
        if (Array.isArray(value)) {
            return value.map(v => this.parseGridValue(v)).join(' ');
        }
        
        return value;
    }
    
    parseGapValue(value) {
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
                xl: tokens.get('spacing.xl')
            };
            
            return spacingTokens[value] || value;
        }
        
        return value;
    }
    
    parseTemplateAreas(areas) {
        if (typeof areas === 'string') {
            return areas;
        }
        
        if (Array.isArray(areas)) {
            return areas.map(area => `"${area}"`).join(' ');
        }
        
        return areas;
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
        Object.entries(this.breakpoints).forEach(([breakpoint, config]) => {
            if (!config) return;
            
            const mediaQuery = `@media (min-width: ${breakpoints[breakpoint]})`;
            const gridStyles = this.getBreakpointGridStyles(config);
            
            css += `${mediaQuery} {\n`;
            css += `    #${this.id} {\n`;
            css += `        ${gridStyles}\n`;
            css += `    }\n`;
            css += `}\n\n`;
        });
        
        return css;
    }
    
    getBreakpointGridStyles(config) {
        const styles = [];
        
        if (config.columns) {
            styles.push(`grid-template-columns: ${this.parseGridValue(config.columns)};`);
        }
        
        if (config.rows) {
            styles.push(`grid-template-rows: ${this.parseGridValue(config.rows)};`);
        }
        
        if (config.templateAreas) {
            styles.push(`grid-template-areas: ${this.parseTemplateAreas(config.templateAreas)};`);
        }
        
        if (config.gap) {
            styles.push(`gap: ${this.parseGapValue(config.gap)};`);
        }
        
        if (config.columnGap) {
            styles.push(`grid-column-gap: ${this.parseGapValue(config.columnGap)};`);
        }
        
        if (config.rowGap) {
            styles.push(`grid-row-gap: ${this.parseGapValue(config.rowGap)};`);
        }
        
        if (config.autoFlow) {
            styles.push(`grid-auto-flow: ${config.autoFlow};`);
        }
        
        if (config.justifyItems) {
            styles.push(`justify-items: ${config.justifyItems};`);
        }
        
        if (config.alignItems) {
            styles.push(`align-items: ${config.alignItems};`);
        }
        
        if (config.justifyContent) {
            styles.push(`justify-content: ${config.justifyContent};`);
        }
        
        if (config.alignContent) {
            styles.push(`align-content: ${config.alignContent};`);
        }
        
        return styles.join('\n        ');
    }
    
    addResponsiveStyles(css) {
        // Create or update style element
        let styleElement = document.getElementById(`grid-responsive-${this.id}`);
        
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = `grid-responsive-${this.id}`;
            document.head.appendChild(styleElement);
        }
        
        styleElement.textContent = css;
    }
    
    // Setter methods
    setColumns(columns) {
        this.columns = columns;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setRows(rows) {
        this.rows = rows;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setGap(gap) {
        this.gap = gap;
        this.columnGap = null;
        this.rowGap = null;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setColumnGap(columnGap) {
        this.columnGap = columnGap;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setRowGap(rowGap) {
        this.rowGap = rowGap;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setTemplateAreas(areas) {
        this.templateAreas = areas;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setAutoFlow(autoFlow) {
        this.autoFlow = autoFlow;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setJustifyItems(justifyItems) {
        this.justifyItems = justifyItems;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setAlignItems(alignItems) {
        this.alignItems = alignItems;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setJustifyContent(justifyContent) {
        this.justifyContent = justifyContent;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setAlignContent(alignContent) {
        this.alignContent = alignContent;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    setBreakpoints(breakpoints) {
        this.breakpoints = breakpoints;
        this.setupResponsiveStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
    }
    
    // Helper methods for common grid patterns
    static createAutoFitGrid(id, minItemWidth = '200px', options = {}) {
        return new Grid(id, {
            columns: `repeat(auto-fit, minmax(${minItemWidth}, 1fr))`,
            gap: 'md',
            ...options
        });
    }
    
    static createAutoFillGrid(id, minItemWidth = '200px', options = {}) {
        return new Grid(id, {
            columns: `repeat(auto-fill, minmax(${minItemWidth}, 1fr))`,
            gap: 'md',
            ...options
        });
    }
    
    static createFixedColumnsGrid(id, columns = 3, options = {}) {
        return new Grid(id, {
            columns: columns,
            gap: 'md',
            ...options
        });
    }
    
    static createResponsiveGrid(id, options = {}) {
        return new Grid(id, {
            columns: 1,
            gap: 'md',
            breakpoints: {
                sm: { columns: 2 },
                lg: { columns: 3 },
                xl: { columns: 4 }
            },
            ...options
        });
    }
    
    static createTemplateGrid(id, templateAreas, options = {}) {
        return new Grid(id, {
            templateAreas,
            gap: 'md',
            ...options
        });
    }
    
    static createMasonryGrid(id, options = {}) {
        return new Grid(id, {
            columns: 'auto-fit',
            autoFlow: 'dense',
            gap: 'md',
            ...options
        });
    }
    
    static createCenteredGrid(id, options = {}) {
        return new Grid(id, {
            columns: 'auto-fit',
            gap: 'md',
            justifyContent: 'center',
            alignItems: 'center',
            ...options
        });
    }
    
    // Grid item positioning helpers
    addItem(item, column = null, row = null, area = null) {
        if (column !== null) {
            item.setStyle('gridColumn', column);
        }
        
        if (row !== null) {
            item.setStyle('gridRow', row);
        }
        
        if (area !== null) {
            item.setStyle('gridArea', area);
        }
        
        this.appendChild(item);
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT);
    }
    
    removeItem(item) {
        if (this.contains(item)) {
            this.removeChild(item);
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT);
        }
    }
    
    // Grid layout analysis
    getGridInfo() {
        return {
            columns: this.columns,
            rows: this.rows,
            gap: this.gap,
            templateAreas: this.templateAreas,
            autoFlow: this.autoFlow,
            justifyContent: this.justifyContent,
            alignContent: this.alignContent,
            childCount: this.children.length
        };
    }
    
    // Cleanup
    destroy() {
        // Remove responsive styles
        const styleElement = document.getElementById(`grid-responsive-${this.id}`);
        if (styleElement) {
            styleElement.remove();
        }
        
        // Clear children
        this.innerHTML = '';
    }
}
