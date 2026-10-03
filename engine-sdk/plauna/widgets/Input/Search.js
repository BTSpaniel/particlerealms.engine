// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Search - Search input widget for Plauna
 * Provides search functionality with suggestions and filters
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _searchSequence = 0;

function _newSearchId() {
    return `search-${Date.now()}-${++_searchSequence}`;
}

export class Search extends UINode {
    // Widget metadata
    static id = 'search';
    static name = 'Search';
    static category = 'input';
    static icon = '🔍';
    static description = 'Search input with suggestions';
    static tags = ['input', 'search', 'autocomplete'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            value: '',
            placeholder: 'Search...',
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Search(_newSearchId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSearchId(), options = {}) {
        super(id, 'search');
        
        // Search-specific properties
        this.value = options.value || '';
        this.placeholder = options.placeholder || 'Search...';
        this.query = options.query || '';
        this.suggestions = options.suggestions || [];
        this.maxSuggestions = options.maxSuggestions || 8;
        this.minQueryLength = options.minQueryLength || 1;
        this.debounceMs = options.debounceMs || 300;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.readonly = options.readonly || false;
        
        // UI properties
        this.label = options.label || '';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, inline
        this.showSuggestions = options.showSuggestions !== false;
        this.showRecent = options.showRecent || false;
        this.showFilters = options.showFilters || false;
        
        // Filter options
        this.filters = options.filters || [];
        this.activeFilters = options.activeFilters || {};
        
        // Recent searches
        this.recentSearches = options.recentSearches || [];
        this.maxRecentSearches = options.maxRecentSearches || 5;
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onSearch = options.onSearch || (() => {});
        this.onSuggestionSelect = options.onSuggestionSelect || (() => {});
        this.onFilterChange = options.onFilterChange || (() => {});
        this.onClear = options.onClear || (() => {});
        
        // Debounce timer
        this.debounceTimer = null;
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label || 'Search input';
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        this.ariaExpanded = 'false';
        this.ariaActivedescendant = null;
        
        // Set default styles
        this.setupStyles();
        
        // Create search input structure
        this.createSearchStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createSearchStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-search-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-search-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create search wrapper
        this.searchWrapper = document.createElement('div');
        this.searchWrapper.className = 'plauna-search-wrapper';
        this.searchWrapper.style.cssText = this.getSearchWrapperStyles();
        
        // Create search icon
        this.searchIcon = document.createElement('div');
        this.searchIcon.className = 'plauna-search-icon';
        this.searchIcon.textContent = '🔍';
        this.searchIcon.style.cssText = this.getSearchIconStyles();
        
        // Create search input
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.value = this.value;
        this.searchInput.placeholder = this.placeholder;
        this.searchInput.disabled = this.disabled;
        this.searchInput.required = this.required;
        this.searchInput.readOnly = this.readonly;
        this.searchInput.autocomplete = 'off';
        this.searchInput.style.cssText = this.getSearchInputStyles();
        
        // Create clear button
        this.clearButton = document.createElement('button');
        this.clearButton.type = 'button';
        this.clearButton.textContent = '✕';
        this.clearButton.style.cssText = this.getClearButtonStyles();
        this.clearButton.style.display = this.value ? 'flex' : 'none';
        
        // Assemble search wrapper
        this.searchWrapper.appendChild(this.searchIcon);
        this.searchWrapper.appendChild(this.searchInput);
        this.searchWrapper.appendChild(this.clearButton);
        
        // Create suggestions dropdown
        if (this.showSuggestions) {
            this.suggestionsDropdown = document.createElement('div');
            this.suggestionsDropdown.className = 'plauna-search-suggestions';
            this.suggestionsDropdown.style.cssText = this.getSuggestionsDropdownStyles();
            this.createSuggestionsContent();
        }
        
        // Create filters section
        if (this.showFilters && this.filters.length > 0) {
            this.filtersContainer = document.createElement('div');
            this.filtersContainer.className = 'plauna-search-filters';
            this.filtersContainer.style.cssText = this.getFiltersContainerStyles();
            this.createFiltersContent();
        }
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-search-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.searchWrapper);
        
        if (this.filtersContainer) {
            this.container.appendChild(this.filtersContainer);
        }
        
        if (this.suggestionsDropdown) {
            this.container.appendChild(this.suggestionsDropdown);
        }
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    createSuggestionsContent() {
        // Suggestions header
        this.suggestionsHeader = document.createElement('div');
        this.suggestionsHeader.style.cssText = (
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'border-bottom: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
        
        // Suggestions list
        this.suggestionsList = document.createElement('div');
        this.suggestionsList.style.cssText = this.getSuggestionsListStyles();
        
        // Recent searches section
        if (this.showRecent && this.recentSearches.length > 0) {
            this.recentHeader = document.createElement('div');
            this.recentHeader.textContent = 'Recent searches';
            this.recentHeader.style.cssText = (
                'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';'
            );
            
            this.recentList = document.createElement('div');
            this.recentList.style.cssText = this.getSuggestionsListStyles();
            this.updateRecentSearches();
        }
        
        this.updateSuggestions();
    }
    
    createFiltersContent() {
        const filtersLabel = document.createElement('div');
        filtersLabel.textContent = 'Filters:';
        filtersLabel.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'margin-bottom: ' + tokens.get('spacing.sm') + ';'
        );
        
        const filtersList = document.createElement('div');
        filtersList.style.cssText = (
            'display: flex;' +
            'flex-wrap: wrap;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        this.filters.forEach(filter => {
            const filterButton = document.createElement('button');
            filterButton.type = 'button';
            filterButton.textContent = filter.label;
            filterButton.style.cssText = this.getFilterButtonStyles();
            
            if (this.activeFilters[filter.key]) {
                filterButton.style.background = tokens.get('colors.primary');
                filterButton.style.color = tokens.get('colors.text.inverse');
            }
            
            filterButton.addEventListener('click', () => {
                this.toggleFilter(filter.key);
            });
            
            filtersList.appendChild(filterButton);
        });
        
        this.filtersContainer.appendChild(filtersLabel);
        this.filtersContainer.appendChild(filtersList);
    }
    
    setupEventHandlers() {
        // Search input events
        this.searchInput.addEventListener('input', (e) => {
            this.value = e.target.value;
            this.updateClearButton();
            this.debounceSearch();
            this.updateSuggestions();
            this.markDirty(DIRTY.VALUE);
        });
        
        this.searchInput.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });
        
        this.searchInput.addEventListener('focus', () => {
            this.showSuggestionsDropdown();
            this.updateAriaExpanded(true);
        });
        
        this.searchInput.addEventListener('blur', () => {
            // Delay hiding to allow clicking suggestions
            setTimeout(() => {
                this.hideSuggestionsDropdown();
                this.updateAriaExpanded(false);
            }, 150);
        });
        
        // Clear button
        this.clearButton.addEventListener('click', () => {
            this.clearSearch();
        });
        
        // Click outside to hide suggestions
        document.addEventListener('click', (e) => {
            if (this.suggestionsDropdown && !this.container.contains(e.target)) {
                this.hideSuggestionsDropdown();
                this.updateAriaExpanded(false);
            }
        });
        
        // Prevent form submission
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.performSearch();
            }
        });
    }
    
    handleKeydown(e) {
        if (!this.suggestionsDropdown || this.suggestionsDropdown.style.display === 'none') {
            return;
        }
        
        const suggestionItems = this.suggestionsDropdown.querySelectorAll('[data-suggestion]');
        let currentIndex = Array.from(suggestionItems).findIndex(item => item.classList.contains('active'));
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                currentIndex = Math.min(currentIndex + 1, suggestionItems.length - 1);
                this.highlightSuggestion(currentIndex);
                break;
            case 'ArrowUp':
                e.preventDefault();
                currentIndex = Math.max(currentIndex - 1, 0);
                this.highlightSuggestion(currentIndex);
                break;
            case 'Enter':
                e.preventDefault();
                if (currentIndex >= 0 && suggestionItems[currentIndex]) {
                    this.selectSuggestion(suggestionItems[currentIndex]);
                } else {
                    this.performSearch();
                }
                break;
            case 'Escape':
                this.hideSuggestionsDropdown();
                this.updateAriaExpanded(false);
                break;
        }
    }
    
    highlightSuggestion(index) {
        const suggestionItems = this.suggestionsDropdown.querySelectorAll('[data-suggestion]');
        suggestionItems.forEach((item, i) => {
            if (i === index) {
                item.classList.add('active');
                item.style.background = tokens.get('colors.primary') + '20';
                this.searchInput.value = item.textContent;
                this.updateAriaActivedescendant(item.id);
            } else {
                item.classList.remove('active');
                item.style.background = 'transparent';
            }
        });
    }
    
    selectSuggestion(item) {
        const suggestion = item.dataset.suggestion;
        this.value = suggestion;
        this.searchInput.value = suggestion;
        this.performSearch();
        this.hideSuggestionsDropdown();
        this.updateAriaExpanded(false);
        this.onSuggestionSelect(suggestion);
    }
    
    debounceSearch() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        this.debounceTimer = setTimeout(() => {
            this.query = this.value;
            this.onSearch(this.query);
        }, this.debounceMs);
    }
    
    performSearch() {
        if (this.value.trim()) {
            this.addToRecentSearches(this.value.trim());
            this.query = this.value;
            this.onSearch(this.query);
        }
        this.hideSuggestionsDropdown();
        this.updateAriaExpanded(false);
    }
    
    clearSearch() {
        this.value = '';
        this.query = '';
        this.searchInput.value = '';
        this.updateClearButton();
        this.updateSuggestions();
        this.onClear();
        this.markDirty(DIRTY.VALUE);
    }
    
    toggleFilter(filterKey) {
        this.activeFilters[filterKey] = !this.activeFilters[filterKey];
        this.updateFilterButtons();
        this.onFilterChange(this.activeFilters);
        this.markDirty(DIRTY.PROPS);
    }
    
    updateFilterButtons() {
        if (!this.filtersContainer) return;
        
        const filterButtons = this.filtersContainer.querySelectorAll('button');
        this.filters.forEach((filter, index) => {
            const button = filterButtons[index];
            if (this.activeFilters[filter.key]) {
                button.style.background = tokens.get('colors.primary');
                button.style.color = tokens.get('colors.text.inverse');
            } else {
                button.style.background = 'transparent';
                button.style.color = tokens.get('colors.text.primary');
            }
        });
    }
    
    addToRecentSearches(search) {
        if (!this.showRecent) return;
        
        // Remove if already exists
        this.recentSearches = this.recentSearches.filter(item => item !== search);
        
        // Add to beginning
        this.recentSearches.unshift(search);
        
        // Limit to max recent searches
        this.recentSearches = this.recentSearches.slice(0, this.maxRecentSearches);
        
        this.updateRecentSearches();
    }
    
    updateRecentSearches() {
        if (!this.recentList) return;
        
        this.recentList.innerHTML = '';
        
        this.recentSearches.forEach(search => {
            const item = document.createElement('div');
            item.textContent = search;
            item.dataset.suggestion = search;
            item.id = this.id + '-recent-' + search.replace(/\s+/g, '-');
            item.style.cssText = this.getSuggestionItemStyles();
            
            item.addEventListener('click', () => {
                this.selectSuggestion(item);
            });
            
            item.addEventListener('mouseenter', () => {
                item.style.background = tokens.get('colors.primary') + '20';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
            });
            
            this.recentList.appendChild(item);
        });
    }
    
    updateSuggestions() {
        if (!this.suggestionsList) return;
        
        this.suggestionsList.innerHTML = '';
        
        if (this.value.length < this.minQueryLength) {
            return;
        }
        
        const filteredSuggestions = this.suggestions
            .filter(suggestion => suggestion.toLowerCase().includes(this.value.toLowerCase()))
            .slice(0, this.maxSuggestions);
        
        filteredSuggestions.forEach((suggestion, index) => {
            const item = document.createElement('div');
            item.textContent = suggestion;
            item.dataset.suggestion = suggestion;
            item.id = this.id + '-suggestion-' + index;
            item.style.cssText = this.getSuggestionItemStyles();
            
            item.addEventListener('click', () => {
                this.selectSuggestion(item);
            });
            
            item.addEventListener('mouseenter', () => {
                item.style.background = tokens.get('colors.primary') + '20';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
            });
            
            this.suggestionsList.appendChild(item);
        });
    }
    
    updateClearButton() {
        if (this.clearButton) {
            this.clearButton.style.display = this.value ? 'flex' : 'none';
        }
    }
    
    showSuggestionsDropdown() {
        if (this.suggestionsDropdown && (this.value.length >= this.minQueryLength || this.recentSearches.length > 0)) {
            this.suggestionsDropdown.style.display = 'block';
            this.updateSuggestions();
        }
    }
    
    hideSuggestionsDropdown() {
        if (this.suggestionsDropdown) {
            this.suggestionsDropdown.style.display = 'none';
        }
    }
    
    updateAriaExpanded(expanded) {
        this.ariaExpanded = expanded.toString();
        if (this.searchInput) {
            this.searchInput.setAttribute('aria-expanded', this.ariaExpanded);
        }
    }
    
    updateAriaActivedescendant(id) {
        this.ariaActivedescendant = id;
        if (this.searchInput) {
            this.searchInput.setAttribute('aria-activedescendant', id);
        }
    }
    
    setupStyles() {
        this.setStyles({
            display: 'block',
            width: '100%'
        });
    }
    
    getContainerStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'width: 100%;' +
            'position: relative;'
        );
    }
    
    getLabelStyles() {
        return (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'margin-bottom: ' + tokens.get('spacing.xs') + ';' +
            'cursor: pointer;'
        );
    }
    
    getSearchWrapperStyles() {
        return (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'width: 100%;' +
            'position: relative;'
        );
    }
    
    getSearchIconStyles() {
        return (
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'font-size: 16px;' +
            'pointer-events: none;'
        );
    }
    
    getSearchInputStyles() {
        const sizeStyles = this.getSizeStyles();
        return (
            'flex: 1;' +
            'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'background: ' + tokens.get('colors.background.primary') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'outline: none;' +
            'transition: all 150ms ease;' +
            'box-sizing: border-box;' +
            'padding: 0;' +
            sizeStyles
        );
    }
    
    getClearButtonStyles() {
        return (
            'background: transparent;' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'border: none;' +
            'border-radius: 50%;' +
            'width: 20px;' +
            'height: 20px;' +
            'font-size: 12px;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'transition: all 150ms ease;' +
            'opacity: 0.6;'
        );
    }
    
    getSuggestionsDropdownStyles() {
        return (
            'position: absolute;' +
            'top: 100%;' +
            'left: 0;' +
            'right: 0;' +
            'z-index: 1000;' +
            'background: ' + tokens.get('colors.background.primary') + ';' +
            'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);' +
            'margin-top: 4px;' +
            'display: none;' +
            'max-height: 300px;' +
            'overflow-y: auto;'
        );
    }
    
    getSuggestionsListStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: 1px;'
        );
    }
    
    getSuggestionItemStyles() {
        return (
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'cursor: pointer;' +
            'transition: background-color 150ms ease;' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'border-bottom: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
    }
    
    getFiltersContainerStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'margin-top: ' + tokens.get('spacing.sm') + ';'
        );
    }
    
    getFilterButtonStyles() {
        return (
            'background: transparent;' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: 4px 8px;' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
    }
    
    getSizeStyles() {
        const sizes = {
            sm: 'height: 32px;',
            md: 'height: 40px;',
            lg: 'height: 48px;'
        };
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
    setValue(value) {
        this.value = value;
        if (this.searchInput) {
            this.searchInput.value = value;
        }
        this.updateClearButton();
        this.updateSuggestions();
        this.markDirty(DIRTY.VALUE);
    }
    
    setSuggestions(suggestions) {
        this.suggestions = suggestions;
        this.updateSuggestions();
        this.markDirty(DIRTY.PROPS);
    }
    
    setFilters(filters) {
        this.filters = filters;
        this.activeFilters = {};
        if (this.filtersContainer) {
            this.createFiltersContent();
        }
        this.markDirty(DIRTY.PROPS | DIRTY.CHILDREN);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.searchInput) {
            this.searchInput.disabled = disabled;
        }
        if (this.clearButton) {
            this.clearButton.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getValue() {
        return this.value;
    }
    
    getQuery() {
        return this.query;
    }
    
    getActiveFilters() {
        return this.activeFilters;
    }
    
    // Static factory methods
    static createBasicSearch(id, options = {}) {
        return new Search(id, {
            showSuggestions: false,
            showFilters: false,
            ...options
        });
    }
    
    static createAdvancedSearch(id, options = {}) {
        return new Search(id, {
            showSuggestions: true,
            showRecent: true,
            showFilters: true,
            ...options
        });
    }
    
    static createCompactSearch(id, options = {}) {
        return new Search(id, {
            variant: 'compact',
            placeholder: 'Search',
            ...options
        });
    }
    
    // Focus methods
    focus() {
        if (this.searchInput) {
            this.searchInput.focus();
        }
    }
    
    blur() {
        if (this.searchInput) {
            this.searchInput.blur();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        if (this.searchInput) {
            this.searchInput.removeEventListener('input', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
