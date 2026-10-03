// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Progress - Task completion indicator widget for Plauna
 * Provides linear and circular progress indicators with multiple states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { lerp } from '../../../engine/core/math/MathScalar.js';

let _progressSequence = 0;

function _newProgressId() {
    return `progress-${Date.now()}-${++_progressSequence}`;
}

export class Progress extends UINode {
    // Widget metadata
    static id = 'progress';
    static name = 'Progress';
    static category = 'primitive';
    static icon = '📊';
    static description = 'Progress indicator';
    static tags = ['primitive', 'progress'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            value: 0,
            max: 100,
            variant: 'default',
            type: 'linear'
        };
    }

    static stories() {
        return {
            'Empty':     { value: 0,   max: 100, size: 'lg', showPercentage: false },
            'Quarter':   { value: 25,  max: 100, size: 'lg', showPercentage: false },
            'Half':      { value: 50,  max: 100, size: 'lg', showPercentage: false },
            'Full':      { value: 100, max: 100, size: 'lg', showPercentage: false },
            'Success':   { value: 75,  max: 100, variant: 'success', size: 'lg', showPercentage: false },
            'Warning':   { value: 40,  max: 100, variant: 'warning', size: 'lg', showPercentage: false },
        };
    }
    
    static create(container, options = {}) {
        const instance = new Progress(_newProgressId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newProgressId(), options = {}) {
        super(id, 'progress');
        
        // Progress-specific properties
        this.value = options.value || 0;
        this.max = options.max || 100;
        this.type = options.type || 'linear'; // linear, circular
        this.variant = options.variant || 'default'; // default, success, warning, error, info
        this.size = options.size || 'md';
        this.indeterminate = options.indeterminate || false;
        this.showPercentage = options.showPercentage !== false;
        this.striped = options.striped || false;
        this.animated = options.animated !== false;
        
        // State management
        this.animationFrame = null;
        
        // Set accessibility
        /**
         * Accessibility pattern for progress indicators.
         *
         * ARIA attributes for screen reader support:
         * - role="progressbar": Identifies element as progress indicator
         * - ariaValueMin/Max/Now: Communicates progress range and current value
         * - ariaLabel: Describes what the progress represents
         */
        this.role = 'progressbar';
        this.ariaLabel = options.ariaLabel || 'Progress indicator';
        this.ariaValueMin = '0';
        this.ariaValueMax = this.max.toString();
        this.ariaValueNow = this.value.toString();

        this.updateClassName();
        
        // Set default styles
        this.setupStyles();
        
        // Build progress structure
        this.buildProgress();
    }

    updateClassName() {
        const parts = ['progress', `progress--${this.size}`, `progress--${this.variant}`];
        if (this.indeterminate) {
            parts.push('progress--indeterminate');
        }
        if (this.type === 'circular') {
            parts.push('progress--circular');
        }
        this.className = parts.join(' ');
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: this.type === 'circular' ? 'inline-block' : 'block',
            position: 'relative',
            width: sizeStyles.width,
            height: sizeStyles.height,
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: this.type === 'circular' ? '50%' : 'var(--border-radius-md)',
            overflow: 'hidden',
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                width: '80px',
                height: '8px'
            },
            sm: {
                width: '120px',
                height: '10px'
            },
            md: {
                width: '160px',
                height: '12px'
            },
            lg: {
                width: '220px',
                height: '16px'
            },
            xl: {
                width: '280px',
                height: '20px'
            },
            '2xl': {
                width: '340px',
                height: '24px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                backgroundColor: 'var(--bg-tertiary)'
            },
            success: {
                backgroundColor: 'var(--color-success)'
            },
            warning: {
                backgroundColor: 'var(--color-warning)'
            },
            error: {
                backgroundColor: 'var(--color-error)'
            },
            info: {
                backgroundColor: 'var(--color-info)'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    buildProgress() {
        this.innerHTML = '';
        
        if (this.type === 'linear') {
            this.buildLinearProgress();
        } else if (this.type === 'circular') {
            this.buildCircularProgress();
        }
        
        // Add percentage text if enabled
        if (this.showPercentage && !this.indeterminate) {
            this.buildPercentageText();
        }
    }
    
    buildLinearProgress() {
        const progressContainer = new UINode(`${this.id}-container`, 'div');
        progressContainer.className = 'progress__bar';
        progressContainer.setStyles({
            width: '100%',
            height: '100%',
            position: 'relative',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: this.type === 'circular' ? '50%' : 'var(--border-radius-md)'
        });
        
        // Progress bar
        const progressBar = new UINode(`${this.id}-bar`, 'div');
        progressBar.className = 'progress__fill';
        progressBar.setStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            height: '100%',
            width: this.calculateProgressWidth() + '%',
            backgroundColor: this.getProgressColor(),
            borderRadius: this.type === 'circular' ? '50%' : 'var(--border-radius-md)',
            transition: this.animated ? 'width 300ms ease' : 'none'
        });
        
        // Add striped animation if enabled
        if (this.striped) {
            progressBar.setStyles({
                backgroundImage: `linear-gradient(
                    45deg,
                    rgba(255, 255, 255, 0.1) 25%,
                    transparent 25%,
                    transparent 50%,
                    rgba(255, 255, 255, 0.1) 75%,
                    transparent 75%
                )`,
                backgroundSize: '40px 40px',
                animation: this.animated ? 'progressStriped 1s linear infinite' : 'none'
            });
        }
        
        // Add indeterminate animation if enabled
        if (this.indeterminate) {
            progressBar.setStyles({
                width: '30%',
                animation: this.animated ? 'progressIndeterminate 1.5s ease-in-out infinite' : 'none'
            });
        }
        
        progressContainer.appendChild(progressBar);
        this.appendChild(progressContainer);
    }
    
    buildCircularProgress() {
        const svgSize = parseInt(this.getSizeStyles().width);
        const strokeWidth = 8;
        const radius = (svgSize - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (this.calculateProgressWidth() / 100) * circumference;
        
        const svg = new UINode(`${this.id}-svg`, 'svg');
        svg.setStyles({
            display: 'block',
            width: svgSize + 'px',
            height: svgSize + 'px',
            transform: 'rotate(-90deg)'
        });
        
        // Create SVG content
        const svgContent = `
            <circle
                cx="${radius + strokeWidth / 2}"
                cy="${radius + strokeWidth / 2}"
                r="${radius}"
                fill="none"
                stroke="${this.getProgressColor()}"
                stroke-width="${strokeWidth}"
                stroke-linecap="round"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${this.indeterminate ? '75' : offset}"
                ${this.animated ? 'style="transition: stroke-dashoffset 300ms ease-in-out"' : ''}
            />
        `;
        
        svg.element.innerHTML = svgContent;
        this.appendChild(svg);
        
        // Add indeterminate animation if enabled
        if (this.indeterminate) {
            const circle = svg.element.querySelector('circle');
            circle.style.animation = this.animated ? 'progressCircularIndeterminate 2s ease-in-out infinite' : 'none';
        }
    }
    
    buildPercentageText() {
        const text = new UINode(`${this.id}-text`, 'span');
        text.textContent = this.indeterminate ? '...' : `${this.calculateProgressWidth()}%`;
        text.setStyles({
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '0.75em',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none'
        });
        this.appendChild(text);
    }
    
    calculateProgressWidth() {
        if (this.indeterminate) {
            return 0;
        }
        return Math.min(100, Math.max(0, (this.value / this.max) * 100));
    }
    
    getProgressColor() {
        const colors = {
            default: 'var(--color-primary-500)',
            success: 'var(--color-success)',
            warning: 'var(--color-warning)',
            error: 'var(--color-error)',
            info: 'var(--color-info)'
        };
        return colors[this.variant] || colors.default;
    }
    
    setValue(value) {
        if (value !== this.value) {
            this.value = value;
            this.ariaValueNow = this.value.toString();
            
            // Update UI
            this.updateProgress();
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setMax(max) {
        if (max !== this.max) {
            this.max = max;
            this.ariaValueMax = this.max.toString();
            
            // Update UI
            this.updateProgress();
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (variant !== this.variant) {
            this.variant = variant;
            this.updateClassName();
            this.setupStyles();
            this.buildProgress();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (size !== this.size) {
            this.size = size;
            this.updateClassName();
            this.setupStyles();
            this.buildProgress();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setType(type) {
        if (type !== this.type) {
            this.type = type;
            this.updateClassName();
            this.setupStyles();
            this.buildProgress();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setIndeterminate(indeterminate) {
        if (indeterminate !== this.indeterminate) {
            this.indeterminate = indeterminate;
            this.ariaLabel = indeterminate ? 'Loading' : 'Progress indicator';
            this.updateClassName();
            
            // Update UI
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowPercentage(showPercentage) {
        if (showPercentage !== this.showPercentage) {
            this.showPercentage = showPercentage;
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setStriped(striped) {
        if (striped !== this.striped) {
            this.striped = striped;
            this.updateClassName();
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAnimated(animated) {
        if (animated !== this.animated) {
            this.animated = animated;
            this.updateClassName();
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    updateProgress() {
        if (this.type === 'linear') {
            const progressBar = this.querySelector(`${this.id}-bar`);
            if (progressBar) {
                if (this.indeterminate) {
                    progressBar.setStyle('width', '30%');
                } else {
                    progressBar.setStyle('width', this.calculateProgressWidth() + '%');
                }
            }
        } else if (this.type === 'circular') {
            const svg = this.querySelector(`${this.id}-svg`);
            if (svg) {
                const circle = svg.element.querySelector('circle');
                if (circle) {
                    const svgSize = parseInt(this.getSizeStyles().width);
                    const strokeWidth = 8;
                    const radius = (svgSize - strokeWidth) / 2;
                    const circumference = 2 * Math.PI * radius;
                    const offset = circumference - (this.calculateProgressWidth() / 100) * circumference;
                    
                    circle.setAttribute('stroke-dashoffset', this.indeterminate ? '75' : offset);
                }
            }
        }
        
        // Update percentage text
        if (this.showPercentage && !this.indeterminate) {
            const text = this.querySelector(`${this.id}-text`);
            if (text) {
                text.textContent = `${this.calculateProgressWidth()}%`;
            }
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods for common progress types
    static createLinearProgress(id, options = {}) {
        return new Progress(id, {
            type: 'linear',
            ...options
        });
    }
    
    static createCircularProgress(id, options = {}) {
        return new Progress(id, {
            type: 'circular',
            ...options
        });
    }
    
    static createSuccessProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'success',
            ...options
        });
    }
    
    static createWarningProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'warning',
            ...options
        });
    }
    
    static createErrorProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'error',
            ...options
        });
    }
    
    static createInfoProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'info',
            ...options
        });
    }
    
    static createIndeterminateProgress(id, options = {}) {
        return new Progress(id, {
            indeterminate: true,
            animated: true,
            showPercentage: false,
            ...options
        });
    }
    
    static createProgressBar(id, value, max, options = {}) {
        return new Progress(id, {
            value,
            max,
            showPercentage: true,
            ...options
        });
    }
    
    // Animation helpers
    animateTo(targetValue, duration = 300) {
        const startValue = this.value;
        const startTime = Date.now();
        
        const animate = () => {
            const currentTime = Date.now();
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration);
            
            const currentValue = lerp(startValue, targetValue, progress);
            this.setValue(currentValue);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        requestAnimationFrame(animate);
    }
    
    // CSS animations for progress bars
    static getCSSAnimations() {
        return `
            @keyframes progressStriped {
                0% {
                    background-position: 40px 0;
                }
                100% {
                    background-position: 0 0;
                }
            }
            
            @keyframes progressIndeterminate {
                0% {
                    left: -30%;
                }
                60% {
                    left: 100%;
                }
                100% {
                    left: 100%;
                }
            }
            
            @keyframes progressCircularIndeterminate {
                0% {
                    stroke-dasharray: 1, 2;
                    stroke-dashoffset: 0;
                }
                50% {
                    stroke-dasharray: 90, 150;
                    stroke-dashoffset: -35;
                }
                100% {
                    stroke-dasharray: 90, 150;
                    stroke-dashoffset: -124;
                }
            }
        `;
    }
}
