// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Stepper - Step indicator widget for Plauna
 * Provides stepper functionality with multiple variants and states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _stepperSequence = 0;

function _newStepperId() {
    return `stepper-${Date.now()}-${++_stepperSequence}`;
}

export class Stepper extends UINode {
    // Widget metadata
    static id = 'stepper';
    static name = 'Stepper';
    static category = 'navigation';
    static icon = '📊';
    static description = 'Step indicator';
    static tags = ['navigation', 'stepper', 'steps'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            steps: [],
            current: 0,
            variant: 'default'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Stepper(_newStepperId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newStepperId(), options = {}) {
        super(id, 'stepper');
        
        // Stepper-specific properties
        this.steps = options.steps || [];
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.orientation = options.orientation || 'horizontal'; // horizontal, vertical
        this.currentStep = options.currentStep || 0;
        this.clickable = options.clickable !== false;
        this.showNumbers = options.showNumbers !== false;
        this.showLabels = options.showLabels !== false;
        this.showDescriptions = options.showDescriptions || false;
        this.alternativeLabels = options.alternativeLabels || false;
        this.linear = options.linear || false;
        this.completed = options.completed || false;
        
        // State management
        this.stepStates = new Map(); // Map of step index to state (pending, active, completed, error)
        this.initializeStepStates();
        
        // Set accessibility
        this.role = 'navigation';
        this.ariaLabel = options.ariaLabel || 'Step navigation';
        this.ariaOrientation = this.orientation;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build stepper structure
        this.buildStepper();
    }
    
    initializeStepStates() {
        this.steps.forEach((step, index) => {
            if (index < this.currentStep) {
                this.stepStates.set(index, 'completed');
            } else if (index === this.currentStep) {
                this.stepStates.set(index, 'active');
            } else {
                this.stepStates.set(index, 'pending');
            }
        });
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const layoutStyles = this.getLayoutStyles();
        
        this.setStyles({
            display: this.orientation === 'horizontal' ? 'flex' : 'block',
            flexDirection: this.orientation === 'horizontal' ? 'row' : 'column',
            gap: tokens.get('spacing.md'),
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: 'none',
            borderRadius: tokens.get('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: tokens.get('fontWeights.medium'),
            outline: 'none',
            position: 'relative',
            transition: 'all 150ms ease',
            ...sizeStyles,
            ...variantStyles,
            ...layoutStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.get('fontSizes.xs'),
                padding: tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md')
            },
            sm: {
                fontSize: tokens.get('fontSizes.sm'),
                padding: tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg')
            },
            md: {
                fontSize: tokens.get('fontSizes.md'),
                padding: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl')
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg'),
                padding: tokens.get('spacing.xl') + ' ' + tokens.get('spacing.xxl')
            },
            xl: {
                fontSize: tokens.get('fontSizes.xl'),
                padding: tokens.get('spacing.xxl') + ' ' + tokens.get('spacing.xxxl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md'),
            sm: tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg'),
            md: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl'),
            lg: tokens.get('spacing.xl') + ' ' + tokens.get('spacing.xxl'),
            xl: tokens.get('spacing.xxl') + ' ' + tokens.get('spacing.xxxl')
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.text.primary')
            },
            primary: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.primary')
            },
            secondary: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.secondary')
            },
            success: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.success')
            },
            warning: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.warning')
            },
            error: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.error')
            },
            info: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.info')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getLayoutStyles() {
        const layouts = {
            horizontal: {
                flexDirection: 'row',
                alignItems: 'center'
            },
            vertical: {
                flexDirection: 'column',
                alignItems: 'flex-start'
            }
        };
        return layouts[this.orientation] || layouts.horizontal;
    }
    
    getBackgroundColor() {
        return 'transparent';
    }
    
    getTextColor() {
        const variantColors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getStepColor(state) {
        const variantColors = {
            default: {
                pending: tokens.get('colors.text.secondary'),
                active: this.getTextColor(),
                completed: this.getTextColor(),
                error: tokens.get('colors.error')
            },
            primary: {
                pending: tokens.get('colors.text.secondary'),
                active: tokens.get('colors.primary'),
                completed: tokens.get('colors.primary'),
                error: tokens.get('colors.error')
            },
            secondary: {
                pending: tokens.get('colors.text.secondary'),
                active: tokens.get('colors.secondary'),
                completed: tokens.get('colors.secondary'),
                error: tokens.get('colors.error')
            },
            success: {
                pending: tokens.get('colors.text.secondary'),
                active: tokens.get('colors.success'),
                completed: tokens.get('colors.success'),
                error: tokens.get('colors.error')
            },
            warning: {
                pending: tokens.get('colors.text.secondary'),
                active: tokens.get('colors.warning'),
                completed: tokens.get('colors.warning'),
                error: tokens.get('colors.error')
            },
            error: {
                pending: tokens.get('colors.text.secondary'),
                active: tokens.get('colors.error'),
                completed: tokens.get('colors.error'),
                error: tokens.get('colors.error')
            },
            info: {
                pending: tokens.get('colors.text.secondary'),
                active: tokens.get('colors.info'),
                completed: tokens.get('colors.info'),
                error: tokens.get('colors.error')
            }
        };
        return variantColors[this.variant]?.[state] || variantColors.default[state];
    }
    
    getStepBackgroundColor(state) {
        const variantColors = {
            default: {
                pending: 'transparent',
                active: tokens.get('colors.background.primary'),
                completed: tokens.get('colors.background.primary'),
                error: 'rgba(239, 68, 68, 0.1)'
            },
            primary: {
                pending: 'transparent',
                active: 'rgba(59, 130, 246, 0.1)',
                completed: 'rgba(59, 130, 246, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            secondary: {
                pending: 'transparent',
                active: 'rgba(107, 114, 128, 0.1)',
                completed: 'rgba(107, 114, 128, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            success: {
                pending: 'transparent',
                active: 'rgba(34, 197, 94, 0.1)',
                completed: 'rgba(34, 197, 94, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            warning: {
                pending: 'transparent',
                active: 'rgba(245, 158, 11, 0.1)',
                completed: 'rgba(245, 158, 11, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            error: {
                pending: 'transparent',
                active: 'rgba(239, 68, 68, 0.1)',
                completed: 'rgba(239, 68, 68, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            info: {
                pending: 'transparent',
                active: 'rgba(59, 130, 246, 0.1)',
                completed: 'rgba(59, 130, 246, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            }
        };
        return variantColors[this.variant]?.[state] || variantColors.default[state];
    }
    
    getStepBorderColor(state) {
        const variantColors = {
            default: {
                pending: tokens.get('colors.border.medium'),
                active: this.getTextColor(),
                completed: this.getTextColor(),
                error: tokens.get('colors.error')
            },
            primary: {
                pending: tokens.get('colors.border.medium'),
                active: tokens.get('colors.primary'),
                completed: tokens.get('colors.primary'),
                error: tokens.get('colors.error')
            },
            secondary: {
                pending: tokens.get('colors.border.medium'),
                active: tokens.get('colors.secondary'),
                completed: tokens.get('colors.secondary'),
                error: tokens.get('colors.error')
            },
            success: {
                pending: tokens.get('colors.border.medium'),
                active: tokens.get('colors.success'),
                completed: tokens.get('colors.success'),
                error: tokens.get('colors.error')
            },
            warning: {
                pending: tokens.get('colors.border.medium'),
                active: tokens.get('colors.warning'),
                completed: tokens.get('colors.warning'),
                error: tokens.get('colors.error')
            },
            error: {
                pending: tokens.get('colors.border.medium'),
                active: tokens.get('colors.error'),
                completed: tokens.get('colors.error'),
                error: tokens.get('colors.error')
            },
            info: {
                pending: tokens.get('colors.border.medium'),
                active: tokens.get('colors.info'),
                completed: tokens.get('colors.info'),
                error: tokens.get('colors.error')
            }
        };
        return variantColors[this.variant]?.[state] || variantColors.default[state];
    }
    
    setupEventHandlers() {
        this.addEventListener('keydown', (e) => {
            this.handleKeyboardNavigation(e);
        });
    }
    
    handleKeyboardNavigation(e) {
        if (!this.clickable) return;
        
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                this.navigatePrevious();
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                this.navigateNext();
                break;
            case 'Home':
                e.preventDefault();
                this.goToStep(0);
                break;
            case 'End':
                e.preventDefault();
                this.goToStep(this.steps.length - 1);
                break;
        }
    }
    
    buildStepper() {
        this.innerHTML = '';
        
        // Create stepper container
        const stepperContainer = document.createElement('div');
        stepperContainer.style.cssText = (
            'display: ' + (this.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (this.orientation === 'horizontal' ? 'row' : 'column') + ';' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'width: 100%;' +
            'position: relative;'
        );
        
        // Create steps
        this.steps.forEach((step, index) => {
            const stepElement = this.createStep(step, index);
            stepperContainer.appendChild(stepElement);
            
            // Add connector (except for last step)
            if (index < this.steps.length - 1) {
                const connector = this.createConnector(index);
                stepperContainer.appendChild(connector);
            }
        });
        
        this.appendChild(stepperContainer);
    }
    
    createStep(step, index) {
        const state = this.stepStates.get(index);
        const isActive = state === 'active';
        const isCompleted = state === 'completed';
        const hasError = state === 'error';
        
        const stepElement = document.createElement('div');
        stepElement.dataset.stepIndex = index.toString();
        stepElement.setAttribute('role', 'button');
        stepElement.setAttribute('aria-label', step.label || `Step ${index + 1}`);
        stepElement.setAttribute('aria-current', isActive ? 'step' : 'false');
        stepElement.setAttribute('aria-disabled', (!this.clickable || (this.linear && index > this.currentStep)).toString());
        stepElement.tabIndex = this.clickable && (!this.linear || index <= this.currentStep) ? (isActive ? '0' : '-1') : '-1';
        stepElement.style.cssText = (
            'display: flex;' +
            'flex-direction: ' + (this.orientation === 'horizontal' ? 'column' : 'row') + ';' +
            'align-items: ' + (this.orientation === 'horizontal' ? 'center' : 'flex-start') + ';' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'cursor: ' + (this.clickable && (!this.linear || index <= this.currentStep) ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'flex: 1;'
        );
        
        // Create step indicator
        const indicator = this.createStepIndicator(state, index);
        stepElement.appendChild(indicator);
        
        // Create step content
        if (this.showLabels || this.showDescriptions) {
            const content = this.createStepContent(step, state, index);
            stepElement.appendChild(content);
        }
        
        // Add click handler
        if (this.clickable && (!this.linear || index <= this.currentStep)) {
            stepElement.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToStep(index);
            });
            
            stepElement.addEventListener('mouseenter', () => {
                if (!isActive) {
                    stepElement.style.opacity = '0.8';
                }
            });
            
            stepElement.addEventListener('mouseleave', () => {
                if (!isActive) {
                    stepElement.style.opacity = '1';
                }
            });
        }
        
        return stepElement;
    }
    
    createStepIndicator(state, index) {
        const indicator = document.createElement('div');
        indicator.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 32px;' +
            'height: 32px;' +
            'border-radius: 50%;' +
            'border: 2px solid ' + this.getStepBorderColor(state) + ';' +
            'background: ' + this.getStepBackgroundColor(state) + ';' +
            'color: ' + this.getStepColor(state) + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'flex-shrink: 0;'
        );
        
        // Add step number or icon
        if (this.showNumbers) {
            const number = document.createElement('span');
            number.textContent = index + 1;
            indicator.appendChild(number);
        } else {
            // Add icon based on state
            const icon = document.createElement('span');
            if (state === 'completed') {
                icon.textContent = '✓';
            } else if (state === 'error') {
                icon.textContent = '✕';
            } else {
                icon.textContent = index + 1;
            }
            indicator.appendChild(icon);
        }
        
        return indicator;
    }
    
    createStepContent(step, state, index) {
        const content = document.createElement('div');
        content.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'text-align: ' + (this.orientation === 'horizontal' ? 'center' : 'left') + ';'
        );
        
        // Add label
        if (this.showLabels && step.label) {
            const label = document.createElement('div');
            label.textContent = step.label;
            label.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + (state === 'active' ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
                'color: ' + this.getStepColor(state) + ';' +
                'line-height: 1.2;'
            );
            content.appendChild(label);
        }
        
        // Add description
        if (this.showDescriptions && step.description) {
            const description = document.createElement('div');
            description.textContent = step.description;
            description.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'line-height: 1.3;' +
                'opacity: 0.8;'
            );
            content.appendChild(description);
        }
        
        return content;
    }
    
    createConnector(index) {
        const connector = document.createElement('div');
        const currentState = this.stepStates.get(index);
        const nextState = this.stepStates.get(index + 1);
        const isCompleted = currentState === 'completed' && nextState !== 'error';
        
        connector.style.cssText = (
            'position: absolute;' +
            (this.orientation === 'horizontal' ? 
                'left: 32px;' +
                'right: -16px;' +
                'top: 16px;' +
                'height: 2px;' :
                'top: 32px;' +
                'bottom: -16px;' +
                'left: 16px;' +
                'width: 2px;'
            ) +
            'background: ' + (isCompleted ? this.getStepColor('completed') : this.getStepBorderColor('pending')) + ';' +
            'transition: all 150ms ease;'
        );
        
        return connector;
    }
    
    // Public methods
    goToStep(stepIndex) {
        if (stepIndex < 0 || stepIndex >= this.steps.length) return;
        
        if (this.linear && stepIndex > this.currentStep + 1) return;
        
        const previousStep = this.currentStep;
        this.currentStep = stepIndex;
        
        // Update step states
        this.initializeStepStates();
        
        // Rebuild stepper
        this.buildStepper();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'stepChange',
            bubbles: true,
            detail: {
                currentStep: this.currentStep,
                previousStep: previousStep,
                step: this.steps[this.currentStep],
                totalSteps: this.steps.length
            }
        });
    }
    
    navigateNext() {
        if (this.currentStep < this.steps.length - 1) {
            this.goToStep(this.currentStep + 1);
        }
    }
    
    navigatePrevious() {
        if (this.currentStep > 0) {
            this.goToStep(this.currentStep - 1);
        }
    }
    
    setStepState(stepIndex, state) {
        if (stepIndex >= 0 && stepIndex < this.steps.length) {
            this.stepStates.set(stepIndex, state);
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildStepper();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildStepper();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setOrientation(orientation) {
        if (this.orientation !== orientation) {
            this.orientation = orientation;
            this.setupStyles();
            this.buildStepper();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSteps(steps) {
        this.steps = steps || [];
        this.currentStep = Math.min(this.currentStep, this.steps.length - 1);
        this.initializeStepStates();
        this.buildStepper();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setClickable(clickable) {
        if (this.clickable !== clickable) {
            this.clickable = clickable;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLinear(linear) {
        if (this.linear !== linear) {
            this.linear = linear;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowNumbers(showNumbers) {
        if (this.showNumbers !== showNumbers) {
            this.showNumbers = showNumbers;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowLabels(showLabels) {
        if (this.showLabels !== showLabels) {
            this.showLabels = showLabels;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowDescriptions(showDescriptions) {
        if (this.showDescriptions !== showDescriptions) {
            this.showDescriptions = showDescriptions;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAlternativeLabels(alternativeLabels) {
        if (this.alternativeLabels !== alternativeLabels) {
            this.alternativeLabels = alternativeLabels;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setCompleted(completed) {
        if (this.completed !== completed) {
            this.completed = completed;
            if (completed) {
                // Mark all steps as completed
                this.steps.forEach((_, index) => {
                    this.stepStates.set(index, 'completed');
                });
            } else {
                this.initializeStepStates();
            }
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createStepper(id, options = {}) {
        return new Stepper(id, options);
    }
    
    static createPrimaryStepper(id, options = {}) {
        return new Stepper(id, { variant: 'primary', ...options });
    }
    
    static createSecondaryStepper(id, options = {}) {
        return new Stepper(id, { variant: 'secondary', ...options });
    }
    
    static createSuccessStepper(id, options = {}) {
        return new Stepper(id, { variant: 'success', ...options });
    }
    
    static createWarningStepper(id, options = {}) {
        return new Stepper(id, { variant: 'warning', ...options });
    }
    
    static createErrorStepper(id, options = {}) {
        return new Stepper(id, { variant: 'error', ...options });
    }
    
    static createInfoStepper(id, options = {}) {
        return new Stepper(id, { variant: 'info', ...options });
    }
    
    static createHorizontalStepper(id, options = {}) {
        return new Stepper(id, { orientation: 'horizontal', ...options });
    }
    
    static createVerticalStepper(id, options = {}) {
        return new Stepper(id, { orientation: 'vertical', ...options });
    }
    
    static createLinearStepper(id, options = {}) {
        return new Stepper(id, { linear: true, ...options });
    }
    
    static createNonLinearStepper(id, options = {}) {
        return new Stepper(id, { linear: false, ...options });
    }
    
    static createClickableStepper(id, options = {}) {
        return new Stepper(id, { clickable: true, ...options });
    }
    
    static createReadOnlyStepper(id, options = {}) {
        return new Stepper(id, { clickable: false, ...options });
    }
    
    static createWizardStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'primary',
            orientation: 'horizontal',
            linear: true,
            clickable: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            ...options
        });
    }
    
    static createProcessStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'success',
            orientation: 'vertical',
            linear: true,
            clickable: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: true,
            ...options
        });
    }
    
    static createTimelineStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'default',
            orientation: 'vertical',
            linear: false,
            clickable: true,
            showNumbers: false,
            showLabels: true,
            showDescriptions: true,
            ...options
        });
    }
    
    static createOnboardingStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'info',
            orientation: 'horizontal',
            linear: true,
            clickable: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            ...options
        });
    }
    
    static createCheckoutStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'primary',
            orientation: 'horizontal',
            linear: true,
            clickable: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            ...options
        });
    }
}
