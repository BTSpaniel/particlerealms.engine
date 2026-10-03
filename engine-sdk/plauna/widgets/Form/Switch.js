// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Switch - Binary on/off form control widget for Plauna
 * Provides toggle functionality with multiple states and variants
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _switchSequence = 0;

function _newSwitchId() {
    return `switch-${Date.now()}-${++_switchSequence}`;
}

export class Switch extends UINode {
    // Widget metadata
    static id = 'switch';
    static name = 'Switch';
    static category = 'form';
    static icon = '🔀';
    static description = 'Toggle switch form control';
    static tags = ['form', 'input', 'switch', 'toggle', 'control'];
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
        const instance = new Switch(_newSwitchId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSwitchId(), options = {}) {
        super(id, 'switch');
        
        // Switch-specific properties
        this.checked = options.checked || false;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.variant = options.variant || 'default'; // default, primary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.label = options.label || '';
        this.description = options.description || '';
        this.value = options.value || 'on';
        this.name = options.name || '';
        
        // State management
        this.isFocused = false;
        
        // Set accessibility
        this.role = 'switch';
        this.ariaChecked = this.checked;
        this.ariaDisabled = this.disabled;
        this.ariaRequired = this.required;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.description ? `${id}-description` : null;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build switch structure
        this.buildSwitch();
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
            transition: 'transform 150ms ease, filter 150ms ease, opacity 150ms ease',
            padding: '2px 0',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                width: '32px',
                height: '16px',
                fontSize: tokens.get('fontSizes.xs')
            },
            sm: {
                width: '40px',
                height: '20px',
                fontSize: tokens.get('fontSizes.sm')
            },
            md: {
                width: '48px',
                height: '24px',
                fontSize: tokens.get('fontSizes.md')
            },
            lg: {
                width: '56px',
                height: '28px',
                fontSize: tokens.get('fontSizes.lg')
            },
            xl: {
                width: '64px',
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
    
    buildSwitch() {
        while (this.firstChild) {
            this.removeChild(this.firstChild);
        }
        if (this.element) {
            this.element.innerHTML = '';
        }
        
        // Create switch track
        const switchInput = new UINode(`${this.id}-input`, 'div');
        switchInput.userData.role = 'presentation';
        switchInput.userData.name = this.name;
        switchInput.userData.value = this.value;
        switchInput.userData.checked = this.checked;
        switchInput.userData.disabled = this.disabled;
        switchInput.userData.required = this.required;
        switchInput.userData.id = `${this.id}-input`;
        
        // Switch input styles
        switchInput.setStyles({
            appearance: 'none',
            width: '100%',
            height: '100%',
            margin: '0',
            padding: '0',
            backgroundColor: this.getTrackColor(),
            borderRadius: this.getBorderRadius(),
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            transition: 'all 150ms ease',
            position: 'relative',
            display: 'block'
        });
        
        // Create switch thumb
        const switchThumb = new UINode(`${this.id}-thumb`, 'span');
        switchThumb.setStyles({
            position: 'absolute',
            top: '50%',
            left: this.checked ? `calc(100% - ${this.getThumbSize()})` : '0',
            transform: 'translate(0, -50%)',
            width: this.getThumbSize(),
            height: this.getThumbSize(),
            backgroundColor: this.getThumbColor(),
            borderRadius: '50%',
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            transition: 'all 150ms ease',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
        });
        
        switchInput.appendChild(switchThumb);
        this.appendChild(switchInput);
        
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
    
    getTrackColor() {
        if (this.disabled) {
            return 'rgba(148, 163, 184, 0.18)';
        }
        
        if (this.checked) {
            const variantColors = {
                default: 'rgba(59, 130, 246, 0.78)',
                primary: 'rgba(59, 130, 246, 0.82)',
                success: 'rgba(16, 185, 129, 0.82)',
                warning: 'rgba(245, 158, 11, 0.82)',
                error: 'rgba(239, 68, 68, 0.82)'
            };
            return variantColors[this.variant] || variantColors.default;
        }
        
        return 'rgba(148, 163, 184, 0.22)';
    }
    
    getBorderRadius() {
        const sizes = {
            xs: '8px',
            sm: '10px',
            md: '12px',
            lg: '14px',
            xl: '16px'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getThumbSize() {
        const sizes = {
            xs: '12px',
            sm: '14px',
            md: '16px',
            lg: '18px',
            xl: '20px'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getThumbColor() {
        if (this.disabled) {
            return 'rgba(255, 255, 255, 0.72)';
        }
        
        if (this.checked) {
            const variantColors = {
                default: 'rgba(255, 255, 255, 0.96)',
                primary: 'rgba(255, 255, 255, 0.96)',
                success: 'rgba(255, 255, 255, 0.96)',
                warning: 'rgba(255, 255, 255, 0.96)',
                error: 'rgba(255, 255, 255, 0.96)'
            };
            return variantColors[this.variant] || variantColors.default;
        }
        
        return 'rgba(255, 255, 255, 0.88)';
    }
    
    updateVisualState() {
        const switchInput = this.querySelector(`#${this.id}-input`);
        const switchThumb = this.querySelector(`#${this.id}-thumb`);
        const trackBg = this.getTrackColor();
        const trackShadow = this.checked
            ? 'inset 0 1px 1px rgba(255, 255, 255, 0.14), 0 10px 20px rgba(15, 23, 42, 0.18)'
            : 'inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 6px 16px rgba(15, 23, 42, 0.08)';
        const thumbLeft = this.checked ? `calc(100% - ${this.getThumbSize()})` : '0';
        const thumbShadow = this.checked
            ? '0 4px 10px rgba(15, 23, 42, 0.20)'
            : '0 3px 8px rgba(15, 23, 42, 0.18)';
        const focusShadow = this.isFocused
            ? '0 0 0 3px rgba(59, 130, 246, 0.16), 0 10px 22px rgba(15, 23, 42, 0.12)'
            : trackShadow;
        const thumbScale = this.isFocused || this.checked ? 'translate(0, -50%) scale(1.06)' : 'translate(0, -50%) scale(1)';
        
        if (switchInput) {
            if (switchInput.element) {
                switchInput.element.style.backgroundColor = trackBg;
                switchInput.element.style.boxShadow = focusShadow;
                switchInput.element.style.transform = this.isFocused ? 'translateY(-1px)' : 'translateY(0)';
            }
            switchInput.setStyle('backgroundColor', trackBg);
            switchInput.setStyle('boxShadow', focusShadow);
            switchInput.setStyle('transform', this.isFocused ? 'translateY(-1px)' : 'translateY(0)');
        }
        
        if (switchThumb) {
            if (switchThumb.element) {
                switchThumb.element.style.left = thumbLeft;
                switchThumb.element.style.transform = thumbScale;
                switchThumb.element.style.backgroundColor = this.getThumbColor();
                switchThumb.element.style.boxShadow = thumbShadow;
            }
            switchThumb.setStyle('left', thumbLeft);
            switchThumb.setStyle('transform', thumbScale);
            switchThumb.setStyle('backgroundColor', this.getThumbColor());
            switchThumb.setStyle('boxShadow', thumbShadow);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Public methods
    toggle() {
        if (this.disabled) return;
        
        this.setChecked(!this.checked);
        
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: {
                checked: this.checked,
                value: this.value
            }
        });
    }
    
    setChecked(checked) {
        if (this.checked !== checked) {
            this.checked = checked;
            this.ariaChecked = checked;
            const switchInput = this.querySelector(`#${this.id}-input`);
            if (switchInput) {
                switchInput.userData.checked = checked;
                if (switchInput.element) {
                    switchInput.element.dataset.checked = String(checked);
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
            this.buildSwitch();
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
            this.buildSwitch();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            this.buildSwitch();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.ariaDescribedBy = description ? `${this.id}-description` : null;
            this.buildSwitch();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            const switchInput = this.querySelector(`#${this.id}-input`);
            if (switchInput) {
                switchInput.userData.value = value;
                if (switchInput.element) {
                    switchInput.element.dataset.value = String(value);
                }
            }
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setName(name) {
        if (this.name !== name) {
            this.name = name;
            const switchInput = this.querySelector(`#${this.id}-input`);
            if (switchInput) {
                switchInput.userData.name = name;
                if (switchInput.element) {
                    switchInput.element.dataset.name = String(name);
                }
            }
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;
            this.ariaRequired = required;
            const switchInput = this.querySelector(`#${this.id}-input`);
            if (switchInput) {
                switchInput.userData.required = required;
                if (switchInput.element) {
                    switchInput.element.dataset.required = String(required);
                }
            }
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newSwitchId();
        const switchWidget = new Switch(id, options);
        if (container) {
            container.appendChild(switchWidget.element);
        }
        return switchWidget;
    }
    
    static getDefaultOptions() {
        return {
            checked: false,
            disabled: false,
            variant: 'default',
            size: 'md'
        };
    }
    
    static createSwitch(id, options = {}) {
        return new Switch(id, options);
    }
    
    static createPrimarySwitch(id, options = {}) {
        return new Switch(id, { variant: 'primary', ...options });
    }
    
    static createSuccessSwitch(id, options = {}) {
        return new Switch(id, { variant: 'success', ...options });
    }
    
    static createWarningSwitch(id, options = {}) {
        return new Switch(id, { variant: 'warning', ...options });
    }
    
    static createErrorSwitch(id, options = {}) {
        return new Switch(id, { variant: 'error', ...options });
    }
    
    static createSmallSwitch(id, options = {}) {
        return new Switch(id, { size: 'sm', ...options });
    }
    
    static createLargeSwitch(id, options = {}) {
        return new Switch(id, { size: 'lg', ...options });
    }
    
    static createXLargeSwitch(id, options = {}) {
        return new Switch(id, { size: 'xl', ...options });
    }
    
    // Group utility methods
    static createSwitchGroup(id, switches, options = {}) {
        const container = new UINode(`${id}-group`, 'div');
        container.setStyles({
            display: 'flex',
            flexDirection: options.orientation === 'horizontal' ? 'row' : 'column',
            gap: tokens.get('spacing.md'),
            alignItems: options.align || 'flex-start'
        });
        
        // Create switch buttons
        switches.forEach((switchConfig, index) => {
            const switchComponent = new Switch(`${id}-switch-${index}`, {
                name: options.name || 'switch-group',
                ...switchConfig
            });
            container.appendChild(switchComponent);
        });
        
        return container;
    }
}
