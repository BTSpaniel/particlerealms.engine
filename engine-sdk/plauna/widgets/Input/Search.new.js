// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Search - Search input widget for Plauna
 * Provides search functionality with suggestions and filters
 * 
 * Refactored to follow the new WidgetItem pattern while maintaining UINode compatibility
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { WidgetItem } from '../WidgetItem.js';
import { tokens } from '../../style/DesignTokens.js';
import { byteSignature } from '../../../engine/core/math/FormatMath.js';

let searchWidgetIdSequence = 0;

function createSearchWidgetId() {
    const cryptoApi = globalThis.crypto;
    let entropy = '';
    try {
        if (typeof cryptoApi?.randomUUID === 'function') {
            entropy = cryptoApi.randomUUID().replace(/-/g, '').slice(0, 9);
        } else if (typeof cryptoApi?.getRandomValues === 'function') {
            entropy = byteSignature(cryptoApi.getRandomValues(new Uint8Array(8))).slice(0, 9);
        }
    } catch (_) {
        entropy = '';
    }
    if (!entropy) entropy = (++searchWidgetIdSequence).toString(36).padStart(9, '0');
    return `search-${Date.now()}-${entropy}`;
}

export class Search extends WidgetItem {
    // WidgetItem metadata
    static id = 'search';
    static name = 'Search';
    static icon = '🔍';
    static category = 'input';
    static description = 'Search input with suggestions and filters';
    static tags = ['input', 'search', 'autocomplete', 'filter'];
    static dependencies = [];
    
    /**
     * Get default widget options
     */
    static getDefaultOptions() {
        return {
            ...super.getDefaultOptions(),
            value: '',
            placeholder: 'Search...',
            query: '',
            suggestions: [],
            maxSuggestions: 8,
            minQueryLength: 1,
            debounceMs: 300,
            disabled: false,
            required: false,
            readonly: false,
            label: '',
            helper: '',
            error: '',
            size: 'md',
            variant: 'default',
            showSuggestions: true,
            showRecent: false,
            showFilters: false,
            filters: [],
            activeFilters: {},
            recentSearches: [],
            maxRecentSearches: 5
        };
    }
    
    /**
     * Get supported events
     */
    static getSupportedEvents() {
        return [
            ...super.getSupportedEvents(),
            'search',
            'suggestion-select',
            'filter-change',
            'clear',
            'query-change'
        ];
    }
    
    /**
     * Get theme tokens requirements
     */
    static getThemeTokens() {
        return {
            ...super.getThemeTokens(),
            colors: [
                'primary', 'background', 'text', 'textSecondary',
                'border', 'borderLight', 'surface', 'accent'
            ],
            spacing: ['xs', 'sm', 'md', 'lg', 'xl'],
            borderRadius: ['sm', 'md', 'lg'],
            fontSizes: ['xs', 'sm', 'md', 'lg'],
            fontWeights: ['normal', 'medium', 'semibold']
        };
    }
    
    /**
     * Create widget instance
     */
    static create(container, options = {}) {
        const validatedOptions = this.validateOptions(options);
        
        // Create unique ID for this instance
        const widgetId = createSearchWidgetId();
        
        // Create the actual widget instance
        const widgetInstance = new SearchUINode(widgetId, validatedOptions);
        
        // Mount to container if provided
        if (container && container.appendChild) {
            container.appendChild(widgetInstance.container);
        }
        
        return widgetInstance;
    }
    
    /**
     * Validate widget-specific options
     */
    static validateOptions(options = {}) {
        const baseOptions = super.validateOptions(options);
        
        return {
            ...baseOptions,
            // Validate numeric options
            maxSuggestions: Math.max(1, parseInt(options.maxSuggestions) || 8),
            minQueryLength: Math.max(0, parseInt(options.minQueryLength) || 1),
            debounceMs: Math.max(0, parseInt(options.debounceMs) || 300),
            maxRecentSearches: Math.max(0, parseInt(options.maxRecentSearches) || 5),
            
            // Validate array options
            suggestions: Array.isArray(options.suggestions) ? options.suggestions : [],
            filters: Array.isArray(options.filters) ? options.filters : [],
            recentSearches: Array.isArray(options.recentSearches) ? options.recentSearches : [],
            activeFilters: typeof options.activeFilters === 'object' ? options.activeFilters : {},
            
            // Validate string options
            size: ['sm', 'md', 'lg'].includes(options.size) ? options.size : 'md',
            variant: ['default', 'compact', 'inline'].includes(options.variant) ? options.variant : 'default',
            
            // Validate boolean options
            showSuggestions: Boolean(options.showSuggestions !== false),
            showRecent: Boolean(options.showRecent),
            showFilters: Boolean(options.showFilters),
            
            // Copy other options
            value: String(options.value || ''),
            placeholder: String(options.placeholder || 'Search...'),
            query: String(options.query || ''),
            disabled: Boolean(options.disabled),
            required: Boolean(options.required),
            readonly: Boolean(options.readonly),
            label: String(options.label || ''),
            helper: String(options.helper || ''),
            error: String(options.error || '')
        };
    }
}

/**
 * SearchUINode - The actual UINode implementation
 * Maintains compatibility with existing UINode system
 */
class SearchUINode extends UINode {
    constructor(id, options = {}) {
        super(id, 'search');
        
        // Store validated options
        this.options = options;
        
        // Search-specific properties
        this.value = options.value;
        this.placeholder = options.placeholder;
        this.query = options.query;
        this.suggestions = options.suggestions;
        this.maxSuggestions = options.maxSuggestions;
        this.minQueryLength = options.minQueryLength;
        this.debounceMs = options.debounceMs;
        this.disabled = options.disabled;
        this.required = options.required;
        this.readonly = options.readonly;
        
        // UI properties
        this.label = options.label;
        this.helper = options.helper;
        this.error = options.error;
        this.size = options.size;
        this.variant = options.variant;
        this.showSuggestions = options.showSuggestions;
        this.showRecent = options.showRecent;
        this.showFilters = options.showFilters;
        
        // Filter options
        this.filters = options.filters;
        this.activeFilters = options.activeFilters;
        
        // Recent searches
        this.recentSearches = options.recentSearches;
        this.maxRecentSearches = options.maxRecentSearches;
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onSearch = options.onSearch || (() => {});
        this.onSuggestionSelect = options.onSuggestionSelect || (() => {});
        this.onFilterChange = options.onFilterChange || (() => {});
        this.onClear = options.onClear || (() => {});
        
        // Debounce timer
        this.debounceTimer = null;
        
        // Initialize widget
        this.setupStyles();
        this.createSearchStructure();
        this.setupEventHandlers();
    }
    
    setupStyles() {
        // Use existing token-based styling
        this.setStyles(tokens.get('search.base'));
    }
    
    createSearchStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-search';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-search-label';
            this.labelElement.textContent = this.label;
            this.container.appendChild(this.labelElement);
        }
        
        // Create search wrapper
        this.searchWrapper = document.createElement('div');
        this.searchWrapper.className = 'plauna-search-wrapper';
        
        // Create search icon
        this.searchIcon = document.createElement('div');
        this.searchIcon.className = 'plauna-search-icon';
        this.searchIcon.innerHTML = '🔍';
        this.searchWrapper.appendChild(this.searchIcon);
        
        // Create input
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.className = 'plauna-search-input';
        this.searchInput.placeholder = this.placeholder;
        this.searchInput.value = this.value;
        this.searchInput.disabled = this.disabled;
        this.searchInput.readOnly = this.readonly;
        this.searchInput.required = this.required;
        this.searchWrapper.appendChild(this.searchInput);
        
        // Create clear button
        this.clearButton = document.createElement('button');
        this.clearButton.className = 'plauna-search-clear';
        this.clearButton.innerHTML = '✕';
        this.clearButton.style.display = this.value ? 'block' : 'none';
        this.searchWrapper.appendChild(this.clearButton);
        
        this.container.appendChild(this.searchWrapper);
        
        // Create suggestions dropdown
        if (this.showSuggestions) {
            this.suggestionsDropdown = document.createElement('div');
            this.suggestionsDropdown.className = 'plauna-search-suggestions';
            this.suggestionsDropdown.style.display = 'none';
            this.container.appendChild(this.suggestionsDropdown);
        }
        
        // Create helper text
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-search-helper';
            this.helperElement.textContent = this.helper;
            this.container.appendChild(this.helperElement);
        }
        
        // Create error text
        if (this.error) {
            this.errorElement = document.createElement('div');
            this.errorElement.className = 'plauna-search-error';
            this.errorElement.textContent = this.error;
            this.container.appendChild(this.errorElement);
        }
    }
    
    setupEventHandlers() {
        // Input events
        this.searchInput.addEventListener('input', (e) => {
            this.handleInput(e.target.value);
        });
        
        this.searchInput.addEventListener('focus', () => {
            this.handleFocus();
        });
        
        this.searchInput.addEventListener('blur', () => {
            this.handleBlur();
        });
        
        this.searchInput.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });
        
        // Clear button
        this.clearButton.addEventListener('click', () => {
            this.handleClear();
        });
        
        // Document click to close suggestions
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.hideSuggestions();
            }
        });
    }
    
    handleInput(value) {
        this.value = value;
        this.query = value;
        
        // Update clear button visibility
        this.clearButton.style.display = value ? 'block' : 'none';
        
        // Debounce search
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        this.debounceTimer = setTimeout(() => {
            this.performSearch(value);
        }, this.debounceMs);
        
        // Notify change
        this.onChange(value);
    }
    
    handleFocus() {
        // Show suggestions on focus if there's a query
        if (this.showSuggestions && this.query.length >= this.minQueryLength) {
            this.showSuggestions();
        }
    }
    
    handleBlur() {
        // Hide suggestions after a short delay to allow click events
        setTimeout(() => {
            this.hideSuggestions();
        }, 150);
    }
    
    handleKeydown(e) {
        // Handle arrow keys, enter, escape for suggestions
        if (this.suggestionsDropdown && this.suggestionsDropdown.style.display !== 'none') {
            // Implementation for keyboard navigation
            // This would be expanded based on requirements
        }
    }
    
    handleClear() {
        this.value = '';
        this.query = '';
        this.searchInput.value = '';
        this.clearButton.style.display = 'none';
        this.hideSuggestions();
        this.onClear();
        this.onChange('');
    }
    
    performSearch(query) {
        if (query.length < this.minQueryLength) {
            this.hideSuggestions();
            return;
        }
        
        // Show suggestions if available
        if (this.showSuggestions && this.suggestions.length > 0) {
            this.filterAndShowSuggestions(query);
        }
        
        // Trigger search event
        this.onSearch(query);
    }
    
    filterAndShowSuggestions(query) {
        const filtered = this.suggestions
            .filter(suggestion => 
                suggestion.toLowerCase().includes(query.toLowerCase())
            )
            .slice(0, this.maxSuggestions);
        
        if (filtered.length > 0) {
            this.showSuggestionsList(filtered);
        } else {
            this.hideSuggestions();
        }
    }
    
    showSuggestionsList(suggestions) {
        if (!this.suggestionsDropdown) return;
        
        this.suggestionsDropdown.innerHTML = '';
        
        for (const suggestion of suggestions) {
            const item = document.createElement('div');
            item.className = 'plauna-search-suggestion-item';
            item.textContent = suggestion;
            
            item.addEventListener('click', () => {
                this.selectSuggestion(suggestion);
            });
            
            this.suggestionsDropdown.appendChild(item);
        }
        
        this.suggestionsDropdown.style.display = 'block';
    }
    
    selectSuggestion(suggestion) {
        this.value = suggestion;
        this.query = suggestion;
        this.searchInput.value = suggestion;
        this.clearButton.style.display = 'block';
        this.hideSuggestions();
        this.onSuggestionSelect(suggestion);
        this.onChange(suggestion);
    }
    
    showSuggestions() {
        if (this.suggestionsDropdown) {
            this.suggestionsDropdown.style.display = 'block';
        }
    }
    
    hideSuggestions() {
        if (this.suggestionsDropdown) {
            this.suggestionsDropdown.style.display = 'none';
        }
    }
    
    // Public API methods
    setValue(value) {
        this.value = value;
        this.query = value;
        this.searchInput.value = value;
        this.clearButton.style.display = value ? 'block' : 'none';
        this.onChange(value);
    }
    
    getValue() {
        return this.value;
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        this.searchInput.disabled = disabled;
    }
    
    focus() {
        this.searchInput.focus();
    }
    
    blur() {
        this.searchInput.blur();
    }
    
    destroy() {
        // Clean up event listeners and DOM
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        super.destroy();
    }
}

// Export both the widget class and the UINode class
export { SearchUINode };
export default Search;
