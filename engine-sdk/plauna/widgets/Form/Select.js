// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Select - Multi-option selection widget for Plauna
 * Provides dropdown functionality with search and keyboard navigation
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _selectSequence = 0;

function _newSelectId() {
    return `select-${Date.now()}-${++_selectSequence}`;
}

export class Select extends UINode {
    // Widget metadata
    static id = 'select';
    static name = 'Select';
    static category = 'form';
    static icon = '📋';
    static description = 'Dropdown select form control';
    static tags = ['form', 'input', 'select', 'dropdown', 'control'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            options: [],
            value: '',
            disabled: false,
            size: 'md'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Select(_newSelectId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSelectId(), options = {}) {
        super(id, 'select');
        
        // Select-specific properties
        this.options = options.options || [];
        this.value = options.value || '';
        this.placeholder = options.placeholder || 'Select an option';
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.searchable = options.searchable !== false;
        this.multiple = options.multiple || false;
        this.clearable = options.clearable !== false;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.label = options.label || '';
        this.description = options.description || '';
        this.name = options.name || '';
        this.isOpen = false;
        
        // State management
        this.isFocused = false;
        this.selectedOptions = [];
        this.filteredOptions = [];
        this.searchTerm = '';
        
        // Set accessibility
        this.role = 'combobox';
        this.ariaExpanded = this.isOpen;
        this.ariaDisabled = this.disabled;
        this.ariaRequired = this.required;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.description ? `${id}-description` : null;
        this.ariaHasPopup = 'listbox';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build select structure
        this.buildSelect();
        
        // Initialize options
        if (options.options) {
            this.setOptions(options.options);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'inline-flex',
            flexDirection: 'column',
            gap: tokens.get('spacing.xs'),
            position: 'relative',
            outline: 'none',
            backdropFilter: 'saturate(1.08) blur(8px)',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.get('fontSizes.xs'),
                minHeight: '32px'
            },
            sm: {
                fontSize: tokens.get('fontSizes.sm'),
                minHeight: '40px'
            },
            md: {
                fontSize: tokens.get('fontSizes.md'),
                minHeight: '48px'
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg'),
                minHeight: '56px'
            },
            xl: {
                fontSize: tokens.get('fontSizes.xl'),
                minHeight: '64px'
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
        if (!this.disabled) {
            this.addEventListener('click', () => {
                this.toggle();
            });
            
            this.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowDown':
                    case 'ArrowUp':
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        if (!this.isOpen) {
                            this.open();
                        } else {
                            this.navigateOptions(e.key === 'ArrowUp' ? -1 : 1);
                        }
                        break;
                    case 'Escape':
                        this.close();
                        break;
                    case 'Tab':
                        this.close();
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
                this.close();
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
        }
    }
    
    buildSelect() {
        while (this.firstChild) {
            this.removeChild(this.firstChild);
        }
        if (this.element) {
            this.element.innerHTML = '';
        }

        // Create select shell
        const selectInput = new UINode(`${this.id}-input`, 'div');
        selectInput.userData.role = 'presentation';
        selectInput.userData.tabIndex = 0;
        selectInput.userData.id = `${this.id}-input`;
        selectInput.setStyles({
            width: '100%',
            minHeight: '48px',
            padding: '12px 40px 12px 14px',
            backgroundColor: 'rgba(15, 23, 42, 0.04)',
            color: this.getInputColor(),
            border: '1px solid ' + this.getBorderColor(),
            borderRadius: '14px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background-color 160ms ease',
            outline: 'none',
            boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(15, 23, 42, 0.08)',
            display: 'flex',
            alignItems: 'center',
            position: 'relative'
        });

        this.selectValue = new UINode(`${this.id}-value`, 'span');
        this.selectValue.setStyles({
            flex: '1',
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: this.getDisplayValue() ? this.getInputColor() : 'var(--text-secondary, #475569)'
        });
        this.selectValue.textContent = this.getDisplayValue() || this.placeholder;
        
        // Select input styles
        // Clear button if clearable
        let clearButton = null;
        if (this.clearable && this.value) {
            clearButton = new UINode(`${this.id}-clear`, 'button');
            clearButton.type = 'button';
            clearButton.textContent = '×';
            clearButton.setStyles({
                position: 'absolute',
                right: '28px',
                top: '50%',
                transform: 'translateY(-50%)',
                backgroundColor: 'rgba(148, 163, 184, 0.12)',
                border: 'none',
                color: 'var(--text-secondary, #475569)',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: 'pointer',
                padding: '0',
                width: '20px',
                height: '20px',
                display: this.value ? 'flex' : 'none',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                opacity: '0.85',
                transition: 'opacity 150ms ease'
            });
            
            clearButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clear();
            });
            
            selectInput.appendChild(clearButton);
        }
        
        // Dropdown arrow
        const dropdownArrow = new UINode(`${this.id}-arrow`, 'span');
        dropdownArrow.textContent = '▼';
        dropdownArrow.setStyles({
            position: 'absolute',
            right: tokens.get('spacing.md'),
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-secondary, #475569)',
            fontSize: '12px',
            pointerEvents: 'none',
            transition: 'transform 150ms ease'
        });
        
        selectInput.appendChild(this.selectValue);
        selectInput.appendChild(dropdownArrow);
        this.appendChild(selectInput);
        
        // Create dropdown container
        const dropdownContainer = new UINode(`${this.id}-dropdown`, 'div');
        dropdownContainer.setStyles({
            position: 'absolute',
            top: '100%',
            left: '0',
            right: '0',
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            border: '1px solid rgba(148, 163, 184, 0.18)',
            borderRadius: '16px',
            boxShadow: '0 20px 48px rgba(2, 6, 23, 0.28)',
            zIndex: 0,
            opacity: '0',
            transform: 'translateY(-8px)',
            transition: 'all 150ms ease',
            maxHeight: '200px',
            overflow: 'auto',
            backdropFilter: 'blur(14px) saturate(140%)'
        });
        
        // Search input if searchable
        if (this.searchable) {
            const searchInput = new UINode(`${dropdownContainer.id}-search`, 'input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search options...';
            searchInput.setStyles({
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--text-inverse, #f8fafc)',
                border: '1px solid rgba(148, 163, 184, 0.18)',
                borderRadius: '12px',
                fontSize: '14px',
                outline: 'none',
                marginBottom: tokens.get('spacing.sm')
            });
            
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value;
                this.filterOptions();
                this.renderOptions();
            });
            
            dropdownContainer.appendChild(searchInput);
            this.searchInput = searchInput;
        } else {
            this.searchInput = null;
        }
        
        // Options list
        const optionsList = new UINode(`${dropdownContainer.id}-list`, 'ul');
        optionsList.setStyles({
            listStyle: 'none',
            margin: '0',
            padding: tokens.get('spacing.xs'),
            maxHeight: '150px',
            overflow: 'auto'
        });
        
        dropdownContainer.appendChild(optionsList);
        
        // Store references
        this.selectInput = selectInput;
        this.clearButton = clearButton;
        this.dropdownContainer = dropdownContainer;
        this.optionsList = optionsList;
        this.dropdownArrow = dropdownArrow;
        
        // Update dropdown container reference in DOMRenderer
        this.dropdownContainer._plaunaNode = this;

        this.updateVisualState();
    }

    updateVisualState() {
        const selectInput = this.querySelector(`#${this.id}-input`);
        const dropdownArrow = this.querySelector(`#${this.id}-arrow`);
        const clearButton = this.querySelector(`#${this.id}-clear`);
        const focusShadow = (this.isFocused || this.isOpen)
            ? '0 0 0 3px rgba(59, 130, 246, 0.16), 0 16px 28px rgba(15, 23, 42, 0.12)'
            : 'inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(15, 23, 42, 0.08)';

        if (selectInput) {
            if (selectInput.element) {
                selectInput.element.style.borderColor = this.getBorderColor();
                selectInput.element.style.backgroundColor = this.disabled ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.04)';
                selectInput.element.style.boxShadow = focusShadow;
                selectInput.element.style.transform = this.isFocused || this.isOpen ? 'translateY(-1px)' : 'translateY(0)';
            }
        }

        if (dropdownArrow && dropdownArrow.element) {
            dropdownArrow.element.style.transform = this.isOpen ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%) rotate(0deg)';
        }

        if (clearButton && clearButton.element) {
            clearButton.element.style.display = this.clearable && this.value ? 'flex' : 'none';
        }

        if (this.dropdownContainer) {
            this.dropdownContainer.setStyle('pointerEvents', this.isOpen ? 'auto' : 'none');
            this.dropdownContainer.setStyle('zIndex', this.isOpen ? '1000' : '0');
        }

        this.updateDisplayValue();
    }
    
    getInputColor() {
        if (this.disabled) {
            return tokens.get('colors.text.disabled');
        }
        return tokens.get('colors.text.primary');
    }
    
    getBorderColor() {
        if (this.isFocused) {
            return tokens.get('colors.primary.500');
        }
        return tokens.get('colors.border.medium');
    }
    
    getDisplayValue() {
        if (this.multiple) {
            if (this.selectedOptions.length === 0) {
                return '';
            }
            if (this.selectedOptions.length === 1) {
                return this.selectedOptions[0].label;
            }
            return `${this.selectedOptions.length} options selected`;
        }
        
        const selectedOption = this.options.find(option => option.value === this.value);
        return selectedOption ? selectedOption.label : '';
    }
    
    toggle() {
        if (this.disabled || this.isOpen) return;
        
        this.isOpen = true;
        this.ariaExpanded = 'true';
        
        // Update dropdown arrow
        this.dropdownArrow.setStyle('transform', 'translateY(-50%) rotate(180deg)');
        
        // Show dropdown
        this.dropdownContainer.setStyle('opacity', '1');
        this.dropdownContainer.setStyle('transform', 'translateY(0)');
        this.dropdownContainer.setStyle('z-index', '1000');
        
        // Focus search input if searchable
        if (this.searchable && this.searchInput) {
            this.searchInput.element.focus();
        }
        
        // Render options
        this.renderOptions();
        this.updateVisualState();
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    close() {
        if (!this.isOpen) return;
        
        this.isOpen = false;
        this.ariaExpanded = 'false';
        
        // Reset dropdown arrow
        this.dropdownArrow.setStyle('transform', 'translateY(-50%) rotate(0deg)');
        
        // Hide dropdown
        this.dropdownContainer.setStyle('opacity', '0');
        this.dropdownContainer.setStyle('transform', 'translateY(-8px)');
        this.dropdownContainer.setStyle('z-index', '0');
        
        // Clear search
        if (this.searchable) {
            this.searchTerm = '';
            if (this.searchInput && this.searchInput.element) {
                this.searchInput.element.value = '';
            }
            this.filterOptions();
        }

        this.updateVisualState();
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    filterOptions() {
        if (!this.searchable) {
            this.filteredOptions = [...this.options];
            return;
        }
        
        const searchTerm = this.searchTerm.toLowerCase();
        this.filteredOptions = this.options.filter(option => 
            option.label.toLowerCase().includes(searchTerm) ||
            option.value.toLowerCase().includes(searchTerm)
        );
    }
    
    renderOptions() {
        this.optionsList.innerHTML = '';
        
        const optionsToRender = this.searchable ? this.filteredOptions : this.options;
        
        optionsToRender.forEach((option, index) => {
            const optionElement = document.createElement('li');
            optionElement.role = 'option';
            optionElement.textContent = option.label;
            optionElement.style.cssText = (
                'padding: 10px 12px;' +
                'color: ' + (this.isOptionSelected(option) ? 'rgba(255,255,255,0.98)' : 'rgba(248,250,252,0.92)') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;' +
                'listStyle: none;' +
                'background: ' + (this.isOptionSelected(option) ? 'rgba(59, 130, 246, 0.22)' : 'transparent') + ';' +
                'border-radius: 12px;' +
                'margin: 4px 6px;'
            );
            
            optionElement.addEventListener('click', () => {
                this.selectOption(option);
            });
            
            optionElement.addEventListener('mouseenter', () => {
                optionElement.style.background = this.isOptionSelected(option) ? 'rgba(59, 130, 246, 0.28)' : 'rgba(255, 255, 255, 0.06)';
            });
            
            optionElement.addEventListener('mouseleave', () => {
                optionElement.style.background = this.isOptionSelected(option) ? 'rgba(59, 130, 246, 0.22)' : 'transparent';
            });
            
            this.optionsList.appendChild(optionElement);
        });
    }
    
    isOptionSelected(option) {
        if (this.multiple) {
            return this.selectedOptions.some(selected => selected.value === option.value);
        }
        return this.value === option.value;
    }
    
    selectOption(option) {
        if (this.multiple) {
            const index = this.selectedOptions.findIndex(selected => selected.value === option.value);
            if (index >= 0) {
                this.selectedOptions.splice(index, 1);
            } else {
                this.selectedOptions.push(option);
            }
        } else {
            this.selectedOptions = [option];
        }
        
        this.value = option.value;
        this.updateDisplayValue();
        this.ariaLabel = option.label;
        
        if (!this.multiple) {
            this.close();
        }
        
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: {
                value: this.value,
                selectedOptions: [...this.selectedOptions]
            }
        });
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    updateDisplayValue() {
        if (this.selectValue) {
            const display = this.getDisplayValue();
            this.selectValue.textContent = display || this.placeholder;
            this.selectValue.setStyle('color', display ? this.getInputColor() : 'var(--text-secondary, #475569)');
        }
        if (this.clearButton && this.clearButton.element) {
            this.clearButton.element.style.display = this.clearable && this.value ? 'flex' : 'none';
        }
    }
    
    clear() {
        this.value = '';
        this.selectedOptions = [];
        this.updateDisplayValue();
        this.dispatchEvent({
            type: 'change',
            bubbles: true,
            detail: {
                value: '',
                selectedOptions: []
            }
        });
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    // Public methods
    setOptions(options) {
        this.options = options.map(option => ({
            value: option.value || '',
            label: option.label || '',
            disabled: option.disabled || false
        }));
        
        this.filteredOptions = [...this.options];
        this.selectedOptions = this.selectedOptions.filter(selected => 
            this.options.some(option => option.value === selected.value)
        );
        
        this.renderOptions();
        this.markDirty(DIRTY.CHILDREN | DIRTY.PAINT);
    }
    
    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            this.selectedOptions = this.options.filter(option => 
                this.multiple ? this.selectedOptions.some(selected => selected.value === option.value) : option.value === value
            );
            this.updateDisplayValue();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.ariaDisabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.setStyle('cursor', disabled ? 'not-allowed' : 'pointer');
            this.setupStyles();
            this.buildSelect();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.updateVisualState();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildSelect();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.ariaDescribedBy = description ? (this.id + '-description') : null;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setSearchable(searchable) {
        if (this.searchable !== searchable) {
            this.searchable = searchable;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setMultiple(multiple) {
        if (this.multiple !== multiple) {
            this.multiple = multiple;
            this.ariaMultiSelectable = multiple;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setClearable(clearable) {
        if (this.clearable !== clearable) {
            this.clearable = clearable;
            this.buildSelect();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;
            this.ariaRequired = required;
            const selectInput = this.querySelector(`#${this.id}-input`);
            if (selectInput && selectInput.element) {
                selectInput.element.dataset.required = String(required);
            }
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newSelectId();
        const selectWidget = new Select(id, options);
        if (container) {
            container.appendChild(selectWidget.element);
        }
        return selectWidget;
    }
    
    static getDefaultOptions() {
        return {
            value: '',
            options: [],
            placeholder: 'Select an option',
            disabled: false,
            searchable: true
        };
    }
    
    static createSelect(id, options = {}) {
        return new Select(id, options);
    }
    
    static createPrimarySelect(id, options = {}) {
        return new Select(id, { variant: 'primary', ...options });
    }
    
    static createSuccessSelect(id, options = {}) {
        return new Select(id, { variant: 'success', ...options });
    }
    
    static createWarningSelect(id, options = {}) {
        return new Select(id, { variant: 'warning', ...options });
    }
    
    static createErrorSelect(id, options = {}) {
        return new Select(id, { variant: 'error', ...options });
    }
    
    static createSmallSelect(id, options = {}) {
        return new Select(id, { size: 'sm', ...options });
    }
    
    static createLargeSelect(id, options = {}) {
        return new Select(id, { size: 'lg', ...options });
    }
    
    static createXLargeSelect(id, options = {}) {
        return new Select(id, { size: 'xl', ...options });
    }
    
    static createMultiSelect(id, options = {}) {
        return new Select(id, { multiple: true, ...options });
    }
    
    static createSearchableSelect(id, options = {}) {
        return new Select(id, { searchable: true, ...options });
    }
    
    static createClearableSelect(id, options = {}) {
        return new Select(id, { clearable: true, ...options });
    }
}
