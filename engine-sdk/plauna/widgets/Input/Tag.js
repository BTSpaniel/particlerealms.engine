// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Tag - Tag input widget for Plauna
 * Provides tag management with autocomplete and suggestions
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _tagSequence = 0;

function _newTagId() {
    return `tag-${Date.now()}-${++_tagSequence}`;
}

export class Tag extends UINode {
    // Widget metadata
    static id = 'tag';
    static name = 'Tag';
    static category = 'input';
    static icon = '🏷️';
    static description = 'Tag input widget';
    static tags = ['input', 'tag', 'autocomplete'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            tags: [],
            disabled: false,
            placeholder: 'Add tags...'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Tag(_newTagId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newTagId(), options = {}) {
        super(id, 'tag');
        
        // Tag-specific properties
        this.tags = options.tags || [];
        this.value = options.value || '';
        this.maxTags = options.maxTags || 10;
        this.minTags = options.minTags || 0;
        this.allowDuplicates = options.allowDuplicates || false;
        this.allowCustom = options.allowCustom !== false;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.readonly = options.readonly || false;
        
        // UI properties
        this.label = options.label || '';
        this.placeholder = options.placeholder || 'Add a tag...';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, outlined
        this.showSuggestions = options.showSuggestions !== false;
        this.showRemove = options.showRemove !== false;
        this.defaultOpen = options.defaultOpen || false;
        
        // Suggestions
        this.suggestions = options.suggestions || [];
        this.maxSuggestions = options.maxSuggestions || 8;
        this.minQueryLength = options.minQueryLength || 1;
        
        // Tag validation
        this.validateTag = options.validateTag || ((tag) => tag.trim().length > 0);
        this.tagTransform = options.tagTransform || ((tag) => tag.trim());
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onAdd = options.onAdd || (() => {});
        this.onRemove = options.onRemove || (() => {});
        this.onSuggestionSelect = options.onSuggestionSelect || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label || 'Tag input';
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create tag input structure
        this.createTagStructure();
        
        // Setup event handlers
        this.setupEventHandlers();

        if (this.defaultOpen && this.showSuggestions) {
            this.showSuggestionsDropdown();
        }
    }
    
    createTagStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-tag-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-tag-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create tag wrapper
        this.tagWrapper = document.createElement('div');
        this.tagWrapper.className = 'plauna-tag-wrapper';
        this.tagWrapper.style.cssText = this.getTagWrapperStyles();
        
        // Create tags display
        this.tagsDisplay = document.createElement('div');
        this.tagsDisplay.className = 'plauna-tags-display';
        this.tagsDisplay.style.cssText = this.getTagsDisplayStyles();
        
        // Create input wrapper
        this.inputWrapper = document.createElement('div');
        this.inputWrapper.className = 'plauna-tag-input-wrapper';
        this.inputWrapper.style.cssText = this.getInputWrapperStyles();
        
        // Create tag input
        this.tagInput = document.createElement('input');
        this.tagInput.type = 'text';
        this.tagInput.value = this.value;
        this.tagInput.placeholder = this.placeholder;
        this.tagInput.disabled = this.disabled;
        this.tagInput.required = this.required;
        this.tagInput.readOnly = this.readonly;
        this.tagInput.autocomplete = 'off';
        this.tagInput.style.cssText = this.getTagInputStyles();
        
        // Assemble input wrapper
        this.inputWrapper.appendChild(this.tagInput);
        
        // Create suggestions dropdown
        if (this.showSuggestions) {
            this.suggestionsDropdown = document.createElement('div');
            this.suggestionsDropdown.className = 'plauna-tag-suggestions';
            this.suggestionsDropdown.style.cssText = this.getSuggestionsDropdownStyles();
            this.createSuggestionsContent();
        }
        
        // Assemble tag wrapper
        this.tagWrapper.appendChild(this.tagsDisplay);
        this.tagWrapper.appendChild(this.inputWrapper);
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-tag-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.tagWrapper);
        
        if (this.suggestionsDropdown) {
            this.container.appendChild(this.suggestionsDropdown);
        }

        this.updateTagsDisplay();
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    createSuggestionsContent() {
        this.suggestionsList = document.createElement('div');
        this.suggestionsList.style.cssText = this.getSuggestionsListStyles();
        this.suggestionsDropdown.appendChild(this.suggestionsList);
        this.updateSuggestions();
    }
    
    setupEventHandlers() {
        // Tag input events
        this.tagInput.addEventListener('input', (e) => {
            this.value = e.target.value;
            this.updateSuggestions();
            this.markDirty(DIRTY.VALUE);
        });
        
        this.tagInput.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });
        
        this.tagInput.addEventListener('focus', () => {
            this.showSuggestionsDropdown();
        });
        
        this.tagInput.addEventListener('blur', () => {
            // Delay hiding to allow clicking suggestions
            setTimeout(() => {
                this.hideSuggestionsDropdown();
            }, 150);
        });
        
        // Click outside to hide suggestions
        document.addEventListener('click', (e) => {
            if (this.suggestionsDropdown && !this.container.contains(e.target)) {
                this.hideSuggestionsDropdown();
            }
        });
    }
    
    handleKeydown(e) {
        if (this.disabled || this.readonly) return;
        
        switch (e.key) {
            case 'Enter':
            case ',':
            case 'Tab':
                e.preventDefault();
                if (this.value.trim()) {
                    this.addTag(this.value.trim());
                }
                break;
            case 'Backspace':
                if (e.key === 'Backspace' && !this.value && this.tags.length > 0) {
                    e.preventDefault();
                    this.removeTag(this.tags.length - 1);
                }
                break;
            case 'Escape':
                this.value = '';
                this.tagInput.value = '';
                this.hideSuggestionsDropdown();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.navigateSuggestions(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.navigateSuggestions(-1);
                break;
        }
    }
    
    navigateSuggestions(direction) {
        if (!this.suggestionsDropdown || this.suggestionsDropdown.style.display === 'none') {
            return;
        }
        
        const suggestionItems = this.suggestionsDropdown.querySelectorAll('[data-suggestion]');
        let currentIndex = Array.from(suggestionItems).findIndex(item => item.classList.contains('active'));
        
        currentIndex = Math.max(0, Math.min(suggestionItems.length - 1, currentIndex + direction));
        
        suggestionItems.forEach((item, i) => {
            if (i === currentIndex) {
                item.classList.add('active');
                item.style.background = tokens.get('colors.primary') + '20';
                this.tagInput.value = item.textContent;
            } else {
                item.classList.remove('active');
                item.style.background = 'transparent';
            }
        });
    }
    
    addTag(tag) {
        const transformedTag = this.tagTransform(tag);
        
        // Validate tag
        if (!this.validateTag(transformedTag)) {
            return false;
        }
        
        // Check for duplicates
        if (!this.allowDuplicates && this.tags.includes(transformedTag)) {
            return false;
        }
        
        // Check max tags
        if (this.tags.length >= this.maxTags) {
            return false;
        }
        
        // Add tag
        this.tags.push(transformedTag);
        this.value = '';
        this.tagInput.value = '';
        
        // Update UI
        this.updateTagsDisplay();
        this.updateSuggestions();
        
        // Trigger events
        this.onChange(this.tags);
        this.onAdd(transformedTag);
        
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
        return true;
    }
    
    removeTag(index) {
        if (index < 0 || index >= this.tags.length) {
            return false;
        }
        
        const removedTag = this.tags[index];
        this.tags.splice(index, 1);
        
        // Update UI
        this.updateTagsDisplay();
        
        // Trigger events
        this.onChange(this.tags);
        this.onRemove(removedTag);
        
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
        return true;
    }
    
    updateTagsDisplay() {
        if (!this.tagsDisplay) return;
        
        this.tagsDisplay.innerHTML = '';
        
        this.tags.forEach((tag, index) => {
            const tagElement = document.createElement('div');
            tagElement.className = 'plauna-tag-item';
            tagElement.style.cssText = this.getTagItemStyles();
            
            // Tag text
            const tagText = document.createElement('span');
            tagText.textContent = tag;
            tagText.style.cssText = (
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';'
            );
            
            // Remove button
            let removeButton = null;
            if (this.showRemove && !this.readonly) {
                removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.textContent = '✕';
                removeButton.style.cssText = this.getRemoveButtonStyles();
                
                removeButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.removeTag(index);
                });
                
                removeButton.addEventListener('mouseenter', () => {
                    removeButton.style.background = 'rgba(255, 255, 255, 0.2)';
                });
                
                removeButton.addEventListener('mouseleave', () => {
                    removeButton.style.background = 'transparent';
                });
            }
            
            tagElement.appendChild(tagText);
            if (removeButton) {
                tagElement.appendChild(removeButton);
            }
            
            this.tagsDisplay.appendChild(tagElement);
        });
        
        // Show/hide input based on max tags
        if (this.inputWrapper) {
            if (this.tags.length >= this.maxTags) {
                this.inputWrapper.style.display = 'none';
            } else {
                this.inputWrapper.style.display = 'flex';
            }
        }
    }
    
    updateSuggestions() {
        if (!this.suggestionsList) return;
        
        this.suggestionsList.innerHTML = '';
        
        if (this.value.length < this.minQueryLength) {
            return;
        }
        
        const filteredSuggestions = this.suggestions
            .filter(suggestion => 
                suggestion.toLowerCase().includes(this.value.toLowerCase()) &&
                !this.tags.includes(suggestion)
            )
            .slice(0, this.maxSuggestions);
        
        filteredSuggestions.forEach((suggestion, index) => {
            const item = document.createElement('div');
            item.textContent = suggestion;
            item.dataset.suggestion = suggestion;
            item.style.cssText = this.getSuggestionItemStyles();
            
            item.addEventListener('click', () => {
                this.selectSuggestion(suggestion);
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
    
    selectSuggestion(suggestion) {
        this.addTag(suggestion);
        this.hideSuggestionsDropdown();
        this.onSuggestionSelect(suggestion);
    }
    
    showSuggestionsDropdown() {
        if (this.suggestionsDropdown && (this.value.length >= this.minQueryLength || this.suggestions.length > 0)) {
            this.suggestionsDropdown.style.display = 'block';
            this.updateSuggestions();
        }
    }
    
    hideSuggestionsDropdown() {
        if (this.suggestionsDropdown) {
            this.suggestionsDropdown.style.display = 'none';
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
    
    getTagWrapperStyles() {
        return (
            'display: flex;' +
            'flex-wrap: wrap;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'align-items: center;' +
            'width: 100%;'
        );
    }
    
    getTagsDisplayStyles() {
        return (
            'display: flex;' +
            'flex-wrap: wrap;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'align-items: center;'
        );
    }
    
    getTagItemStyles() {
        const variantStyles = this.variant === 'outlined' 
            ? 'background: rgba(59, 130, 246, 0.10); border: 1px solid rgba(59, 130, 246, 0.28); color: ' + tokens.get('colors.primary') + ';'
            : 'background: linear-gradient(180deg, rgba(59, 130, 246, 0.96), rgba(37, 99, 235, 0.92)); border: 1px solid rgba(148, 163, 184, 0.18); color: ' + tokens.get('colors.text.inverse') + ';';
        
        return (
            'display: inline-flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'padding: 6px 10px;' +
            'border-radius: 999px;' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'position: relative;' +
            'transition: all 160ms ease;' +
            variantStyles
        );
    }
    
    getRemoveButtonStyles() {
        return (
            'background: rgba(255, 255, 255, 0.10);' +
            'color: inherit;' +
            'border: 1px solid rgba(255, 255, 255, 0.12);' +
            'border-radius: 50%;' +
            'width: 18px;' +
            'height: 18px;' +
            'font-size: 10px;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'transition: all 160ms ease;' +
            'opacity: 0.8;'
        );
    }
    
    getInputWrapperStyles() {
        return (
            'display: flex;' +
            'align-items: center;' +
            'flex: 1;' +
            'min-width: 120px;'
        );
    }
    
    getTagInputStyles() {
        const sizeStyles = this.getSizeStyles();
        return (
            'flex: 1;' +
            'min-width: 140px;' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 14px;' +
            'background: rgba(15, 23, 42, 0.04);' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'outline: none;' +
            'transition: all 160ms ease;' +
            'box-sizing: border-box;' +
            'padding: 10px 12px;' +
            sizeStyles
        );
    }
    
    getSuggestionsDropdownStyles() {
        return (
            'position: absolute;' +
            'top: 100%;' +
            'left: 0;' +
            'right: 0;' +
            'z-index: 1000;' +
            'background: rgba(15, 23, 42, 0.92);' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 16px;' +
            'box-shadow: 0 24px 56px rgba(2, 6, 23, 0.24);' +
            'margin-top: 8px;' +
            'display: none;' +
            'max-height: 200px;' +
            'overflow-y: auto;' +
            'backdrop-filter: blur(18px) saturate(140%);'
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
            'padding: 10px 12px;' +
            'cursor: pointer;' +
            'transition: background-color 160ms ease;' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: rgba(248, 250, 252, 0.94);' +
            'border-bottom: 1px solid rgba(148, 163, 184, 0.12);'
        );
    }
    
    getSizeStyles() {
        const sizes = {
            sm: 'height: 28px;',
            md: 'height: 32px;',
            lg: 'height: 40px;'
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
    setTags(tags) {
        this.tags = Array.isArray(tags) ? tags : [tags];
        this.updateTagsDisplay();
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    setSuggestions(suggestions) {
        this.suggestions = suggestions;
        this.updateSuggestions();
        this.markDirty(DIRTY.PROPS);
    }
    
    setMaxTags(maxTags) {
        this.maxTags = maxTags;
        this.updateTagsDisplay();
        this.markDirty(DIRTY.PROPS);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.tagInput) {
            this.tagInput.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getTags() {
        return this.tags;
    }
    
    getTagCount() {
        return this.tags.length;
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newTagId();
        const tag = new Tag(id, options);
        if (container) {
            container.appendChild(tag.element);
        }
        return tag;
    }
    
    static getDefaultOptions() {
        return {
            tags: [],
            value: '',
            maxTags: 10,
            minTags: 0,
            allowDuplicates: false,
            allowCustom: true,
            disabled: false
        };
    }
    
    static createBasicTags(id, options = {}) {
        return new Tag(id, {
            showSuggestions: false,
            ...options
        });
    }
    
    static createAutocompleteTags(id, options = {}) {
        return new Tag(id, {
            showSuggestions: true,
            allowCustom: true,
            ...options
        });
    }
    
    static createCompactTags(id, options = {}) {
        return new Tag(id, {
            variant: 'compact',
            showRemove: false,
            ...options
        });
    }
    
    static createLimitedTags(id, maxTags, options = {}) {
        return new Tag(id, {
            maxTags,
            ...options
        });
    }

    static stories() {
        return {
            Chips: {
                tags: ['Design', 'UI', 'Gallery'],
                suggestions: ['Design', 'UI', 'Gallery', 'Theme', 'Motion'],
                defaultOpen: true,
                label: 'Chip Tags'
            },
            Autocomplete: {
                tags: ['React'],
                suggestions: ['React', 'Vue', 'Svelte', 'Solid', 'Angular'],
                defaultOpen: true,
                variant: 'outlined',
                label: 'Autocomplete Tags'
            },
            Compact: {
                tags: ['alpha', 'beta'],
                suggestions: ['alpha', 'beta', 'release', 'stable'],
                showRemove: false,
                variant: 'compact',
                label: 'Compact Tags'
            }
        };
    }
    
    // Focus methods
    focus() {
        if (this.tagInput) {
            this.tagInput.focus();
        }
    }
    
    blur() {
        if (this.tagInput) {
            this.tagInput.blur();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.tagInput) {
            this.tagInput.removeEventListener('input', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
