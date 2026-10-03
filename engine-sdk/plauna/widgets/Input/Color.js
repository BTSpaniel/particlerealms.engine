// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Color - Color picker widget for Plauna
 * Provides color selection with various input formats
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { byteRgbToHex, hexToRgb as mathHexToRgb } from '../../../engine/core/math/MathColor.js';

let _colorSequence = 0;

function _newColorId() {
    return `color-${Date.now()}-${++_colorSequence}`;
}

export class Color extends UINode {
    // Widget metadata
    static id = 'color';
    static name = 'Color';
    static category = 'input';
    static icon = '🎨';
    static description = 'Color picker input';
    static tags = ['input', 'color', 'picker'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            value: '#000000',
            format: 'hex',
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Color(_newColorId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newColorId(), options = {}) {
        super(id, 'color');
        
        // Color-specific properties
        this.value = options.value || '#000000';
        this.format = options.format || 'hex'; // hex, rgb, hsl, hsv
        this.alpha = options.alpha !== false; // include alpha channel
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        
        // UI properties
        this.label = options.label || 'Color';
        this.placeholder = options.placeholder || 'Select color';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, swatch
        
        // Preset colors
        this.presets = options.presets || [
            '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
            '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff'
        ];
        this.showPresets = options.showPresets !== false;
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onFocus = options.onFocus || (() => {});
        this.onBlur = options.onBlur || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label;
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create color input structure
        this.createColorStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createColorStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-color-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-color-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create color input wrapper
        this.inputWrapper = document.createElement('div');
        this.inputWrapper.className = 'plauna-color-input-wrapper';
        this.inputWrapper.style.cssText = this.getInputWrapperStyles();
        
        // Create hidden color input
        this.colorInput = document.createElement('input');
        this.colorInput.type = 'color';
        this.colorInput.value = this.value;
        this.colorInput.disabled = this.disabled;
        this.colorInput.required = this.required;
        this.colorInput.style.cssText = 'display: none;';
        
        // Create color display
        this.colorDisplay = document.createElement('div');
        this.colorDisplay.className = 'plauna-color-display';
        this.colorDisplay.style.cssText = this.getColorDisplayStyles();
        
        // Create text input
        this.textInput = document.createElement('input');
        this.textInput.type = 'text';
        this.textInput.value = this.formatValue(this.value);
        this.textInput.placeholder = this.placeholder;
        this.textInput.disabled = this.disabled;
        this.textInput.setAttribute('aria-label', 'Color value');
        this.textInput.style.cssText = this.getTextInputStyles();

        this.valueMeta = document.createElement('div');
        this.valueMeta.className = 'plauna-color-meta';
        this.valueMeta.style.cssText = this.getValueMetaStyles();

        this.valueCaption = document.createElement('div');
        this.valueCaption.className = 'plauna-color-caption';
        this.valueCaption.style.cssText = this.getValueCaptionStyles();
        this.valueCaption.textContent = this.formatValue(this.value);

        this.valueMeta.appendChild(this.valueCaption);
        this.valueMeta.appendChild(this.textInput);
        
        // Create color swatch button
        this.swatchButton = document.createElement('button');
        this.swatchButton.type = 'button';
        this.swatchButton.className = 'plauna-color-swatch';
        this.swatchButton.style.cssText = this.getSwatchButtonStyles();
        this.swatchButton.appendChild(this.colorDisplay);
        this.updateColorDisplay();

        // Assemble input wrapper
        this.inputWrapper.appendChild(this.swatchButton);
        this.inputWrapper.appendChild(this.valueMeta);
        
        // Create preset colors if enabled
        if (this.showPresets) {
            this.presetContainer = document.createElement('div');
            this.presetContainer.className = 'plauna-color-presets';
            this.presetContainer.style.cssText = this.getPresetContainerStyles();
            this.createPresetColors();
        }
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-color-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.colorInput);
        this.container.appendChild(this.inputWrapper);
        
        if (this.presetContainer) {
            this.container.appendChild(this.presetContainer);
        }
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    createPresetColors() {
        this.presets.forEach(color => {
            const presetButton = document.createElement('button');
            presetButton.type = 'button';
            presetButton.style.cssText = (
                'width: 24px;' +
                'height: 24px;' +
                'border: 2px solid ' + tokens.get('colors.border.medium') + ';' +
                'border-radius: 4px;' +
                'background: ' + color + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;' +
                'margin-right: 4px;'
            );
            presetButton.style.setProperty('--preset-color', color);
            
            presetButton.addEventListener('click', () => {
                this.setValue(color);
            });
            
            presetButton.addEventListener('mouseenter', () => {
                presetButton.style.transform = 'scale(1.1)';
                presetButton.style.borderColor = tokens.get('colors.primary');
            });
            
            presetButton.addEventListener('mouseleave', () => {
                presetButton.style.transform = 'scale(1)';
                presetButton.style.borderColor = tokens.get('colors.border.medium');
            });
            
            this.presetContainer.appendChild(presetButton);
        });
    }
    
    setupEventHandlers() {
        // Color input change
        this.colorInput.addEventListener('input', (e) => {
            this.setValue(e.target.value);
        });
        
        // Text input change
        this.textInput.addEventListener('input', (e) => {
            const value = e.target.value;
            if (this.isValidColor(value)) {
                this.setValue(value);
            }
        });
        
        // Text input blur
        this.textInput.addEventListener('blur', () => {
            const value = this.textInput.value;
            if (!this.isValidColor(value)) {
                this.textInput.value = this.formatValue(this.value);
            }
            this.onBlur();
        });
        
        // Swatch button click
        this.swatchButton.addEventListener('click', () => {
            this.colorInput.click();
        });
        
        // Focus/blur events
        this.textInput.addEventListener('focus', () => {
            this.onFocus();
        });
        
        // Keyboard events
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const value = this.textInput.value;
                if (this.isValidColor(value)) {
                    this.setValue(value);
                }
            }
        });
    }
    
    setValue(value) {
        if (this.isValidColor(value)) {
            this.value = value;
            this.colorInput.value = value;
            this.textInput.value = this.formatValue(value);
            this.updateColorDisplay();
            this.onChange(value);
            this.markDirty(DIRTY.VALUE);
        }
    }
    
    updateColorDisplay() {
        this.colorDisplay.style.background = this.value;
        this.colorDisplay.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, 0.45), 0 0 0 1px ${this.value}`;
        if (this.swatchButton) {
            this.swatchButton.style.setProperty('--swatch-color', this.value);
            this.swatchButton.style.background = this.value;
            this.swatchButton.style.borderColor = this.value;
        }
        if (this.valueCaption) {
            this.valueCaption.textContent = this.formatValue(this.value);
        }
        if (this.swatchButton) {
            this.swatchButton.setAttribute('aria-label', `Selected color ${this.value}`);
        }
    }
    
    isValidColor(value) {
        // Create a temporary element to test color validity
        const tempElement = document.createElement('div');
        tempElement.style.color = value;
        return tempElement.style.color !== '';
    }
    
    formatValue(value) {
        if (!this.isValidColor(value)) {
            return value;
        }
        
        switch (this.format) {
            case 'hex':
                return this.toHex(value);
            case 'rgb':
                return this.toRgb(value);
            case 'hsl':
                return this.toHsl(value);
            case 'hsv':
                return this.toHsv(value);
            default:
                return value;
        }
    }
    
    toHex(color) {
        const rgb = this.parseRgb(color);
        if (!rgb) return color;
        if (
            rgb.r >= 0 && rgb.r <= 255 &&
            rgb.g >= 0 && rgb.g <= 255 &&
            rgb.b >= 0 && rgb.b <= 255
        ) {
            return byteRgbToHex(rgb.r, rgb.g, rgb.b);
        }

        const toHex = (n) => {
            const hex = n.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        
        return '#' + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
    }
    
    toRgb(color) {
        const rgb = this.parseRgb(color);
        if (!rgb) return color;
        
        return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    }
    
    toHsl(color) {
        const rgb = this.parseRgb(color);
        if (!rgb) return color;
        
        const r = rgb.r / 255;
        const g = rgb.g / 255;
        const b = rgb.b / 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        
        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        
        return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    }
    
    toHsv(color) {
        const rgb = this.parseRgb(color);
        if (!rgb) return color;
        
        const r = rgb.r / 255;
        const g = rgb.g / 255;
        const b = rgb.b / 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        
        let h, s = max === 0 ? 0 : d / max;
        const v = max;
        
        if (max === min) {
            h = 0;
        } else {
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        
        return `hsv(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(v * 100)}%)`;
    }
    
    parseRgb(color) {
        // Handle hex colors
        const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
        if (hexMatch) {
            const [r, g, b] = mathHexToRgb(color);
            return {
                r: Math.round(r * 255),
                g: Math.round(g * 255),
                b: Math.round(b * 255)
            };
        }
        
        // Handle rgb colors
        const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1], 10),
                g: parseInt(rgbMatch[2], 10),
                b: parseInt(rgbMatch[3], 10)
            };
        }
        
        return null;
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
            'align-items: stretch;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'width: 100%;'
        );
    }
    
    getColorDisplayStyles() {
        return (
            'width: 100%;' +
            'height: 100%;' +
            'min-width: 36px;' +
            'min-height: 36px;' +
            'border: 2px solid rgba(255, 255, 255, 0.18);' +
            'border-radius: 12px;' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
    }
    
    getSwatchButtonStyles() {
        return (
            'background: var(--swatch-color, transparent);' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'padding: 8px;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'border-radius: 18px;' +
            'min-width: 96px;' +
            'min-height: 56px;' +
            'flex-shrink: 0;'
        );
    }
    
    getTextInputStyles() {
        const sizeStyles = this.getSizeStyles();
        return (
            'flex: 1;' +
            'min-width: 0;' +
            'border: 1px solid rgba(148, 163, 184, 0.18);' +
            'border-radius: 14px;' +
            'background: rgba(15, 23, 42, 0.03);' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'font-size: 13px;' +
            'font-family: monospace;' +
            'outline: none;' +
            'transition: all 160ms ease;' +
            'box-sizing: border-box;' +
            sizeStyles
        );
    }

    getValueMetaStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: 6px;' +
            'flex: 1;' +
            'min-width: 0;'
        );
    }

    getValueCaptionStyles() {
        return (
            'font-size: 11px;' +
            'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
            'line-height: 1;' +
            'letter-spacing: 0.08em;' +
            'text-transform: uppercase;' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
    }
    
    getSizeStyles() {
        const sizes = {
            sm: 'padding: 4px 8px;',
            md: 'padding: 6px 12px;',
            lg: 'padding: 8px 16px;'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPresetContainerStyles() {
        return (
            'display: flex;' +
            'flex-wrap: wrap;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'margin-top: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';'
        );
    }
    
    getHelperStyles() {
        return (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
    }
    
    // Setter methods
    setFormat(format) {
        this.format = format;
        this.textInput.value = this.formatValue(this.value);
        this.markDirty(DIRTY.PROPS);
    }
    
    setPresets(presets) {
        this.presets = presets;
        if (this.presetContainer) {
            this.presetContainer.innerHTML = '';
            this.createPresetColors();
        }
        this.markDirty(DIRTY.PROPS | DIRTY.CHILDREN);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.colorInput) {
            this.colorInput.disabled = disabled;
        }
        if (this.textInput) {
            this.textInput.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getValue() {
        return this.value;
    }
    
    getHexValue() {
        return this.toHex(this.value);
    }
    
    getRgbValue() {
        return this.toRgb(this.value);
    }
    
    getHslValue() {
        return this.toHsl(this.value);
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newColorId();
        const color = new Color(id, options);
        return color;
    }
    
    static getDefaultOptions() {
        return {
            value: '#000000',
            format: 'hex',
            alpha: true,
            disabled: false
        };
    }
    
    static createHexColorPicker(id, options = {}) {
        return new Color(id, {
            format: 'hex',
            ...options
        });
    }
    
    static createRgbColorPicker(id, options = {}) {
        return new Color(id, {
            format: 'rgb',
            ...options
        });
    }
    
    static createHslColorPicker(id, options = {}) {
        return new Color(id, {
            format: 'hsl',
            ...options
        });
    }
    
    static createCompactColorPicker(id, options = {}) {
        return new Color(id, {
            variant: 'compact',
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
        if (this.colorInput) {
            this.colorInput.removeEventListener('input', this.onChange);
        }
        if (this.textInput) {
            this.textInput.removeEventListener('input', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
