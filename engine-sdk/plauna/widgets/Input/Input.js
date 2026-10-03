// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Input - Text input widget for Plauna
 * Provides various input types with validation, states, and accessibility
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _inputSequence = 0;

function _newInputId() {
    return `input-${Date.now()}-${++_inputSequence}`;
}

export class Input extends UINode {
    // Widget metadata
    static id = 'input-field';
    static name = 'Input';
    static category = 'input';
    static icon = '📝';
    static description = 'Text input field';
    static tags = ['input', 'text', 'field'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            type: 'text',
            value: '',
            placeholder: '',
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Input(_newInputId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newInputId(), options = {}) {
        super(id, 'input');
        
        // Input-specific properties
        this.type = options.type || 'text'; // text, password, email, number, tel, url, search
        this.value = options.value || '';
        this.placeholder = options.placeholder || '';
        this.label = options.label || '';
        this.description = options.description || '';
        this.error = options.error || '';
        this.helper = options.helper || '';
        this.required = options.required || false;
        this.disabled = options.disabled || false;
        this.readonly = options.readonly || false;
        this.autofocus = options.autofocus || false;
        this.autocomplete = options.autocomplete !== false; // default true
        this.name = options.name || id;
        this.id = options.id || id;
        
        // Validation
        this.min = options.min;
        this.max = options.max;
        this.step = options.step || 'any';
        this.minLength = options.minLength;
        this.maxLength = options.maxLength;
        this.pattern = options.pattern;
        
        // Styling
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, outlined, filled
        this.prefix = options.prefix || null; // icon or text
        this.suffix = options.suffix || null; // icon or text
        this.borderRadius = options.borderRadius || tokens.get('borderRadius.md');
        this.background = options.background || tokens.get('colors.background.primary');
        this.borderColor = options.borderColor || tokens.get('colors.border.medium');
        this.borderWidth = options.borderWidth || '1px';
        this.textColor = options.textColor || tokens.get('colors.text.primary');
        this.placeholderColor = options.placeholderColor || tokens.get('colors.text.secondary');
        
        // States
        this.focused = false;
        this.hovered = false;
        this.valid = true;
        this.dirty = false;
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onFocus = options.onFocus || (() => {});
        this.onBlur = options.onBlur || (() => {});
        this.onInput = options.onInput || (() => {});
        this.onValidate = options.onValidate || (() => true);
        
        // Set accessibility
        this.role = 'textbox';
        this.ariaLabel = options.ariaLabel || this.label;
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        this.ariaInvalid = options.ariaInvalid || 'false';
        this.ariaRequired = this.required.toString();
        
        // Set default styles
        this.setupStyles();
        
        // Create input structure
        this.createInputStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createInputStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-input-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-input-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create input wrapper
        this.inputWrapper = document.createElement('div');
        this.inputWrapper.className = 'plauna-input-wrapper';
        this.inputWrapper.style.cssText = this.getInputWrapperStyles();
        
        // Create prefix if provided
        if (this.prefix) {
            this.prefixElement = document.createElement('div');
            this.prefixElement.className = 'plauna-input-prefix';
            this.prefixElement.textContent = typeof this.prefix === 'string' ? this.prefix : '';
            this.prefixElement.style.cssText = this.getPrefixSuffixStyles();
            this.inputWrapper.appendChild(this.prefixElement);
        }
        
        // Create input element
        this.inputElement = document.createElement('input');
        this.inputElement.className = 'plauna-input';
        this.inputElement.type = this.type;
        this.inputElement.value = this.value;
        this.inputElement.placeholder = this.placeholder;
        this.inputElement.name = this.name;
        this.inputElement.id = this.id;
        this.inputElement.disabled = this.disabled;
        this.inputElement.readOnly = this.readonly;
        this.inputElement.autofocus = this.autofocus;
        this.inputElement.required = this.required;
        this.inputElement.autocomplete = this.autocomplete ? 'on' : 'off';
        
        // Set validation attributes
        if (this.min !== undefined) this.inputElement.min = this.min;
        if (this.max !== undefined) this.inputElement.max = this.max;
        if (this.step) this.inputElement.step = this.step;
        if (this.minLength) this.inputElement.minLength = this.minLength;
        if (this.maxLength) this.inputElement.maxLength = this.maxLength;
        if (this.pattern) this.inputElement.pattern = this.pattern;
        
        // Set accessibility attributes
        this.inputElement.setAttribute('aria-label', this.ariaLabel);
        if (this.ariaDescribedBy) {
            this.inputElement.setAttribute('aria-describedby', this.ariaDescribedBy);
        }
        this.inputElement.setAttribute('aria-invalid', this.ariaInvalid);
        this.inputElement.setAttribute('aria-required', this.ariaRequired);
        
        this.inputElement.style.cssText = this.getInputStyles();
        this.inputWrapper.appendChild(this.inputElement);
        
        // Create suffix if provided
        if (this.suffix) {
            this.suffixElement = document.createElement('div');
            this.suffixElement.className = 'plauna-input-suffix';
            this.suffixElement.textContent = typeof this.suffix === 'string' ? this.suffix : '';
            this.suffixElement.style.cssText = this.getPrefixSuffixStyles();
            this.inputWrapper.appendChild(this.suffixElement);
        }
        
        this.container.appendChild(this.inputWrapper);
        
        // Create helper text if provided
        if (this.helper || this.error) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-input-helper';
            this.helperElement.textContent = this.error || this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    setupEventHandlers() {
        // Input events
        this.inputElement.addEventListener('input', (e) => {
            this.value = e.target.value;
            this.dirty = true;
            this.onInput(e);
            this.validate();
            this.markDirty(DIRTY.VALUE);
        });
        
        this.inputElement.addEventListener('change', (e) => {
            this.value = e.target.value;
            this.onChange(e);
            this.validate();
            this.markDirty(DIRTY.VALUE);
        });
        
        this.inputElement.addEventListener('focus', (e) => {
            this.focused = true;
            this.onFocus(e);
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
        
        this.inputElement.addEventListener('blur', (e) => {
            this.focused = false;
            this.onBlur(e);
            this.validate();
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
        
        // Hover effects
        this.inputWrapper.addEventListener('mouseenter', () => {
            this.hovered = true;
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
        
        this.inputWrapper.addEventListener('mouseleave', () => {
            this.hovered = false;
            this.updateStateStyles();
            this.markDirty(DIRTY.STATE);
        });
    }
    
    validate() {
        if (this.disabled || this.readonly) {
            this.valid = true;
            return true;
        }
        
        const isValid = this.inputElement.checkValidity();
        const customValid = this.onValidate(this.value);
        
        this.valid = isValid && customValid;
        this.ariaInvalid = (!this.valid).toString();
        
        if (this.inputElement) {
            this.inputElement.setAttribute('aria-invalid', this.ariaInvalid);
        }
        
        this.updateStateStyles();
        this.markDirty(DIRTY.STATE | DIRTY.STYLE);
        
        return this.valid;
    }
    
    updateStateStyles() {
        if (!this.inputElement) return;
        
        const styles = this.getInputStyles();
        this.inputElement.style.cssText = styles;
        
        if (this.helperElement) {
            this.helperElement.style.cssText = this.getHelperStyles();
        }
    }
    
    setupStyles() {
        this.setStyles({
            display: 'inline-block',
            width: '100%'
        });
    }
    
    getContainerStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'width: 100%;'
        );
    }
    
    getLabelStyles() {
        return (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'margin-bottom: ' + tokens.get('spacing.xs') + ';' +
            'cursor: pointer;'
        );
    }
    
    getInputWrapperStyles() {
        return (
            'display: flex;' +
            'align-items: center;' +
            'position: relative;' +
            'width: 100%;'
        );
    }
    
    getInputStyles() {
        const sizeStyles = this.getSizeStyles();
        const stateStyles = this.getStateStyles();
        const variantStyles = this.getVariantStyles();
        
        return (
            'width: 100%;' +
            'border: ' + this.borderWidth + ' solid ' + this.borderColor + ';' +
            'border-radius: ' + this.borderRadius + ';' +
            'background: ' + this.background + ';' +
            'color: ' + this.textColor + ';' +
            'font-size: ' + tokens.get('fontSizes.md') + ';' +
            'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
            'outline: none;' +
            'transition: all 150ms ease;' +
            'box-sizing: border-box;' +
            sizeStyles +
            stateStyles +
            variantStyles
        );
    }
    
    getSizeStyles() {
        const sizes = {
            sm: 'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';',
            md: 'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';',
            lg: 'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: '',
            outlined: 'background: transparent;',
            filled: 'background: ' + tokens.get('colors.surface') + ';'
        };
        return variants[this.variant] || variants.default;
    }
    
    getStateStyles() {
        let styles = '';
        
        if (this.disabled) {
            styles += (
                'opacity: 0.6;' +
                'cursor: not-allowed;' +
                'background: ' + tokens.get('colors.surface') + ';'
            );
        } else if (this.readonly) {
            styles += (
                'background: ' + tokens.get('colors.surface') + ';' +
                'cursor: default;'
            );
        } else if (this.focused) {
            styles += (
                'border-color: ' + tokens.get('colors.primary') + ';' +
                'box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);'
            );
        } else if (this.hovered) {
            styles += 'border-color: ' + tokens.get('colors.border.dark') + ';';
        }
        
        if (!this.valid && this.dirty) {
            styles += (
                'border-color: #ef4444;' +
                'box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.1);'
            );
        }
        
        return styles;
    }
    
    getPrefixSuffixStyles() {
        return (
            'display: flex;' +
            'align-items: center;' +
            'padding: 0 ' + tokens.get('spacing.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'pointer-events: none;'
        );
    }
    
    getHelperStyles() {
        const isError = !this.valid && this.dirty;
        return (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
            'color: ' + (isError ? '#ef4444' : tokens.get('colors.text.secondary')) + ';' +
            'margin-top: ' + tokens.get('spacing.xs') + ';'
        );
    }
    
    // Setter methods
    setValue(value) {
        this.value = value;
        if (this.inputElement) {
            this.inputElement.value = value;
        }
        this.validate();
        this.markDirty(DIRTY.VALUE);
    }
    
    setPlaceholder(placeholder) {
        this.placeholder = placeholder;
        if (this.inputElement) {
            this.inputElement.placeholder = placeholder;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    setError(error) {
        this.error = error;
        if (this.helperElement) {
            this.helperElement.textContent = error || this.helper;
        }
        this.validate();
        this.markDirty(DIRTY.PROPS);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.inputElement) {
            this.inputElement.disabled = disabled;
        }
        this.updateStateStyles();
        this.markDirty(DIRTY.PROPS | DIRTY.STATE);
    }
    
    setRequired(required) {
        this.required = required;
        if (this.inputElement) {
            this.inputElement.required = required;
        }
        this.ariaRequired = required.toString();
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getValue() {
        return this.value;
    }
    
    isValid() {
        return this.valid;
    }
    
    isDirty() {
        return this.dirty;
    }
    
    // Static factory methods
    static createTextInput(id, options = {}) {
        return new Input(id, {
            type: 'text',
            ...options
        });
    }
    
    static createEmailInput(id, options = {}) {
        return new Input(id, {
            type: 'email',
            placeholder: 'email@example.com',
            ...options
        });
    }
    
    static createPasswordInput(id, options = {}) {
        return new Input(id, {
            type: 'password',
            placeholder: 'Enter password',
            ...options
        });
    }
    
    static createNumberInput(id, options = {}) {
        return new Input(id, {
            type: 'number',
            ...options
        });
    }
    
    static createSearchInput(id, options = {}) {
        return new Input(id, {
            type: 'search',
            placeholder: 'Search...',
            ...options
        });
    }
    
    static createTelInput(id, options = {}) {
        return new Input(id, {
            type: 'tel',
            placeholder: '(123) 456-7890',
            ...options
        });
    }
    
    static createUrlInput(id, options = {}) {
        return new Input(id, {
            type: 'url',
            placeholder: 'https://example.com',
            ...options
        });
    }
    
    static createRequiredInput(id, options = {}) {
        return new Input(id, {
            required: true,
            ...options
        });
    }
    
    static createDisabledInput(id, options = {}) {
        return new Input(id, {
            disabled: true,
            ...options
        });
    }
    
    static createReadonlyInput(id, options = {}) {
        return new Input(id, {
            readonly: true,
            ...options
        });
    }
    
    // Focus methods
    focus() {
        if (this.inputElement) {
            this.inputElement.focus();
        }
    }
    
    blur() {
        if (this.inputElement) {
            this.inputElement.blur();
        }
    }
    
    select() {
        if (this.inputElement) {
            this.inputElement.select();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.inputElement) {
            this.inputElement.removeEventListener('input', this.onInput);
            this.inputElement.removeEventListener('change', this.onChange);
            this.inputElement.removeEventListener('focus', this.onFocus);
            this.inputElement.removeEventListener('blur', this.onBlur);
        }
        
        this.innerHTML = '';
    }
}
