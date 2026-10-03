// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Chip/Tag - Removable tag widget for Plauna
 * Provides chip functionality with multiple variants and states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';

let _chipSequence = 0;

function _newChipId() {
    return `chip-${Date.now()}-${++_chipSequence}`;
}

export class Chip extends UINode {
    // Widget metadata
    static id = 'chip';
    static name = 'Chip';
    static category = 'primitive';
    static icon = '🏷️';
    static description = 'Chip/tag element';
    static tags = ['primitive', 'chip', 'tag'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            label: '',
            variant: 'default',
            removable: false
        };
    }

    static stories() {
        return {
            'Default':   { label: 'Design' },
            'Primary':   { label: 'Primary',  variant: 'primary' },
            'Removable': { label: 'Remove me', removable: true },
            'Success':   { label: 'Approved', variant: 'success' },
            'Warning':   { label: 'Review',   variant: 'warning' },
        };
    }
    
    static create(container, options = {}) {
        const instance = new Chip(_newChipId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newChipId(), options = {}) {
        super(id, 'chip');
        
        // Chip-specific properties
        this.label = options.label || '';
        this.value = options.value || '';
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.disabled = options.disabled || false;
        this.removable = options.removable === true;
        this.avatar = options.avatar || null;
        this.icon = options.icon || null;
        this.onClick = options.onClick || null;
        this.onRemove = options.onRemove || null;
        
        // State management
        this.isHovered = false;
        
        // Set accessibility
        this.role = 'button';
        this.ariaDisabled = this.disabled;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.removable ? `${id}-remove-button` : null;
        // Mark chip as keyboard-focusable when not disabled
        this.setState(NODE_STATE.FOCUSABLE, !this.disabled);
        
        /**
         * Setup modern chip/pill styling.
         *
         * Modern design pattern: soft, elevated pill with clear borders.
         * - Full rounded corners (border-radius-full) for pill shape
         * - Subtle shadow adds depth without heaviness
         * - Backdrop filter creates glassy layered effect
         * - Minimum 32px height for better touch targets
         * - Tinted backgrounds with stronger borders for variant differentiation
         *
         * Variants use alpha-transparent backgrounds rather than solid colors,
         * allowing them to work across light/dark themes while maintaining
         * semantic meaning (primary, success, warning, error).
         */
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build chip structure
        this.buildChip();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'inline-flex',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: 'var(--spacing-xs)',
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: '1px solid ' + this.getBorderColor(),
            borderRadius: 'var(--border-radius-full)',
            fontSize: 'inherit',
            fontWeight: '600',
            lineHeight: 1,
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            outline: 'none',
            boxShadow: '0 8px 18px rgba(15, 23, 42, 0.10)',
            backdropFilter: 'saturate(1.1) blur(10px)',
            transition: 'transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease',
            position: 'relative',
            width: 'fit-content',
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            minHeight: '32px',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                padding: '2px 8px',
                fontSize: 'var(--font-size-xs)'
            },
            sm: {
                padding: '4px 10px',
                fontSize: 'var(--font-size-sm)'
            },
            md: {
                padding: '5px 12px',
                fontSize: 'var(--font-size-md)'
            },
            lg: {
                padding: '6px 14px',
                fontSize: 'var(--font-size-lg)'
            },
            xl: {
                padding: '8px 16px',
                fontSize: 'var(--font-size-xl)'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: '2px 8px',
            sm: '4px 10px',
            md: '5px 12px',
            lg: '6px 14px',
            xl: '8px 16px'
        };
        return sizes[this.size] || sizes.md;
    }
    
    /**
     * Get variant-specific styles with alpha-transparent colors.
     *
     * Modern alpha-transparent variant pattern:
     * - Uses RGBA colors with low opacity for backgrounds
     * - Stronger opacity for borders for definition
     * - Works across both light and dark themes without theme-specific values
     * - Semantic colors: primary, secondary, success, warning, error
     *
     * Alpha transparency allows chips to work as overlays on any background
     * while maintaining semantic meaning through color hue.
     */
    getVariantStyles() {
        const variants = {
            default: {
                backgroundColor: 'rgba(15, 23, 42, 0.06)',
                color: 'var(--text-primary)',
                borderColor: 'rgba(148, 163, 184, 0.20)'
            },
            primary: {
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                color: 'var(--color-primary-700)',
                borderColor: 'rgba(59, 130, 246, 0.24)'
            },
            secondary: {
                backgroundColor: 'rgba(15, 23, 42, 0.08)',
                color: 'var(--text-primary)',
                borderColor: 'rgba(148, 163, 184, 0.18)'
            },
            success: {
                backgroundColor: 'rgba(34, 197, 94, 0.12)',
                color: 'var(--color-success-700, #15803d)',
                borderColor: 'rgba(34, 197, 94, 0.24)'
            },
            warning: {
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                color: 'var(--color-warning-700, #b45309)',
                borderColor: 'rgba(245, 158, 11, 0.24)'
            },
            error: {
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                color: 'var(--color-error-700, #b91c1c)',
                borderColor: 'rgba(239, 68, 68, 0.24)'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    /**
     * Get background color based on variant and disabled state.
     *
     * Color cascade pattern:
     * - Disabled state: neutral tertiary background
     * - Enabled state: variant-specific color from design tokens
     * - Falls back to default if variant is unknown
     *
     * Uses design tokens for theme consistency while allowing
     * variant-specific semantic coloring.
     */
    getBackgroundColor() {
        if (this.disabled) {
            return 'var(--bg-tertiary)';
        }
        
        const variantColors = {
            default: 'var(--bg-secondary)',
            primary: 'var(--color-primary-50)',
            secondary: 'var(--bg-tertiary)',
            success: 'var(--color-success)',
            warning: 'var(--color-warning)',
            error: 'var(--color-error)'
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    /**
     * Get text color based on variant and disabled state.
     *
     * Color cascade pattern:
     * - Disabled state: disabled text color
     * - Enabled state: variant-specific color with contrast awareness
     * - Success/warning/error variants use inverse text for readability
     *
     * Ensures text remains readable against variant backgrounds
     * by using appropriate contrast ratios.
     */
    getTextColor() {
        if (this.disabled) {
            return 'var(--text-disabled)';
        }
        
        const variantColors = {
            default: 'var(--text-primary)',
            primary: 'var(--color-primary-700)',
            secondary: 'var(--text-primary)',
            success: 'var(--text-inverse)',
            warning: 'var(--text-inverse)',
            error: 'var(--text-inverse)'
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    /**
     * Get border color based on variant and disabled state.
     *
     * Color cascade pattern:
     * - Disabled state: subtle border for de-emphasis
     * - Enabled state: variant-specific border for definition
     * - Primary/success/warning/error use colored borders
     *
     * Borders provide definition even on similar-colored backgrounds,
     * helping chips stand out in dense UI layouts.
     */
    getBorderColor() {
        if (this.disabled) {
            return 'var(--border-subtle)';
        }
        
        const variantColors = {
            default: 'var(--border-medium)',
            primary: 'var(--color-primary-200)',
            secondary: 'var(--border-subtle)',
            success: 'var(--color-success)',
            warning: 'var(--color-warning)',
            error: 'var(--color-error)'
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    setupEventHandlers() {
        if (!this.disabled) {
            this.addEventListener('click', (e) => {
                this.handleClick(e);
            });
            
            this.addEventListener('mouseenter', () => {
                this.isHovered = true;
                this.setState(NODE_STATE.HOVER, true);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT);
            });
            
            this.addEventListener('mouseleave', () => {
                this.isHovered = false;
                this.setState(NODE_STATE.HOVER, false);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT);
            });
            
            this.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    this.handleClick(e);
                }
            });

            /**
             * Modern focus treatment for chips.
             *
             * Chips are keyboard-focusable with a clear focus ring:
             * - Outline ring with primary color for visibility
             * - Outline offset provides spacing from chip border
             * - Dual-layer shadow (outer ring + base shadow) for depth
             *
             * This ensures keyboard navigation is discoverable and visible,
             * following WCAG 2.1 guidelines for focus indicators.
             */
            this.addEventListener('focus', () => {
                this.setState(NODE_STATE.FOCUSED, true);
                this.setStyle('outline', '2px solid rgba(14, 165, 233, 0.28)');
                this.setStyle('outlineOffset', '2px');
                this.setStyle('boxShadow', '0 0 0 3px rgba(14, 165, 233, 0.10), var(--shadow-sm)');
            });

            /**
             * Restore chip appearance on blur.
             *
             * Removes focus ring and restores base shadow via
             * updateVisualState to maintain consistent idle appearance.
             */
            this.addEventListener('blur', () => {
                this.setState(NODE_STATE.FOCUSED, false);
                this.setStyle('outline', 'none');
                this.setStyle('outlineOffset', '0');
                this.updateVisualState();
            });
        }
    }
    
    /**
     * Build the chip's flexible DOM structure.
     *
     * Flexible chip structure pattern:
     * 1. Container: Base element with pill styling and event handlers
     * 2. Avatar (optional): Small user avatar on the left
     * 3. Icon (optional): Icon on the left if no avatar
     * 4. Label: Text content in the center
     * 5. Remove button (optional): Dismissible action on the right
     *
     * This structure supports various chip types:
     * - Simple text chips (label only)
     * - Avatar chips (avatar + label)
     * - Icon chips (icon + label)
     * - Removable chips (label + remove button)
     * - Combined chips (avatar + label + remove button)
     */
    buildChip() {
        this.innerHTML = '';
        
        // Add avatar if present
        if (this.avatar) {
            const avatar = this.createAvatar();
            this.appendChild(avatar);
        }
        
        // Add icon if present
        if (this.icon) {
            const icon = this.createIcon();
            this.appendChild(icon);
        }
        
        // Add label
        const label = new UINode(`${this.id}-label`, 'span');
        label.textContent = this.label;
        label.setStyles({
            flex: '0 1 auto',
            color: 'inherit',
            fontWeight: 'inherit',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        });
        this.appendChild(label);
        
        // Add remove button if removable
        if (this.removable) {
            const removeButton = this.createRemoveButton();
            this.appendChild(removeButton);
        }
        
        this.updateVisualState();
    }
    
    /**
     * Create avatar sub-component for chip.
     *
     * Sub-component pattern:
     * - Creates UINode for avatar with appropriate styling
     * - Uses size-based dimensions that scale with chip size
     * - Circular border-radius for consistent profile appearance
     * - Object-fit cover for proper image scaling
     */
    createAvatar() {
        const avatar = new UINode(`${this.id}-avatar`, 'img');
        avatar.src = this.avatar.src;
        avatar.alt = this.avatar.alt || '';
        avatar.setStyles({
            width: this.getAvatarSize() + 'px',
            height: this.getAvatarSize() + 'px',
            borderRadius: '50%',
            objectFit: 'cover',
            flexShrink: '0'
        });
        return avatar;
    }
    
    getAvatarSize() {
        const sizes = {
            xs: 16,
            sm: 20,
            md: 24,
            lg: 28,
            xl: 32
        };
        return sizes[this.size] || sizes.md;
    }
    
    /**
     * Create icon sub-component for chip.
     *
     * Sub-component pattern:
     * - Creates UINode for icon with text content
     * - Inherits font size from parent for consistent scaling
     * - Flex layout for proper alignment with label
     */
    createIcon() {
        const icon = new UINode(`${this.id}-icon`, 'span');
        icon.textContent = this.icon;
        icon.setStyles({
            width: '16px',
            height: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--font-size-sm)',
            color: 'inherit',
            flexShrink: '0'
        });
        return icon;
    }

    /**
     * Create remove button sub-component for chip.
     *
     * Sub-component pattern:
     * - Creates UINode for dismissible action button
     * - Uses × (multiplication sign) as universal close icon
     * - Sets up click handler to trigger onRemove callback
     * - Dispatches 'remove' event for parent component handling
     */
    createRemoveButton() {
        const removeButton = new UINode(`${this.id}-remove`, 'button');
        removeButton.type = 'button';
        removeButton.ariaLabel = 'Remove';
        removeButton.textContent = '×';
        removeButton.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            backgroundColor: 'rgba(148, 163, 184, 0.14)',
            color: 'inherit',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            lineHeight: 1,
            opacity: 0.9
        });
        return removeButton;
    }

    setOnClick(onClick) {
        this.onClick = onClick;
    }

    setOnRemove(onRemove) {
        this.onRemove = onRemove;
    }

    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }

    // Static factory methods
    static createChip(id, options = {}) {
        return new Chip(id, options);
    }

    static createPrimaryChip(id, options = {}) {
        return new Chip(id, { variant: 'primary', ...options });
    }

    static createSuccessChip(id, options = {}) {
        return new Chip(id, { variant: 'success', ...options });
    }

    static createWarningChip(id, options = {}) {
        return new Chip(id, { variant: 'warning', ...options });
    }

    static createErrorChip(id, options = {}) {
        return new Chip(id, { variant: 'error', ...options });
    }

    static createSmallChip(id, options = {}) {
        return new Chip(id, { size: 'sm', ...options });
    }

    static createLargeChip(id, options = {}) {
        return new Chip(id, { size: 'lg', ...options });
    }

    static createXLargeChip(id, options = {}) {
        return new Chip(id, { size: 'xl', ...options });
    }

    handleClick(e) {
        if (this.onClick && typeof this.onClick === 'function') {
            this.onClick({
                label: this.label,
                value: this.value,
                variant: this.variant,
                disabled: this.disabled
            });
        }

        this.dispatchEvent({
            type: 'click',
            bubbles: true,
            detail: {
                label: this.label,
                value: this.value,
                variant: this.variant
            }
        });
    }

    handleRemove(e) {
        if (this.onRemove && typeof this.onRemove === 'function') {
            this.onRemove({
                label: this.label,
                value: this.value,
                variant: this.variant
            });
        }

        this.dispatchEvent({
            type: 'remove',
            bubbles: true,
            detail: {
                label: this.label,
                value: this.value,
                variant: this.variant
            }
        });
    }

    /**
     * Update visual state based on hover and disabled conditions.
     *
     * Modern interaction pattern:
     * - Hover: subtle lift (translateY) and elevated shadow for tactile feedback
     * - Idle: maintains base shadow (var(--shadow-sm)) for modern surface appearance
     * - Disabled: reduced opacity and not-allowed cursor
     *
     * The base shadow is preserved when not hovered to maintain the
     * modern pill surface treatment across interaction states.
     */
    updateVisualState() {
        // Update hover state
        if (this.isHovered && !this.disabled) {
            this.setStyle('transform', 'translateY(-1px)');
            this.setStyle('boxShadow', '0 4px 12px rgba(0, 0, 0, 0.15)');
        } else {
            this.setStyle('transform', 'translateY(0)');
            this.setStyle('boxShadow', 'var(--shadow-sm)');
        }

        // Update disabled state
        if (this.disabled) {
            this.setStyle('opacity', '0.5');
            this.setStyle('cursor', 'not-allowed');
        } else {
            this.setStyle('opacity', '1');
            this.setStyle('cursor', 'pointer');
        }
    }

    // Public methods
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            const labelElement = this.querySelector('span');
            if (labelElement) {
                labelElement.textContent = label;
            }
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildChip();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.ariaDisabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.updateVisualState();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    setRemovable(removable) {
        if (this.removable !== removable) {
            this.removable = removable;
            this.buildChip();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    setAvatar(avatar) {
        if (this.avatar !== avatar) {
            this.avatar = avatar;
            this.buildChip();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    setIcon(icon) {
        if (this.icon !== icon) {
            this.icon = icon;
            this.buildChip();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
}
