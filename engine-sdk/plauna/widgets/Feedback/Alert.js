// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Alert - Alert message widget for Plauna
 * Provides alert functionality with multiple variants and dismissible options
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _alertSequence = 0;

function _newAlertId() {
    return `alert-${Date.now()}-${++_alertSequence}`;
}

export class Alert extends UINode {
    // Widget metadata
    static id = 'alert';
    static name = 'Alert';
    static category = 'feedback';
    static icon = '⚠️';
    static description = 'Alert notification';
    static tags = ['feedback', 'alert', 'notification'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            message: '',
            variant: 'info',
            closable: true,
            icon: true
        };
    }
    
    static create(container, options = {}) {
        const instance = new Alert(_newAlertId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newAlertId(), options = {}) {
        super(id, 'alert');
        
        // Alert-specific properties
        this.message = options.message || '';
        this.title = options.title || '';
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.dismissible = options.dismissible || false;
        this.icon = options.icon || null;
        this.action = options.action || null;
        this.timeout = options.timeout || null;
        this.showIcon = options.showIcon !== false;
        
        // State management
        this.visible = true;
        this.timeoutId = null;
        
        // Set accessibility
        this.role = 'alert';
        this.ariaLive = 'polite';
        this.ariaAtomic = 'true';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build alert structure
        this.buildAlert();
        
        // Auto-dismiss if timeout is set
        if (this.timeout && this.timeout > 0) {
            this.setTimeout(this.timeout);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'flex',
            alignItems: 'flex-start',
            gap: tokens.get('spacing.md'),
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: '1px solid ' + this.getBorderColor(),
            borderRadius: tokens.get('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: tokens.get('fontWeights.medium'),
            outline: 'none',
            position: 'relative',
            transition: 'all 150ms ease',
            ...sizeStyles,
            ...variantStyles
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
                backgroundColor: tokens.get('colors.background.primary'),
                color: tokens.get('colors.text.primary'),
                borderColor: tokens.get('colors.border.medium')
            },
            primary: {
                backgroundColor: tokens.get('colors.primary.50'),
                color: tokens.get('colors.primary.700'),
                borderColor: tokens.get('colors.primary.200')
            },
            secondary: {
                backgroundColor: tokens.get('colors.secondary.50'),
                color: tokens.get('colors.secondary.700'),
                borderColor: tokens.get('colors.secondary.200')
            },
            success: {
                backgroundColor: tokens.get('colors.success.50'),
                color: tokens.get('colors.success'),
                borderColor: tokens.get('colors.success.200')
            },
            warning: {
                backgroundColor: tokens.get('colors.warning.50'),
                color: tokens.get('colors.warning'),
                borderColor: tokens.get('colors.warning.200')
            },
            error: {
                backgroundColor: tokens.get('colors.error.50'),
                color: tokens.get('colors.error'),
                borderColor: tokens.get('colors.error.200')
            },
            info: {
                backgroundColor: tokens.get('colors.info.50'),
                color: tokens.get('colors.info'),
                borderColor: tokens.get('colors.info.200')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getBackgroundColor() {
        const variantColors = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary.50'),
            secondary: tokens.get('colors.secondary.50'),
            success: tokens.get('colors.success.50'),
            warning: tokens.get('colors.warning.50'),
            error: tokens.get('colors.error.50'),
            info: tokens.get('colors.info.50')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getTextColor() {
        const variantColors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.primary.700'),
            secondary: tokens.get('colors.secondary.700'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getBorderColor() {
        const variantColors = {
            default: tokens.get('colors.border.medium'),
            primary: tokens.get('colors.primary.200'),
            secondary: tokens.get('colors.secondary.200'),
            success: tokens.get('colors.success.200'),
            warning: tokens.get('colors.warning.200'),
            error: tokens.get('colors.error.200'),
            info: tokens.get('colors.info.200')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getIconColor() {
        const variantColors = {
            default: tokens.get('colors.text.secondary'),
            primary: tokens.get('colors.primary.600'),
            secondary: tokens.get('colors.secondary.600'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    setupEventHandlers() {
        this.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.dismiss();
            }
        });
    }
    
    buildAlert() {
        this.innerHTML = '';
        
        // Create icon if enabled
        if (this.showIcon) {
            const icon = this.createIcon();
            this.appendChild(icon);
        }
        
        // Create content container
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = (
            'flex: 1;' +
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';'
        );
        
        // Add title if present
        if (this.title) {
            const titleElement = document.createElement('div');
            titleElement.textContent = this.title;
            titleElement.style.cssText = (
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'color: inherit;' +
                'line-height: 1.2;'
            );
            contentContainer.appendChild(titleElement);
        }
        
        // Add message
        const messageElement = document.createElement('div');
        messageElement.textContent = this.message;
        messageElement.style.cssText = (
            'color: inherit;' +
            'line-height: 1.4;' +
            'font-size: inherit;'
        );
        contentContainer.appendChild(messageElement);
        
        this.appendChild(contentContainer);
        
        // Add dismiss button if dismissible
        if (this.dismissible) {
            const dismissButton = this.createDismissButton();
            this.appendChild(dismissButton);
        }
        
        // Add action button if present
        if (this.action) {
            const actionButton = this.createActionButton();
            this.appendChild(actionButton);
        }
    }
    
    createIcon() {
        const icon = document.createElement('div');
        icon.style.cssText = (
            'width: 20px;' +
            'height: 20px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;'
        );
        
        // Get icon based on variant if no custom icon is provided
        const iconText = this.icon || this.getDefaultIcon();
        icon.textContent = iconText;
        icon.style.color = this.getIconColor();
        
        return icon;
    }
    
    getDefaultIcon() {
        const variantIcons = {
            default: 'ℹ️',
            primary: 'ℹ️',
            secondary: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️'
        };
        return variantIcons[this.variant] || variantIcons.default;
    }
    
    createDismissButton() {
        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.setAttribute('aria-label', 'Dismiss');
        dismissButton.textContent = '×';
        dismissButton.style.cssText = (
            'width: 20px;' +
            'height: 20px;' +
            'background: transparent;' +
            'border: none;' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'font-size: 18px;' +
            'font-weight: bold;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'border-radius: 50%;' +
            'transition: all 150ms ease;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;'
        );
        
        dismissButton.addEventListener('mouseenter', () => {
            dismissButton.style.background = 'rgba(0, 0, 0, 0.1)';
            dismissButton.style.color = tokens.get('colors.text.primary');
        });
        
        dismissButton.addEventListener('mouseleave', () => {
            dismissButton.style.background = 'transparent';
            dismissButton.style.color = tokens.get('colors.text.secondary');
        });
        
        dismissButton.addEventListener('click', () => {
            this.dismiss();
        });
        
        return dismissButton;
    }
    
    createActionButton() {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.textContent = this.action.label || 'Action';
        actionButton.style.cssText = (
            'background: transparent;' +
            'color: ' + this.getIconColor() + ';' +
            'border: 1px solid ' + this.getBorderColor() + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;'
        );
        
        actionButton.addEventListener('mouseenter', () => {
            actionButton.style.background = this.getBackgroundColor();
            actionButton.style.color = this.getTextColor();
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.background = 'transparent';
            actionButton.style.color = this.getIconColor();
        });
        
        actionButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.action.onClick && typeof this.action.onClick === 'function') {
                this.action.onClick({
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                });
            }
            
            this.dispatchEvent({
                type: 'action',
                bubbles: true,
                detail: {
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                }
            });
        });
        
        return actionButton;
    }
    
    // Public methods
    setMessage(message) {
        if (this.message !== message) {
            this.message = message;
            const messageElement = this.querySelector('div div:last-child');
            if (messageElement) {
                messageElement.textContent = message;
            }
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setTitle(title) {
        if (this.title !== title) {
            this.title = title;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildAlert();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildAlert();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setDismissible(dismissible) {
        if (this.dismissible !== dismissible) {
            this.dismissible = dismissible;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setIcon(icon) {
        if (this.icon !== icon) {
            this.icon = icon;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowIcon(showIcon) {
        if (this.showIcon !== showIcon) {
            this.showIcon = showIcon;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAction(action) {
        if (this.action !== action) {
            this.action = action;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setTimeout(timeout) {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        
        if (timeout && timeout > 0) {
            this.timeoutId = setTimeout(() => {
                this.dismiss();
            }, timeout);
        }
    }
    
    show() {
        if (!this.visible) {
            this.visible = true;
            this.setStyle('display', 'flex');
            this.setStyle('opacity', '1');
            this.setStyle('transform', 'translateY(0)');
            this.markDirty(DIRTY.PAINT);
            
            this.dispatchEvent({
                type: 'show',
                bubbles: true,
                detail: {
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                }
            });
        }
    }
    
    dismiss() {
        if (this.visible) {
            this.visible = false;
            this.setStyle('opacity', '0');
            this.setStyle('transform', 'translateY(-10px)');
            
            setTimeout(() => {
                this.setStyle('display', 'none');
                this.markDirty(DIRTY.PAINT);
            }, 150);
            
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            
            this.dispatchEvent({
                type: 'dismiss',
                bubbles: true,
                detail: {
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                }
            });
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createAlert(id, options = {}) {
        return new Alert(id, options);
    }
    
    static createSuccessAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'success', message, ...options });
    }
    
    static createWarningAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'warning', message, ...options });
    }
    
    static createErrorAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'error', message, ...options });
    }
    
    static createInfoAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'info', message, ...options });
    }
    
    static createPrimaryAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'primary', message, ...options });
    }
    
    static createSecondaryAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'secondary', message, ...options });
    }
    
    static createDismissibleAlert(id, message, options = {}) {
        return new Alert(id, { message, dismissible: true, ...options });
    }
    
    static createTitledAlert(id, title, message, options = {}) {
        return new Alert(id, { title, message, ...options });
    }
    
    static createAutoDismissAlert(id, message, timeout, options = {}) {
        return new Alert(id, { message, timeout, ...options });
    }
    
    static createActionAlert(id, message, action, options = {}) {
        return new Alert(id, { message, action, ...options });
    }
    
    static createNotificationAlert(id, message, options = {}) {
        return new Alert(id, {
            variant: 'info',
            dismissible: true,
            timeout: 5000,
            message,
            ...options
        });
    }
    
    static createToastAlert(id, message, options = {}) {
        return new Alert(id, {
            variant: 'default',
            dismissible: true,
            timeout: 3000,
            message,
            ...options
        });
    }
}
