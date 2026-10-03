// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Slider - Range selection widget for Plauna
 * Provides slider functionality with multiple states and variants
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _sliderSequence = 0;

function _newSliderId() {
    return `slider-${Date.now()}-${++_sliderSequence}`;
}

export class Slider extends UINode {
    // Widget metadata
    static id = 'slider';
    static name = 'Slider';
    static category = 'form';
    static icon = '🎚️';
    static description = 'Range slider form control';
    static tags = ['form', 'input', 'slider', 'range', 'control'];
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
        const instance = new Slider(_newSliderId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSliderId(), options = {}) {
        super(id, 'slider');
        
        // Slider-specific properties
        this.value = options.value || 0;
        this.min = options.min || 0;
        this.max = options.max || 100;
        this.step = options.step || 1;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.orientation = options.orientation || 'horizontal'; // horizontal, vertical
        this.showValue = options.showValue !== false;
        this.showTicks = options.showTicks || false;
        this.showMarks = options.showMarks || false;
        this.label = options.label || '';
        this.description = options.description || '';
        this.name = options.name || '';
        this.error = options.error || '';
        
        // State management
        this.isFocused = false;
        this.isDragging = false;
        this.dragStartValue = 0;
        this.dragStartX = 0;
        this.dragStartY = 0;
        
        // Set accessibility
        this.role = 'slider';
        this.ariaDisabled = this.disabled;
        this.ariaRequired = this.required;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.description ? `${id}-description` : null;
        this.ariaValueMin = this.min.toString();
        this.ariaValueMax = this.max.toString();
        this.ariaValueNow = this.value.toString();
        this.ariaOrientation = this.orientation;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build slider structure
        this.buildSlider();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const orientationStyles = this.getOrientationStyles();
        
        this.setStyles({
            display: 'inline-flex',
            flexDirection: this.orientation === 'vertical' ? 'column' : 'row',
            alignItems: 'center',
            gap: tokens.get('spacing.md'),
            position: 'relative',
            outline: 'none',
            ...sizeStyles,
            ...variantStyles,
            ...orientationStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                width: this.orientation === 'vertical' ? '24px' : '120px',
                height: this.orientation === 'vertical' ? '120px' : '24px'
            },
            sm: {
                width: this.orientation === 'vertical' ? '32px' : '160px',
                height: this.orientation === 'vertical' ? '160px' : '32px'
            },
            md: {
                width: this.orientation === 'vertical' ? '40px' : '200px',
                height: this.orientation === 'vertical' ? '200px' : '40px'
            },
            lg: {
                width: this.orientation === 'vertical' ? '48px' : '240px',
                height: this.orientation === 'vertical' ? '240px' : '48px'
            },
            xl: {
                width: this.orientation === 'vertical' ? '56px' : '280px',
                height: this.orientation === 'vertical' ? '280px' : '56px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                color: tokens.get('colors.primary.500')
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
    
    getOrientationStyles() {
        const orientations = {
            horizontal: {
                width: '100%',
                height: 'auto'
            },
            vertical: {
                width: 'auto',
                height: '100%'
            }
        };
        return orientations[this.orientation] || orientations.horizontal;
    }
    
    setupEventHandlers() {
        if (!this.disabled) {
            this.addEventListener('mousedown', (e) => {
                this.startDrag(e);
            });
            
            this.addEventListener('touchstart', (e) => {
                this.startDrag(e.touches[0]);
            });
            
            this.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowLeft':
                    case 'ArrowDown':
                        e.preventDefault();
                        this.adjustValue(-this.step);
                        break;
                    case 'ArrowRight':
                    case 'ArrowUp':
                        e.preventDefault();
                        this.adjustValue(this.step);
                        break;
                    case 'Home':
                        e.preventDefault();
                        this.setValue(this.min);
                        break;
                    case 'End':
                        e.preventDefault();
                        this.setValue(this.max);
                        break;
                    case 'PageUp':
                        e.preventDefault();
                        this.adjustValue(this.step * 10);
                        break;
                    case 'PageDown':
                        e.preventDefault();
                        this.adjustValue(-this.step * 10);
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
        
        // Global mouse/touch events for dragging
        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.handleDrag(e);
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.endDrag();
            }
        });
        
        document.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                this.handleDrag(e.touches[0]);
            }
        });
        
        document.addEventListener('touchend', () => {
            if (this.isDragging) {
                this.endDrag();
            }
        });
    }
    
    buildSlider() {
        this.innerHTML = '';
        let valueDisplay = null;
        
        // Create slider container
        const container = new UINode(`${this.id}-container`, 'div');
        container.setStyles({
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: this.orientation === 'vertical' ? 'column' : 'row',
            alignItems: 'center'
        });
        
        // Create track
        const track = new UINode(`${this.id}-track`, 'div');
        track.setStyles({
            position: 'relative',
            width: this.orientation === 'vertical' ? '4px' : '100%',
            height: this.orientation === 'vertical' ? '100%' : '4px',
            backgroundColor: this.getTrackColor(),
            borderRadius: '2px',
            cursor: this.disabled ? 'not-allowed' : 'pointer'
        });
        
        // Create fill
        const fill = new UINode(`${this.id}-fill`, 'div');
        fill.setStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            width: this.orientation === 'vertical' ? '100%' : (this.getPercentage() + '%'),
            height: this.orientation === 'vertical' ? (this.getPercentage() + '%') : '100%',
            backgroundColor: this.getFillColor(),
            borderRadius: '2px',
            transition: this.isDragging ? 'none' : 'all 150ms ease'
        });
        
        // Create ticks if enabled
        if (this.showTicks) {
            this.createTicks(track);
        }
        
        // Create thumb
        const thumb = new UINode(`${this.id}-thumb`, 'div');
        thumb.setStyles({
            position: 'absolute',
            top: this.orientation === 'vertical' ? (this.getPercentage() + '%') : '50%',
            left: this.orientation === 'horizontal' ? (this.getPercentage() + '%') : '50%',
            transform: this.orientation === 'vertical' ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)',
            width: this.getThumbSize(),
            height: this.getThumbSize(),
            backgroundColor: this.getThumbColor(),
            border: '2px solid ' + tokens.get('colors.background.primary'),
            borderRadius: '50%',
            cursor: this.disabled ? 'not-allowed' : 'grab',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
            transition: this.isDragging ? 'none' : 'all 150ms ease'
        });
        
        // Create marks if enabled
        if (this.showMarks) {
            this.createMarks(container);
        }
        
        // Create value display if enabled
        if (this.showValue) {
            valueDisplay = new UINode(`${this.id}-value`, 'span');
            valueDisplay.textContent = this.value.toString();
            valueDisplay.setStyles({
                fontSize: tokens.get('fontSizes.sm'),
                fontWeight: tokens.get('fontWeights.medium'),
                color: tokens.get('colors.text.primary'),
                backgroundColor: tokens.get('colors.background.primary'),
                padding: '2px 6px',
                borderRadius: tokens.get('borderRadius.sm'),
                border: '1px solid ' + tokens.get('colors.border.medium'),
                marginLeft: this.orientation === 'horizontal' ? tokens.get('spacing.sm') : '0',
                marginTop: this.orientation === 'vertical' ? tokens.get('spacing.sm') : '0'
            });
            
            container.appendChild(valueDisplay);
        }
        
        // Assemble components
        track.appendChild(fill);
        track.appendChild(thumb);
        container.appendChild(track);
        this.appendChild(container);
        
        // Store references
        this.container = container;
        this.track = track;
        this.fill = fill;
        this.thumb = thumb;
        this.valueDisplay = valueDisplay;
    }
    
    getThumbSize() {
        const sizes = {
            xs: '12px',
            sm: '16px',
            md: '20px',
            lg: '24px',
            xl: '28px'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getTrackColor() {
        if (this.disabled) {
            return tokens.get('colors.border.disabled');
        }
        return tokens.get('colors.border.medium');
    }
    
    getFillColor() {
        if (this.disabled) {
            return tokens.get('colors.border.disabled');
        }
        
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
    
    getThumbColor() {
        if (this.disabled) {
            return tokens.get('colors.text.disabled');
        }
        
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
    
    getPercentage() {
        const range = this.max - this.min;
        if (range === 0) return 0;
        return ((this.value - this.min) / range) * 100;
    }
    
    createTicks(track) {
        const range = this.max - this.min;
        const safeStep = this.step > 0 ? this.step : 1;
        const tickCount = Math.max(2, Math.min(10, Math.floor(range / safeStep) + 1));
        const tickInterval = 100 / (tickCount - 1);
        
        for (let i = 0; i < tickCount; i++) {
            const tick = document.createElement('div');
            tick.style.cssText = (
                'position: absolute;' +
                (this.orientation === 'horizontal' ? 
                    'left: ' + (i * tickInterval) + '%; top: 50%; transform: translateY(-50%); width: 2px; height: 6px;' :
                    'top: ' + (i * tickInterval) + '%; left: 50%; transform: translateX(-50%) rotate(-90deg); width: 6px; height: 2px;'
                ) +
                'background: ' + tokens.get('colors.border.light') + ';' +
                'border-radius: 1px;'
            );
            track.element.appendChild(tick);
        }
    }
    
    createMarks(container) {
        const marks = [this.min, (this.min + this.max) / 2, this.max];
        
        marks.forEach((mark, index) => {
            const markElement = document.createElement('div');
            markElement.textContent = mark.toString();
            markElement.style.cssText = (
                'position: absolute;' +
                (this.orientation === 'horizontal' ? 
                    'bottom: -20px; left: ' + (index * 50) + '%; transform: translateX(-50%);' :
                    'left: -20px; top: ' + (index * 50) + '%; transform: translateY(-50%) rotate(-90deg);'
                ) +
                'font-size: 12px; color: ' + tokens.get('colors.text.secondary') + ';' +
                'background: ' + tokens.get('colors.background.primary') + ';' +
                'padding: 2px 4px; border-radius: 4px; border: 1px solid ' + tokens.get('colors.border.light') + ';'
            );
            container.element.appendChild(markElement);
        });
    }
    
    startDrag(e) {
        if (this.disabled) return;
        
        this.isDragging = true;
        this.dragStartValue = this.value;
        this.dragStartX = e.clientX || e.pageX;
        this.dragStartY = e.clientY || e.pageY;
        
        this.thumb.setStyle('cursor', 'grabbing');
        this.thumb.setStyle('transform', 'translate(-50%, -50%) scale(1.2)');
        
        this.setState(NODE_STATE.ACTIVE, true);
        this.markDirty(DIRTY.PAINT);
    }
    
    handleDrag(e) {
        if (!this.isDragging) return;
        
        const deltaX = (e.clientX || e.pageX) - this.dragStartX;
        const deltaY = (e.clientY || e.pageY) - this.dragStartY;
        
        const delta = this.orientation === 'horizontal' ? deltaX : deltaY;
        const trackSize = this.orientation === 'horizontal' ? 
            this.track.element.offsetWidth : 
            this.track.element.offsetHeight;
        
        const valueRange = this.max - this.min || 1;
        const percentage = Math.max(0, Math.min(1, (delta / Math.max(trackSize, 1)) + (this.dragStartValue - this.min) / valueRange));
        const newValue = this.min + (percentage * valueRange);
        
        this.setValue(this.snapToStep(newValue));
    }
    
    endDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        
        this.thumb.setStyle('cursor', 'grab');
        this.thumb.setStyle('transform', 'translate(-50%, -50%) scale(1)');
        
        this.setState(NODE_STATE.ACTIVE, false);
        this.markDirty(DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: { value: this.value }
        });
    }
    
    snapToStep(value) {
        const safeStep = this.step > 0 ? this.step : 1;
        return Math.round(value / safeStep) * safeStep;
    }
    
    adjustValue(delta) {
        const newValue = this.snapToStep(this.value + delta);
        this.setValue(Math.max(this.min, Math.min(this.max, newValue)));
        
        this.dispatchEvent({
            type: 'input',
            bubbles: true,
            detail: { value: this.value }
        });
    }
    
    updateVisualState() {
        const percentage = this.getPercentage();
        const trackShadow = this.isFocused || this.isDragging
            ? '0 0 0 3px rgba(59, 130, 246, 0.16), 0 12px 22px rgba(15, 23, 42, 0.12)'
            : 'none';
        const thumbScale = this.isFocused || this.isDragging ? 'translate(-50%, -50%) scale(1.12)' : 'translate(-50%, -50%) scale(1)';
        
        // Update fill
        if (this.fill) {
            if (this.orientation === 'horizontal') {
                this.fill.setStyle('width', percentage + '%');
            } else {
                this.fill.setStyle('height', percentage + '%');
            }
        }

        if (this.track) {
            this.track.setStyle('boxShadow', trackShadow);
        }
        
        // Update thumb position
        if (this.thumb) {
            if (this.orientation === 'horizontal') {
                this.thumb.setStyle('left', percentage + '%');
            } else {
                this.thumb.setStyle('top', percentage + '%');
            }
            this.thumb.setStyle('transform', thumbScale);
            this.thumb.setStyle('boxShadow', this.isDragging ? '0 6px 14px rgba(15, 23, 42, 0.24)' : '0 2px 4px rgba(0, 0, 0, 0.2)');
        }
        
        // Update value display
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.value.toString();
        }
        
        // Update ARIA
        this.ariaValueNow = this.value.toString();
    }
    
    // Public methods
    setValue(value) {
        if (this.value !== value) {
            this.value = Math.max(this.min, Math.min(this.max, value));
            this.updateVisualState();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setMin(min) {
        if (this.min !== min) {
            this.min = min;
            this.ariaValueMin = min.toString();
            
            // Adjust value if necessary
            if (this.value < min) {
                this.setValue(min);
            }
            
            this.buildSlider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setMax(max) {
        if (this.max !== max) {
            this.max = max;
            this.ariaValueMax = max.toString();
            
            // Adjust value if necessary
            if (this.value > max) {
                this.setValue(max);
            }
            
            this.buildSlider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setStep(step) {
        if (this.step !== step) {
            this.step = step;
            this.setValue(this.snapToStep(this.value));
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.ariaDisabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.buildSlider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;
            this.ariaRequired = required;
            this.markDirty(DIRTY.ACCESSIBILITY);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildSlider();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildSlider();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setOrientation(orientation) {
        if (this.orientation !== orientation) {
            this.orientation = orientation;
            this.ariaOrientation = orientation;
            this.setupStyles();
            this.buildSlider();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setShowValue(showValue) {
        if (this.showValue !== showValue) {
            this.showValue = showValue;
            this.buildSlider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowTicks(showTicks) {
        if (this.showTicks !== showTicks) {
            this.showTicks = showTicks;
            this.buildSlider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowMarks(showMarks) {
        if (this.showMarks !== showMarks) {
            this.showMarks = showMarks;
            this.buildSlider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setError(error) {
        if (this.error !== error) {
            this.error = error;
            this.buildSlider();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            this.markDirty(DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.ariaDescribedBy = description ? (this.id + '-description') : null;
            this.markDirty(DIRTY.ACCESSIBILITY);
        }
    }
    
    setName(name) {
        if (this.name !== name) {
            this.name = name;
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    // Static factory methods
    static createSlider(id, options = {}) {
        return new Slider(id, options);
    }
    
    static createPrimarySlider(id, options = {}) {
        return new Slider(id, { variant: 'primary', ...options });
    }
    
    static createSuccessSlider(id, options = {}) {
        return new Slider(id, { variant: 'success', ...options });
    }
    
    static createWarningSlider(id, options = {}) {
        return new Slider(id, { variant: 'warning', ...options });
    }
    
    static createErrorSlider(id, options = {}) {
        return new Slider(id, { variant: 'error', ...options });
    }
    
    static createSmallSlider(id, options = {}) {
        return new Slider(id, { size: 'sm', ...options });
    }
    
    static createLargeSlider(id, options = {}) {
        return new Slider(id, { size: 'lg', ...options });
    }
    
    static createXLargeSlider(id, options = {}) {
        return new Slider(id, { size: 'xl', ...options });
    }
    
    static createVerticalSlider(id, options = {}) {
        return new Slider(id, { orientation: 'vertical', ...options });
    }
    
    static createRangeSlider(id, min, max, options = {}) {
        return new Slider(id, { min, max, ...options });
    }
    
    static createVolumeSlider(id, options = {}) {
        return new Slider(id, { min: 0, max: 100, step: 1, variant: 'primary', ...options });
    }
    
    static createRatingSlider(id, options = {}) {
        return new Slider(id, { min: 1, max: 5, step: 1, showMarks: true, ...options });
    }
}
