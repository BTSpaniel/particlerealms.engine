// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Divider - Visual separation widget for Plauna
 * Provides orientation variants with text label support
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _dividerSequence = 0;
let _dividerLineSequence = 0;

function _newDividerId() {
    return `divider-${Date.now()}-${++_dividerSequence}`;
}

function _newDividerLineId(ownerId) {
    return `${ownerId}-line-${++_dividerLineSequence}`;
}

export class Divider extends UINode {
    // Widget metadata
    static id = 'divider';
    static name = 'Divider';
    static category = 'layout';
    static icon = '─';
    static description = 'Visual divider';
    static tags = ['layout', 'divider', 'separator'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            orientation: 'horizontal',
            variant: 'default',
            margin: 'md'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Divider(_newDividerId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newDividerId(), options = {}) {
        super(id, 'divider');
        
        // Divider-specific properties
        this.orientation = options.orientation || 'horizontal'; // horizontal, vertical
        this.thickness = options.thickness || 'default'; // thin, default, thick
        this.style = options.style || 'solid'; // solid, dashed, dotted, double
        this.color = options.color || 'default'; // default, subtle, primary, secondary, success, warning, error
        this.label = options.label || null;
        this.labelPosition = options.labelPosition || 'center'; // start, center, end
        this.labelSpacing = options.labelSpacing || 'md';
        this.fullWidth = options.fullWidth !== false;
        
        // Set accessibility
        this.role = 'separator';
        this.ariaOrientation = this.orientation;
        this.ariaLabel = options.ariaLabel || (this.label ? `Divider: ${this.label}` : 'Content separator');
        
        // Set default styles
        this.setupStyles();
        
        // Build divider structure
        this.buildDivider();
    }
    
    setupStyles() {
        const orientationStyles = this.getOrientationStyles();
        const thicknessStyles = this.getThicknessStyles();
        const styleStyles = this.getStyleStyles();
        const colorStyles = this.getColorStyles();
        
        this.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: this.label ? this.getLabelJustify() : 'center',
            width: this.fullWidth ? '100%' : 'auto',
            height: 'auto',
            border: 'none',
            margin: '0',
            padding: '0',
            outline: 'none',
            ...orientationStyles,
            ...thicknessStyles,
            ...styleStyles,
            ...colorStyles
        });
    }
    
    getOrientationStyles() {
        if (this.orientation === 'horizontal') {
            return {
                flexDirection: 'row',
                width: this.fullWidth ? '100%' : 'auto',
                height: '1px',
                minHeight: '1px'
            };
        } else {
            return {
                flexDirection: 'column',
                width: '1px',
                minWidth: '1px',
                height: '100%'
            };
        }
    }
    
    getThicknessStyles() {
        const thicknesses = {
            thin: this.orientation === 'horizontal' ? { height: '1px', minHeight: '1px' } : { width: '1px', minWidth: '1px' },
            default: this.orientation === 'horizontal' ? { height: '1px', minHeight: '1px' } : { width: '1px', minWidth: '1px' },
            thick: this.orientation === 'horizontal' ? { height: '2px', minHeight: '2px' } : { width: '2px', minWidth: '2px' }
        };
        return thicknesses[this.thickness] || thicknesses.default;
    }
    
    getStyleStyles() {
        const styles = {
            solid: {
                borderStyle: 'solid'
            },
            dashed: {
                borderStyle: 'dashed'
            },
            dotted: {
                borderStyle: 'dotted'
            },
            double: {
                borderStyle: 'double'
            }
        };
        return styles[this.style] || styles.solid;
    }
    
    getColorStyles() {
        const colors = {
            default: this.orientation === 'horizontal' 
                ? { borderBottomColor: tokens.get('colors.border.medium') }
                : { borderLeftColor: tokens.get('colors.border.medium') },
            subtle: this.orientation === 'horizontal'
                ? { borderBottomColor: tokens.get('colors.border.subtle') }
                : { borderLeftColor: tokens.get('colors.border.subtle') },
            primary: this.orientation === 'horizontal'
                ? { borderBottomColor: tokens.get('colors.primary.500') }
                : { borderLeftColor: tokens.get('colors.primary.500') },
            secondary: this.orientation === 'horizontal'
                ? { borderBottomColor: tokens.get('colors.secondary.500') }
                : { borderLeftColor: tokens.get('colors.secondary.500') },
            success: this.orientation === 'horizontal'
                ? { borderBottomColor: tokens.get('colors.success') }
                : { borderLeftColor: tokens.get('colors.success') },
            warning: this.orientation === 'horizontal'
                ? { borderBottomColor: tokens.get('colors.warning') }
                : { borderLeftColor: tokens.get('colors.warning') },
            error: this.orientation === 'horizontal'
                ? { borderBottomColor: tokens.get('colors.error') }
                : { borderLeftColor: tokens.get('colors.error') }
        };
        return colors[this.color] || colors.default;
    }
    
    getLabelJustify() {
        const justifications = {
            start: 'flex-start',
            center: 'center',
            end: 'flex-end'
        };
        return justifications[this.labelPosition] || justifications.center;
    }
    
    getLabelSpacing() {
        const spacings = {
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return spacings[this.labelSpacing] || spacings.md;
    }
    
    buildDivider() {
        this.innerHTML = '';
        
        if (this.label) {
            this.buildLabeledDivider();
        } else {
            this.buildSimpleDivider();
        }
    }
    
    buildSimpleDivider() {
        if (this.orientation === 'horizontal') {
            const line = new UINode(`${this.id}-line`, 'div');
            line.setStyles({
                width: '100%',
                height: '100%',
                borderBottom: `${this.getThicknessValue()} ${this.style} ${this.getColorValue()}`,
                borderLeft: 'none',
                borderRight: 'none',
                borderTop: 'none'
            });
            this.appendChild(line);
        } else {
            const line = new UINode(`${this.id}-line`, 'div');
            line.setStyles({
                width: '100%',
                height: '100%',
                borderLeft: `${this.getThicknessValue()} ${this.style} ${this.getColorValue()}`,
                borderTop: 'none',
                borderBottom: 'none',
                borderRight: 'none'
            });
            this.appendChild(line);
        }
    }
    
    buildLabeledDivider() {
        const container = new UINode(`${this.id}-container`, 'div');
        container.setStyles({
            display: 'flex',
            flexDirection: this.orientation === 'horizontal' ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: this.getLabelJustify(),
            width: '100%',
            height: '100%',
            gap: this.getLabelSpacing()
        });
        
        if (this.orientation === 'horizontal') {
            // Left line
            const leftLine = this.createDividerLine();
            container.appendChild(leftLine);
            
            // Label
            const label = this.createLabel();
            container.appendChild(label);
            
            // Right line
            const rightLine = this.createDividerLine();
            container.appendChild(rightLine);
        } else {
            // Top line
            const topLine = this.createDividerLine();
            container.appendChild(topLine);
            
            // Label
            const label = this.createLabel();
            container.appendChild(label);
            
            // Bottom line
            const bottomLine = this.createDividerLine();
            container.appendChild(bottomLine);
        }
        
        this.appendChild(container);
    }
    
    createDividerLine() {
        const line = new UINode(_newDividerLineId(this.id), 'div');
        
        if (this.orientation === 'horizontal') {
            line.setStyles({
                flex: '1',
                height: '100%',
                borderBottom: `${this.getThicknessValue()} ${this.style} ${this.getColorValue()}`
            });
        } else {
            line.setStyles({
                flex: '1',
                width: '100%',
                borderLeft: `${this.getThicknessValue()} ${this.style} ${this.getColorValue()}`
            });
        }
        
        return line;
    }
    
    createLabel() {
        const label = new UINode(`${this.id}-label`, 'span');
        label.setStyles({
            color: tokens.get('colors.text.secondary'),
            fontSize: tokens.get('fontSizes.sm'),
            fontWeight: tokens.get('fontWeights.medium'),
            whiteSpace: 'nowrap',
            userSelect: 'none',
            flex: '0 0 auto'
        });
        
        if (typeof this.label === 'string') {
            label.textContent = this.label;
        } else if (this.label instanceof UINode) {
            label.appendChild(this.label);
        }
        
        return label;
    }
    
    getThicknessValue() {
        const thicknesses = {
            thin: '1px',
            default: '1px',
            thick: '2px'
        };
        return thicknesses[this.thickness] || thicknesses.default;
    }
    
    getColorValue() {
        const colors = {
            default: tokens.get('colors.border.medium'),
            subtle: tokens.get('colors.border.subtle'),
            primary: tokens.get('colors.primary.500'),
            secondary: tokens.get('colors.secondary.500'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error')
        };
        return colors[this.color] || colors.default;
    }
    
    // Setter methods
    setOrientation(orientation) {
        if (orientation !== this.orientation) {
            this.orientation = orientation;
            this.ariaOrientation = orientation;
            this.setupStyles();
            this.buildDivider();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setThickness(thickness) {
        if (thickness !== this.thickness) {
            this.thickness = thickness;
            this.setupStyles();
            this.buildDivider();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setStyle(style) {
        if (style !== this.style) {
            this.style = style;
            this.setupStyles();
            this.buildDivider();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setColor(color) {
        if (color !== this.color) {
            this.color = color;
            this.setupStyles();
            this.buildDivider();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setLabel(label) {
        if (label !== this.label) {
            this.label = label;
            this.ariaLabel = label ? `Divider: ${label}` : 'Content separator';
            this.buildDivider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setLabelPosition(position) {
        if (position !== this.labelPosition) {
            this.labelPosition = position;
            this.setupStyles();
            this.buildDivider();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setLabelSpacing(spacing) {
        if (spacing !== this.labelSpacing) {
            this.labelSpacing = spacing;
            this.setupStyles();
            this.buildDivider();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    setFullWidth(fullWidth) {
        if (fullWidth !== this.fullWidth) {
            this.fullWidth = fullWidth;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);
        }
    }
    
    // Static factory methods for common divider types
    static createHorizontalDivider(id, options = {}) {
        return new Divider(id, {
            orientation: 'horizontal',
            ...options
        });
    }
    
    static createVerticalDivider(id, options = {}) {
        return new Divider(id, {
            orientation: 'vertical',
            ...options
        });
    }
    
    static createLabeledDivider(id, label, options = {}) {
        return new Divider(id, {
            label: label,
            ...options
        });
    }
    
    static createThinDivider(id, options = {}) {
        return new Divider(id, {
            thickness: 'thin',
            ...options
        });
    }
    
    static createThickDivider(id, options = {}) {
        return new Divider(id, {
            thickness: 'thick',
            ...options
        });
    }
    
    static createDashedDivider(id, options = {}) {
        return new Divider(id, {
            style: 'dashed',
            ...options
        });
    }
    
    static createDottedDivider(id, options = {}) {
        return new Divider(id, {
            style: 'dotted',
            ...options
        });
    }
    
    static createPrimaryDivider(id, options = {}) {
        return new Divider(id, {
            color: 'primary',
            ...options
        });
    }
    
    static createSubtleDivider(id, options = {}) {
        return new Divider(id, {
            color: 'subtle',
            ...options
        });
    }
    
    // Helper method to create section dividers
    static createSectionDivider(id, title, options = {}) {
        return new Divider(id, {
            label: title,
            labelPosition: 'start',
            thickness: 'default',
            color: 'default',
            labelSpacing: 'lg',
            ...options
        });
    }
    
    // Helper method to create content dividers
    static createContentDivider(id, options = {}) {
        return new Divider(id, {
            thickness: 'thin',
            color: 'subtle',
            fullWidth: true,
            ...options
        });
    }
}
