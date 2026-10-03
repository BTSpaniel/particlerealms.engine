// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * StyleInspector - Live style debugging tool for Plauna
 * Provides real-time style inspection and editing capabilities
 */

import { ComputedStyle } from '../style/ComputedStyle.js';
import { tokens } from '../style/DesignTokens.js';

export class StyleInspector {
    constructor(options = {}) {
        this.selectedNode = options.selectedNode || null;
        this.computedStyle = new ComputedStyle();
        this.liveEdit = options.liveEdit !== false;
        this.showInherited = options.showInherited || true;
        this.showComputed = options.showComputed || true;
        
        // Inspector UI
        this.container = null;
        this.styleView = null;
        this.tokenView = null;
        this.editView = null;
        
        // Event handlers
        this.onStyleChanged = options.onStyleChanged || null;
        
        // Performance tracking
        this.updateCount = 0;
        this.lastUpdateTime = 0;
    }

    // Initialize inspector
    initialize(container) {
        this.container = container;
        
        // Create inspector layout
        this.createInspectorLayout();
        
        // Bind events
        this.bindEvents();
        
        // Initial render
        this.render();
        
        return this;
    }

    // Create inspector layout
    createInspectorLayout() {
        if (!this.container) return;
        
        // Clear container
        while (this.container.children.length > 0) {
            this.container.removeChild(this.container.children[0]);
        }
        
        // Create main layout
        const layout = new UINode('plauna-style-inspector', 'style-inspector-layout');
        layout.setStyles({
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            backgroundColor: '#1e1e1e',
            color: '#ffffff',
            fontFamily: 'monospace',
            fontSize: 12,
            overflow: 'hidden'
        });
        
        // Create header
        const header = this.createHeader();
        layout.appendChild(header);
        
        // Create content area
        const content = new UINode('style-content', 'style-content');
        content.setStyles({
            display: 'flex',
            flexDirection: 'row',
            flex: 1,
            overflow: 'hidden'
        });
        
        // Create style view
        this.styleView = this.createStyleView();
        content.appendChild(this.styleView);
        
        // Create token view
        this.tokenView = this.createTokenView();
        content.appendChild(this.tokenView);
        
        // Create edit view
        this.editView = this.createEditView();
        content.appendChild(this.editView);
        
        layout.appendChild(content);
        
        // Add to container
        this.container.appendChild(layout);
    }

    // Create header
    createHeader() {
        const header = new UINode('style-inspector-header', 'style-header');
        header.setStyles({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            backgroundColor: '#2d2d2d',
            borderBottom: '1px solid #444444',
            fontSize: 14,
            fontWeight: 'bold'
        });
        
        // Title
        const title = new UINode('style-inspector-title', 'style-title');
        title.textContent = 'Plauna Style Inspector';
        title.setStyles({
            color: '#ffffff',
            fontWeight: 'bold'
        });
        header.appendChild(title);
        
        // Controls
        const controls = new UINode('style-controls', 'style-controls');
        controls.setStyles({
            display: 'flex',
            flexDirection: 'row',
            gap: '8px'
        });
        
        // Refresh button
        const refreshBtn = this.createButton('Refresh', () => this.render());
        controls.appendChild(refreshBtn);
        
        // Toggle inherited display
        const inheritedBtn = this.createButton('Inherited', () => {
            this.showInherited = !this.showInherited;
            this.render();
        });
        controls.appendChild(inheritedBtn);
        
        // Toggle computed display
        const computedBtn = this.createButton('Computed', () => {
            this.showComputed = !this.showComputed;
            this.render();
        });
        controls.appendChild(computedBtn);
        
        // Toggle live edit
        const liveBtn = this.createButton('Live Edit', () => {
            this.liveEdit = !this.liveEdit;
            this.render();
        });
        controls.appendChild(liveBtn);
        
        header.appendChild(controls);
        
        return header;
    }

    // Create button
    createButton(text, onClick) {
        const button = new UINode('style-btn', 'style-button');
        button.textContent = text;
        button.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px 8px',
            backgroundColor: '#444444',
            color: '#ffffff',
            border: '1px solid #666666',
            borderRadius: '4px',
            fontSize: 11,
            cursor: 'pointer',
            userSelect: 'none'
        });
        
        button.addEventListener('click', onClick);
        
        return button;
    }

    // Create style view
    createStyleView() {
        const styleView = new UINode('style-view', 'style-view');
        styleView.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: '300px',
            backgroundColor: '#1e1e1e',
            borderRight: '1px solid #444444',
            overflow: 'auto',
            padding: '8px'
        });
        
        return styleView;
    }

    // Create token view
    createTokenView() {
        const tokenView = new UINode('token-view', 'token-view');
        tokenView.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: '250px',
            backgroundColor: '#1e1e1e',
            borderRight: '1px solid #444444',
            overflow: 'auto',
            padding: '8px'
        });
        
        return tokenView;
    }

    // Create edit view
    createEditView() {
        const editView = new UINode('edit-view', 'edit-view');
        editView.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: '300px',
            backgroundColor: '#1e1e1e',
            overflow: 'auto',
            padding: '8px'
        });
        
        return editView;
    }

    // Bind events
    bindEvents() {
        // Auto-refresh on interval
        setInterval(() => {
            this.render();
        }, 500); // Update every 500ms
    }

    // Set selected node
    setSelectedNode(node) {
        this.selectedNode = node;
        this.render();
    }

    // Render inspector
    render() {
        this.updateCount++;
        this.lastUpdateTime = Date.now();
        
        this.renderStyles();
        this.renderTokens();
        this.renderEditView();
    }

    // Render styles
    renderStyles() {
        if (!this.styleView || !this.selectedNode) return;
        
        // Clear style view
        while (this.styleView.children.length > 0) {
            this.styleView.removeChild(this.styleView.children[0]);
        }
        
        // Compute styles
        const parentStyle = this.selectedNode.parent ? 
            this.computedStyle.compute(this.selectedNode.parent) : null;
        const computed = this.computedStyle.compute(this.selectedNode, parentStyle);
        
        // Render style sections
        this.renderStyleSection('Computed Styles', computed, true);
        
        if (this.showInherited && parentStyle) {
            this.renderStyleSection('Inherited Styles', parentStyle, false);
        }
        
        this.renderStyleSection('Applied Styles', this.selectedNode.style, false);
    }

    // Render style section
    renderStyleSection(title, styles, isComputed) {
        const section = new UINode(`style-section-${title.toLowerCase().replace(' ', '-')}`, 'style-section');
        section.setStyles({
            marginBottom: '16px'
        });
        
        // Section header
        const header = new UINode(`${section.id}-header`, 'section-header');
        header.textContent = title;
        header.setStyles({
            color: '#4fc3f7',
            fontWeight: 'bold',
            marginBottom: '4px',
            fontSize: 12
        });
        section.appendChild(header);
        
        // Style properties
        for (const [property, value] of Object.entries(styles)) {
            const styleElement = this.createStyleElement(property, value, isComputed);
            section.appendChild(styleElement);
        }
        
        this.styleView.appendChild(section);
    }

    // Create style element
    createStyleElement(property, value, isComputed) {
        const element = new UINode(`style-${property}`, 'style-property');
        element.setStyles({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: '2px',
            fontSize: 11,
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: '2px'
        });
        
        // Hover effect
        element.setStyles({
            ':hover': {
                backgroundColor: '#333333'
            }
        });
        
        // Property name
        const propertyElement = new UINode(`${element.id}-property`, 'property-name');
        propertyElement.textContent = property;
        propertyElement.setStyles({
            color: isComputed ? '#81c784' : '#ffffff',
            width: '150px',
            flexShrink: 0,
            fontWeight: isComputed ? 'bold' : 'normal'
        });
        element.appendChild(propertyElement);
        
        // Value
        const valueElement = new UINode(`${element.id}-value`, 'property-value');
        valueElement.textContent = this.formatStyleValue(value);
        valueElement.setStyles({
            color: this.getStyleValueColor(property, value),
            flex: 1,
            wordBreak: 'break-all'
        });
        element.appendChild(valueElement);
        
        // Token indicator
        if (this.isTokenValue(value)) {
            const tokenIndicator = new UINode(`${element.id}-token`, 'token-indicator');
            tokenIndicator.textContent = '🎨';
            tokenIndicator.setStyles({
                color: '#ff9800',
                marginLeft: '4px',
                fontSize: 10
            });
            element.appendChild(tokenIndicator);
        }
        
        // Click handler for editing
        element.addEventListener('click', () => {
            this.editStyleProperty(property, value);
        });
        
        return element;
    }

    // Format style value
    formatStyleValue(value) {
        if (value === null || value === undefined) return 'null';
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return String(value);
    }

    // Get style value color
    getStyleValueColor(property, value) {
        if (typeof value === 'string') {
            // Color values
            if (property.includes('color') || property.includes('Color')) {
                return '#ff9800'; // Orange for colors
            }
            
            // Token values
            if (this.isTokenValue(value)) {
                return '#ff9800'; // Orange for tokens
            }
            
            // Numeric values
            if (!isNaN(parseFloat(value))) {
                return '#4fc3f7'; // Blue for numbers
            }
        }
        
        return '#ffffff'; // White for everything else
    }

    // Check if value is a token
    isTokenValue(value) {
        if (typeof value !== 'string') return false;
        
        return value.includes('color(') || 
               value.includes('spacing(') || 
               value.includes('typography(') || 
               value.includes('radius(') || 
               value.includes('shadow(');
    }

    // Edit style property
    editStyleProperty(property, currentValue) {
        if (!this.liveEdit || !this.selectedNode) return;
        
        // Create edit dialog
        const newValue = prompt(`Edit ${property}:`, this.formatStyleValue(currentValue));
        if (newValue === null) return; // User cancelled
        
        // Parse the new value
        const parsedValue = this.parseStyleValue(newValue, currentValue);
        
        // Apply the change
        this.selectedNode.setStyle(property, parsedValue);
        
        // Emit change event
        if (this.onStyleChanged) {
            this.onStyleChanged(property, currentValue, parsedValue);
        }
        
        // Re-render
        this.render();
    }

    // Parse style value
    parseStyleValue(newValue, currentValue) {
        // If current value is a number, try to parse as number
        if (typeof currentValue === 'number') {
            const parsed = parseFloat(newValue);
            return isNaN(parsed) ? currentValue : parsed;
        }
        
        // If current value is a boolean, parse as boolean
        if (typeof currentValue === 'boolean') {
            return newValue.toLowerCase() === 'true';
        }
        
        // Return as string for everything else
        return newValue;
    }

    // Render tokens
    renderTokens() {
        if (!this.tokenView) return;
        
        // Clear token view
        while (this.tokenView.children.length > 0) {
            this.tokenView.removeChild(this.tokenView.children[0]);
        }
        
        // Render token sections
        this.renderTokenSection('Spacing Tokens', this.getSpacingTokens());
        this.renderTokenSection('Typography Tokens', this.getTypographyTokens());
        this.renderTokenSection('Color Tokens', this.getColorTokens());
        this.renderTokenSection('Other Tokens', this.getOtherTokens());
    }

    // Render token section
    renderTokenSection(title, tokens) {
        const section = new UINode(`token-section-${title.toLowerCase().replace(' ', '-')}`, 'token-section');
        section.setStyles({
            marginBottom: '16px'
        });
        
        // Section header
        const header = new UINode(`${section.id}-header`, 'section-header');
        header.textContent = title;
        header.setStyles({
            color: '#4fc3f7',
            fontWeight: 'bold',
            marginBottom: '4px',
            fontSize: 12
        });
        section.appendChild(header);
        
        // Token properties
        for (const [path, value] of Object.entries(tokens)) {
            const tokenElement = this.createTokenElement(path, value);
            section.appendChild(tokenElement);
        }
        
        this.tokenView.appendChild(section);
    }

    // Create token element
    createTokenElement(path, value) {
        const element = new UINode(`token-${path}`, 'token-property');
        element.setStyles({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: '2px',
            fontSize: 11,
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: '2px'
        });
        
        // Hover effect
        element.setStyles({
            ':hover': {
                backgroundColor: '#333333'
            }
        });
        
        // Token path
        const pathElement = new UINode(`${element.id}-path`, 'token-path');
        pathElement.textContent = path;
        pathElement.setStyles({
            color: '#ff9800',
            width: '120px',
            flexShrink: 0,
            fontSize: 10
        });
        element.appendChild(pathElement);
        
        // Token value
        const valueElement = new UINode(`${element.id}-value`, 'token-value');
        valueElement.textContent = this.formatStyleValue(value);
        valueElement.setStyles({
            color: '#ffffff',
            flex: 1,
            wordBreak: 'break-all'
        });
        element.appendChild(valueElement);
        
        // Copy button
        const copyBtn = new UINode(`${element.id}-copy`, 'copy-btn');
        copyBtn.textContent = '📋';
        copyBtn.setStyles({
            color: '#888888',
            marginLeft: '4px',
            fontSize: 10,
            cursor: 'pointer'
        });
        
        copyBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this.copyToClipboard(`token(${path})`);
        });
        
        element.appendChild(copyBtn);
        
        // Click handler to use token
        element.addEventListener('click', () => {
            this.useToken(path);
        });
        
        return element;
    }

    // Get spacing tokens
    getSpacingTokens() {
        const spacingTokens = {};
        const spacing = tokens.get('spacing') || {};
        
        for (const [key, value] of Object.entries(spacing)) {
            spacingTokens[`spacing.${key}`] = value;
        }
        
        return spacingTokens;
    }

    // Get typography tokens
    getTypographyTokens() {
        const typographyTokens = {};
        const typography = tokens.get('typography') || {};
        
        for (const [key, value] of Object.entries(typography)) {
            if (typeof value === 'object') {
                for (const [subKey, subValue] of Object.entries(value)) {
                    typographyTokens[`typography.${key}.${subKey}`] = subValue;
                }
            } else {
                typographyTokens[`typography.${key}`] = value;
            }
        }
        
        return typographyTokens;
    }

    // Get color tokens
    getColorTokens() {
        const colorTokens = {};
        const colors = tokens.get('colors') || {};
        
        const collectColors = (obj, prefix = 'colors') => {
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'object' && value !== null) {
                    collectColors(value, `${prefix}.${key}`);
                } else {
                    colorTokens[`${prefix}.${key}`] = value;
                }
            }
        };
        
        collectColors(colors);
        return colorTokens;
    }

    // Get other tokens
    getOtherTokens() {
        const otherTokens = {};
        
        // Radius tokens
        const radius = tokens.get('radius') || {};
        for (const [key, value] of Object.entries(radius)) {
            otherTokens[`radius.${key}`] = value;
        }
        
        // Shadow tokens
        const shadows = tokens.get('shadows') || {};
        for (const [key, value] of Object.entries(shadows)) {
            otherTokens[`shadows.${key}`] = value;
        }
        
        // Motion tokens
        const motion = tokens.get('motion') || {};
        for (const [key, value] of Object.entries(motion)) {
            otherTokens[`motion.${key}`] = value;
        }
        
        return otherTokens;
    }

    // Use token
    useToken(path) {
        if (!this.liveEdit || !this.selectedNode) return;
        
        const tokenValue = `token(${path})`;
        console.log(`Would apply token ${path} to selected node`);
        
        // In a real implementation, this would apply the token to the selected node
        // For now, just log it
    }

    // Copy to clipboard
    copyToClipboard(text) {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(text).catch(err => {
                console.error('Failed to copy to clipboard:', err);
            });
        }
    }

    // Render edit view
    renderEditView() {
        if (!this.editView) return;
        
        // Clear edit view
        while (this.editView.children.length > 0) {
            this.editView.removeChild(this.editView.children[0]);
        }
        
        if (!this.liveEdit) {
            const disabledState = new UINode('edit-disabled', 'edit-disabled');
            disabledState.textContent = 'Live editing is disabled';
            disabledState.setStyles({
                color: '#888888',
                fontStyle: 'italic',
                textAlign: 'center',
                padding: '20px'
            });
            this.editView.appendChild(disabledState);
            return;
        }
        
        if (!this.selectedNode) {
            const noSelection = new UINode('no-selection', 'no-selection');
            noSelection.textContent = 'Select a node to edit styles';
            noSelection.setStyles({
                color: '#888888',
                fontStyle: 'italic',
                textAlign: 'center',
                padding: '20px'
            });
            this.editView.appendChild(noSelection);
            return;
        }
        
        // Render quick edit section
        this.renderQuickEdit();
        
        // Render style editor
        this.renderStyleEditor();
    }

    // Render quick edit
    renderQuickEdit() {
        const section = new UINode('quick-edit', 'quick-edit');
        section.setStyles({
            marginBottom: '16px'
        });
        
        const header = new UINode('quick-edit-header', 'section-header');
        header.textContent = 'Quick Edit';
        header.setStyles({
            color: '#4fc3f7',
            fontWeight: 'bold',
            marginBottom: '8px',
            fontSize: 12
        });
        section.appendChild(header);
        
        // Quick edit controls
        const controls = new UINode('quick-controls', 'quick-controls');
        controls.setStyles({
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
        });
        
        // Background color
        const bgControl = this.createQuickEditControl('Background', 'backgroundColor', 'color');
        controls.appendChild(bgControl);
        
        // Text color
        const textControl = this.createQuickEditControl('Text Color', 'color', 'color');
        controls.appendChild(textControl);
        
        // Border
        const borderControl = this.createQuickEditControl('Border', 'border', 'border');
        controls.appendChild(borderControl);
        
        // Padding
        const paddingControl = this.createQuickEditControl('Padding', 'padding', 'spacing');
        controls.appendChild(paddingControl);
        
        section.appendChild(controls);
        this.editView.appendChild(section);
    }

    // Create quick edit control
    createQuickEditControl(label, property, type) {
        const control = new UNode(`quick-${property}`, 'quick-control');
        control.setStyles({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '8px'
        });
        
        // Label
        const labelElement = new UINode(`${control.id}-label`, 'control-label');
        labelElement.textContent = label;
        labelElement.setStyles({
            color: '#ffffff',
            width: '80px',
            fontSize: 11
        });
        control.appendChild(labelElement);
        
        // Input
        const input = new UINode(`${control.id}-input`, 'control-input');
        input.setStyles({
            flex: 1,
            padding: '4px',
            backgroundColor: '#333333',
            color: '#ffffff',
            border: '1px solid #555555',
            borderRadius: '2px',
            fontSize: 11
        });
        
        // Set current value
        const currentValue = this.selectedNode.getStyle(property);
        input.textContent = this.formatStyleValue(currentValue);
        
        // Make editable
        input.addEventListener('click', () => {
            const newValue = prompt(`Edit ${label}:`, input.textContent);
            if (newValue !== null) {
                const parsedValue = this.parseStyleValue(newValue, currentValue);
                this.selectedNode.setStyle(property, parsedValue);
                input.textContent = this.formatStyleValue(parsedValue);
                this.render();
            }
        });
        
        control.appendChild(input);
        
        return control;
    }

    // Render style editor
    renderStyleEditor() {
        const section = new UINode('style-editor', 'style-editor');
        section.setStyles({
            marginBottom: '16px'
        });
        
        const header = new UINode('style-editor-header', 'section-header');
        header.textContent = 'Style Editor';
        header.setStyles({
            color: '#4fc3f7',
            fontWeight: 'bold',
            marginBottom: '8px',
            fontSize: 12
        });
        section.appendChild(header);
        
        // Style editor textarea
        const editor = new UINode('style-textarea', 'style-textarea');
        editor.setStyles({
            width: '100%',
            height: '200px',
            padding: '8px',
            backgroundColor: '#333333',
            color: '#ffffff',
            border: '1px solid #555555',
            borderRadius: '4px',
            fontSize: 11,
            fontFamily: 'monospace',
            resize: 'vertical'
        });
        
        // Generate CSS representation
        const css = this.generateCSS();
        editor.textContent = css;
        
        // Make editable
        editor.addEventListener('click', () => {
            const newCSS = prompt('Edit CSS:', editor.textContent);
            if (newCSS !== null) {
                this.parseAndApplyCSS(newCSS);
                this.render();
            }
        });
        
        section.appendChild(editor);
        this.editView.appendChild(section);
    }

    // Generate CSS representation
    generateCSS() {
        if (!this.selectedNode) return '';
        
        const styles = this.selectedNode.style;
        const css = [];
        
        for (const [property, value] of Object.entries(styles)) {
            css.push(`  ${property}: ${value};`);
        }
        
        return `.${this.selectedNode.type}#${this.selectedNode.id} {\n${css.join('\n')}\n}`;
    }

    // Parse and apply CSS
    parseAndApplyCSS(css) {
        if (!this.selectedNode) return;
        
        // Simple CSS parser (very basic implementation)
        const styleRegex = /(\w+(?:-\w+)*)\s*:\s*([^;]+);/g;
        let match;
        
        while ((match = styleRegex.exec(css)) !== null) {
            const property = match[1];
            const value = match[2].trim();
            
            this.selectedNode.setStyle(property, value);
        }
    }

    // Destroy inspector
    destroy() {
        if (this.container) {
            while (this.container.children.length > 0) {
                this.container.removeChild(this.container.children[0]);
            }
        }
        
        this.selectedNode = null;
        this.styleView = null;
        this.tokenView = null;
        this.editView = null;
        this.onStyleChanged = null;
    }
}
