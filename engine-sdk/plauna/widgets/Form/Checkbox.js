// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Checkbox - Multi-select form control widget for Plauna
 * Provides checkbox functionality with multiple states and variants
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _checkboxSequence = 0;

function _newCheckboxId() {
    return `checkbox-${Date.now()}-${++_checkboxSequence}`;
}

export class Checkbox extends UINode {
    // Widget metadata
    static id = 'checkbox';
    static name = 'Checkbox';
    static category = 'form';
    static icon = '☑️';
    static description = 'Checkbox form control';
    static tags = ['form', 'input', 'checkbox', 'control'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            checked: false,
            disabled: false,
            label: '',
            size: 'md'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Checkbox(_newCheckboxId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newCheckboxId(), options = {}) {
        super(id, 'checkbox');
        
        // Checkbox-specific properties
        this.checked = options.checked || false;
        this.indeterminate = options.indeterminate || false;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.label = options.label || '';
        this.description = options.description || '';
        this.value = options.value || '';
        this.name = options.name || '';
        
        // State management
        this.isFocused = false;
        
        // Set accessibility
        this.role = 'checkbox';
        this.ariaChecked = this.checked;
        this.ariaDisabled = this.disabled;
        this.ariaRequired = this.required;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.description ? `${id}-description` : null;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build checkbox structure
        this.buildCheckbox();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'inline-flex',
            alignItems: 'center',
            gap: tokens.get('spacing.sm'),
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            outline: 'none',
            userSelect: 'none',
            transition: 'all 150ms ease',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                width: '16px',
                height: '16px',
                fontSize: tokens.get('fontSizes.xs')
            },
            sm: {
                width: '20px',
                height: '20px',
                fontSize: tokens.get('fontSizes.sm')
            },
            md: {
                width: '24px',
                height: '24px',
                fontSize: tokens.get('fontSizes.md')
            },
            lg: {
                width: '28px',
                height: '28px',
                fontSize: tokens.get('fontSizes.lg')
            },
            xl: {
                width: '32px',
                height: '32px',
                fontSize: tokens.get('fontSizes.xl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                color: tokens.get('colors.text.primary')
            },
            primary: {
                color: tokens.get('colors.primary.600')
            },
            secondary: {
                color: tokens.get('colors.secondary.600')
            },
            success: {
                color: tokens.get('colors.success')
            },
            warning: {
                color: tokens.get('colors.warning')
            },
            error: {
                color: tokens.get('colors.error')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    setupEventHandlers() {
        if (!this.disabled) {
            this.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggle();
            });
            
            this.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case ' ':
                    case 'Enter':
                        e.preventDefault();
                        this.toggle();
                        break;
                    case 'Escape':
                        this.blur();
                        break;
                }
            });
            
            this.addEventListener('focus', () => {
                this.isFocused = true;
                this.setState(NODE_STATE.FOCUSED, true);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
            
            this.addEventListener('blur', () => {
                this.isFocused = false;
                this.setState(NODE_STATE.FOCUSED, false);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
        }
    }
    
    buildCheckbox() {
        while (this.firstChild) {
            this.removeChild(this.firstChild);
        }
        if (this.element) {
            this.element.innerHTML = '';
        }

        // Create checkbox track
        const checkboxInput = new UINode(`${this.id}-input`, 'div');
        checkboxInput.userData.role = 'presentation';
        checkboxInput.userData.name = this.name;
        checkboxInput.userData.value = this.value;
        checkboxInput.userData.checked = this.checked;
        checkboxInput.userData.disabled = this.disabled;
        checkboxInput.userData.required = this.required;
        checkboxInput.userData.indeterminate = this.indeterminate;
        checkboxInput.userData.id = `${this.id}-input`;
        
        // Checkbox input styles
        checkboxInput.setStyles({
            width: '100%',
            height: '100%',
            margin: '0',
            padding: '0',
            border: `2px solid ${this.getBorderColor()}`,
            borderRadius: tokens.get('borderRadius.sm'),
            backgroundColor: this.getBackgroundColor(),
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            transition: 'all 150ms ease',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });
        
        // Add checkmark for checked state
        const checkmark = new UINode(`${this.id}-checkmark`, 'span');
        checkmark.setStyles({
            width: '0',
            height: '0',
            borderLeft: '2px solid currentColor',
            borderBottom: '2px solid currentColor',
            transform: 'rotate(-45deg)',
            transformOrigin: 'center',
            opacity: this.checked || this.indeterminate ? '1' : '0',
            transition: 'all 150ms ease',
            position: 'absolute'
        });
        
        // Add indeterminate dash
        const indeterminateDash = new UINode(`${this.id}-indeterminate`, 'span');
        indeterminateDash.setStyles({
            width: '8px',
            height: '2px',
            backgroundColor: 'currentColor',
            opacity: this.indeterminate ? '1' : '0',
            transition: 'all 150ms ease',
            position: 'absolute',
            borderRadius: tokens.get('borderRadius.xs')
        });
        
        checkboxInput.appendChild(checkmark);
        checkboxInput.appendChild(indeterminateDash);
        this.appendChild(checkboxInput);
        
        // Add label if provided
        if (this.label) {
            const labelContainer = new UINode(`${this.id}-label-container`, 'label');
            labelContainer.htmlFor = this.id;
            labelContainer.setStyles({
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.get('spacing.xs'),
                cursor: this.disabled ? 'not-allowed' : 'pointer',
                userSelect: 'none'
            });
            
            // Label text
            const labelText = new UINode(`${labelContainer.id}-text`, 'span');
            labelText.textContent = this.label;
            labelText.setStyles({
                fontSize: 'inherit',
                fontWeight: this.disabled ? tokens.get('fontWeights.normal') : tokens.get('fontWeights.medium'),
                color: this.disabled ? tokens.get('colors.text.disabled') : 'inherit'
            });
            
            labelContainer.appendChild(labelText);
            
            // Description if provided
            if (this.description) {
                const description = new UINode(`${labelContainer.id}-description`, 'span');
                description.textContent = this.description;
                description.id = `${this.id}-description`;
                description.setStyles({
                    fontSize: tokens.get('fontSizes.sm'),
                    color: this.disabled ? tokens.get('colors.text.disabled') : tokens.get('colors.text.secondary'),
                    marginTop: '2px'
                });
                labelContainer.appendChild(description);
            }
            
            this.appendChild(labelContainer);
            this.labelContainer = labelContainer;
        }
        
        // Update visual state
        this.updateVisualState();
    }
    
    getBorderColor() {
        if (this.disabled) {
            return tokens.get('colors.border.disabled');
        }
        
        if (this.isFocused) {
            return tokens.get('colors.primary.500');
        }
        
        if (this.checked || this.indeterminate) {
            const variantColors = {
                default: tokens.get('colors.primary.500'),
                primary: tokens.get('colors.primary.600'),
                secondary: tokens.get('colors.secondary.600'),
                success: tokens.get('colors.success'),
                warning: tokens.get('colors.warning'),
                error: tokens.get('colors.error')
            };
            return variantColors[this.variant] || variantColors.default;
        }
        
        return tokens.get('colors.border.medium');
    }
    
    getBackgroundColor() {
        if (this.disabled) {
            return tokens.get('colors.background.disabled');
        }
        
        if (this.checked || this.indeterminate) {
            const variantColors = {
                default: tokens.get('colors.primary.500'),
                primary: tokens.get('colors.primary.600'),
                secondary: tokens.get('colors.secondary.600'),
                success: tokens.get('colors.success'),
                warning: tokens.get('colors.warning'),
                error: tokens.get('colors.error')
            };
            return variantColors[this.variant] || variantColors.default;
        }
        
        return tokens.get('colors.background.primary');
    }
    
    updateVisualState() {
        const checkboxInput = this.querySelector(`#${this.id}-input`);
        const checkmark = this.querySelector(`#${this.id}-checkmark`);
        const indeterminateDash = this.querySelector(`#${this.id}-indeterminate`);
        const focusShadow = this.isFocused
            ? '0 0 0 3px rgba(59, 130, 246, 0.16), 0 10px 22px rgba(15, 23, 42, 0.12)'
            : 'none';
        const inputTransform = this.isFocused ? 'translateY(-1px)' : 'translateY(0)';
        
        if (checkboxInput) {
            if (checkboxInput.element) {
                checkboxInput.element.style.borderColor = this.getBorderColor();
                checkboxInput.element.style.backgroundColor = this.getBackgroundColor();
                checkboxInput.element.style.boxShadow = focusShadow;
                checkboxInput.element.style.transform = inputTransform;
            }
            checkboxInput.setStyle('borderColor', this.getBorderColor());
            checkboxInput.setStyle('backgroundColor', this.getBackgroundColor());
            checkboxInput.setStyle('boxShadow', focusShadow);
            checkboxInput.setStyle('transform', inputTransform);
        }
        
        if (checkmark) {
            const visible = this.checked && !this.indeterminate;
            if (checkmark.element) {
                checkmark.element.style.opacity = visible ? '1' : '0';
                checkmark.element.style.transform = visible ? 'rotate(-45deg)' : 'rotate(-45deg) scale(0)';
            }
            checkmark.setStyle('opacity', visible ? '1' : '0');
            checkmark.setStyle('transform', visible ? 'rotate(-45deg)' : 'rotate(-45deg) scale(0)');
        }
        
        if (indeterminateDash) {
            if (indeterminateDash.element) {
                indeterminateDash.element.style.opacity = this.indeterminate ? '1' : '0';
            }
            indeterminateDash.setStyle('opacity', this.indeterminate ? '1' : '0');
        }

        if (this.label && this.labelContainer) {
            this.labelContainer.setStyle('transform', this.isFocused ? 'translateX(1px)' : 'translateX(0)');
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Public methods
    toggle() {
        if (this.disabled) return;
        
        if (this.indeterminate) {
            this.setIndeterminate(false);
            this.setChecked(true);
        } else {
            this.setChecked(!this.checked);
        }
        
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: {
                checked: this.checked,
                indeterminate: this.indeterminate,
                value: this.value
            }
        });
    }

    setIndeterminate(indeterminate) {
        if (this.indeterminate !== indeterminate) {
            this.indeterminate = indeterminate;
            this.ariaChecked = indeterminate ? 'mixed' : this.checked;
            const checkboxInput = this.querySelector(`#${this.id}-input`);
            if (checkboxInput) {
                checkboxInput.userData.indeterminate = indeterminate;
                if (checkboxInput.element) {
                    checkboxInput.element.dataset.indeterminate = String(indeterminate);
                }
            }
            this.updateVisualState();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.ariaDisabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.setStyle('cursor', disabled ? 'not-allowed' : 'pointer');
            this.setupStyles();
            this.buildCheckbox();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.updateVisualState();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildCheckbox();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            this.buildCheckbox();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.ariaDescribedBy = description ? `${this.id}-description` : null;
            this.buildCheckbox();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    static create(container, options = {}) {
        const instance = new Checkbox(_newCheckboxId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static getDefaultOptions() {
        return {
            checked: false,
            disabled: false,
            variant: 'default',
            size: 'md'
        };
    }
    
    static createCheckbox(id, options = {}) {
        return new Checkbox(id, options);
    }
    
    static createPrimaryCheckbox(id, options = {}) {
        return new Checkbox(id, { variant: 'primary', ...options });
    }
    
    static createSuccessCheckbox(id, options = {}) {
        return new Checkbox(id, { variant: 'success', ...options });
    }
    
    static createWarningCheckbox(id, options = {}) {
        return new Checkbox(id, { variant: 'warning', ...options });
    }
    
    static createErrorCheckbox(id, options = {}) {
        return new Checkbox(id, { variant: 'error', ...options });
    }
    
    static createSmallCheckbox(id, options = {}) {
        return new Checkbox(id, { size: 'sm', ...options });
    }
    
    static createLargeCheckbox(id, options = {}) {
        return new Checkbox(id, { size: 'lg', ...options });
    }
}
