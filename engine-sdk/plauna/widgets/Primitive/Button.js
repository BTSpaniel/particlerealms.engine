// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Button - Interactive button widget for Plauna
 * Provides clickable button with styling, states, and event handling
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _buttonSequence = 0;

function _newButtonId() {
    return `button-${Date.now()}-${++_buttonSequence}`;
}

export class Button extends UINode {
    // Widget metadata
    static id = 'button';
    static name = 'Button';
    static category = 'primitive';
    static icon = '🔘';
    static description = 'Primitive button element';
    static tags = ['primitive', 'button'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            text: '',
            variant: 'primary',
            size: 'md',
            disabled: false
        };
    }

    static stories() {
        return {
            'Primary':   { text: 'Primary',   variant: 'primary' },
            'Secondary': { text: 'Secondary', variant: 'secondary' },
            'Ghost':     { text: 'Ghost',     variant: 'ghost' },
            'Disabled':  { text: 'Disabled',  variant: 'primary', disabled: true },
            'Small':     { text: 'Small',     variant: 'primary', size: 'sm' },
            'Large':     { text: 'Large',     variant: 'primary', size: 'lg' },
        };
    }
    
    static create(container, options = {}) {
        const instance = new Button(_newButtonId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newButtonId(), options = {}) {
        super(id, 'button');
        
        // Button-specific properties
        this.content = options.text || '';
        this.variant = options.variant || 'primary';
        this.size = options.size || 'md';
        this.disabled = options.disabled || false;
        this.icon = options.icon || null;
        this.iconPosition = options.iconPosition || 'left';
        this.type = options.type || 'button';
        this.updateClassName();

        // Set loading state if provided
        if (options.loading) {
            this.setState(NODE_STATE.LOADING, true);
        }

        // Set accessibility
        this.role = 'button';
        this.setState(NODE_STATE.FOCUSABLE, !this.disabled);
        
        // Set default styles
        /**
         * Setup modern button surface styling.
         *
         * Modern design pattern: elevated surface with clear focus visibility.
         * - Larger border-radius (lg) for friendlier, modern appearance
         * - Subtle shadow adds depth and lift from background
         * - Backdrop filter creates glassy blur effect
         * - Larger touch targets (min-width/height) follow modern accessibility guidelines
         * - Transitions on transform, shadow, background, color, border, and opacity
         *
         * Touch targets are sized to meet WCAG 2.1 minimum 44x44px recommendation
         * for better mobile usability and accessibility.
         */
        this.setStyles({
            display: 'inline-flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--spacing-xs)',
            padding: this.getPaddingForSize(),
            border: 'none',
            borderRadius: 'var(--border-radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            backdropFilter: 'saturate(1.05) blur(8px)',
            fontFamily: 'inherit',
            fontSize: this.getFontSizeForSize(),
            fontWeight: 'var(--font-weight-medium)',
            lineHeight: 1,
            textAlign: 'center',
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            userSelect: 'none',
            textDecoration: 'none',
            outline: 'none',
            transition: 'transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease, color 160ms ease, border-color 160ms ease, opacity 160ms ease',
            boxSizing: 'border-box',
            minWidth: this.getMinWidthForSize(),
            minHeight: this.getMinHeightForSize()
        });
        
        // Apply variant styles
        this.applyVariant();
        
        // Setup event handlers
        this.setupEventHandlers();

        // Set content
        this.setContent(this.content);
    }

    // Set button content
    /**
     * Build button content with optional icon and text.
     *
     * Content structure pattern for flexible button rendering:
     * - Clear existing children first
     * - Add icon on left if specified and iconPosition is 'left'
     * - Add text content (or loading spinner)
     * - Add icon on right if specified and iconPosition is 'right'
     *
     * This pattern supports icons on either side of the text,
     * or text-only buttons, or icon-only buttons.
     */
    setContent(content) {
        this.content = content;
        
        // Clear existing children
        while (this.children.length > 0) {
            this.removeChild(this.children[0]);
        }
        
        // Add icon if specified
        if (this.icon && this.iconPosition === 'left') {
            const iconElement = new UINode(`${this.id}-icon-left`, 'button-icon');
            iconElement.textContent = this.icon;
            iconElement.setStyles({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1em'
            });
            this.appendChild(iconElement);
        }
        
        // Add text content (or loading spinner)
        if (content || this.hasState(NODE_STATE.LOADING)) {
            const textElement = new UINode(`${this.id}-text`, 'span');
            textElement.textContent = this.hasState(NODE_STATE.LOADING) ? 'Loading...' : content;
            textElement.setStyles({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1em'
            });
            this.appendChild(textElement);
        }
        
        // Add icon if specified (right position)
        if (this.icon && this.iconPosition === 'right') {
            const iconElement = new UINode(`${this.id}-icon-right`, 'button-icon');
            iconElement.textContent = this.icon;
            iconElement.setStyles({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1em'
            });
            this.appendChild(iconElement);
        }
        
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }

    updateClassName() {
        const variantClass = this.variant === 'danger' ? 'error' : this.variant;
        this.className = `button button--${this.size} button--${variantClass}`.trim();
    }

    // Set button variant
    setVariant(variant) {
        this.variant = variant;
        this.updateClassName();
        this.applyVariant();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Set button size
    setSize(size) {
        this.size = size;
        this.updateClassName();
        this.setStyles({
            padding: this.getPaddingForSize(),
            fontSize: this.getFontSizeForSize(),
            minWidth: this.getMinWidthForSize(),
            minHeight: this.getMinHeightForSize()
        });
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }

    // Set disabled state
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.setStyle('cursor', disabled ? 'not-allowed' : 'pointer');
            this.applyVariant();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    // Set loading state
    setLoading(loading) {
        const wasLoading = this.hasState(NODE_STATE.LOADING);
        if (wasLoading !== loading) {
            this.setState(NODE_STATE.LOADING, loading);
            this.setState(NODE_STATE.DISABLED, loading);
            this.setState(NODE_STATE.FOCUSABLE, !loading);
            this.setStyle('cursor', loading ? 'not-allowed' : 'pointer');
            this.setContent(this.content); // This will update the loading text
            this.applyVariant();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    // Set icon
    setIcon(icon, position = 'left') {
        this.icon = icon;
        this.iconPosition = position;
        this.setContent(this.content);
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }

    // Apply variant styles
    applyVariant() {
        const variantStyles = this.getVariantStyles();
        this.setStyles(variantStyles);
    }

    // Get styles for variant
    /**
     * Get variant-specific styling with semantic meaning.
     *
     * Variant system provides semantic visual feedback for different actions:
     * - primary: Main action, high emphasis with solid primary color
     * - secondary: Secondary action, medium emphasis with background color
     * - outline: Low emphasis, border-only style with primary color
     * - ghost: Minimal emphasis, text-only style with primary color
     * - danger: Destructive action, error color for caution
     * - warning: Cautionary action, warning color for attention
     * - success: Positive action, success color for confirmation
     *
     * Disabled state is handled uniformly across all variants:
     * - Reduced opacity (0.6) for visual de-emphasis
     * - Removed shadow for flat appearance
     * - Neutral background color
     * - Changed cursor to not-allowed
     */
    getVariantStyles() {
        const baseStyles = {
            opacity: this.disabled || this.hasState(NODE_STATE.LOADING) ? 0.6 : 1
        };
        
        switch (this.variant) {
            case 'primary':
                return {
                    ...baseStyles,
                    backgroundColor: this.disabled ? 'var(--bg-tertiary)' : 'var(--color-primary-500)',
                    color: 'var(--text-inverse)',
                    boxShadow: this.disabled ? 'none' : 'var(--shadow-sm)'
                };
                
            case 'secondary':
                return {
                    ...baseStyles,
                    backgroundColor: this.disabled ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                    color: this.disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
                    border: '1px solid var(--border-medium)',
                    boxShadow: this.disabled ? 'none' : 'var(--shadow-sm)'
                };
                
            case 'outline':
                return {
                    ...baseStyles,
                    backgroundColor: 'transparent',
                    color: this.disabled ? 'var(--text-disabled)' : 'var(--color-primary-500)',
                    border: '1px solid ' + (this.disabled ? 'var(--border-subtle)' : 'var(--color-primary-500)'),
                    boxShadow: 'none'
                };
                
            case 'ghost':
                return {
                    ...baseStyles,
                    backgroundColor: 'transparent',
                    color: this.disabled ? 'var(--text-disabled)' : 'var(--color-primary-500)',
                    border: 'none',
                    boxShadow: 'none'
                };
                
            case 'danger':
                return {
                    ...baseStyles,
                    backgroundColor: this.disabled ? 'var(--bg-tertiary)' : 'var(--color-error)',
                    color: 'var(--text-inverse)',
                    boxShadow: this.disabled ? 'none' : 'var(--shadow-sm)'
                };
                
            case 'warning':
                return {
                    ...baseStyles,
                    backgroundColor: this.disabled ? 'var(--bg-tertiary)' : 'var(--color-warning)',
                    color: '#111827',
                    boxShadow: this.disabled ? 'none' : 'var(--shadow-sm)'
                };
                
            case 'success':
                return {
                    ...baseStyles,
                    backgroundColor: this.disabled ? 'var(--bg-tertiary)' : 'var(--color-success)',
                    color: 'var(--text-inverse)',
                    boxShadow: this.disabled ? 'none' : 'var(--shadow-sm)'
                };
                
            default:
                return baseStyles;
        }
    }

    // Get padding for size
    getPaddingForSize() {
        switch (this.size) {
            case 'sm':
                return 'var(--spacing-xs) var(--spacing-sm)';
            case 'md':
                return 'var(--spacing-sm) var(--spacing-md)';
            case 'lg':
                return 'var(--spacing-sm) var(--spacing-lg)';
            default:
                return 'var(--spacing-sm) var(--spacing-md)';
        }
    }

    // Get font size for size
    getFontSizeForSize() {
        switch (this.size) {
            case 'sm':
                return 'var(--font-size-sm)';
            case 'md':
                return 'var(--font-size-md)';
            case 'lg':
                return 'var(--font-size-lg)';
            default:
                return 'var(--font-size-md)';
        }
    }

    // Get min width for size
    /**
     * Get minimum width for each button size.
     *
     * Modern accessibility pattern: ensures touch targets meet WCAG 2.1
     * minimum 44x44px recommendation for better mobile usability.
     * - sm: 36px (smaller compact buttons)
     * - md: 44px (default, meets accessibility minimum)
     * - lg: 52px (large touch targets)
     */
    getMinWidthForSize() {
        switch (this.size) {
            case 'sm':
                return '36px';
            case 'md':
                return '44px';
            case 'lg':
                return '52px';
            default:
                return '44px';
        }
    }

    // Get min height for size
    /**
     * Get minimum height for each button size.
     *
     * Modern accessibility pattern: ensures touch targets meet WCAG 2.1
     * minimum 44x44px recommendation for better mobile usability.
     * - sm: 32px (slightly below minimum for compact layouts)
     * - md: 40px (near minimum, comfortable for most users)
     * - lg: 44px (meets accessibility minimum for large buttons)
     */
    getMinHeightForSize() {
        switch (this.size) {
            case 'sm':
                return '32px';
            case 'md':
                return '40px';
            case 'lg':
                return '44px';
            default:
                return '40px';
        }
    }

    // Setup event handlers
    setupEventHandlers() {
        // Mouse events
        /**
         * Mouse enter: hover state for tactile feedback.
         *
         * Modern hover pattern:
         * - Sets HOVERED state for visual feedback
         * - Triggers paint dirty flag for re-render
         * - Respects disabled and loading states
         */
        this.addEventListener('mouseenter', () => {
            if (!this.disabled && !this.hasState(NODE_STATE.LOADING)) {
                this.setState(NODE_STATE.HOVERED, true);
                this.markDirty(DIRTY.PAINT);
            }
        });

        /**
         * Mouse leave: restore idle state.
         *
         * State restoration pattern:
         * - Clears HOVERED and ACTIVE states
         * - Triggers paint dirty flag for re-render
         */
        this.addEventListener('mouseleave', () => {
            this.setState(NODE_STATE.HOVERED, false);
            this.setState(NODE_STATE.ACTIVE, false);
            this.markDirty(DIRTY.PAINT);
        });

        /**
         * Mouse down: active state for press feedback.
         *
         * Modern press pattern:
         * - Sets ACTIVE state for visual press feedback
         * - Triggers paint dirty flag for re-render
         */
        this.addEventListener('mousedown', () => {
            if (!this.disabled && !this.hasState(NODE_STATE.LOADING)) {
                this.setState(NODE_STATE.ACTIVE, true);
                this.markDirty(DIRTY.PAINT);
            }
        });

        /**
         * Mouse up: clear active state.
         *
         * Release pattern:
         * - Clears ACTIVE state to restore hover state
         * - Triggers paint dirty flag for re-render
         */
        this.addEventListener('mouseup', () => {
            if (!this.disabled && !this.hasState(NODE_STATE.LOADING)) {
                this.setState(NODE_STATE.ACTIVE, false);
                this.markDirty(DIRTY.PAINT);
            }
        });

        /**
         * Click: trigger button activation.
         *
         * Click handling pattern:
         * - Prevents default if disabled or loading
         * - Calls activate() to trigger the button's action
         * - Activates both mouse clicks and keyboard triggers
         */
        // Click event
        this.addEventListener('click', (e) => {
            this.activate(e);
        });
        
        // Keyboard events
        this.addEventListener('keydown', (event) => {
            if (this.disabled || this.hasState(NODE_STATE.LOADING)) return;
            
            // Handle Enter and Space for activation
            const key = event.key ?? event.originalEvent?.key;
            if (key === 'Enter' || key === ' ') {
                event.preventDefault();
                this.activate();
            }
        });
        
        // Focus events
        /**
         * Modern focus treatment with clear visible focus ring.
         *
         * Uses dual-layer shadow for visibility across backgrounds:
         * - Outer ring: 3px primary color with reduced opacity
         * - Inner shadow: base shadow preserved for depth
         * - Outline offset provides spacing between ring and button
         *
         * This follows WCAG 2.1 guidelines for focus indicator visibility
         * and ensures keyboard navigation is clearly visible.
         */
        this.addEventListener('focus', () => {
            if (!this.disabled && !this.hasState(NODE_STATE.LOADING)) {
                this.setState(NODE_STATE.FOCUSED, true);
                this.setStyle('outline', '2px solid rgba(14, 165, 233, 0.35)');
                this.setStyle('outlineOffset', '2px');
                this.setStyle('boxShadow', '0 0 0 3px rgba(14, 165, 233, 0.16), var(--shadow-sm)');
                this.markDirty(DIRTY.PAINT);
            }
        });
        
        /**
         * Restore base button appearance on blur.
         *
         * Removes focus ring and restores variant-specific shadow
         * by re-applying variant styles. This ensures the button
         * returns to its correct visual state after keyboard navigation.
         */
        this.addEventListener('blur', () => {
            this.setState(NODE_STATE.FOCUSED, false);
            this.setState(NODE_STATE.ACTIVE, false);
            this.setStyle('outline', 'none');
            this.setStyle('outlineOffset', '0');
            this.applyVariant();
            this.markDirty(DIRTY.PAINT);
        });
    }

    // Handle button click
    handleClick() {
        // Add haptic feedback if available
        if (navigator.vibrate) {
            navigator.vibrate(10); // Light vibration
        }
    }

    // Activate button (for keyboard interaction)
    /**
     * Activate button (trigger click action).
     *
     * Activation pattern for button interaction:
     * - Early return if disabled or loading to prevent accidental activation
     * - Creates synthetic click event with preventDefault support
     * - Dispatches event for parent components to handle
     * - Calls onClick callback if provided
     *
     * This pattern allows buttons to be activated programmatically
     * (e.g., by keyboard Enter/Space) with the same behavior as mouse clicks.
     */
    activate(event = null) {
        if (this.disabled || this.hasState(NODE_STATE.LOADING)) {
            event?.preventDefault?.();
            return;
        }
        
        // Simulate click
        const clickEvent = {
            type: 'button-click',
            target: this,
            originalEvent: event?.originalEvent ?? event,
            defaultPrevented: Boolean(event?.defaultPrevented || event?.originalEvent?.defaultPrevented),
            preventDefault: () => {
                clickEvent.defaultPrevented = true;
                event?.preventDefault?.();
            }
        };

        if (this.onClick) {
            this.onClick(event ?? clickEvent);
        }
        if (event?.defaultPrevented || event?.originalEvent?.defaultPrevented) {
            clickEvent.defaultPrevented = true;
        }
        
        this.dispatchEvent(clickEvent);
        
        if (!clickEvent.defaultPrevented) {
            this.handleClick();
        }
    }

    // Get button info
    getInfo() {
        return {
            ...this.getDebugInfo(),
            content: this.content,
            variant: this.variant,
            size: this.size,
            disabled: this.disabled,
            loading: this.hasState(NODE_STATE.LOADING),
            icon: this.icon,
            iconPosition: this.iconPosition,
            type: this.type
        };
    }

    // Override destroy to clean up button-specific resources
    destroy() {
        // Clean up any event listeners or resources
        super.destroy();
    }
}

// Button factory functions
export const ButtonFactory = {
    // Create basic button
    create(id, content, options = {}) {
        return new Button(id, content, options);
    },
    
    // Create primary button
    createPrimary(id, content, options = {}) {
        return new Button(id, content, { ...options, variant: 'primary' });
    },
    
    // Create secondary button
    createSecondary(id, content, options = {}) {
        return new Button(id, content, { ...options, variant: 'secondary' });
    },
    
    // Create outline button
    createOutline(id, content, options = {}) {
        return new Button(id, content, { ...options, variant: 'outline' });
    },
    
    // Create ghost button
    createGhost(id, content, options = {}) {
        return new Button(id, content, { ...options, variant: 'ghost' });
    },
    
    // Create danger button
    createDanger(id, content, options = {}) {
        return new Button(id, content, { ...options, variant: 'danger' });
    },
    
    // Create warning button
    createWarning(id, content, options = {}) {
        return new Button(id, content, { ...options, variant: 'warning' });
    },
    
    // Create success button
    createSuccess(id, content, options = {}) {
        return new Button(id, content, { ...options, variant: 'success' });
    },
    
    // Create small button
    createSmall(id, content, options = {}) {
        return new Button(id, content, { ...options, size: 'sm' });
    },
    
    // Create large button
    createLarge(id, content, options = {}) {
        return new Button(id, content, { ...options, size: 'lg' });
    },
    
    // Create icon button
    createIcon(id, icon, options = {}) {
        return new Button(id, '', { ...options, icon });
    },
    
    // Create loading button
    createLoading(id, content, options = {}) {
        return new Button(id, content, { ...options, loading: true });
    },
    
    // Create disabled button
    createDisabled(id, content, options = {}) {
        return new Button(id, content, { ...options, disabled: true });
    },
    
    // Create icon-text button
    createIconText(id, icon, content, options = {}) {
        return new Button(id, content, { ...options, icon });
    }
};
