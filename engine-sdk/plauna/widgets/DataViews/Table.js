// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Table - Data table widget for Plauna
 * Provides table functionality with sorting, filtering, and pagination
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _tableSequence = 0;

function _newTableId() {
    return `table-${Date.now()}-${++_tableSequence}`;
}

export class Table extends UINode {
    // Widget metadata
    static id = 'table';
    static name = 'Table';
    static category = 'dataviews';
    static icon = '📊';
    static description = 'Data table widget';
    static tags = ['dataviews', 'table', 'data'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            columns: [],
            data: [],
            pagination: true,
            pageSize: 10
        };
    }
    
    static create(container, options = {}) {
        const instance = new Table(_newTableId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newTableId(), options = {}) {
        super(id, 'table');
        
        // Table-specific properties
        this.columns = options.columns || [];
        this.data = options.data || [];
        this.sortColumn = options.sortColumn || null;
        this.sortDirection = options.sortDirection || 'asc'; // asc, desc
        this.filterValue = options.filterValue || '';
        this.filterColumn = options.filterColumn || null;
        this.pagination = options.pagination !== false;
        this.currentPage = options.currentPage || 1;
        this.pageSize = options.pageSize || 10;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.striped = options.striped !== false;
        this.bordered = options.bordered || false;
        this.hoverable = options.hoverable !== false;
        this.selectable = options.selectable || false;
        this.loading = options.loading || false;
        this.empty = options.empty || 'No data available';
        
        // State management
        this.selectedRows = new Set();
        this.filteredData = [];
        
        // Set accessibility
        this.role = 'table';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build table structure
        this.buildTable();
        
        // Initialize data
        if (options.data) {
            this.setData(options.data);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'block',
            width: '100%',
            overflow: 'auto',
            outline: 'none',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.get('fontSizes.xs')
            },
            sm: {
                fontSize: tokens.get('fontSizes.sm')
            },
            md: {
                fontSize: tokens.get('fontSizes.md')
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg')
            },
            xl: {
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
    
    setupEventHandlers() {
        this.addEventListener('click', (e) => {
            if (this.selectable) {
                const row = e.target.closest('tr');
                if (row && row.dataset.rowIndex) {
                    this.toggleRowSelection(parseInt(row.dataset.rowIndex));
                }
            }
        });
        
        this.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowUp':
                case 'ArrowDown':
                case 'Home':
                case 'End':
                case 'PageUp':
                case 'PageDown':
                    this.handleKeyboardNavigation(e);
                    break;
                case ' ':
                case 'Enter':
                    if (this.selectable && this.focusedRow !== null) {
                        e.preventDefault();
                        this.toggleRowSelection(this.focusedRow);
                    }
                    break;
            }
        });
    }
    
    buildTable() {
        this.innerHTML = '';
        
        // Create table element
        const table = new UINode(`${this.id}-table`, 'table');
        table.setStyles({
            width: '100%',
            borderCollapse: this.bordered ? 'separate' : 'collapse',
            borderSpacing: this.bordered ? '0' : '0',
            fontSize: 'inherit'
        });
        
        // Create table header
        const thead = new UINode(`${this.id}-thead`, 'thead');
        const headerRow = new UINode(`${this.id}-header-row`, 'tr');
        headerRow.setStyles({
            backgroundColor: this.getHeaderBackgroundColor(),
            borderBottom: this.bordered ? `1px solid ${tokens.get('colors.border.medium')}` : 'none'
        });
        
        // Create header cells
        this.columns.forEach((column, index) => {
            const th = new UINode(`${this.id}-header-${index}`, 'th');
            th.textContent = column.label || column.key;
            th.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
                'text-align: ' + (column.align || 'left') + ';' +
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'color: ' + this.getHeaderTextColor() + ';' +
                'background: ' + this.getHeaderBackgroundColor() + ';' +
                'border-bottom: ' + (this.bordered ? '1px solid ' + tokens.get('colors.border.medium') : 'none') + ';' +
                'position: relative;' +
                'cursor: ' + (column.sortable ? 'pointer' : 'default') + ';' +
                'user-select: none;' +
                'transition: all 150ms ease;'
            );
            
            // Add sort indicator if sortable
            if (column.sortable) {
                const sortIndicator = document.createElement('span');
                sortIndicator.textContent = this.sortColumn === column.key ? 
                    (this.sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
                sortIndicator.style.cssText = (
                    'margin-left: 4px;' +
                    'font-size: 12px;' +
                    'opacity: 0.7;'
                );
                th.element.appendChild(sortIndicator);
                
                th.element.addEventListener('click', () => {
                    this.sortByColumn(column.key);
                });
            }
            
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create table body
        const tbody = new UINode(`${this.id}-tbody`, 'tbody');
        this.tbody = tbody;
        table.appendChild(tbody);
        
        // Create table footer if pagination is enabled
        if (this.pagination) {
            const tfoot = new UINode(`${this.id}-tfoot`, 'tfoot');
            const footerRow = new UINode(`${this.id}-footer-row`, 'tr');
            const footerCell = new UINode(`${this.id}-footer-cell`, 'td');
            footerCell.setAttribute('colspan', this.columns.length);
            footerCell.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ';' +
                'text-align: center;' +
                'border-top: ' + (this.bordered ? '1px solid ' + tokens.get('colors.border.medium') : 'none') + ';'
            );
            
            // Create pagination controls
            const paginationContainer = document.createElement('div');
            paginationContainer.style.cssText = (
                'display: flex;' +
                'justify-content: center;' +
                'align-items: center;' +
                'gap: ' + tokens.get('spacing.md') + ';'
            );
            
            // Previous button
            const prevButton = document.createElement('button');
            prevButton.textContent = 'Previous';
            prevButton.style.cssText = (
                'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                'background: ' + tokens.get('colors.background.primary') + ';' +
                'color: ' + tokens.get('colors.text.primary') + ';' +
                'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'cursor: ' + (this.currentPage > 1 ? 'pointer' : 'not-allowed') + ';' +
                'opacity: ' + (this.currentPage > 1 ? '1' : '0.5') + ';' +
                'transition: all 150ms ease;'
            );
            
            prevButton.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.setPage(this.currentPage - 1);
                }
            });
            
            // Page info
            const pageInfo = document.createElement('span');
            pageInfo.textContent = `Page ${this.currentPage}`;
            pageInfo.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';'
            );
            
            // Next button
            const nextButton = document.createElement('button');
            nextButton.textContent = 'Next';
            nextButton.style.cssText = (
                'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                'background: ' + tokens.get('colors.background.primary') + ';' +
                'color: ' + tokens.get('colors.text.primary') + ';' +
                'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'cursor: ' + (this.hasNextPage() ? 'pointer' : 'not-allowed') + ';' +
                'opacity: ' + (this.hasNextPage() ? '1' : '0.5') + ';' +
                'transition: all 150ms ease;'
            );
            
            nextButton.addEventListener('click', () => {
                if (this.hasNextPage()) {
                    this.setPage(this.currentPage + 1);
                }
            });
            
            paginationContainer.appendChild(prevButton);
            paginationContainer.appendChild(pageInfo);
            paginationContainer.appendChild(nextButton);
            
            footerCell.element.appendChild(paginationContainer);
            footerRow.appendChild(footerCell);
            tfoot.appendChild(footerRow);
            table.appendChild(tfoot);
        }
        
        this.appendChild(table);
        this.table = table;
        
        // Render initial data
        this.renderData();
    }
    
    getHeaderBackgroundColor() {
        const variantColors = {
            default: tokens.get('colors.background.secondary'),
            primary: tokens.get('colors.primary.50'),
            secondary: tokens.get('colors.secondary.50'),
            success: tokens.get('colors.success.50'),
            warning: tokens.get('colors.warning.50'),
            error: tokens.get('colors.error.50')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getHeaderTextColor() {
        const variantColors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.primary.700'),
            secondary: tokens.get('colors.secondary.700'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getRowBackgroundColor(rowIndex) {
        if (this.selectedRows.has(rowIndex)) {
            return tokens.get('colors.primary.50');
        }
        
        if (this.striped && rowIndex % 2 === 1) {
            return tokens.get('colors.background.secondary');
        }
        
        return tokens.get('colors.background.primary');
    }
    
    renderData() {
        if (!this.tbody) return;
        
        this.tbody.innerHTML = '';
        
        if (this.loading) {
            // Show loading state
            const loadingRow = new UINode(`${this.id}-loading-row`, 'tr');
            const loadingCell = new UINode(`${this.id}-loading-cell`, 'td');
            loadingCell.setAttribute('colspan', this.columns.length);
            loadingCell.style.cssText = (
                'padding: ' + tokens.get('spacing.lg') + ';' +
                'text-align: center;' +
                'color: ' + tokens.get('colors.text.secondary') + ';'
            );
            loadingCell.textContent = 'Loading...';
            loadingRow.appendChild(loadingCell);
            this.tbody.appendChild(loadingRow);
            return;
        }
        
        const dataToRender = this.getPaginatedData();
        
        if (dataToRender.length === 0) {
            // Show empty state
            const emptyRow = new UINode(`${this.id}-empty-row`, 'tr');
            const emptyCell = new UINode(`${this.id}-empty-cell`, 'td');
            emptyCell.setAttribute('colspan', this.columns.length);
            emptyCell.style.cssText = (
                'padding: ' + tokens.get('spacing.lg') + ';' +
                'text-align: center;' +
                'color: ' + tokens.get('colors.text.secondary') + ';'
            );
            emptyCell.textContent = this.empty;
            emptyRow.appendChild(emptyCell);
            this.tbody.appendChild(emptyRow);
            return;
        }
        
        // Render data rows
        dataToRender.forEach((row, index) => {
            const actualIndex = this.getActualRowIndex(index);
            const tr = new UINode(`${this.id}-row-${actualIndex}`, 'tr');
            tr.dataset.rowIndex = actualIndex.toString();
            
            // Row styling
            tr.style.cssText = (
                'background: ' + this.getRowBackgroundColor(actualIndex) + ';' +
                'transition: all 150ms ease;'
            );
            
            if (this.hoverable) {
                tr.element.addEventListener('mouseenter', () => {
                    tr.style.background = tokens.get('colors.background.tertiary');
                });
                
                tr.element.addEventListener('mouseleave', () => {
                    tr.style.background = this.getRowBackgroundColor(actualIndex);
                });
            }
            
            // Create cells
            this.columns.forEach((column, colIndex) => {
                const td = new UINode(`${this.id}-cell-${actualIndex}-${colIndex}`, 'td');
                td.textContent = this.formatCellValue(row[column.key], column);
                td.style.cssText = (
                    'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
                    'text-align: ' + (column.align || 'left') + ';' +
                    'border-bottom: ' + (this.bordered ? '1px solid ' + tokens.get('colors.border.light') : 'none') + ';' +
                    'color: ' + tokens.get('colors.text.primary') + ';'
                );
                
                tr.appendChild(td);
            });
            
            this.tbody.appendChild(tr);
        });
        
        this.updatePagination();
    }
    
    formatCellValue(value, column) {
        if (column.formatter && typeof column.formatter === 'function') {
            return column.formatter(value);
        }
        
        if (value === null || value === undefined) {
            return '';
        }
        
        return String(value);
    }
    
    getActualRowIndex(displayIndex) {
        if (this.pagination) {
            return (this.currentPage - 1) * this.pageSize + displayIndex;
        }
        return displayIndex;
    }
    
    getPaginatedData() {
        if (!this.pagination) {
            return this.filteredData;
        }
        
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        return this.filteredData.slice(startIndex, endIndex);
    }
    
    getTotalPages() {
        return Math.ceil(this.filteredData.length / this.pageSize);
    }
    
    hasNextPage() {
        return this.currentPage < this.getTotalPages();
    }
    
    updatePagination() {
        if (!this.pagination) return;
        
        // Update pagination controls
        const prevButton = this.querySelector('button');
        const nextButton = this.querySelectorAll('button')[1];
        const pageInfo = this.querySelector('span');
        
        if (prevButton) {
            prevButton.style.opacity = this.currentPage > 1 ? '1' : '0.5';
            prevButton.style.cursor = this.currentPage > 1 ? 'pointer' : 'not-allowed';
        }
        
        if (nextButton) {
            nextButton.style.opacity = this.hasNextPage() ? '1' : '0.5';
            nextButton.style.cursor = this.hasNextPage() ? 'pointer' : 'not-allowed';
        }
        
        if (pageInfo) {
            pageInfo.textContent = `Page ${this.currentPage} of ${this.getTotalPages()}`;
        }
    }
    
    // Public methods
    setData(data) {
        this.data = data || [];
        this.applyFilter();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setColumns(columns) {
        this.columns = columns || [];
        this.buildTable();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    sortByColumn(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        
        this.filteredData.sort((a, b) => {
            const aValue = a[column];
            const bValue = b[column];
            
            if (aValue < bValue) {
                return this.sortDirection === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return this.sortDirection === 'asc' ? 1 : -1;
            }
            return 0;
        });
        
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'sort',
            bubbles: true,
            detail: {
                column,
                direction: this.sortDirection
            }
        });
    }
    
    setFilter(filterValue, filterColumn = null) {
        this.filterValue = filterValue;
        this.filterColumn = filterColumn;
        this.applyFilter();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    applyFilter() {
        if (!this.filterValue) {
            this.filteredData = [...this.data];
            return;
        }
        
        const filterColumn = this.filterColumn || this.columns[0]?.key;
        if (!filterColumn) {
            this.filteredData = [...this.data];
            return;
        }
        
        this.filteredData = this.data.filter(row => {
            const value = String(row[filterColumn] || '').toLowerCase();
            return value.includes(this.filterValue.toLowerCase());
        });
    }
    
    setPage(page) {
        const totalPages = this.getTotalPages();
        if (page < 1 || page > totalPages) {
            return;
        }
        
        this.currentPage = page;
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'pageChange',
            bubbles: true,
            detail: {
                page: this.currentPage,
                totalPages
            }
        });
    }
    
    toggleRowSelection(rowIndex) {
        if (this.selectedRows.has(rowIndex)) {
            this.selectedRows.delete(rowIndex);
        } else {
            this.selectedRows.add(rowIndex);
        }
        
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'selectionChange',
            bubbles: true,
            detail: {
                selectedRows: Array.from(this.selectedRows),
                data: this.selectedRows.size > 0 ? 
                    this.data.filter((_, index) => this.selectedRows.has(index)) : []
            }
        });
    }
    
    clearSelection() {
        this.selectedRows.clear();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setLoading(loading) {
        this.loading = loading;
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildTable();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildTable();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setStriped(striped) {
        if (this.striped !== striped) {
            this.striped = striped;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBordered(bordered) {
        if (this.bordered !== bordered) {
            this.bordered = bordered;
            this.buildTable();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHoverable(hoverable) {
        if (this.hoverable !== hoverable) {
            this.hoverable = hoverable;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSelectable(selectable) {
        if (this.selectable !== selectable) {
            this.selectable = selectable;
            this.clearSelection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPagination(pagination) {
        if (this.pagination !== pagination) {
            this.pagination = pagination;
            this.buildTable();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPageSize(pageSize) {
        if (this.pageSize !== pageSize) {
            this.pageSize = pageSize;
            this.currentPage = 1;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setEmpty(empty) {
        if (this.empty !== empty) {
            this.empty = empty;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    querySelectorAll(selector) {
        return this.element?.querySelectorAll(selector);
    }
    
    // Static factory methods
    static createTable(id, options = {}) {
        return new Table(id, options);
    }
    
    static createPrimaryTable(id, options = {}) {
        return new Table(id, { variant: 'primary', ...options });
    }
    
    static createSuccessTable(id, options = {}) {
        return new Table(id, { variant: 'success', ...options });
    }
    
    static createWarningTable(id, options = {}) {
        return new Table(id, { variant: 'warning', ...options });
    }
    
    static createErrorTable(id, options = {}) {
        return new Table(id, { variant: 'error', ...options });
    }
    
    static createSmallTable(id, options = {}) {
        return new Table(id, { size: 'sm', ...options });
    }
    
    static createLargeTable(id, options = {}) {
        return new Table(id, { size: 'lg', ...options });
    }
    
    static createXLargeTable(id, options = {}) {
        return new Table(id, { size: 'xl', ...options });
    }
    
    static createStripedTable(id, options = {}) {
        return new Table(id, { striped: true, ...options });
    }
    
    static createBorderedTable(id, options = {}) {
        return new Table(id, { bordered: true, ...options });
    }
    
    static createSelectableTable(id, options = {}) {
        return new Table(id, { selectable: true, ...options });
    }
    
    static createSortableTable(id, options = {}) {
        const sortableColumns = (options.columns || []).map(col => ({
            ...col,
            sortable: true
        }));
        return new Table(id, { columns: sortableColumns, ...options });
    }
    
    static createFilterableTable(id, options = {}) {
        return new Table(id, { filterable: true, ...options });
    }
}
