// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Button - Interactive button widget for Plauna
 * Provides various button types, states, and accessibility
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _inputButtonSequence = 0;

function _newInputButtonId() {
    return `button-input-${Date.now()}-${++_inputButtonSequence}`;
}

export class Button extends UINode {
    // Widget metadata
    static id = 'button-input';
    static name = 'Button';
    static category = 'input';
    static icon = '🔘';
    static description = 'Interactive button';
    static tags = ['input', 'button', 'action'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            type: 'button',
            variant: 'primary',
            size: 'md',
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Button(_newInputButtonId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newInputButtonId(), options = {}) {
        super(id, 'button');
        
        // Button-specific properties
        this.type = options.type || 'button'; // button, submit, reset
        this.variant = options.variant || 'default'; // default, primary, secondary, ghost, danger, warning, success
        this.size = options.size || 'md'; // sm, md, lg, xl
        this.text = options.text || '';
        this.icon = options.icon || null; // icon name or element
        this.iconPosition = options.iconPosition || 'left'; // left, right, only
        this.disabled = options.disabled || false;
        this.loading = options.loading || false;
        this.active = options.active || false;
        this.selected = options.selected || false;
        
        // Styling
        this.borderRadius = options.borderRadius || tokens.get('borderRadius.md');
        this.background = options.background || null;
        this.color = options.color || null;
        this.borderColor = options.borderColor || null;
        this.borderWidth = options.borderWidth || '1px';
        this.shadow = options.shadow || null;
        this.hoverShadow = options.hoverShadow || null;
        this.activeShadow = options.activeShadow || null;
        
        // Layout
        this.fullWidth = options.fullWidth || false;
        this.block = options.block || false;
        
        // Events
        this.onClick = options.onClick || (() => {});
        this.onHover = options.onHover || (() => {});
        this.onFocus = options.onFocus || (() => {});
        this.onBlur = options.onBlur || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.text;
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        this.ariaPressed = this.active.toString();
        this.ariaExpanded = options.ariaExpanded || null;
        this.ariaControls = options.ariaControls || null;
        this.role = options.role || 'button';
        
        // Set default styles
        this.setupStyles();
        
        // Create button structure
        this.createButtonStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createButtonStructure() {
        // Create button element
        this.buttonElement = document.createElement('button');
        this.buttonElement.className = 'plauna-button';
        this.buttonElement.type = this.type;
        this.buttonElement.textContent = this.text;
        this.buttonElement.disabled = this.disabled;
        
        // Set accessibility attributes
        this.buttonElement.setAttribute('aria-label', this.ariaLabel);
        if (this.ariaDescribedBy) {
            this.buttonElement.setAttribute('aria-describedby', this.ariaDescribedBy);
        }
        this.buttonElement.setAttribute('aria-pressed', this.ariaPressed);
        if (this.ariaExpanded) {
            this.buttonElement.setAttribute('aria-expanded', this.ariaExpanded);
        }
        if (this.ariaControls) {
            this.buttonElement.setAttribute('aria-controls', this.ariaControls);
        }
        this.buttonElement.setAttribute('role', this.role);
        
        // Set styles
        this.buttonElement.style.cssText = this.getButtonStyles();
        
        // Create icon if provided
        if (this.icon) {
            this.createIcon();
        }
        
        // Append to this element
        this.appendChild(this.buttonElement);
    }
    
    createIcon() {
        const iconElement = document.createElement('span');
        iconElement.className = 'plauna-button-icon';
        iconElement.textContent = typeof this.icon === 'string' ? this.icon : '';
        iconElement.style.cssText = this.getIconStyles();
        
        // Insert icon based on position
        if (this.iconPosition === 'left') {
            this.buttonElement.insertBefore(iconElement, this.buttonElement.firstChild);
        } else if (this.iconPosition === 'right') {
            this.buttonElement.appendChild(iconElement);
        } else if (this.iconPosition === 'only') {
            this.buttonElement.textContent = '';
            this.buttonElement.appendChild(iconElement);
        }
        
        this.iconElement = iconElement;
    }
    
    setupEventHandlers() {
        // Click events
        this.buttonElement.addEventListener('click', (e) => {
            if (!this.disabled && !this.loading) {
                this.onClick(e);
                this.markDirty(DIRTY.STATE);
            }
        });
        
        // Focus events
        this.buttonElement.addEventListener('focus', (e) => {
            this.onFocus(e);
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
        
        this.buttonElement.addEventListener('blur', (e) => {
            this.onBlur(e);
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
        
        // Hover events
        this.buttonElement.addEventListener('mouseenter', (e) => {
            this.onHover(e);
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
        
        this.buttonElement.addEventListener('mouseleave', () => {
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
        
        // Keyboard events
        this.buttonElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.buttonElement.click();
            }
        });
    }
    
    setupStyles() {
        this.setStyles({
            display: this.block ? 'block' : 'inline-block',
            width: this.fullWidth ? '100%' : 'auto'
        });
    }
    
    getButtonStyles() {
        const variantStyles = this.getVariantStyles();
        const sizeStyles = this.getSizeStyles();
        const stateStyles = this.getStateStyles();
        const layoutStyles = this.getLayoutStyles();
        
        return (
            'font-family: inherit;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'text-decoration: none;' +
            'border: ' + this.borderWidth + ' solid ' + (this.borderColor || 'transparent') + ';' +
            'border-radius: ' + this.borderRadius + ';' +
            'outline: none;' +
            'cursor: ' + (this.disabled ? 'not-allowed' : 'pointer') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'overflow: hidden;' +
            'user-select: none;' +
            'box-sizing: border-box;' +
            'display: inline-flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            variantStyles +
            sizeStyles +
            stateStyles +
            layoutStyles
        );
    }
    
    getVariantStyles() {
        const variants = {
            default: (
                'background: ' + (this.background || 'var(--bg-secondary, rgba(15, 23, 42, 0.05))') + ';' +
                'color: ' + (this.color || 'var(--text-primary, #0f172a)') + ';' +
                'border-color: ' + (this.borderColor || 'var(--border-medium, rgba(148, 163, 184, 0.28))') + ';'
            ),
            primary: (
                'background: ' + (this.background || 'linear-gradient(180deg, rgba(59, 130, 246, 0.98), rgba(37, 99, 235, 0.94))') + ';' +
                'color: ' + (this.color || 'var(--text-inverse, #ffffff)') + ';' +
                'border-color: ' + (this.borderColor || 'rgba(37, 99, 235, 0.65)') + ';'
            ),
            secondary: (
                'background: ' + (this.background || 'rgba(15, 23, 42, 0.06)') + ';' +
                'color: ' + (this.color || 'var(--text-primary, #0f172a)') + ';' +
                'border-color: ' + (this.borderColor || 'rgba(148, 163, 184, 0.24)') + ';'
            ),
            ghost: (
                'background: transparent;' +
                'color: ' + (this.color || 'var(--color-primary-500, #0ea5e9)') + ';' +
                'border-color: ' + (this.borderColor || 'rgba(59, 130, 246, 0.24)') + ';'
            ),
            danger: (
                'background: ' + (this.background || 'linear-gradient(180deg, rgba(239, 68, 68, 0.98), rgba(220, 38, 38, 0.94))') + ';' +
                'color: ' + (this.color || 'var(--text-inverse, #ffffff)') + ';' +
                'border-color: ' + (this.borderColor || '#ef4444') + ';'
            ),
            warning: (
                'background: ' + (this.background || 'linear-gradient(180deg, rgba(245, 158, 11, 0.98), rgba(217, 119, 6, 0.94))') + ';' +
                'color: ' + (this.color || '#111827') + ';' +
                'border-color: ' + (this.borderColor || '#f59e0b') + ';'
            ),
            success: (
                'background: ' + (this.background || 'linear-gradient(180deg, rgba(16, 185, 129, 0.98), rgba(5, 150, 105, 0.94))') + ';' +
                'color: ' + (this.color || 'var(--text-inverse, #ffffff)') + ';' +
                'border-color: ' + (this.borderColor || '#10b981') + ';'
            )
        };
        
        return variants[this.variant] || variants.default;
    }
    
    getSizeStyles() {
        const sizes = {
            sm: (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'min-height: 28px;'
            ),
            md: (
                'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'min-height: 36px;'
            ),
            lg: (
                'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
                'font-size: ' + tokens.get('fontSizes.md') + ';' +
                'min-height: 44px;'
            ),
            xl: (
                'padding: ' + tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl') + ';' +
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'min-height: 52px;'
            )
        };
        
        return sizes[this.size] || sizes.md;
    }
    
    getStateStyles() {
        let styles = '';
        
        if (this.disabled) {
            styles += (
                'opacity: 0.5;' +
                'cursor: not-allowed;' +
                'pointer-events: none;'
            );
        }
        
        if (this.loading) {
            styles += (
                'cursor: wait;' +
                'pointer-events: none;'
            );
        }
        
        if (this.active || this.selected) {
            styles += (
                'box-shadow: ' + (this.activeShadow || '0 0 0 2px rgba(59, 130, 246, 0.2)') + ';' +
                'transform: translateY(1px);'
            );
        }
        
        return styles;
    }
    
    getLayoutStyles() {
        let styles = '';
        
        if (this.fullWidth) {
            styles += 'width: 100%;';
        }
        
        if (this.block) {
            styles += 'display: block; width: 100%;';
        }
        
        return styles;
    }
    
    getIconStyles() {
        return (
            'display: inline-flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: ' + tokens.get('fontSizes.md') + ';' +
            'height: ' + tokens.get('fontSizes.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.md') + ';'
        );
    }
    
    updateStateStyles() {
        if (!this.buttonElement) return;
        
        const styles = this.getButtonStyles();
        this.buttonElement.style.cssText = styles;
    }
    
    // Setter methods
    setText(text) {
        this.text = text;
        if (this.buttonElement) {
            if (this.iconPosition === 'only') {
                // Don't update text if icon only
            } else {
                this.buttonElement.textContent = text;
                // Re-add icon if it exists
                if (this.icon && this.iconElement) {
                    if (this.iconPosition === 'left') {
                        this.buttonElement.insertBefore(this.iconElement, this.buttonElement.firstChild);
                    } else if (this.iconPosition === 'right') {
                        this.buttonElement.appendChild(this.iconElement);
                    }
                }
            }
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    setVariant(variant) {
        this.variant = variant;
        this.updateStateStyles();
        this.markDirty(DIRTY.STYLE);
    }
    
    setSize(size) {
        this.size = size;
        this.updateStateStyles();
        this.markDirty(DIRTY.STYLE);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.buttonElement) {
            this.buttonElement.disabled = disabled;
        }
        this.updateStateStyles();
        this.markDirty(DIRTY.PROPS | DIRTY.STATE);
    }
    
    setLoading(loading) {
        this.loading = loading;
        this.updateStateStyles();
        this.markDirty(DIRTY.PROPS | DIRTY.STATE);
    }
    
    setActive(active) {
        this.active = active;
        this.ariaPressed = active.toString();
        if (this.buttonElement) {
            this.buttonElement.setAttribute('aria-pressed', this.ariaPressed);
        }
        this.updateStateStyles();
        this.markDirty(DIRTY.PROPS | DIRTY.STATE);
    }
    
    setSelected(selected) {
        this.selected = selected;
        this.updateStateStyles();
        this.markDirty(DIRTY.PROPS | DIRTY.STATE);
    }
    
    // Getter methods
    getText() {
        return this.text;
    }
    
    isDisabled() {
        return this.disabled;
    }
    
    isLoading() {
        return this.loading;
    }
    
    isActive() {
        return this.active;
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newInputButtonId();
        const button = new Button(id, options);
        if (container) {
            container.appendChild(button.element);
        }
        return button;
    }
    
    static getDefaultOptions() {
        return {
            text: 'Button',
            variant: 'default',
            size: 'md',
            disabled: false
        };
    }
    
    static createPrimaryButton(id, text, options = {}) {
        return new Button(id, {
            text,
            variant: 'primary',
            ...options
        });
    }
    
    static createSecondaryButton(id, text, options = {}) {
        return new Button(id, {
            text,
            variant: 'secondary',
            ...options
        });
    }
    
    static createGhostButton(id, text, options = {}) {
        return new Button(id, {
            text,
            variant: 'ghost',
            ...options
        });
    }
    
    static createDangerButton(id, text, options = {}) {
        return new Button(id, {
            text,
            variant: 'danger',
            ...options
        });
    }
    
    static createWarningButton(id, text, options = {}) {
        return new Button(id, {
            text,
            variant: 'warning',
            ...options
        });
    }
    
    static createSuccessButton(id, text, options = {}) {
        return new Button(id, {
            text,
            variant: 'success',
            ...options
        });
    }
    
    static createIconButton(id, icon, options = {}) {
        return new Button(id, {
            icon,
            iconPosition: 'only',
            ...options
        });
    }
    
    static createLoadingButton(id, text, options = {}) {
        return new Button(id, {
            text,
            loading: true,
            ...options
        });
    }
    
    static createDisabledButton(id, text, options = {}) {
        return new Button(id, {
            text,
            disabled: true,
            ...options
        });
    }
    
    // Focus methods
    focus() {
        if (this.buttonElement) {
            this.buttonElement.focus();
        }
    }
    
    blur() {
        if (this.buttonElement) {
            this.buttonElement.blur();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.buttonElement) {
            this.buttonElement.removeEventListener('click', this.onClick);
            this.buttonElement.removeEventListener('focus', this.onFocus);
            this.buttonElement.removeEventListener('blur', this.onBlur);
            this.buttonElement.removeEventListener('mouseenter', this.onHover);
        }
        
        this.innerHTML = '';
    }
}
