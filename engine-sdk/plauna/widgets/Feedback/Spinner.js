// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spinner - Loading spinner widget for Plauna
 * Provides spinner functionality with multiple variants and sizes
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _spinnerSequence = 0;

function _newSpinnerId() {
    return `spinner-${Date.now()}-${++_spinnerSequence}`;
}

export class Spinner extends UINode {
    // Widget metadata
    static id = 'spinner';
    static name = 'Spinner';
    static category = 'feedback';
    static icon = '⏳';
    static description = 'Loading spinner';
    static tags = ['feedback', 'spinner', 'loading'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            size: 'md',
            variant: 'primary',
            label: ''
        };
    }
    
    static create(container, options = {}) {
        const instance = new Spinner(_newSpinnerId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSpinnerId(), options = {}) {
        super(id, 'spinner');
        
        // Spinner-specific properties
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.type = options.type || 'default'; // default, dots, pulse, ring, bars, circle
        this.label = options.label || '';
        this.showLabel = options.showLabel !== false;
        this.speed = options.speed || 1; // 0.5, 1, 2
        this.color = options.color || null; // Custom color override
        
        // State management
        this.isVisible = true;
        this.animationFrame = null;
        
        // Set accessibility
        this.role = 'status';
        this.ariaLive = 'polite';
        this.ariaAtomic = 'true';
        this.ariaLabel = this.label || options.ariaLabel || 'Loading';
        
        // Set default styles
        this.setupStyles();
        
        // Build spinner structure
        this.buildSpinner();
        
        // Start animation
        this.startAnimation();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens.get('spacing.md'),
            color: this.getColor(),
            outline: 'none',
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
                width: '24px',
                height: '24px',
                fontSize: tokens.get('fontSizes.sm')
            },
            md: {
                width: '32px',
                height: '32px',
                fontSize: tokens.get('fontSizes.md')
            },
            lg: {
                width: '48px',
                height: '48px',
                fontSize: tokens.get('fontSizes.lg')
            },
            xl: {
                width: '64px',
                height: '64px',
                fontSize: tokens.get('fontSizes.xl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                color: tokens.get('colors.text.secondary')
            },
            primary: {
                color: tokens.get('colors.primary')
            },
            secondary: {
                color: tokens.get('colors.secondary')
            },
            success: {
                color: tokens.get('colors.success')
            },
            warning: {
                color: tokens.get('colors.warning')
            },
            error: {
                color: tokens.get('colors.error')
            },
            info: {
                color: tokens.get('colors.info')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getColor() {
        if (this.color) {
            return this.color;
        }
        
        const variantColors = {
            default: tokens.get('colors.text.secondary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    buildSpinner() {
        this.innerHTML = '';
        
        // Create spinner container
        const spinnerContainer = document.createElement('div');
        spinnerContainer.style.cssText = (
            'position: relative;' +
            'width: ' + this.getSize() + ';' +
            'height: ' + this.getSize() + ';'
        );
        
        // Create spinner based on type
        switch (this.type) {
            case 'dots':
                this.createDotsSpinner(spinnerContainer);
                break;
            case 'pulse':
                this.createPulseSpinner(spinnerContainer);
                break;
            case 'ring':
                this.createRingSpinner(spinnerContainer);
                break;
            case 'bars':
                this.createBarsSpinner(spinnerContainer);
                break;
            case 'circle':
                this.createCircleSpinner(spinnerContainer);
                break;
            default:
                this.createDefaultSpinner(spinnerContainer);
                break;
        }
        
        this.appendChild(spinnerContainer);
        
        // Add label if enabled
        if (this.showLabel && this.label) {
            const label = document.createElement('div');
            label.textContent = this.label;
            label.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'color: inherit;' +
                'margin-top: ' + tokens.get('spacing.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';'
            );
            this.appendChild(label);
        }
    }
    
    getSize() {
        const sizes = {
            xs: '16px',
            sm: '24px',
            md: '32px',
            lg: '48px',
            xl: '64px'
        };
        return sizes[this.size] || sizes.md;
    }
    
    createDefaultSpinner(container) {
        const spinner = document.createElement('div');
        spinner.style.cssText = (
            'width: 100%;' +
            'height: 100%;' +
            'border: 3px solid ' + this.getColor() + '25;' +
            'border-top-color: ' + this.getColor() + ';' +
            'border-radius: 50%;' +
            'animation: spin 1s linear infinite;'
        );
        
        // Adjust animation speed
        spinner.style.animationDuration = (1 / this.speed) + 's';
        
        container.appendChild(spinner);
        
        // Add keyframes if not already added
        this.addSpinKeyframes();
    }
    
    createDotsSpinner(container) {
        const dotsContainer = document.createElement('div');
        dotsContainer.style.cssText = (
            'display: flex;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 100%;' +
            'height: 100%;'
        );
        
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.style.cssText = (
                'width: 25%;' +
                'height: 25%;' +
                'background: ' + this.getColor() + ';' +
                'border-radius: 50%;' +
                'animation: dot-bounce 1.4s ease-in-out infinite;' +
                'animation-delay: ' + (i * 0.16) + 's;'
            );
            
            // Adjust animation speed
            dot.style.animationDuration = (1.4 / this.speed) + 's';
            dot.style.animationDelay = ((i * 0.16) / this.speed) + 's';
            
            dotsContainer.appendChild(dot);
        }
        
        container.appendChild(dotsContainer);
        
        // Add keyframes if not already added
        this.addDotBounceKeyframes();
    }
    
    createPulseSpinner(container) {
        const pulse = document.createElement('div');
        pulse.style.cssText = (
            'width: 100%;' +
            'height: 100%;' +
            'background: ' + this.getColor() + ';' +
            'border-radius: 50%;' +
            'animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;'
        );
        
        // Adjust animation speed
        pulse.style.animationDuration = (2 / this.speed) + 's';
        
        container.appendChild(pulse);
        
        // Add keyframes if not already added
        this.addPulseKeyframes();
    }
    
    createRingSpinner(container) {
        const ring = document.createElement('div');
        ring.style.cssText = (
            'width: 100%;' +
            'height: 100%;' +
            'border: 2px solid ' + this.getColor() + ';' +
            'border-top-color: transparent;' +
            'border-right-color: transparent;' +
            'border-radius: 50%;' +
            'animation: spin 1s linear infinite;'
        );
        
        // Adjust animation speed
        ring.style.animationDuration = (1 / this.speed) + 's';
        
        container.appendChild(ring);
        
        // Add keyframes if not already added
        this.addSpinKeyframes();
    }
    
    createBarsSpinner(container) {
        const barsContainer = document.createElement('div');
        barsContainer.style.cssText = (
            'display: flex;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 100%;' +
            'height: 100%;'
        );
        
        for (let i = 0; i < 4; i++) {
            const bar = document.createElement('div');
            bar.style.cssText = (
                'width: 15%;' +
                'height: 100%;' +
                'background: ' + this.getColor() + ';' +
                'border-radius: 2px;' +
                'animation: bar-stretch 1.2s ease-in-out infinite;' +
                'animation-delay: ' + (i * 0.1) + 's;'
            );
            
            // Adjust animation speed
            bar.style.animationDuration = (1.2 / this.speed) + 's';
            bar.style.animationDelay = ((i * 0.1) / this.speed) + 's';
            
            barsContainer.appendChild(bar);
        }
        
        container.appendChild(barsContainer);
        
        // Add keyframes if not already added
        this.addBarStretchKeyframes();
    }
    
    createCircleSpinner(container) {
        const circle = document.createElement('div');
        circle.style.cssText = (
            'width: 100%;' +
            'height: 100%;' +
            'border: 2px solid ' + this.getColor() + ';' +
            'border-radius: 50%;' +
            'border-top-color: transparent;' +
            'border-bottom-color: transparent;' +
            'animation: spin 1s linear infinite;'
        );
        
        // Adjust animation speed
        circle.style.animationDuration = (1 / this.speed) + 's';
        
        container.appendChild(circle);
        
        // Add keyframes if not already added
        this.addSpinKeyframes();
    }
    
    addSpinKeyframes() {
        if (!document.querySelector('#plauna-spinner-keyframes')) {
            const style = document.createElement('style');
            style.id = 'plauna-spinner-keyframes';
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    addDotBounceKeyframes() {
        if (!document.querySelector('#plauna-dot-bounce-keyframes')) {
            const style = document.createElement('style');
            style.id = 'plauna-dot-bounce-keyframes';
            style.textContent = `
                @keyframes dot-bounce {
                    0%, 80%, 100% {
                        transform: scale(0);
                    }
                    40% {
                        transform: scale(1);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    addPulseKeyframes() {
        if (!document.querySelector('#plauna-pulse-keyframes')) {
            const style = document.createElement('style');
            style.id = 'plauna-pulse-keyframes';
            style.textContent = `
                @keyframes pulse {
                    0%, 100% {
                        opacity: 1;
                    }
                    50% {
                        opacity: 0.5;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    addBarStretchKeyframes() {
        if (!document.querySelector('#plauna-bar-stretch-keyframes')) {
            const style = document.createElement('style');
            style.id = 'plauna-bar-stretch-keyframes';
            style.textContent = `
                @keyframes bar-stretch {
                    0%, 40%, 100% {
                        transform: scaleY(0.4);
                    }
                    20% {
                        transform: scaleY(1);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    startAnimation() {
        this.isVisible = true;
        this.setStyle('display', 'flex');
        this.setStyle('opacity', '1');
    }
    
    stopAnimation() {
        this.isVisible = false;
        this.setStyle('display', 'none');
        this.setStyle('opacity', '0');
    }
    
    // Public methods
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildSpinner();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildSpinner();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setType(type) {
        if (this.type !== type) {
            this.type = type;
            this.buildSpinner();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label || 'Loading';
            this.buildSpinner();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setShowLabel(showLabel) {
        if (this.showLabel !== showLabel) {
            this.showLabel = showLabel;
            this.buildSpinner();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSpeed(speed) {
        if (this.speed !== speed) {
            this.speed = speed;
            this.buildSpinner();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setColor(color) {
        if (this.color !== color) {
            this.color = color;
            this.setupStyles();
            this.buildSpinner();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    show() {
        this.startAnimation();
    }
    
    hide() {
        this.stopAnimation();
    }
    
    // Static factory methods
    static createSpinner(id, options = {}) {
        return new Spinner(id, options);
    }
    
    static createPrimarySpinner(id, options = {}) {
        return new Spinner(id, { variant: 'primary', ...options });
    }
    
    static createSuccessSpinner(id, options = {}) {
        return new Spinner(id, { variant: 'success', ...options });
    }
    
    static createWarningSpinner(id, options = {}) {
        return new Spinner(id, { variant: 'warning', ...options });
    }
    
    static createErrorSpinner(id, options = {}) {
        return new Spinner(id, { variant: 'error', ...options });
    }
    
    static createInfoSpinner(id, options = {}) {
        return new Spinner(id, { variant: 'info', ...options });
    }
    
    static createSmallSpinner(id, options = {}) {
        return new Spinner(id, { size: 'sm', ...options });
    }
    
    static createLargeSpinner(id, options = {}) {
        return new Spinner(id, { size: 'lg', ...options });
    }
    
    static createXLargeSpinner(id, options = {}) {
        return new Spinner(id, { size: 'xl', ...options });
    }
    
    static createDotsSpinner(id, options = {}) {
        return new Spinner(id, { type: 'dots', ...options });
    }
    
    static createPulseSpinner(id, options = {}) {
        return new Spinner(id, { type: 'pulse', ...options });
    }
    
    static createRingSpinner(id, options = {}) {
        return new Spinner(id, { type: 'ring', ...options });
    }
    
    static createBarsSpinner(id, options = {}) {
        return new Spinner(id, { type: 'bars', ...options });
    }
    
    static createCircleSpinner(id, options = {}) {
        return new Spinner(id, { type: 'circle', ...options });
    }
    
    static createLoadingSpinner(id, label, options = {}) {
        return new Spinner(id, { 
            label: label || 'Loading...', 
            showLabel: true,
            ...options 
        });
    }
    
    static createFastSpinner(id, options = {}) {
        return new Spinner(id, { speed: 2, ...options });
    }
    
    static createSlowSpinner(id, options = {}) {
        return new Spinner(id, { speed: 0.5, ...options });
    }
    
    static createCustomSpinner(id, color, options = {}) {
        return new Spinner(id, { color, ...options });
    }
}
