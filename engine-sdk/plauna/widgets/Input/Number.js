// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Number - Number input widget for Plauna
 * Provides numeric input with validation, controls, and formatting
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _numberSequence = 0;

function _newNumberId() {
    return `number-${Date.now()}-${++_numberSequence}`;
}

export class Number extends UINode {
    // Widget metadata
    static id = 'number';
    static name = 'Number';
    static category = 'input';
    static icon = '🔢';
    static description = 'Number input';
    static tags = ['input', 'number'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            value: 0,
            min: -Infinity,
            max: Infinity,
            step: 1,
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Number(_newNumberId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newNumberId(), options = {}) {
        super(id, 'number');
        
        // Number-specific properties
        this.value = options.value !== undefined ? options.value : 0;
        this.min = options.min !== undefined ? options.min : -Infinity;
        this.max = options.max !== undefined ? options.max : Infinity;
        this.step = options.step !== undefined ? options.step : 1;
        this.precision = options.precision !== undefined ? options.precision : null;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.readonly = options.readonly || false;
        
        // UI properties
        this.label = options.label || '';
        this.placeholder = options.placeholder || 'Enter number';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, inline
        this.showControls = options.showControls !== false;
        this.showPrefix = options.showPrefix || false;
        this.showSuffix = options.showSuffix || false;
        
        // Formatting
        this.prefix = options.prefix || '';
        this.suffix = options.suffix || '';
        this.thousandsSeparator = options.thousandsSeparator !== false;
        this.decimalSeparator = options.decimalSeparator || '.';
        
        // Validation
        this.allowNegative = options.allowNegative !== false;
        this.allowDecimal = options.allowDecimal !== false;
        this.integerOnly = options.integerOnly || false;
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onInput = options.onInput || (() => {});
        this.onFocus = options.onFocus || (() => {});
        this.onBlur = options.onBlur || (() => {});
        this.onIncrement = options.onIncrement || (() => {});
        this.onDecrement = options.onDecrement || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label || 'Number input';
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        this.ariaValueText = options.ariaValueText || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create number input structure
        this.createNumberStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createNumberStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-number-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-number-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create input wrapper
        this.inputWrapper = document.createElement('div');
        this.inputWrapper.className = 'plauna-number-input-wrapper';
        this.inputWrapper.style.cssText = this.getInputWrapperStyles();
        
        // Create decrement button
        if (this.showControls) {
            this.decrementButton = document.createElement('button');
            this.decrementButton.type = 'button';
            this.decrementButton.textContent = '−';
            this.decrementButton.style.cssText = this.getControlButtonStyles();
            this.decrementButton.addEventListener('click', () => this.decrement());
        }
        
        // Create prefix display
        if (this.showPrefix && this.prefix) {
            this.prefixDisplay = document.createElement('div');
            this.prefixDisplay.className = 'plauna-number-prefix';
            this.prefixDisplay.textContent = this.prefix;
            this.prefixDisplay.style.cssText = this.getPrefixSuffixStyles();
        }
        
        // Create hidden number input
        this.numberInput = document.createElement('input');
        this.numberInput.type = 'number';
        this.numberInput.value = this.value;
        this.numberInput.min = this.min;
        this.numberInput.max = this.max;
        this.numberInput.step = this.step;
        this.numberInput.disabled = this.disabled;
        this.numberInput.required = this.required;
        this.numberInput.readOnly = this.readonly;
        this.numberInput.style.cssText = 'display: none;';
        
        // Create text input for formatting
        this.textInput = document.createElement('input');
        this.textInput.type = 'text';
        this.textInput.value = this.formatValue(this.value);
        this.textInput.placeholder = this.placeholder;
        this.textInput.disabled = this.disabled;
        this.textInput.readOnly = this.readonly;
        this.textInput.style.cssText = this.getTextInputStyles();
        
        // Create suffix display
        if (this.showSuffix && this.suffix) {
            this.suffixDisplay = document.createElement('div');
            this.suffixDisplay.className = 'plauna-number-suffix';
            this.suffixDisplay.textContent = this.suffix;
            this.suffixDisplay.style.cssText = this.getPrefixSuffixStyles();
        }
        
        // Create increment button
        if (this.showControls) {
            this.incrementButton = document.createElement('button');
            this.incrementButton.type = 'button';
            this.incrementButton.textContent = '+';
            this.incrementButton.style.cssText = this.getControlButtonStyles();
            this.incrementButton.addEventListener('click', () => this.increment());
        }
        
        // Assemble input wrapper
        if (this.decrementButton) {
            this.inputWrapper.appendChild(this.decrementButton);
        }
        
        if (this.prefixDisplay) {
            this.inputWrapper.appendChild(this.prefixDisplay);
        }
        
        this.inputWrapper.appendChild(this.textInput);
        
        if (this.suffixDisplay) {
            this.inputWrapper.appendChild(this.suffixDisplay);
        }
        
        if (this.incrementButton) {
            this.inputWrapper.appendChild(this.incrementButton);
        }
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-number-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.numberInput);
        this.container.appendChild(this.inputWrapper);
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    setupEventHandlers() {
        // Number input change
        this.numberInput.addEventListener('input', (e) => {
            this.setValue(parseFloat(e.target.value));
        });
        
        // Text input events
        this.textInput.addEventListener('input', (e) => {
            const value = this.parseValue(e.target.value);
            if (value !== null) {
                this.setValue(value);
            }
        });
        
        this.textInput.addEventListener('blur', () => {
            const value = this.parseValue(this.textInput.value);
            if (value !== null) {
                this.setValue(value);
            } else {
                this.textInput.value = this.formatValue(this.value);
            }
            this.onBlur();
        });
        
        // Focus/blur events
        this.textInput.addEventListener('focus', () => {
            this.onFocus();
        });
        
        // Keyboard events
        this.textInput.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });
        
        // Wheel events for increment/decrement
        this.textInput.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    this.increment();
                } else {
                    this.decrement();
                }
            }
        });
        
        // Control button hover effects
        if (this.decrementButton) {
            this.decrementButton.addEventListener('mouseenter', () => {
                this.decrementButton.style.background = 'rgba(59, 130, 246, 0.10)';
                this.decrementButton.style.borderColor = 'rgba(59, 130, 246, 0.28)';
                this.decrementButton.style.color = 'var(--color-primary-500, #0ea5e9)';
            });
            
            this.decrementButton.addEventListener('mouseleave', () => {
                this.decrementButton.style.background = 'rgba(15, 23, 42, 0.04)';
                this.decrementButton.style.borderColor = 'rgba(148, 163, 184, 0.20)';
                this.decrementButton.style.color = 'var(--text-secondary, #475569)';
            });
        }
        
        if (this.incrementButton) {
            this.incrementButton.addEventListener('mouseenter', () => {
                this.incrementButton.style.background = 'rgba(59, 130, 246, 0.10)';
                this.incrementButton.style.borderColor = 'rgba(59, 130, 246, 0.28)';
                this.incrementButton.style.color = 'var(--color-primary-500, #0ea5e9)';
            });
            
            this.incrementButton.addEventListener('mouseleave', () => {
                this.incrementButton.style.background = 'rgba(15, 23, 42, 0.04)';
                this.incrementButton.style.borderColor = 'rgba(148, 163, 184, 0.20)';
                this.incrementButton.style.color = 'var(--text-secondary, #475569)';
            });
        }
    }
    
    handleKeydown(e) {
        if (this.disabled || this.readonly) return;
        
        let newValue = this.value;
        
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                newValue = Math.min(this.max, this.value + this.step);
                break;
            case 'ArrowDown':
                e.preventDefault();
                newValue = Math.max(this.min, this.value - this.step);
                break;
            case 'Home':
                e.preventDefault();
                newValue = this.max;
                break;
            case 'End':
                e.preventDefault();
                newValue = this.min;
                break;
            case 'PageUp':
                e.preventDefault();
                newValue = Math.min(this.max, this.value + (this.step * 10));
                break;
            case 'PageDown':
                e.preventDefault();
                newValue = Math.max(this.min, this.value - (this.step * 10));
                break;
            default:
                return;
        }
        
        this.setValue(newValue);
        this.onInput(this.value);
    }
    
    setValue(value) {
        // Validate value
        if (isNaN(value)) {
            value = this.defaultValue || 0;
        }
        
        value = Math.max(this.min, Math.min(this.max, value));
        
        // Apply precision if specified
        if (this.precision !== null && !isNaN(value)) {
            value = parseFloat(value.toFixed(this.precision));
        }
        
        this.value = value;
        this.numberInput.value = value;
        this.textInput.value = this.formatValue(value);
        
        // Update accessibility
        this.updateAriaValueText();
        
        this.onChange(value);
        this.markDirty(DIRTY.VALUE);
    }
    
    increment() {
        const newValue = Math.min(this.max, this.value + this.step);
        this.setValue(newValue);
        this.onIncrement(newValue);
        this.onInput(newValue);
    }
    
    decrement() {
        const newValue = Math.max(this.min, this.value - this.step);
        this.setValue(newValue);
        this.onDecrement(newValue);
        this.onInput(newValue);
    }
    
    parseValue(text) {
        if (!text) return null;
        
        // Remove formatting characters
        let cleanText = text.replace(/[^\d\.\-]/g, '');
        
        // Handle negative numbers
        if (!this.allowNegative) {
            cleanText = cleanText.replace(/-/g, '');
        }
        
        // Handle decimal numbers
        if (!this.allowDecimal || this.integerOnly) {
            cleanText = cleanText.replace(/\./g, '');
        }
        
        // Parse as number
        const value = parseFloat(cleanText);
        
        return isNaN(value) ? null : value;
    }
    
    formatValue(value) {
        if (isNaN(value)) return '';
        
        let formatted = value.toString();
        
        // Apply precision if specified
        if (this.precision !== null) {
            formatted = value.toFixed(this.precision);
        }
        
        // Add thousands separator
        if (this.thousandsSeparator && !this.integerOnly) {
            const parts = formatted.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            formatted = parts.join(this.decimalSeparator);
        }
        
        return formatted;
    }
    
    updateAriaValueText() {
        const valueText = this.ariaValueText || `${this.value}`;
        this.numberInput.setAttribute('aria-valuetext', valueText);
    }
    
    setupStyles() {
        this.setStyles({
            display: 'block',
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
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'width: 100%;'
        );
    }
    
    getTextInputStyles() {
        const sizeStyles = this.getSizeStyles();
        return (
            'flex: 1;' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 14px;' +
            'background: rgba(15, 23, 42, 0.04);' +
            'color: var(--text-primary, #0f172a);' +
            'font-size: 14px;' +
            'font-family: monospace;' +
            'text-align: center;' +
            'outline: none;' +
            'transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background-color 160ms ease;' +
            'box-sizing: border-box;' +
            'box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(15, 23, 42, 0.08);' +
            sizeStyles
        );
    }
    
    getControlButtonStyles() {
        return (
            'background: rgba(15, 23, 42, 0.04);' +
            'color: var(--text-secondary, #475569);' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 10px;' +
            'width: 28px;' +
            'height: 28px;' +
            'font-size: 16px;' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'transition: all 150ms ease;' +
            'box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);' +
            'flex-shrink: 0;'
        );
    }
    
    getPrefixSuffixStyles() {
        return (
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'padding: 0 4px;' +
            'flex-shrink: 0;'
        );
    }
    
    getSizeStyles() {
        const sizes = {
            sm: 'height: 28px;',
            md: 'height: 32px;',
            lg: 'height: 40px;'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getHelperStyles() {
        return (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
    }
    
    // Setter methods
    setMin(min) {
        this.min = min;
        this.numberInput.min = min;
        this.setValue(this.value); // Re-validate current value
        this.markDirty(DIRTY.PROPS);
    }
    
    setMax(max) {
        this.max = max;
        this.numberInput.max = max;
        this.setValue(this.value); // Re-validate current value
        this.markDirty(DIRTY.PROPS);
    }
    
    setStep(step) {
        this.step = step;
        this.numberInput.step = step;
        this.markDirty(DIRTY.PROPS);
    }
    
    setPrecision(precision) {
        this.precision = precision;
        this.setValue(this.value); // Re-format current value
        this.markDirty(DIRTY.PROPS);
    }
    
    setPrefix(prefix) {
        this.prefix = prefix;
        if (this.prefixDisplay) {
            this.prefixDisplay.textContent = prefix;
            this.prefixDisplay.style.display = prefix ? 'block' : 'none';
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    setSuffix(suffix) {
        this.suffix = suffix;
        if (this.suffixDisplay) {
            this.suffixDisplay.textContent = suffix;
            this.suffixDisplay.style.display = suffix ? 'block' : 'none';
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.numberInput) {
            this.numberInput.disabled = disabled;
        }
        if (this.textInput) {
            this.textInput.disabled = disabled;
        }
        if (this.decrementButton) {
            this.decrementButton.disabled = disabled;
        }
        if (this.incrementButton) {
            this.incrementButton.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getValue() {
        return this.value;
    }
    
    getFormattedValue() {
        return this.formatValue(this.value);
    }
    
    // Static factory methods
    static createIntegerInput(id, options = {}) {
        return new Number(id, {
            integerOnly: true,
            allowDecimal: false,
            ...options
        });
    }
    
    static createDecimalInput(id, options = {}) {
        return new Number(id, {
            integerOnly: false,
            allowDecimal: true,
            ...options
        });
    }
    
    static createCurrencyInput(id, options = {}) {
        return new Number(id, {
            prefix: '$',
            precision: 2,
            thousandsSeparator: true,
            ...options
        });
    }
    
    static createPercentageInput(id, options = {}) {
        return new Number(id, {
            suffix: '%',
            min: 0,
            max: 100,
            precision: 1,
            ...options
        });
    }
    
    static createCompactNumberInput(id, options = {}) {
        return new Number(id, {
            variant: 'compact',
            showControls: false,
            ...options
        });
    }
    
    // Focus methods
    focus() {
        if (this.textInput) {
            this.textInput.focus();
        }
    }
    
    blur() {
        if (this.textInput) {
            this.textInput.blur();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.numberInput) {
            this.numberInput.removeEventListener('input', this.onChange);
        }
        if (this.textInput) {
            this.textInput.removeEventListener('input', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
