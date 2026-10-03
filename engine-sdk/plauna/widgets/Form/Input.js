// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Input - Form input widget for Plauna
 * Provides text input with validation and styling options
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';

let _formInputSequence = 0;

function _newFormInputId() {
    return `form-input-${Date.now()}-${++_formInputSequence}`;
}

export class Input extends UINode {
    // Widget metadata
    static id = 'input';
    static name = 'Input';
    static category = 'form';
    static icon = '📝';
    static description = 'Text input form control';
    static tags = ['form', 'input', 'text'];
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
        const instance = new Input(_newFormInputId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newFormInputId(), options = {}) {
        super(id, 'input');
        
        // Input-specific properties
        this.value = options.value || '';
        this.placeholder = options.placeholder || '';
        this.type = options.type || 'text';
        this.autocomplete = options.autocomplete || false;
        this.required = options.required || false;
        this.disabled = options.disabled || false;
        this.readonly = options.readonly || false;
        this.maxLength = options.maxLength || null;
        this.minLength = options.minLength || null;
        this.pattern = options.pattern || null;
        
        // Validation
        this.isValid = true;
        this.errorMessage = '';
        this.validationRules = options.validationRules || [];
        
        // Set accessibility
        this.role = 'textbox';
        this.setState(NODE_STATE.FOCUSABLE, !this.disabled);
        
        // Set default styles
        this.setStyles({
            display: 'block',
            width: '100%',
            padding: '12px 14px',
            backgroundColor: 'rgba(15, 23, 42, 0.04)',
            color: 'var(--text-primary, #0f172a)',
            border: '1px solid rgba(148, 163, 184, 0.20)',
            borderRadius: '14px',
            fontSize: '14px',
            fontFamily: 'inherit',
            lineHeight: '1.5',
            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background-color 160ms ease',
            outline: 'none',
            boxSizing: 'border-box',
            boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(15, 23, 42, 0.08)'
        });
        
        // Apply focus styles
        this.setStyles({
            ':focus': {
                borderColor: 'rgba(59, 130, 246, 0.72)',
                boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.14), 0 12px 24px rgba(15, 23, 42, 0.10)'
            },
            ':focus-visible': {
                borderColor: 'rgba(59, 130, 246, 0.72)',
                boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.18), 0 12px 24px rgba(15, 23, 42, 0.10)'
            }
        });
        
        // Apply disabled styles
        this.setStyles({
            ':disabled': {
                backgroundColor: 'rgba(148, 163, 184, 0.08)',
                color: 'var(--text-disabled, #94a3b8)',
                cursor: 'not-allowed',
                opacity: 0.6
            }
        });
        
        // Apply readonly styles
        this.setStyles({
            ':readonly': {
                backgroundColor: 'rgba(148, 163, 184, 0.08)',
                color: 'var(--text-secondary, #475569)',
                cursor: 'default'
            }
        });
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Set initial value
        this.setValue(this.value);
    }

    // Set input value
    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            this.textContent = value;
            this.markDirty(DIRTY.TEXT | DIRTY.PAINT);
            
            // Validate input
            this.validateInput();
            
            // Emit change event
            this.emitChange();
        }
    }

    // Get input value
    getValue() {
        return this.value;
    }

    // Set placeholder
    setPlaceholder(placeholder) {
        if (this.placeholder !== placeholder) {
            this.placeholder = placeholder;
            this.markDirty(DIRTY.PAINT);
        }
    }

    // Set input type
    setType(type) {
        if (this.type !== type) {
            this.type = type;
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Set required
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;
            this.setState(NODE_STATE.REQUIRED, required);
            this.ariaRequired = required;
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    // Set disabled
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.ariaDisabled = disabled;
            this.setStyle('cursor', disabled ? 'not-allowed' : 'text');
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    // Set readonly
    setReadonly(readonly) {
        if (this.readonly !== readonly) {
            this.readonly = readonly;
            this.ariaReadOnly = readonly;
            this.setStyle('cursor', readonly ? 'default' : 'text');
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Set max length
    setMaxLength(maxLength) {
        if (this.maxLength !== maxLength) {
            this.maxLength = maxLength;
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Set min length
    setMinLength(minLength) {
        if (this.minLength !== minLength) {
            this.minLength = minLength;
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Set validation pattern
    setPattern(pattern) {
        if (this.pattern !== pattern) {
            this.pattern = pattern;
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Add validation rule
    addValidationRule(rule) {
        this.validationRules.push(rule);
    }

    // Clear validation rules
    clearValidationRules() {
        this.validationRules = [];
    }

    // Validate input
    validateInput() {
        const oldValue = this.isValid;
        this.isValid = true;
        this.errorMessage = '';
        
        // Check required
        if (this.required && (!this.value.trim())) {
            this.isValid = false;
            this.errorMessage = 'This field is required';
            return;
        }
        
        // Check min length
        if (this.minLength && this.value.length < this.minLength) {
            this.isValid = false;
            this.errorMessage = `Minimum ${this.minLength} characters required`;
            return;
        }
        
        // Check max length
        if (this.maxLength && this.value.length > this.maxLength) {
            this.isValid = false;
            this.errorMessage = `Maximum ${this.maxLength} characters allowed`;
            return;
        }
        
        // Check pattern
        if (this.pattern && !new RegExp(this.pattern).test(this.value)) {
            this.isValid = false;
            this.errorMessage = 'Input format is invalid';
            return;
        }
        
        this.isValid = true;
        this.errorMessage = '';
    }
    setupEventHandlers() {
        // Focus events
        this.addEventListener('focus', () => {
            this.setState(NODE_STATE.FOCUSED, true);
            this.markDirty(DIRTY.PAINT);
        });
        
        this.addEventListener('blur', () => {
            this.setState(NODE_STATE.FOCUSED, false);
            this.markDirty(DIRTY.PAINT);
        });
        
        // Input events
        this.addEventListener('input', (event) => {
            this.setValue(event.target.value);
        });
        
        // Change events
        this.addEventListener('change', (event) => {
            this.emitChange();
        });
        
        // Keyboard navigation
        this.addEventListener('keydown', (event) => {
            if (this.disabled || this.readonly) return;
            
            switch (event.key) {
                case 'Enter':
                    event.preventDefault();
                    this.emitSubmit();
                    break;
                case 'Escape':
                    event.preventDefault();
                    this.emitCancel();
                    break;
            }
        });
        
        // Paste events
        this.addEventListener('paste', (event) => {
            event.preventDefault();
            const pastedText = event.clipboardData.getData('text');
            if (pastedText) {
                let newValue = this.value + pastedText;
                if (this.maxLength && newValue.length > this.maxLength) {
                    newValue = newValue.substring(0, this.maxLength);
                }
                this.setValue(newValue);
            }
        });
        
        // Select events
        this.addEventListener('select', () => {
            this.markDirty(DIRTY.TEXT | DIRTY.PAINT);
        });
    }

    // Emit change event
    emitChange() {
        const changeEvent = {
            type: 'input-change',
            target: this,
            value: this.value,
            isValid: this.isValid,
            errorMessage: this.errorMessage,
            defaultPrevented: false,
            preventDefault: () => { changeEvent.defaultPrevented = true; }
        };
        
        this.dispatchEvent(changeEvent);
        
        if (!changeEvent.defaultPrevented) {
            // Handle change logic here
            this.handleInputChange();
        }
    }

    // Handle input change
    handleInputChange() {
        // Placeholder for custom change handling
        this.emit('input-changed', {
            target: this,
            value: this.value,
            isValid: this.isValid,
            errorMessage: this.errorMessage
        });
    }

    // Emit submit event
    emitSubmit() {
        const submitEvent = {
            type: 'input-submit',
            target: this,
            value: this.value,
            isValid: this.isValid,
            errorMessage: this.errorMessage,
            defaultPrevented: false,
            preventDefault: () => { submitEvent.defaultPrevented = true; }
        };
        
        this.dispatchEvent(submitEvent);
        
        if (!submitEvent.defaultPrevented) {
            // Handle submit logic here
            this.handleInputSubmit();
        }
    }

    // Handle input submit
    handleInputSubmit() {
        // Placeholder for custom submit handling
        this.emit('input-submitted', {
            target: this,
            value: this.value,
            isValid: this.isValid,
            errorMessage: this.errorMessage
        });
    }

    // Emit cancel event
    emitCancel() {
        const cancelEvent = {
            type: 'input-cancel',
            target: this,
            value: this.value,
            defaultPrevented: false,
            preventDefault: () => { cancelEvent.defaultPrevented = true; }
        };
        
        this.dispatchEvent(cancelEvent);
        
        if (!cancelEvent.defaultPrevented) {
            // Handle cancel logic here
            this.handleInputCancel();
        }
    }

    // Handle input cancel
    handleInputCancel() {
        // Placeholder for custom cancel handling
        this.emit('input-cancelled', {
            target: this,
            value: this.value,
            isValid: this.validationRules.length > 0,
            errorMessage: this.errorMessage
        });
    }

    // Focus input
    focus() {
        if (!this.disabled && !this.readonly) {
            this.setState(NODE_STATE.FOCUSED, true);
            this.markDirty(DIRTY.PAINT);
        }
    }

    // Blur input
    blur() {
        this.setState(NODE_STATE.FOCUSED, false);
        this.markDirty(DIRTY.PAINT);
    }

    // Select all text
    select() {
        if (!this.readonly && !this.disabled) {
            this.markDirty(DIRTY.TEXT | DIRTY.PAINT);
        }
    }

    // Get input info
    getInfo() {
        return {
            ...this.getDebugInfo(),
            value: this.value,
            placeholder: this.placeholder,
            type: this.type,
            required: this.required,
            disabled: this.disabled,
            readonly: this.readonly,
            maxLength: this.maxLength,
            minLength: this.minLength,
            pattern: this.pattern,
            isValid: this.isValid,
            errorMessage: this.errorMessage,
            validationRules: this.validationRules.length
        };
    }

    // Override destroy to clean up input-specific resources
    destroy() {
        // Clean up event listeners and resources
        super.destroy();
    }
}

// Input factory functions
export const InputFactory = {
    // Create basic text input
    create(id, options = {}) {
        return new Input(id, options);
    },
    
    // Create email input
    createEmail(id, options = {}) {
        return new Input(id, {
            type: 'email',
            placeholder: 'Enter your email',
            validationRules: [
                {
                    test: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+\.[^\s@]+$/.test(value),
                    message: 'Please enter a valid email address'
                }
            ],
            ...options
        });
    },
    
    // Create password input
    createPassword(id, options = {}) {
        return new Input(id, {
            type: 'password',
            placeholder: 'Enter your password',
            validationRules: [
                {
                    test: (value) => value.length >= 8,
                    message: 'Password must be at least 8 characters'
                }
            ],
            ...options
        });
    },
    
    // Create number input
    createNumber(id, options = {}) {
        return new Input(id, {
            type: 'number',
            placeholder: 'Enter a number',
            validationRules: [
                {
                    test: (value) => !isNaN(parseFloat(value)),
                    message: 'Please enter a valid number'
                }
            ],
            ...options
        });
    },
    
    // Create search input
    createSearch(id, options = {}) {
        return new Input(id, {
            type: 'search',
            placeholder: 'Search...',
            ...options
        });
    },
    
    // Create textarea
    createTextarea(id, options = {}) {
        const textarea = new UINode(id, 'textarea');
        
        textarea.setStyles({
            display: 'block',
            width: '100%',
            padding: 'spacing.md',
            backgroundColor: 'color(background.primary)',
            color: 'color.text.primary',
            border: `1px solid ${this.disabled ? 'color(text.tertiary)' : 'color(text.secondary)'}`,
            borderRadius: 'radius.md',
            fontSize: 14,
            fontFamily: 'typography.fontFamily.primary',
            lineHeight: 'typography.lineHeight.normal',
            resize: 'vertical',
            minHeight: 80
        });
        
        // Add textarea-specific properties
        if (options.rows) {
            textarea.setStyle('minHeight', options.rows * 20 + 40); // Estimate line height
        }
        
        if (options.autoResize !== undefined) {
            textarea.setStyle('resize', options.autoResize ? 'vertical' : 'none');
        }
        
        return textarea;
    },
    
    // Create disabled input
    createDisabled(id, content, options = {}) {
        return new Input(id, {
            value: content,
            disabled: true,
            ...options
        });
    },
    
    // Create readonly input
    createReadonly(id, content, options = {}) {
        return new Input(id, {
            value: content,
            readonly: true,
            ...options
        });
    }
};
    
// Static factory method for widget registry
Input.create = function(container, options = {}) {
    const id = options.id || _newFormInputId();
    const input = new Input(id, options);
    if (container) {
        container.appendChild(input.element);
    }
    return input;
};

Input.getDefaultOptions = function() {
    return {
        value: '',
        placeholder: '',
        type: 'text',
        disabled: false,
        variant: 'default'
    };
};
