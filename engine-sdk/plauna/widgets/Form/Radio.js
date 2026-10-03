// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Radio - Single-select form control widget for Plauna
 * Provides radio button functionality with multiple states and variants
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _radioSequence = 0;

function _newRadioId() {
    return `radio-${Date.now()}-${++_radioSequence}`;
}

export class Radio extends UINode {
    // Widget metadata
    static id = 'radio';
    static name = 'Radio';
    static category = 'form';
    static icon = '🔘';
    static description = 'Radio button form control';
    static tags = ['form', 'input', 'radio', 'control'];
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
        const instance = new Radio(_newRadioId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newRadioId(), options = {}) {
        super(id, 'radio');
        
        // Radio-specific properties
        this.checked = options.checked || false;
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
        this.role = 'radio';
        this.ariaChecked = this.checked;
        this.ariaDisabled = this.disabled;
        this.ariaRequired = this.required;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.description ? `${id}-description` : null;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build radio structure
        this.buildRadio();
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
                this.select();
            });
            
            this.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case ' ':
                    case 'Enter':
                        e.preventDefault();
                        this.select();
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
    
    buildRadio() {
        this.innerHTML = '';
        
        // Create radio input
        const radioInput = new UINode(`${this.id}-input`, 'input');
        radioInput.type = 'radio';
        radioInput.name = this.name;
        radioInput.value = this.value;
        radioInput.checked = this.checked;
        radioInput.disabled = this.disabled;
        radioInput.required = this.required;
        
        // Radio input styles
        radioInput.setStyles({
            appearance: 'none',
            width: '100%',
            height: '100%',
            margin: '0',
            padding: '0',
            border: `2px solid ${this.getBorderColor()}`,
            borderRadius: '50%',
            backgroundColor: this.getBackgroundColor(),
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            transition: 'all 150ms ease',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });
        
        // Add radio button dot
        const radioDot = new UINode(`${this.id}-dot`, 'span');
        radioDot.setStyles({
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: this.getDotColor(),
            opacity: this.checked ? '1' : '0',
            transition: 'all 150ms ease',
            position: 'absolute'
        });
        
        radioInput.appendChild(radioDot);
        this.appendChild(radioInput);
        
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
        
        if (this.checked) {
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
        
        if (this.checked) {
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
    
    getDotColor() {
        if (this.disabled) {
            return tokens.get('colors.text.disabled');
        }
        
        if (this.checked) {
            return tokens.get('colors.text.inverse');
        }
        
        return tokens.get('colors.text.secondary');
    }
    
    updateVisualState() {
        const radioInput = this.querySelector(`#${this.id}-input`);
        const radioDot = this.querySelector(`#${this.id}-dot`);
        const focusShadow = this.isFocused
            ? '0 0 0 3px rgba(59, 130, 246, 0.16), 0 10px 22px rgba(15, 23, 42, 0.12)'
            : 'none';
        const inputTransform = this.isFocused ? 'translateY(-1px)' : 'translateY(0)';
        const dotTransform = this.checked ? 'scale(1)' : 'scale(0.7)';
        
        if (radioInput) {
            if (radioInput.element) {
                radioInput.element.style.borderColor = this.getBorderColor();
                radioInput.element.style.backgroundColor = this.getBackgroundColor();
                radioInput.element.style.boxShadow = focusShadow;
                radioInput.element.style.transform = inputTransform;
            }
            radioInput.setStyle('borderColor', this.getBorderColor());
            radioInput.setStyle('backgroundColor', this.getBackgroundColor());
            radioInput.setStyle('boxShadow', focusShadow);
            radioInput.setStyle('transform', inputTransform);
        }
        
        if (radioDot) {
            if (radioDot.element) {
                radioDot.element.style.opacity = this.checked ? '1' : '0';
                radioDot.element.style.transform = this.checked ? 'scale(1)' : 'scale(0.7)';
            }
            radioDot.setStyle('opacity', this.checked ? '1' : '0');
            radioDot.setStyle('backgroundColor', this.getDotColor());
            radioDot.setStyle('transform', dotTransform);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Public methods
    select() {
        if (this.disabled || this.checked) return;
        
        // Uncheck other radios in the same group
        this.uncheckOtherRadios();
        
        this.setChecked(true);
        
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: {
                checked: this.checked,
                value: this.value
            }
        });
    }
    
    uncheckOtherRadios() {
        if (!this.name) return;
        
        // Find all other radios with the same name and uncheck them
        const allRadios = document.querySelectorAll(`input[type="radio"][name="${this.name}"]`);
        allRadios.forEach(radio => {
            if (radio !== this.element) {
                const radioNode = radio._plaunaNode;
                if (radioNode && radioNode.setChecked) {
                    radioNode.setChecked(false);
                }
            }
        });
    }
    
    setChecked(checked) {
        if (this.checked !== checked) {
            this.checked = checked;
            this.ariaChecked = checked;
            const radioInput = this.querySelector(`#${this.id}-input`);
            if (radioInput) {
                radioInput.element.checked = checked;
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
            this.buildRadio();
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
            this.buildRadio();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            this.buildRadio();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.ariaDescribedBy = description ? `${this.id}-description` : null;
            this.buildRadio();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            const radioInput = this.querySelector(`#${this.id}-input`);
            if (radioInput) {
                radioInput.element.value = value;
            }
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setName(name) {
        if (this.name !== name) {
            this.name = name;
            const radioInput = this.querySelector(`#${this.id}-input`);
            if (radioInput) {
                radioInput.element.name = name;
            }
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;
            this.ariaRequired = required;
            const radioInput = this.querySelector(`#${this.id}-input`);
            if (radioInput) {
                radioInput.element.required = required;
            }
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newRadioId();
        const radioWidget = new Radio(id, options);
        if (container) {
            container.appendChild(radioWidget.element);
        }
        return radioWidget;
    }
    
    static getDefaultOptions() {
        return {
            checked: false,
            disabled: false,
            variant: 'default',
            size: 'md'
        };
    }
    
    static createRadio(id, options = {}) {
        return new Radio(id, options);
    }
    
    static createPrimaryRadio(id, options = {}) {
        return new Radio(id, { variant: 'primary', ...options });
    }
    
    static createSuccessRadio(id, options = {}) {
        return new Radio(id, { variant: 'success', ...options });
    }
    
    static createWarningRadio(id, options = {}) {
        return new Radio(id, { variant: 'warning', ...options });
    }
    
    static createErrorRadio(id, options = {}) {
        return new Radio(id, { variant: 'error', ...options });
    }
    
    static createSmallRadio(id, options = {}) {
        return new Radio(id, { size: 'sm', ...options });
    }
    
    static createLargeRadio(id, options = {}) {
        return new Radio(id, { size: 'lg', ...options });
    }
    
    // Group utility methods
    static createRadioGroup(id, radios, options = {}) {
        const container = new UINode(`${id}-group`, 'div');
        container.setStyles({
            display: 'flex',
            flexDirection: options.orientation === 'horizontal' ? 'row' : 'column',
            gap: tokens.get('spacing.md'),
            alignItems: options.align || 'flex-start'
        });
        
        // Create radio buttons
        radios.forEach((radioConfig, index) => {
            const radio = new Radio(`${id}-radio-${index}`, {
                name: options.name || 'radio-group',
                ...radioConfig
            });
            container.appendChild(radio);
        });
        
        return container;
    }
}
