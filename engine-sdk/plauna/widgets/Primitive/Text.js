// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Text - Basic text widget for Plauna
 * Provides text rendering with styling and layout options
 */

import { UINode, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _textSequence = 0;

function _newTextId() {
    return `text-${Date.now()}-${++_textSequence}`;
}

export class Text extends UINode {
    // Widget metadata
    static id = 'text';
    static name = 'Text';
    static category = 'primitive';
    static icon = '📝';
    static description = 'Text display element';
    static tags = ['primitive', 'text'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            content: '',
            variant: 'body',
            size: 'md'
        };
    }

    static stories() {
        return {
            'Default': { content: 'Readable body text for the Plauna showcase.' },
            'Heading': { content: 'Design System Heading', variant: 'heading-1' },
            'Caption': { content: 'Supporting caption text for context and metadata.', variant: 'caption' },
            'Code': { content: 'const result = items.filter(Boolean);', variant: 'code' }
        };
    }
    
    static create(container, options = {}) {
        const instance = new Text(_newTextId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newTextId(), options = {}) {
        super(id, 'text');
        
        // Text-specific properties
        this.text = '';
        this.variant = options.variant || 'body';
        this.maxLines = options.maxLines || null;
        this.overflow = options.overflow || 'wrap';
        this.selectable = options.selectable !== false;
        this.editable = options.editable || false;
        
        // Set default styles
        /**
         * Modern typography surface pattern.
         *
         * Text widget follows design system typography tokens:
         * - Uses design token font family for consistency
         * - Default body styling (14px, 400 weight, 1.5 line-height)
         * - User-select configurable for text selection control
         * - Overflow handling (wrap/nowrap/clip) for text truncation
         *
         * Variants (heading, caption, code, etc.) are applied after
         * base styles via setVariant() for semantic typography.
         */
        this.setStyles({
            display: 'inline-block',
            color: 'var(--text-primary)',
            fontSize: '14px',
            fontFamily: tokens.get('typography.fontFamily.primary'),
            fontWeight: '400',
            lineHeight: '1.5',
            textAlign: 'left',
            userSelect: this.selectable ? 'text' : 'none',
            whiteSpace: this.overflow === 'wrap' ? 'normal' : 'nowrap',
            overflow: this.overflow === 'clip' ? 'hidden' : 'visible'
        });
        
        // Set content
        this.setText(options.content || '');

        // Apply variant styling
        this.setVariant(this.variant);
        
        // Setup editable behavior
        if (this.editable) {
            this.setupEditableBehavior();
        }
    }

    // Set text content
    setText(text) {
        if (this.text !== text || this.textContent !== text) {
            this.text = text;
            this.textContent = text;
            this.markDirty(DIRTY.TEXT | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    // Get text content
    getText() {
        return this.text;
    }

    // Set max lines
    setMaxLines(maxLines) {
        if (this.maxLines !== maxLines) {
            this.maxLines = maxLines;
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    // Set overflow behavior
    setOverflow(overflow) {
        if (this.overflow !== overflow) {
            this.overflow = overflow;
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    // Set selectable
    setSelectable(selectable) {
        if (this.selectable !== selectable) {
            this.selectable = selectable;
            this.setStyle('userSelect', selectable ? 'text' : 'none');
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Set editable
    setEditable(editable) {
        if (this.editable !== editable) {
            this.editable = editable;
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            
            if (editable) {
                this.setupEditableBehavior();
            } else {
                this.removeEditableBehavior();
            }
        }
    }

    // Set text variant
    setVariant(variant) {
        this.variant = variant;

        switch (variant) {
            case 'heading-1':
                this.setStyles({
                    fontSize: '32px',
                    fontWeight: '700',
                    lineHeight: '1.2',
                    color: 'var(--text-primary)'
                });
                break;
                
            case 'heading-2':
                this.setStyles({
                    fontSize: '24px',
                    fontWeight: '600',
                    lineHeight: '1.2',
                    color: 'var(--text-primary)'
                });
                break;
                
            case 'heading-3':
                this.setStyles({
                    fontSize: '20px',
                    fontWeight: '600',
                    lineHeight: '1.2',
                    color: 'var(--text-primary)'
                });
                break;
                
            case 'body':
                this.setStyles({
                    fontSize: '16px',
                    fontWeight: '400',
                    lineHeight: '1.5',
                    color: 'var(--text-primary)'
                });
                break;
                
            case 'caption':
                this.setStyles({
                    fontSize: '12px',
                    fontWeight: '400',
                    lineHeight: '1.5',
                    color: 'var(--text-secondary)'
                });
                break;
                
            case 'label':
                this.setStyles({
                    fontSize: '14px',
                    fontWeight: '500',
                    lineHeight: '1.5',
                    color: 'var(--text-secondary)'
                });
                break;
                
            case 'code':
                this.setStyles({
                    fontFamily: tokens.get('typography.fontFamily.monospace'),
                    fontSize: '13px',
                    fontWeight: '400',
                    lineHeight: '1.5',
                    color: 'var(--text-primary)',
                    backgroundColor: 'var(--bg-tertiary)',
                    padding: '2px 4px',
                    borderRadius: 'var(--border-radius-sm)'
                });
                break;
                
            default:
                // Keep default styles
                break;
        }
        
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Set text color
    setColor(color) {
        this.setStyle('color', color);
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Set text size
    setFontSize(size) {
        this.setStyle('fontSize', size);
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }

    // Set font weight
    setFontWeight(weight) {
        this.setStyle('fontWeight', weight);
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Set text alignment
    setTextAlign(align) {
        this.setStyle('textAlign', align);
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Set font family
    setFontFamily(family) {
        this.setStyle('fontFamily', family);
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Set line height
    setLineHeight(height) {
        this.setStyle('lineHeight', height);
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }

    // Setup editable behavior
    setupEditableBehavior() {
        this.setStyle('cursor', 'text');
        this.setState(NODE_STATE.FOCUSABLE, true);
        
        // Add focus event listeners
        this.addEventListener('focus', () => {
            this.setState(NODE_STATE.FOCUSED, true);
            this.markDirty(DIRTY.PAINT);
        });
        
        this.addEventListener('blur', () => {
            this.setState(NODE_STATE.FOCUSED, false);
            this.markDirty(DIRTY.PAINT);
        });
        
        // Add input event listeners for editing
        this.addEventListener('keydown', (event) => {
            if (!this.editable) return;
            
            switch (event.key) {
                case 'Enter':
                    event.preventDefault();
                    this.finishEditing();
                    break;
                case 'Escape':
                    event.preventDefault();
                    this.cancelEditing();
                    break;
            }
        });
        
        this.addEventListener('dblclick', () => {
            if (this.editable) {
                this.startEditing();
            }
        });
    }

    // Remove editable behavior
    removeEditableBehavior() {
        this.setStyle('cursor', 'default');
        this.setState(NODE_STATE.FOCUSABLE, false);
        this.setState(NODE_STATE.FOCUSED, false);
    }

    // Start editing
    startEditing() {
        if (!this.editable) return;
        
        // Create input element for editing
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.text;
        input.style.cssText = `
            position: absolute;
            left: ${this.layoutBox.x}px;
            top: ${this.layoutBox.y}px;
            width: ${this.layoutBox.width}px;
            height: ${this.layoutBox.height}px;
            font-family: ${this.getStyle('fontFamily')};
            font-size: ${this.getStyle('fontSize')}px;
            font-weight: ${this.getStyle('fontWeight')};
            color: ${this.getStyle('color')};
            background: transparent;
            border: 1px solid transparent;
            outline: none;
            padding: 0;
            margin: 0;
        `;
        
        document.body.appendChild(input);
        input.focus();
        input.select();
        
        // Handle input events
        const finishEdit = () => {
            const newText = input.value;
            this.setText(newText);
            document.body.removeChild(input);
        };
        
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                finishEdit();
            } else if (event.key === 'Escape') {
                document.body.removeChild(input);
            }
        });
        
        this._editingInput = input;
    }

    // Finish editing
    finishEditing() {
        if (this._editingInput) {
            const newText = this._editingInput.value;
            this.setText(newText);
            document.body.removeChild(this._editingInput);
            this._editingInput = null;
        }
    }

    // Cancel editing
    cancelEditing() {
        if (this._editingInput) {
            document.body.removeChild(this._editingInput);
            this._editingInput = null;
        }
    }

    // Calculate text metrics (placeholder for text measurement service)
    calculateMetrics() {
        // This would integrate with the text measurement service
        // For now, return estimated metrics
        const fontSize = this.getStyle('fontSize') || 14;
        const lineHeight = this.getStyle('lineHeight') || 1.4;
        
        return {
            width: this.estimateTextWidth(this.text),
            height: this.estimateTextHeight(this.text, fontSize, lineHeight),
            ascent: fontSize * 0.8,
            descent: fontSize * 0.2
        };
    }

    // Estimate text width (rough approximation)
    estimateTextWidth(text) {
        if (!text) return 0;
        
        const fontSize = this.getStyle('fontSize') || 14;
        const fontWeight = this.getStyle('fontWeight') || 400;
        
        // Rough character width estimation
        const avgCharWidth = fontSize * 0.6;
        const weightMultiplier = fontWeight >= 600 ? 1.1 : 1.0;
        
        return text.length * avgCharWidth * weightMultiplier;
    }

    // Estimate text height
    estimateTextHeight(text, fontSize, lineHeight) {
        if (!text) return fontSize;
        
        const lines = text.split('\n').length;
        return fontSize * lineHeight * lines;
    }

    // Truncate text to fit width
    truncateText(maxWidth, suffix = '...') {
        if (!this.text || this.estimateTextWidth(this.text) <= maxWidth) {
            return this.text;
        }
        
        const suffixWidth = this.estimateTextWidth(suffix);
        const availableWidth = maxWidth - suffixWidth;
        
        let truncated = '';
        let currentWidth = 0;
        
        for (const char of this.text) {
            const charWidth = this.estimateTextWidth(char);
            
            if (currentWidth + charWidth > availableWidth) {
                break;
            }
            
            truncated += char;
            currentWidth += charWidth;
        }
        
        return truncated + suffix;
    }

    // Get text info
    getInfo() {
        return {
            ...this.getDebugInfo(),
            text: this.text,
            maxLines: this.maxLines,
            overflow: this.overflow,
            selectable: this.selectable,
            editable: this.editable,
            metrics: this.calculateMetrics()
        };
    }

    // Override destroy to clean up text-specific resources
    destroy() {
        // Clean up editing input if exists
        if (this._editingInput) {
            document.body.removeChild(this._editingInput);
            this._editingInput = null;
        }
        
        // Call parent destroy
        super.destroy();
    }
}

// Text factory functions
export const TextFactory = {
    // Create basic text
    create(id, content, options = {}) {
        return new Text(id, content, options);
    },
    
    // Create heading text
    createHeading(id, content, level = 1, options = {}) {
        const text = new Text(id, content, options);
        text.setVariant(`heading-${level}`);
        return text;
    },
    
    // Create body text
    createBody(id, content, options = {}) {
        const text = new Text(id, content, options);
        text.setVariant('body');
        return text;
    },
    
    // Create caption text
    createCaption(id, content, options = {}) {
        const text = new Text(id, content, options);
        text.setVariant('caption');
        return text;
    },
    
    // Create label text
    createLabel(id, content, options = {}) {
        const text = new Text(id, content, options);
        text.setVariant('label');
        return text;
    },
    
    // Create code text
    createCode(id, content, options = {}) {
        const text = new Text(id, content, options);
        text.setVariant('code');
        return text;
    },
    
    // Create editable text
    createEditable(id, content, options = {}) {
        const text = new Text(id, content, { ...options, editable: true });
        return text;
    },
    
    // Create truncated text
    createTruncated(id, content, maxWidth, options = {}) {
        const text = new Text(id, content, options);
        text.setText(text.truncateText(maxWidth));
        return text;
    },
    
    // Create multiline text
    createMultiline(id, content, maxLines, options = {}) {
        const text = new Text(id, content, { ...options, maxLines });
        text.setStyle('whiteSpace', 'pre-wrap');
        return text;
    }
};
