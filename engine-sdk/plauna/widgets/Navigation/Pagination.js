// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Pagination - Data navigation widget for Plauna
 * Provides page controls with ellipsis and keyboard navigation
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _paginationSequence = 0;
let _ellipsisSequence = 0;

function _newPaginationId() {
    return `pagination-${Date.now()}-${++_paginationSequence}`;
}

function _newEllipsisId(id) {
    return `${id}-ellipsis-${Date.now()}-${++_ellipsisSequence}`;
}

export class Pagination extends UINode {
    // Widget metadata
    static id = 'pagination';
    static name = 'Pagination';
    static category = 'navigation';
    static icon = '⬅️➡️';
    static description = 'Pagination controls';
    static tags = ['navigation', 'pagination'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            total: 0,
            current: 1,
            pageSize: 10
        };
    }
    
    static create(container, options = {}) {
        const instance = new Pagination(_newPaginationId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newPaginationId(), options = {}) {
        super(id, 'pagination');
        
        // Pagination-specific properties
        this.currentPage = options.currentPage || 1;
        this.totalPages = options.totalPages || 1;
        this.itemsPerPage = options.itemsPerPage || 10;
        this.totalItems = options.totalItems || null;
        this.showItemsPerPage = options.showItemsPerPage !== false;
        this.showJumpToPage = options.showJumpToPage !== false;
        this.maxVisiblePages = options.maxVisiblePages || 7;
        this.size = options.size || 'md';
        this.variant = options.variant || 'default';
        
        // Navigation labels
        this.labels = {
            previous: options.labels?.previous || 'Previous',
            next: options.labels?.next || 'Next',
            first: options.labels?.first || 'First',
            last: options.labels?.last || 'Last',
            page: options.labels?.page || 'Page',
            of: options.labels?.of || 'of',
            items: options.labels?.items || 'items',
            perPage: options.labels?.perPage || 'per page',
            goTo: options.labels?.goTo || 'Go to page'
        };
        
        // Set accessibility
        this.role = 'navigation';
        this.ariaLabel = 'Pagination navigation';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build pagination structure
        this.buildPagination();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: tokens.get('spacing.sm'),
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.get('fontSizes.xs'),
                padding: tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm')
            },
            sm: {
                fontSize: tokens.get('fontSizes.sm'),
                padding: tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md')
            },
            md: {
                fontSize: tokens.get('fontSizes.md'),
                padding: tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg')
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg'),
                padding: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl')
            },
            xl: {
                fontSize: tokens.get('fontSizes.xl'),
                padding: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                color: tokens.get('colors.text.primary')
            },
            minimal: {
                color: tokens.get('colors.text.secondary')
            },
            compact: {
                color: tokens.get('colors.text.primary'),
                gap: tokens.get('spacing.xs')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    setupEventHandlers() {
        // Keyboard navigation
        this.addEventListener('keydown', (event) => {
            switch (event.key) {
                case 'ArrowLeft':
                    event.preventDefault();
                    this.goToPreviousPage();
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    this.goToNextPage();
                    break;
                case 'Home':
                    event.preventDefault();
                    this.goToFirstPage();
                    break;
                case 'End':
                    event.preventDefault();
                    this.goToLastPage();
                    break;
            }
        });
    }
    
    buildPagination() {
        this.innerHTML = '';
        
        if (this.totalPages <= 1) {
            // No pagination needed
            this.setStyles({ display: 'none' });
            return;
        }
        
        this.setStyles({ display: 'flex' });
        
        // Previous button
        const prevButton = this.createNavigationButton('previous', this.labels.previous, () => this.goToPreviousPage());
        prevButton.setDisabled(this.currentPage === 1);
        this.appendChild(prevButton);
        
        // First page button (if not showing page 1)
        if (this.shouldShowFirstPage()) {
            const firstButton = this.createPageButton(1);
            this.appendChild(firstButton);
            
            // Add ellipsis if needed
            if (this.shouldShowStartEllipsis()) {
                const ellipsis = this.createEllipsis();
                this.appendChild(ellipsis);
            }
        }
        
        // Page numbers
        const visiblePages = this.calculateVisiblePages();
        visiblePages.forEach(pageNum => {
            if (pageNum === 'ellipsis') {
                const ellipsis = this.createEllipsis();
                this.appendChild(ellipsis);
            } else {
                const pageButton = this.createPageButton(pageNum);
                this.appendChild(pageButton);
            }
        });
        
        // Last page button (if not showing last page)
        if (this.shouldShowLastPage()) {
            // Add ellipsis if needed
            if (this.shouldShowEndEllipsis()) {
                const ellipsis = this.createEllipsis();
                this.appendChild(ellipsis);
            }
            
            const lastButton = this.createPageButton(this.totalPages);
            this.appendChild(lastButton);
        }
        
        // Next button
        const nextButton = this.createNavigationButton('next', this.labels.next, () => this.goToNextPage());
        nextButton.setDisabled(this.currentPage === this.totalPages);
        this.appendChild(nextButton);
        
        // Items per page selector
        if (this.showItemsPerPage) {
            const itemsPerPage = this.createItemsPerPageSelector();
            this.appendChild(itemsPerPage);
        }
        
        // Jump to page input
        if (this.showJumpToPage && this.totalPages > this.maxVisiblePages) {
            const jumpToPage = this.createJumpToPage();
            this.appendChild(jumpToPage);
        }
    }
    
    calculateVisiblePages() {
        const visiblePages = [];
        const totalPages = this.totalPages;
        const currentPage = this.currentPage;
        const maxVisible = this.maxVisiblePages;
        
        if (totalPages <= maxVisible) {
            // Show all pages
            for (let i = 1; i <= totalPages; i++) {
                visiblePages.push(i);
            }
        } else {
            // Calculate range around current page
            const halfVisible = Math.floor(maxVisible / 2);
            let startPage = Math.max(1, currentPage - halfVisible);
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            
            // Adjust if we're not using the full range
            if (endPage - startPage + 1 < maxVisible) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }
            
            for (let i = startPage; i <= endPage; i++) {
                visiblePages.push(i);
            }
        }
        
        return visiblePages;
    }
    
    shouldShowFirstPage() {
        const visiblePages = this.calculateVisiblePages();
        return visiblePages.length > 0 && visiblePages[0] !== 1;
    }
    
    shouldShowLastPage() {
        const visiblePages = this.calculateVisiblePages();
        return visiblePages.length > 0 && visiblePages[visiblePages.length - 1] !== this.totalPages;
    }
    
    shouldShowStartEllipsis() {
        const visiblePages = this.calculateVisiblePages();
        return this.shouldShowFirstPage() && visiblePages[0] > 2;
    }
    
    shouldShowEndEllipsis() {
        const visiblePages = this.calculateVisiblePages();
        return this.shouldShowLastPage() && visiblePages[visiblePages.length - 1] < this.totalPages - 1;
    }
    
    createNavigationButton(type, label, onClick) {
        const button = new UINode(`${this.id}-${type}`, 'button');
        button.role = 'button';
        button.ariaLabel = label;
        
        button.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '40px',
            height: '40px',
            padding: tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm'),
            backgroundColor: tokens.get('colors.background.primary'),
            color: tokens.get('colors.text.primary'),
            border: '1px solid ' + tokens.get('colors.border.medium'),
            borderRadius: tokens.get('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: tokens.get('fontWeights.medium'),
            cursor: 'pointer',
            transition: 'all 150ms ease',
            outline: 'none'
        });
        
        // Add icon
        const icon = new UINode(`${button.id}-icon`, 'span');
        icon.textContent = type === 'previous' ? '←' : '→';
        icon.setStyles({
            marginRight: type === 'previous' ? tokens.get('spacing.xs') : '0',
            marginLeft: type === 'next' ? tokens.get('spacing.xs') : '0'
        });
        button.appendChild(icon);
        
        // Add text (if not compact variant)
        if (this.variant !== 'compact') {
            const text = new UINode(`${button.id}-text`, 'span');
            text.textContent = label;
            text.setStyles({
                fontSize: 'inherit',
                fontWeight: 'inherit'
            });
            button.appendChild(text);
        }
        
        // Add hover effects
        button.addEventListener('mouseenter', () => {
            button.setStyle('backgroundColor', tokens.get('colors.background.tertiary'));
            button.setStyle('border-color', tokens.get('colors.primary.500'));
        });
        
        button.addEventListener('mouseleave', () => {
            button.setStyle('backgroundColor', tokens.get('colors.background.primary'));
            button.setStyle('border-color', tokens.get('colors.border.medium'));
        });
        
        button.addEventListener('focus', () => {
            button.setStyle('border-color', tokens.get('colors.primary.500'));
            button.setStyle('boxShadow', '0 0 0 2px ' + tokens.get('colors.primary.200'));
        });
        
        button.addEventListener('blur', () => {
            button.setStyle('border-color', tokens.get('colors.border.medium'));
            button.setStyle('boxShadow', 'none');
        });
        
        button.addEventListener('click', onClick);
        
        return button;
    }
    
    createPageButton(pageNum) {
        const button = new UINode(`${this.id}-page-${pageNum}`, 'button');
        button.role = 'button';
        button.ariaLabel = 'Page ' + pageNum;
        button.ariaCurrent = pageNum === this.currentPage ? 'page' : null;
        button.tabIndex = pageNum === this.currentPage ? '0' : '-1';
        
        const isActive = pageNum === this.currentPage;
        
        button.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '40px',
            height: '40px',
            padding: tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm'),
            backgroundColor: isActive ? tokens.get('colors.primary.500') : tokens.get('colors.background.primary'),
            color: isActive ? tokens.get('colors.text.inverse') : tokens.get('colors.text.primary'),
            border: isActive ? '1px solid ' + tokens.get('colors.primary.500') : '1px solid ' + tokens.get('colors.border.medium'),
            borderRadius: tokens.get('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: isActive ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium'),
            cursor: 'pointer',
            transition: 'all 150ms ease',
            outline: 'none'
        });
        
        button.textContent = pageNum.toString();
        
        // Add hover effects for non-active buttons
        if (!isActive) {
            button.addEventListener('mouseenter', () => {
                button.setStyle('backgroundColor', tokens.get('colors.background.tertiary'));
                button.setStyle('border-color', tokens.get('colors.primary.500'));
            });
            
            button.addEventListener('mouseleave', () => {
                button.setStyle('backgroundColor', tokens.get('colors.background.primary'));
                button.setStyle('border-color', tokens.get('colors.border.medium'));
            });
            
            button.addEventListener('focus', () => {
                button.setStyle('border-color', tokens.get('colors.primary.500'));
                button.setStyle('boxShadow', '0 0 0 2px ' + tokens.get('colors.primary.200'));
            });
            
            button.addEventListener('blur', () => {
                button.setStyle('border-color', tokens.get('colors.border.medium'));
                button.setStyle('boxShadow', 'none');
            });
        }
        
        button.addEventListener('click', () => this.goToPage(pageNum));
        
        return button;
    }
    
    createEllipsis() {
        const ellipsis = new UINode(_newEllipsisId(this.id), 'span');
        ellipsis.role = 'presentation';
        ellipsis.ariaHidden = 'true';
        
        ellipsis.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '40px',
            height: '40px',
            color: tokens.get('colors.text.disabled'),
            fontSize: 'inherit',
            userSelect: 'none',
            pointerEvents: 'none'
        });
        
        ellipsis.textContent = '...';
        return ellipsis;
    }
    
    createItemsPerPageSelector() {
        const container = new UINode(`${this.id}-items-per-page`, 'div');
        container.setStyles({
            display: 'flex',
            alignItems: 'center',
            gap: tokens.get('spacing.sm'),
            fontSize: 'inherit'
        });
        
        // Label
        const label = new UINode(`${container.id}-label`, 'span');
        label.textContent = this.labels.items + ' ' + this.labels.perPage;
        label.setStyles({
            color: tokens.get('colors.text.secondary'),
            fontSize: 'inherit'
        });
        container.appendChild(label);
        
        // Select
        const select = new UINode(`${container.id}-select`, 'select');
        select.role = 'listbox';
        select.ariaLabel = this.labels.items + ' ' + this.labels.perPage;
        
        select.setStyles({
            padding: tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm'),
            backgroundColor: tokens.get('colors.background.primary'),
            color: tokens.get('colors.text.primary'),
            border: '1px solid ' + tokens.get('colors.border.medium'),
            borderRadius: tokens.get('borderRadius.md'),
            fontSize: 'inherit',
            cursor: 'pointer',
            outline: 'none'
        });
        
        // Add options
        const commonSizes = [10, 20, 50, 100];
        commonSizes.forEach(size => {
            const option = document.createElement('option');
            option.value = size.toString();
            option.textContent = size.toString();
            option.selected = size === this.itemsPerPage;
            select.element.appendChild(option);
        });
        
        select.addEventListener('change', () => {
            const newSize = parseInt(select.element.value);
            this.setItemsPerPage(newSize);
        });
        
        container.appendChild(select);
        return container;
    }
    
    createJumpToPage() {
        const container = new UINode(`${this.id}-jump-to-page`, 'div');
        container.setStyles({
            display: 'flex',
            alignItems: 'center',
            gap: tokens.get('spacing.sm'),
            fontSize: 'inherit'
        });
        
        // Label
        const label = new UINode(`${container.id}-label`, 'span');
        label.textContent = this.labels.goTo;
        label.setStyles({
            color: tokens.get('colors.text.secondary'),
            fontSize: 'inherit'
        });
        container.appendChild(label);
        
        // Input
        const input = new UINode(`${container.id}-input`, 'input');
        input.type = 'number';
        input.min = '1';
        input.max = this.totalPages.toString();
        input.value = this.currentPage.toString();
        input.placeholder = '1';
        
        input.setStyles({
            width: '60px',
            padding: tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm'),
            backgroundColor: tokens.get('colors.background.primary'),
            color: tokens.get('colors.text.primary'),
            border: '1px solid ' + tokens.get('colors.border.medium'),
            borderRadius: tokens.get('borderRadius.md'),
            fontSize: 'inherit',
            textAlign: 'center',
            outline: 'none'
        });
        
        input.addEventListener('focus', () => {
            input.setStyle('border-color', tokens.get('colors.primary.500'));
            input.setStyle('boxShadow', '0 0 0 2px ' + tokens.get('colors.primary.200'));
        });
        
        input.addEventListener('blur', () => {
            input.setStyle('border-color', tokens.get('colors.border.medium'));
            input.setStyle('boxShadow', 'none');
        });
        
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const pageNum = parseInt(input.element.value);
                if (pageNum >= 1 && pageNum <= this.totalPages) {
                    this.goToPage(pageNum);
                }
            }
        });
        
        container.appendChild(input);
        
        // Go button
        const goButton = new UINode(`${container.id}-go`, 'button');
        goButton.textContent = 'Go';
        goButton.setStyles({
            padding: tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm'),
            backgroundColor: tokens.get('colors.primary.500'),
            color: tokens.get('colors.text.inverse'),
            border: 'none',
            borderRadius: tokens.get('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: tokens.get('fontWeights.medium'),
            cursor: 'pointer',
            transition: 'all 150ms ease',
            outline: 'none'
        });
        
        goButton.addEventListener('click', () => {
            const pageNum = parseInt(input.element.value);
            if (pageNum >= 1 && pageNum <= this.totalPages) {
                this.goToPage(pageNum);
            }
        });
        
        container.appendChild(goButton);
        return container;
    }
    
    // Navigation methods
    goToPage(pageNum) {
        if (pageNum < 1 || pageNum > this.totalPages || pageNum === this.currentPage) {
            return;
        }
        
        this.currentPage = pageNum;
        this.buildPagination();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        // Emit page change event
        this.dispatchEvent({
            type: 'pagechange',
            bubbles: false,
            detail: { 
                currentPage: this.currentPage,
                totalPages: this.totalPages,
                itemsPerPage: this.itemsPerPage
            }
        });
    }
    
    goToFirstPage() {
        this.goToPage(1);
    }
    
    goToLastPage() {
        this.goToPage(this.totalPages);
    }
    
    goToNextPage() {
        if (this.currentPage < this.totalPages) {
            this.goToPage(this.currentPage + 1);
        }
    }
    
    goToPreviousPage() {
        if (this.currentPage > 1) {
            this.goToPage(this.currentPage - 1);
        }
    }
    
    // Setter methods
    setCurrentPage(pageNum) {
        this.goToPage(pageNum);
    }
    
    setTotalPages(totalPages) {
        this.totalPages = Math.max(1, totalPages);
        this.currentPage = Math.min(this.currentPage, this.totalPages);
        this.buildPagination();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setItemsPerPage(itemsPerPage) {
        this.itemsPerPage = itemsPerPage;
        
        // Recalculate total pages if total items is known
        if (this.totalItems) {
            this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
            this.currentPage = Math.min(this.currentPage, this.totalPages);
        }
        
        this.buildPagination();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        // Emit items per page change event
        this.dispatchEvent({
            type: 'itemsperpagechange',
            bubbles: false,
            detail: {
                itemsPerPage: this.itemsPerPage,
                currentPage: this.currentPage,
                totalPages: this.totalPages
            }
        });
    }
    
    setTotalItems(totalItems) {
        this.totalItems = totalItems;
        this.totalPages = Math.ceil(totalItems / this.itemsPerPage);
        this.currentPage = Math.min(this.currentPage, this.totalPages);
        this.buildPagination();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setSize(size) {
        this.size = size;
        this.setupStyles();
        this.buildPagination();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setVariant(variant) {
        this.variant = variant;
        this.setupStyles();
        this.buildPagination();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setMaxVisiblePages(maxVisiblePages) {
        this.maxVisiblePages = maxVisiblePages;
        this.buildPagination();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    // Static factory method
    static createFromItems(id, items, itemsPerPage = 10, options = {}) {
        const totalItems = items.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        
        return new Pagination(id, {
            currentPage: options.currentPage || 1,
            totalPages,
            totalItems,
            itemsPerPage,
            ...options
        });
    }
}
