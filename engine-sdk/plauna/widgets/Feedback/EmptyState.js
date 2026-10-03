// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EmptyState - Empty state widget for Plauna
 * Provides empty state functionality with multiple variants and content options
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _emptyStateSequence = 0;

function _newEmptyStateId() {
    return `empty-state-${Date.now()}-${++_emptyStateSequence}`;
}

export class EmptyState extends UINode {
    // Widget metadata
    static id = 'empty-state';
    static name = 'EmptyState';
    static category = 'feedback';
    static icon = '🚫';
    static description = 'Empty state placeholder';
    static tags = ['feedback', 'empty', 'placeholder'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            title: 'No data',
            description: '',
            icon: '📭',
            action: null
        };
    }
    
    static create(container, options = {}) {
        const instance = new EmptyState(_newEmptyStateId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newEmptyStateId(), options = {}) {
        super(id, 'empty-state');
        
        // EmptyState-specific properties
        this.title = options.title || 'No data';
        this.description = options.description || 'There is no data to display at the moment.';
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.icon = options.icon || null;
        this.action = options.action || null;
        this.image = options.image || null;
        this.centered = options.centered !== false;
        this.fullWidth = options.fullWidth || false;
        
        // Set accessibility
        this.role = 'status';
        this.ariaLive = 'polite';
        this.ariaAtomic = 'true';
        this.ariaLabel = this.title || 'Empty state';
        
        // Set default styles
        this.setupStyles();
        
        // Build empty state structure
        this.buildEmptyState();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const layoutStyles = this.getLayoutStyles();
        
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens.get('spacing.lg'),
            padding: this.getPadding(),
            color: this.getTextColor(),
            textAlign: 'center',
            outline: 'none',
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
                padding: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl')
            },
            sm: {
                fontSize: tokens.get('fontSizes.sm'),
                padding: tokens.get('spacing.xl') + ' ' + tokens.get('spacing.xxl')
            },
            md: {
                fontSize: tokens.get('fontSizes.md'),
                padding: tokens.get('spacing.xxl') + ' ' + tokens.get('spacing.xxxl')
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg'),
                padding: tokens.get('spacing.xxxl') + ' ' + tokens.get('spacing.xxxxl')
            },
            xl: {
                fontSize: tokens.get('fontSizes.xl'),
                padding: tokens.get('spacing.xxxxl') + ' ' + tokens.get('spacing.xxxxl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl'),
            sm: tokens.get('spacing.xl') + ' ' + tokens.get('spacing.xxl'),
            md: tokens.get('spacing.xxl') + ' ' + tokens.get('spacing.xxxl'),
            lg: tokens.get('spacing.xxxl') + ' ' + tokens.get('spacing.xxxxl'),
            xl: tokens.get('spacing.xxxxl') + ' ' + tokens.get('spacing.xxxxl')
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
    
    getLayoutStyles() {
        const layouts = {
            centered: {
                alignItems: 'center',
                justifyContent: 'center'
            },
            fullWidth: {
                width: '100%'
            }
        };
        
        const layoutStyles = {};
        if (this.centered) {
            Object.assign(layoutStyles, layouts.centered);
        }
        if (this.fullWidth) {
            Object.assign(layoutStyles, layouts.fullWidth);
        }
        
        return layoutStyles;
    }
    
    getTextColor() {
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
    
    getIconColor() {
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
    
    buildEmptyState() {
        this.innerHTML = '';
        
        // Create image if provided
        if (this.image) {
            const image = this.createImage();
            this.appendChild(image);
        }
        
        // Create icon if provided
        if (this.showIcon && this.icon) {
            const icon = this.createIcon();
            this.appendChild(icon);
        }
        
        // Create content container
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'align-items: center;' +
            'max-width: 500px;'
        );
        
        // Add title
        const titleElement = document.createElement('div');
        titleElement.textContent = this.title;
        titleElement.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.xl') + ';' +
            'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
            'color: inherit;' +
            'line-height: 1.2;' +
            'margin-bottom: ' + tokens.get('spacing.sm') + ';'
        );
        contentContainer.appendChild(titleElement);
        
        // Add description
        const descriptionElement = document.createElement('div');
        descriptionElement.textContent = this.description;
        descriptionElement.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.md') + ';' +
            'color: inherit;' +
            'line-height: 1.4;' +
            'opacity: 0.8;' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';'
        );
        contentContainer.appendChild(descriptionElement);
        
        // Add action button if provided
        if (this.action) {
            const actionButton = this.createActionButton();
            contentContainer.appendChild(actionButton);
        }
        
        this.appendChild(contentContainer);
    }
    
    createImage() {
        const image = document.createElement('img');
        image.src = this.image.src;
        image.alt = this.image.alt || '';
        image.style.cssText = (
            'width: 120px;' +
            'height: 120px;' +
            'object-fit: cover;' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';' +
            'opacity: 0.7;' +
            'transition: all 150ms ease;'
        );
        
        image.addEventListener('mouseenter', () => {
            image.style.opacity = '1';
        });
        
        image.addEventListener('mouseleave', () => {
            image.style.opacity = '0.7';
        });
        
        return image;
    }
    
    createIcon() {
        const icon = document.createElement('div');
        icon.style.cssText = (
            'width: 64px;' +
            'height: 64px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'font-size: ' + tokens.get('fontSizes.xxxl') + ';' +
            'color: ' + this.getIconColor() + ';' +
            'margin-bottom: ' + tokens.get('spacing.md') + ';' +
            'opacity: 0.7;' +
            'transition: all 150ms ease;'
        );
        
        // Get icon based on variant if no custom icon is provided
        const iconText = this.icon || this.getDefaultIcon();
        icon.textContent = iconText;
        
        icon.addEventListener('mouseenter', () => {
            icon.style.opacity = '1';
        });
        
        icon.addEventListener('mouseleave', () => {
            icon.style.opacity = '0.7';
        });
        
        return icon;
    }
    
    getDefaultIcon() {
        const variantIcons = {
            default: '📭',
            primary: '📋',
            secondary: '📋',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️'
        };
        return variantIcons[this.variant] || variantIcons.default;
    }
    
    createActionButton() {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.textContent = this.action.label || 'Action';
        actionButton.style.cssText = (
            'background: ' + this.getActionButtonBackground() + ';' +
            'color: ' + this.getActionButtonTextColor() + ';' +
            'border: 1px solid ' + this.getActionButtonBorderColor() + ';' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
            'font-size: ' + tokens.get('fontSizes.md') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'text-decoration: none;' +
            'outline: none;'
        );
        
        actionButton.addEventListener('mouseenter', () => {
            actionButton.style.background = this.getActionButtonHoverBackground();
            actionButton.style.transform = 'translateY(-1px)';
            actionButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.background = this.getActionButtonBackground();
            actionButton.style.transform = 'translateY(0)';
            actionButton.style.boxShadow = 'none';
        });
        
        actionButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.action.onClick && typeof this.action.onClick === 'function') {
                this.action.onClick({
                    title: this.title,
                    description: this.description,
                    variant: this.variant
                });
            }
            
            this.dispatchEvent({
                type: 'action',
                bubbles: true,
                detail: {
                    title: this.title,
                    description: this.description,
                    variant: this.variant
                }
            });
        });
        
        return actionButton;
    }
    
    getActionButtonBackground() {
        if (this.variant === 'default') {
            return tokens.get('colors.background.primary');
        }
        
        const variantColors = {
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.primary;
    }
    
    getActionButtonTextColor() {
        if (this.variant === 'default') {
            return tokens.get('colors.text.primary');
        }
        return 'white';
    }
    
    getActionButtonBorderColor() {
        if (this.variant === 'default') {
            return tokens.get('colors.border.medium');
        }
        
        const variantColors = {
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.primary;
    }
    
    getActionButtonHoverBackground() {
        if (this.variant === 'default') {
            return tokens.get('colors.hover.primary');
        }
        
        const variantColors = {
            primary: tokens.get('colors.primary.hover'),
            secondary: tokens.get('colors.secondary.hover'),
            success: tokens.get('colors.success.hover'),
            warning: tokens.get('colors.warning.hover'),
            error: tokens.get('colors.error.hover'),
            info: tokens.get('colors.info.hover')
        };
        return variantColors[this.variant] || variantColors.primary;
    }
    
    // Public methods
    setTitle(title) {
        if (this.title !== title) {
            this.title = title;
            this.ariaLabel = title || this.ariaLabel || 'Empty state';
            this.buildEmptyState();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.buildEmptyState();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildEmptyState();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildEmptyState();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setIcon(icon) {
        if (this.icon !== icon) {
            this.icon = icon;
            this.buildEmptyState();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setImage(image) {
        if (this.image !== image) {
            this.image = image;
            this.buildEmptyState();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAction(action) {
        if (this.action !== action) {
            this.action = action;
            this.buildEmptyState();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setCentered(centered) {
        if (this.centered !== centered) {
            this.centered = centered;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setFullWidth(fullWidth) {
        if (this.fullWidth !== fullWidth) {
            this.fullWidth = fullWidth;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    show() {
        this.setStyle('display', 'flex');
        this.setStyle('opacity', '1');
        this.markDirty(DIRTY.PAINT);
    }
    
    hide() {
        this.setStyle('display', 'none');
        this.setStyle('opacity', '0');
        this.markDirty(DIRTY.PAINT);
    }
    
    // Static factory methods
    static createEmptyState(id, options = {}) {
        return new EmptyState(id, options);
    }
    
    static createNoDataEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'No Data',
            description: 'There is no data to display at the moment.',
            ...options
        });
    }
    
    static createNoResultsEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'No Results',
            description: 'No results found for your search.',
            icon: '🔍',
            ...options
        });
    }
    
    static createNoItemsEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'No Items',
            description: 'There are no items to display.',
            icon: '📦',
            ...options
        });
    }
    
    static createNotFoundEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'Not Found',
            description: 'The requested resource could not be found.',
            icon: '🔍',
            variant: 'error',
            ...options
        });
    }
    
    static createOfflineEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'Offline',
            description: 'You appear to be offline. Please check your connection.',
            icon: '⚫',
            variant: 'warning',
            ...options
        });
    }
    
    static createErrorEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'Error',
            description: 'An error occurred while loading data.',
            icon: '❌',
            variant: 'error',
            ...options
        });
    }
    
    static createLoadingEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'Loading',
            description: 'Please wait while we load your data.',
            icon: '⏳',
            variant: 'info',
            ...options
        });
    }
    
    static createPrimaryEmptyState(id, options = {}) {
        return new EmptyState(id, { variant: 'primary', ...options });
    }
    
    static createSecondaryEmptyState(id, options = {}) {
        return new EmptyState(id, { variant: 'secondary', ...options });
    }
    
    static createSuccessEmptyState(id, options = {}) {
        return new EmptyState(id, { variant: 'success', ...options });
    }
    
    static createWarningEmptyState(id, options = {}) {
        return new EmptyState(id, { variant: 'warning', ...options });
    }
    
    static createErrorEmptyState(id, options = {}) {
        return new EmptyState(id, { variant: 'error', ...options });
    }
    
    static createInfoEmptyState(id, options = {}) {
        return new EmptyState(id, { variant: 'info', ...options });
    }
    
    static createSmallEmptyState(id, options = {}) {
        return new EmptyState(id, { size: 'sm', ...options });
    }
    
    static createLargeEmptyState(id, options = {}) {
        return new EmptyState(id, { size: 'lg', ...options });
    }
    
    static createXLargeEmptyState(id, options = {}) {
        return new EmptyState(id, { size: 'xl', ...options });
    }
    
    static createCenteredEmptyState(id, options = {}) {
        return new EmptyState(id, { centered: true, ...options });
    }
    
    static createFullWidthEmptyState(id, options = {}) {
        return new EmptyState(id, { fullWidth: true, ...options });
    }
    
    static createIconEmptyState(id, icon, options = {}) {
        return new EmptyState(id, { icon, ...options });
    }
    
    static createImageEmptyState(id, image, options = {}) {
        return new EmptyState(id, { image, ...options });
    }
    
    static createActionEmptyState(id, action, options = {}) {
        return new EmptyState(id, { action, ...options });
    }
    
    static createSearchEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'No Search Results',
            description: 'Try adjusting your search terms or filters.',
            icon: '🔍',
            action: {
                label: 'Clear Filters',
                onClick: () => {
                    console.log('Clear filters clicked');
                }
            },
            ...options
        });
    }
    
    static createUploadEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'No Files Yet',
            description: 'Drag and drop files here or click to upload.',
            icon: '📁',
            action: {
                label: 'Browse Files',
                onClick: () => {
                    console.log('Browse files clicked');
                }
            },
            ...options
        });
    }
    
    static createCartEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'Cart is Empty',
            description: 'Add items to your cart to get started.',
            icon: '🛒',
            action: {
                label: 'Start Shopping',
                onClick: () => {
                    console.log('Start shopping clicked');
                }
            },
            ...options
        });
    }
    
    static createInboxEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'No Messages',
            description: 'Your inbox is empty. New messages will appear here.',
            icon: '📬',
            action: {
                label: 'Compose',
                onClick: () => {
                    console.log('Compose clicked');
                }
            },
            ...options
        });
    }
    
    static createCalendarEmptyState(id, options = {}) {
        return new EmptyState(id, {
            title: 'No Events',
            description: 'No events scheduled for this day.',
            icon: '📅',
            action: {
                label: 'Add Event',
                onClick: () => {
                    console.log('Add event clicked');
                }
            },
            ...options
        });
    }
}
