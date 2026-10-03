// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Range - Range slider widget for Plauna
 * Provides range selection with various configurations
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _rangeSequence = 0;

function _newRangeId() {
    return `range-${Date.now()}-${++_rangeSequence}`;
}

export class Range extends UINode {
    // Widget metadata
    static id = 'range';
    static name = 'Range';
    static category = 'input';
    static icon = '📊';
    static description = 'Range slider input';
    static tags = ['input', 'range', 'slider'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Range(_newRangeId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newRangeId(), options = {}) {
        super(id, 'range');
        
        // Range-specific properties
        this.value = options.value || 0;
        this.min = options.min !== undefined ? options.min : 0;
        this.max = options.max !== undefined ? options.max : 100;
        this.step = options.step !== undefined ? options.step : 1;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        
        // UI properties
        this.label = options.label || '';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, vertical
        this.showValue = options.showValue !== false;
        this.showTicks = options.showTicks || false;
        this.showLabels = options.showLabels || false;
        
        // Visual properties
        this.color = options.color || tokens.get('colors.primary');
        this.trackColor = options.trackColor || tokens.get('colors.border.light');
        this.thumbColor = options.thumbColor || tokens.get('colors.primary');
        this.thumbSize = options.thumbSize || 'md'; // sm, md, lg
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onInput = options.onInput || (() => {});
        this.onFocus = options.onFocus || (() => {});
        this.onBlur = options.onBlur || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label || 'Range slider';
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        this.ariaValueText = options.ariaValueText || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create range input structure
        this.createRangeStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createRangeStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-range-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        this.container.setAttribute('data-orientation', this.variant === 'vertical' ? 'vertical' : 'horizontal');
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-range-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create range wrapper
        this.rangeWrapper = document.createElement('div');
        this.rangeWrapper.className = 'plauna-range-wrapper';
        this.rangeWrapper.style.cssText = this.getRangeWrapperStyles();
        
        // Create range input
        this.rangeInput = document.createElement('input');
        this.rangeInput.type = 'range';
        this.rangeInput.value = this.value;
        this.rangeInput.min = this.min;
        this.rangeInput.max = this.max;
        this.rangeInput.step = this.step;
        this.rangeInput.disabled = this.disabled;
        this.rangeInput.required = this.required;
        this.rangeInput.style.cssText = this.getRangeInputStyles();
        
        // Create custom track
        this.track = document.createElement('div');
        this.track.className = 'plauna-range-track';
        this.track.style.cssText = this.getTrackStyles();
        
        // Create progress fill
        this.progress = document.createElement('div');
        this.progress.className = 'plauna-range-progress';
        this.progress.style.cssText = this.getProgressStyles();
        this.updateProgress();
        
        // Create thumb
        this.thumb = document.createElement('div');
        this.thumb.className = 'plauna-range-thumb';
        this.thumb.style.cssText = this.getThumbStyles();
        this.updateThumbPosition();
        
        // Create value display
        if (this.showValue) {
            this.valueDisplay = document.createElement('div');
            this.valueDisplay.className = 'plauna-range-value';
            this.valueDisplay.style.cssText = this.getValueDisplayStyles();
            this.updateValueDisplay();
        }
        
        // Create ticks if enabled
        if (this.showTicks) {
            this.ticksContainer = document.createElement('div');
            this.ticksContainer.className = 'plauna-range-ticks';
            this.ticksContainer.style.cssText = this.getTicksContainerStyles();
            this.createTicks();
        }
        
        // Create labels if enabled
        if (this.showLabels) {
            this.labelsContainer = document.createElement('div');
            this.labelsContainer.className = 'plauna-range-labels';
            this.labelsContainer.style.cssText = this.getLabelsContainerStyles();
            this.createLabels();
        }
        
        // Assemble track
        this.track.appendChild(this.progress);
        this.track.appendChild(this.thumb);
        
        // Assemble range wrapper
        this.rangeWrapper.appendChild(this.rangeInput);
        this.rangeWrapper.appendChild(this.track);
        
        if (this.valueDisplay) {
            this.rangeWrapper.appendChild(this.valueDisplay);
        }
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-range-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.rangeWrapper);
        
        if (this.ticksContainer) {
            this.container.appendChild(this.ticksContainer);
        }
        
        if (this.labelsContainer) {
            this.container.appendChild(this.labelsContainer);
        }
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    createTicks() {
        const tickCount = Math.floor((this.max - this.min) / this.step) + 1;
        
        for (let i = 0; i < tickCount; i++) {
            const tickValue = this.min + (i * this.step);
            const tick = document.createElement('div');
            tick.className = 'plauna-range-tick';
            tick.style.cssText = this.getTickStyles();
            
            const position = ((tickValue - this.min) / (this.max - this.min)) * 100;
            
            if (this.variant === 'vertical') {
                tick.style.bottom = position + '%';
                tick.style.left = '50%';
                tick.style.transform = 'translateX(-50%)';
            } else {
                tick.style.left = position + '%';
                tick.style.top = '50%';
                tick.style.transform = 'translateY(-50%)';
            }
            
            this.ticksContainer.appendChild(tick);
        }
    }
    
    createLabels() {
        const labels = [this.min, this.max];
        
        labels.forEach((labelValue, index) => {
            const label = document.createElement('div');
            label.className = 'plauna-range-label-item';
            label.textContent = this.formatLabel(labelValue);
            label.style.cssText = this.getLabelItemStyles();
            
            const position = index === 0 ? 0 : 100;
            
            if (this.variant === 'vertical') {
                label.style.bottom = position + '%';
                label.style.left = '50%';
                label.style.transform = 'translateX(-50%)';
            } else {
                label.style.left = position + '%';
                label.style.top = '50%';
                label.style.transform = 'translateY(-50%)';
            }
            
            this.labelsContainer.appendChild(label);
        });
    }
    
    setupEventHandlers() {
        // Range input events
        this.rangeInput.addEventListener('input', (e) => {
            this.setValue(parseFloat(e.target.value));
            this.onInput(this.value);
        });
        
        this.rangeInput.addEventListener('change', (e) => {
            this.setValue(parseFloat(e.target.value));
            this.onChange(this.value);
        });
        
        this.rangeInput.addEventListener('focus', () => {
            this.onFocus();
            this.updateFocusStyles(true);
        });
        
        this.rangeInput.addEventListener('blur', () => {
            this.onBlur();
            this.updateFocusStyles(false);
        });
        
        // Mouse events for custom thumb dragging
        let isDragging = false;
        
        this.thumb.addEventListener('mousedown', (e) => {
            if (!this.disabled) {
                isDragging = true;
                e.preventDefault();
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
                this.updateFocusStyles(true);
            }
        });
        
        const handleMouseMove = (e) => {
            if (isDragging && !this.disabled) {
                const newValue = this.getValueFromPosition(e);
                this.setValue(newValue);
                this.onInput(this.value);
            }
        };
        
        const handleMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            this.updateFocusStyles(false);
            this.onChange(this.value);
        };
        
        // Track click to jump to position
        this.track.addEventListener('click', (e) => {
            if (!this.disabled && e.target !== this.thumb) {
                const newValue = this.getValueFromPosition(e);
                this.setValue(newValue);
                this.onChange(this.value);
            }
        });
        
        // Keyboard events
        this.rangeInput.addEventListener('keydown', (e) => {
            if (this.disabled) return;
            
            let newValue = this.value;
            
            switch (e.key) {
                case 'ArrowLeft':
                case 'ArrowDown':
                    newValue = Math.max(this.min, this.value - this.step);
                    break;
                case 'ArrowRight':
                case 'ArrowUp':
                    newValue = Math.min(this.max, this.value + this.step);
                    break;
                case 'Home':
                    newValue = this.min;
                    break;
                case 'End':
                    newValue = this.max;
                    break;
                default:
                    return;
            }
            
            e.preventDefault();
            this.setValue(newValue);
            this.onInput(this.value);
        });
    }
    
    setValue(value) {
        value = Math.max(this.min, Math.min(this.max, value));
        
        // Snap to step if needed
        if (this.step > 0) {
            const steps = Math.round((value - this.min) / this.step);
            value = this.min + (steps * this.step);
        }
        
        this.value = value;
        this.rangeInput.value = value;
        
        // Update visual elements
        this.updateProgress();
        this.updateThumbPosition();
        if (this.valueDisplay) {
            this.updateValueDisplay();
        }
        
        // Update accessibility
        this.updateAriaValueText();
        
        this.markDirty(DIRTY.VALUE);
    }
    
    getValueFromPosition(e) {
        const rect = this.track.getBoundingClientRect();
        let position;
        
        if (this.variant === 'vertical') {
            position = 1 - ((e.clientY - rect.top) / rect.height);
        } else {
            position = (e.clientX - rect.left) / rect.width;
        }
        
        position = Math.max(0, Math.min(1, position));
        return this.min + (position * (this.max - this.min));
    }
    
    updateProgress() {
        const percentage = ((this.value - this.min) / (this.max - this.min)) * 100;
        
        if (this.variant === 'vertical') {
            this.progress.style.height = percentage + '%';
            this.progress.style.bottom = '0';
            this.progress.style.top = 'auto';
        } else {
            this.progress.style.width = percentage + '%';
            this.progress.style.left = '0';
            this.progress.style.right = 'auto';
        }
    }
    
    updateThumbPosition() {
        const percentage = ((this.value - this.min) / (this.max - this.min)) * 100;
        
        if (this.variant === 'vertical') {
            this.thumb.style.bottom = percentage + '%';
            this.thumb.style.left = '50%';
            this.thumb.style.top = 'auto';
            this.thumb.style.transform = 'translateX(-50%)';
        } else {
            this.thumb.style.left = percentage + '%';
            this.thumb.style.top = '50%';
            this.thumb.style.bottom = 'auto';
            this.thumb.style.transform = 'translateY(-50%)';
        }
    }
    
    updateValueDisplay() {
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.formatValue(this.value);
        }
    }
    
    updateFocusStyles(focused) {
        if (focused) {
            this.thumb.style.boxShadow = `0 0 0 3px ${this.color}33`;
            this.thumb.style.borderColor = this.color;
        } else {
            this.thumb.style.boxShadow = 'none';
            this.thumb.style.borderColor = this.thumbColor;
        }
    }
    
    updateAriaValueText() {
        const valueText = this.ariaValueText || `${this.value} of ${this.max}`;
        this.rangeInput.setAttribute('aria-valuetext', valueText);
    }
    
    formatValue(value) {
        if (typeof value !== 'number') {
            return value.toString();
        }
        return value.toFixed(2);
    }
    
    formatLabel(value) {
        return this.formatValue(value);
    }
    
    setupStyles() {
        this.setStyles({
            display: 'block',
            width: '100%'
        });
    }
    
    getContainerStyles() {
        const orientation = this.variant === 'vertical' ? 'flex-direction: row;' : 'flex-direction: column;';
        return (
            'display: flex;' +
            orientation +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'width: 100%;' +
            'position: relative;'
        );
    }
    
    getLabelStyles() {
        return (
            'font-size: 13px;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: var(--text-primary, #0f172a);' +
            'margin-bottom: 6px;' +
            'cursor: pointer;'
        );
    }
    
    getRangeWrapperStyles() {
        const orientation = this.variant === 'vertical' ? 'flex-direction: row;' : 'flex-direction: column;';
        const size = this.getSizeStyles();
        return (
            'display: flex;' +
            orientation +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'position: relative;' +
            size
        );
    }
    
    getRangeInputStyles() {
        return (
            'position: absolute;' +
            'opacity: 0;' +
            'width: 100%;' +
            'height: 100%;' +
            'cursor: pointer;' +
            'z-index: 1;'
        );
    }
    
    getTrackStyles() {
        const orientation = this.variant === 'vertical' 
            ? 'width: 4px; height: 200px;'
            : 'height: 6px; width: 100%;';
        
        return (
            'position: relative;' +
            'background: linear-gradient(180deg, rgba(148, 163, 184, 0.22), rgba(15, 23, 42, 0.08));' +
            'border: 1px solid rgba(148, 163, 184, 0.18);' +
            'border-radius: 999px;' +
            'cursor: pointer;' +
            'box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08);' +
            orientation
        );
    }
    
    getProgressStyles() {
        const orientation = this.variant === 'vertical'
            ? 'width: 100%; bottom: 0;'
            : 'height: 100%; left: 0;';
        
        return (
            'position: absolute;' +
            'background: linear-gradient(90deg, rgba(59, 130, 246, 0.96), rgba(37, 99, 235, 0.92));' +
            'border-radius: inherit;' +
            orientation
        );
    }
    
    getThumbStyles() {
        const size = this.getThumbSizeStyles();
        const orientation = this.variant === 'vertical'
            ? 'left: 50%; transform: translateX(-50%);'
            : 'top: 50%; transform: translateY(-50%);';
        
        return (
            'position: absolute;' +
            'background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(226, 232, 240, 0.95));' +
            'border: 2px solid rgba(59, 130, 246, 0.82);' +
            'border-radius: 50%;' +
            'cursor: grab;' +
            'transition: all 150ms ease;' +
            'z-index: 2;' +
            'box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);' +
            size +
            orientation
        );
    }
    
    getThumbSizeStyles() {
        const sizes = {
            sm: 'width: 12px; height: 12px;',
            md: 'width: 16px; height: 16px;',
            lg: 'width: 20px; height: 20px;'
        };
        return sizes[this.thumbSize] || sizes.md;
    }
    
    getValueDisplayStyles() {
        return (
            'position: absolute;' +
            'top: -24px;' +
            'left: 50%;' +
            'transform: translateX(-50%);' +
            'background: rgba(15, 23, 42, 0.88);' +
            'color: #fff;' +
            'padding: 4px 8px;' +
            'border-radius: 999px;' +
            'font-size: 11px;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'white-space: nowrap;' +
            'z-index: 3;' +
            'box-shadow: 0 10px 24px rgba(2, 6, 23, 0.22);'
        );
    }
    
    getTicksContainerStyles() {
        const orientation = this.variant === 'vertical' 
            ? 'flex-direction: column; width: 20px;'
            : 'flex-direction: row; height: 20px;';
        
        return (
            'position: relative;' +
            'display: flex;' +
            'justify-content: space-between;' +
            orientation
        );
    }
    
    getTickStyles() {
        const orientation = this.variant === 'vertical'
            ? 'width: 1px; height: 4px;'
            : 'height: 1px; width: 4px;';
        
        return (
            'position: absolute;' +
            'background: rgba(148, 163, 184, 0.55);' +
            orientation
        );
    }
    
    getLabelsContainerStyles() {
        const orientation = this.variant === 'vertical' 
            ? 'flex-direction: column; width: 30px;'
            : 'flex-direction: row; height: 20px;';
        
        return (
            'position: relative;' +
            'display: flex;' +
            'justify-content: space-between;' +
            orientation
        );
    }
    
    getLabelItemStyles() {
        return (
            'position: absolute;' +
            'font-size: 11px;' +
            'color: var(--text-secondary, #475569);' +
            'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
            'white-space: nowrap;'
        );
    }
    
    getSizeStyles() {
        const sizes = {
            sm: 'min-height: 120px;',
            md: 'min-height: 200px;',
            lg: 'min-height: 280px;'
        };
        
        if (this.variant === 'vertical') {
            const verticalSizes = {
                sm: 'min-width: 120px;',
                md: 'min-width: 200px;',
                lg: 'min-width: 280px;'
            };
            return verticalSizes[this.size] || verticalSizes.md;
        }
        
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
        this.rangeInput.min = min;
        this.setValue(this.value); // Re-validate current value
        this.markDirty(DIRTY.PROPS);
    }
    
    setMax(max) {
        this.max = max;
        this.rangeInput.max = max;
        this.setValue(this.value); // Re-validate current value
        this.markDirty(DIRTY.PROPS);
    }
    
    setStep(step) {
        this.step = step;
        this.rangeInput.step = step;
        this.setValue(this.value); // Re-validate current value
        this.markDirty(DIRTY.PROPS);
    }
    
    setColor(color) {
        this.color = color;
        this.progress.style.background = color;
        this.markDirty(DIRTY.STYLE);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.rangeInput) {
            this.rangeInput.disabled = disabled;
        }
        this.thumb.style.cursor = disabled ? 'not-allowed' : 'grab';
        this.track.style.cursor = disabled ? 'not-allowed' : 'pointer';
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getValue() {
        return this.value;
    }
    
    getPercentage() {
        return ((this.value - this.min) / (this.max - this.min)) * 100;
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newRangeId();
        const range = new Range(id, options);
        if (container) {
            container.appendChild(range.element);
        }
        return range;
    }
    
    static getDefaultOptions() {
        return {
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            disabled: false
        };
    }
    
    static createVolumeSlider(id, options = {}) {
        return new Range(id, {
            min: 0,
            max: 100,
            step: 1,
            showValue: true,
            ...options
        });
    }
    
    static createProgressSlider(id, options = {}) {
        return new Range(id, {
            min: 0,
            max: 100,
            step: 1,
            showValue: true,
            showTicks: true,
            ...options
        });
    }
    
    static createRatingSlider(id, options = {}) {
        return new Range(id, {
            min: 1,
            max: 5,
            step: 1,
            showValue: false,
            showTicks: true,
            ...options
        });
    }
    
    static createVerticalSlider(id, options = {}) {
        return new Range(id, {
            variant: 'vertical',
            ...options
        });
    }
    
    static createCompactSlider(id, options = {}) {
        return new Range(id, {
            variant: 'compact',
            showValue: false,
            ...options
        });
    }
    
    // Focus methods
    focus() {
        if (this.rangeInput) {
            this.rangeInput.focus();
        }
    }
    
    blur() {
        if (this.rangeInput) {
            this.rangeInput.blur();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.rangeInput) {
            this.rangeInput.removeEventListener('input', this.onInput);
            this.rangeInput.removeEventListener('change', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
