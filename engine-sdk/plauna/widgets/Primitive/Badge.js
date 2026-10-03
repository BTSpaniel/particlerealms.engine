// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Badge - Status indicator widget for Plauna
 * Provides status indicators, counts, and labels with variants
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';

let _badgeSequence = 0;

function _newBadgeId() {
    return `badge-${Date.now()}-${++_badgeSequence}`;
}

export class Badge extends UINode {
    // Widget metadata
    static id = 'badge';
    static name = 'Badge';
    static category = 'primitive';
    static icon = '🏷️';
    static description = 'Status badge indicator';
    static tags = ['primitive', 'badge', 'status'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            label: '',
            variant: 'primary',
            size: 'md'
        };
    }

    static stories() {
        return {
            'Primary':   { content: 'New',    variant: 'primary' },
            'Success':   { content: 'Done',   variant: 'success' },
            'Warning':   { content: 'Review', variant: 'warning' },
            'Error':     { content: 'Failed', variant: 'error' },
            'Small':     { content: 'Badge',  variant: 'primary', size: 'sm' },
            'Large':     { content: 'Badge',  variant: 'primary', size: 'lg' },
        };
    }
    
    static create(container, options = {}) {
        const instance = new Badge(_newBadgeId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newBadgeId(), options = {}) {
        super(id, 'badge');
        
        // Badge-specific properties
        this.content = options.content || '';
        this.variant = options.variant || 'default';
        this.size = options.size || 'md';
        this.shape = options.shape || 'rounded'; // rounded, pill, square
        this.dot = options.dot || false;
        this.count = options.count || null;
        this.maxCount = options.maxCount || 99;
        this.showZero = options.showZero || false;
        this.position = options.position || 'static'; // static, top-right, top-left
        
        // Set accessibility
        /**
         * Accessibility role pattern for badges.
         *
         * Role assignment based on badge type:
         * - Dot badges (no content): role="presentation" - purely decorative
         * - Label badges (with content): role="status" - conveys status information
         * - Label badges: ariaLive="polite" - announces changes to screen readers
         *
         * This pattern ensures screen readers ignore decorative dots
         * while announcing meaningful status changes for label badges.
         */
        this.role = this.dot ? 'presentation' : 'status';
        if (!this.dot) {
            this.ariaLive = 'polite';
        }
        
        // Set default styles
        this.setupStyles();
        
        // Update content
        this.updateContent();
    }
    
    /**
     * Setup modern badge surface styling.
     *
     * Badge surface pattern for status indicators:
     * - Inline-flex for proper alignment with text
     * - Font weight medium for clear visibility
     * - Transitions for smooth state changes
     * - User-select none to prevent text selection
     * - Default cursor (badges are typically non-interactive)
     *
     * Badges are designed to be small status indicators that can
     * be placed inline with text or positioned absolutely on elements.
     */
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const shapeStyles = this.getShapeStyles();
        const positionStyles = this.getPositionStyles();
        
        this.setStyles({
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            verticalAlign: 'middle',
            transition: 'transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease, border-color 150ms ease, color 150ms ease',
            cursor: 'default',
            userSelect: 'none',
            boxShadow: '0 8px 18px rgba(15, 23, 42, 0.10)',
            backdropFilter: 'saturate(1.12) blur(8px)',
            ...sizeStyles,
            ...variantStyles,
            ...shapeStyles,
            ...positionStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: 'var(--font-size-xs)',
                height: '16px',
                minWidth: this.dot ? '6px' : '16px',
                padding: this.dot ? '0' : '0 4px'
            },
            sm: {
                fontSize: 'var(--font-size-sm)',
                height: '20px',
                minWidth: this.dot ? '8px' : '20px',
                padding: this.dot ? '0' : '0 6px'
            },
            md: {
                fontSize: 'var(--font-size-sm)',
                height: '24px',
                minWidth: this.dot ? '10px' : '24px',
                padding: this.dot ? '0' : '0 8px'
            },
            lg: {
                fontSize: 'var(--font-size-md)',
                height: '28px',
                minWidth: this.dot ? '12px' : '28px',
                padding: this.dot ? '0' : '0 10px'
            },
            xl: {
                fontSize: 'var(--font-size-md)',
                height: '32px',
                minWidth: this.dot ? '14px' : '32px',
                padding: this.dot ? '0' : '0 12px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                color: 'var(--color-primary-700, #1d4ed8)',
                border: '1px solid rgba(59, 130, 246, 0.24)'
            },
            secondary: {
                backgroundColor: 'rgba(15, 23, 42, 0.06)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(148, 163, 184, 0.18)'
            },
            success: {
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                color: 'var(--color-success, #10b981)',
                border: '1px solid rgba(16, 185, 129, 0.24)'
            },
            warning: {
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                color: '#92400e',
                border: '1px solid rgba(245, 158, 11, 0.24)'
            },
            error: {
                backgroundColor: 'rgba(239, 68, 68, 0.14)',
                color: '#991b1b',
                border: '1px solid rgba(239, 68, 68, 0.24)'
            },
            info: {
                backgroundColor: 'rgba(59, 130, 246, 0.14)',
                color: 'var(--color-primary-700, #1d4ed8)',
                border: '1px solid rgba(59, 130, 246, 0.24)'
            },
            outline: {
                backgroundColor: 'transparent',
                color: 'var(--color-primary-600, #0284c7)',
                border: '1px solid rgba(59, 130, 246, 0.32)'
            },
            subtle: {
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                color: 'var(--color-primary-700, #1d4ed8)',
                border: '1px solid rgba(59, 130, 246, 0.16)'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getShapeStyles() {
        const shapes = {
            rounded: {
                borderRadius: 'var(--border-radius-md)'
            },
            pill: {
                borderRadius: 'var(--border-radius-full)'
            },
            square: {
                borderRadius: 'var(--border-radius-sm)'
            }
        };
        return shapes[this.shape] || shapes.rounded;
    }
    
    getPositionStyles() {
        const positions = {
            static: {
                position: 'static',
                top: 'auto',
                right: 'auto',
                bottom: 'auto',
                left: 'auto',
                transform: 'none'
            },
            'top-right': {
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                transform: 'translate(50%, -50%)',
                zIndex: '1'
            },
            'top-left': {
                position: 'absolute',
                top: '-8px',
                left: '-8px',
                transform: 'translate(-50%, -50%)',
                zIndex: '1'
            }
        };
        return positions[this.position] || positions.static;
    }
    
    updateContent() {
        if (this.dot) {
            this.textContent = '';
            if (this.element) this.element.innerHTML = '';
            this.ariaLabel = 'Status indicator';
        } else if (this.count !== null) {
            const displayCount = this.formatCount(this.count);
            this.textContent = displayCount;
            if (this.element) this.element.textContent = displayCount;
            this.ariaLabel = `Count: ${this.count}`;
        } else {
            this.textContent = this.content;
            if (this.element) this.element.textContent = this.content;
            this.ariaLabel = this.content || 'Badge';
        }
        
        // Hide if count is 0 and showZero is false
        if (this.count === 0 && !this.showZero && !this.dot) {
            this.setStyle('display', 'none');
        } else {
            this.setStyle('display', 'inline-flex');
        }
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    formatCount(count) {
        if (count > this.maxCount) {
            return `${this.maxCount}+`;
        }
        return count.toString();
    }
    
    setContent(content) {
        this.content = content;
        this.updateContent();
    }
    
    setVariant(variant) {
        this.variant = variant;
        this.setupStyles();
        this.markDirty(DIRTY.PAINT);
    }
    
    setSize(size) {
        this.size = size;
        this.setupStyles();
        this.markDirty(DIRTY.PAINT);
    }
    
    setShape(shape) {
        this.shape = shape;
        this.setupStyles();
        this.markDirty(DIRTY.PAINT);
    }
    
    setDot(dot) {
        this.dot = dot;
        this.setupStyles();
        this.updateContent();
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setCount(count) {
        this.count = count;
        this.updateContent();
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setMaxCount(maxCount) {
        this.maxCount = maxCount;
        if (this.count !== null) {
            this.updateContent();
        }
        this.markDirty(DIRTY.PAINT);
    }
    
    setShowZero(showZero) {
        this.showZero = showZero;
        if (this.count === 0) {
            this.updateContent();
        }
        this.markDirty(DIRTY.PAINT);
    }
    
    setPosition(position) {
        this.position = position;
        this.setupStyles();
        this.markDirty(DIRTY.PAINT);
    }
    
    // Static method to create a dot badge
    static createDot(id, variant = 'default', options = {}) {
        return new Badge(id, '', {
            ...options,
            variant,
            dot: true,
            size: options.size || 'sm'
        });
    }
    
    // Static method to create a count badge
    static createCount(id, count = 0, variant = 'default', options = {}) {
        return new Badge(id, '', {
            ...options,
            variant,
            count,
            size: options.size || 'sm'
        });
    }
    
    // Static method to create a status badge
    static createStatus(id, status, text = null, options = {}) {
        const variants = {
            online: 'success',
            offline: 'secondary',
            busy: 'warning',
            away: 'error',
            active: 'success',
            inactive: 'secondary',
            new: 'info',
            updated: 'warning',
            deleted: 'error'
        };
        
        const variant = variants[status] || 'default';
        const content = text || status;
        
        return new Badge(id, content, {
            ...options,
            variant,
            shape: options.shape || 'pill'
        });
    }
}
