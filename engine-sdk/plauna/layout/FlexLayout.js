// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FlexLayout - Flexbox-inspired layout engine for Plauna
 * Provides CSS Flexbox-like layout functionality with constrained feature set
 */

import { resolvePlaunaLayoutSize } from './LayoutSizing.js';

export class FlexLayout {
    constructor() {
        this.layoutCache = new Map();
        this.performanceStats = {
            totalLayouts: 0,
            totalTime: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }

    // Main layout calculation
    calculate(node, availableWidth, availableHeight) {
        const startTime = performance.now();
        
        // Generate cache key
        const cacheKey = this.generateCacheKey(node, availableWidth, availableHeight);
        
        // Check cache
        if (this.layoutCache.has(cacheKey)) {
            this.performanceStats.cacheHits++;
            const result = this.layoutCache.get(cacheKey);
            this.updateNodeLayoutBox(node, result);
            return result;
        }
        
        this.performanceStats.cacheMisses++;
        
        const style = node.style;
        const result = {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            children: []
        };
        
        // Determine flex direction
        const direction = style.flexDirection || 'row';
        const isRow = direction === 'row' || direction === 'row-reverse';
        const isReverse = direction.includes('reverse');
        
        // Calculate available space after padding and border
        const padding = this.getPadding(node);
        const border = this.getBorder(node);
        
        const innerWidth = availableWidth - padding.left - padding.right - border.left - border.right;
        const innerHeight = availableHeight - padding.top - padding.bottom - border.top - border.bottom;
        
        // Calculate child constraints
        const childConstraints = this.calculateChildConstraints(node, innerWidth, innerHeight);
        
        // Layout children
        if (isRow) {
            this.layoutRow(node, childConstraints, isReverse, result);
        } else {
            this.layoutColumn(node, childConstraints, isReverse, result);
        }
        
        // Calculate container size
        result.width = this.calculateContainerWidth(node, result.children, availableWidth);
        result.height = this.calculateContainerHeight(node, result.children, availableHeight);
        
        // Add padding and border back
        result.width += padding.left + padding.right + border.left + border.right;
        result.height += padding.top + padding.bottom + border.top + border.bottom;
        
        // Cache result
        this.layoutCache.set(cacheKey, result);
        
        // Update performance stats
        const layoutTime = performance.now() - startTime;
        this.performanceStats.totalLayouts++;
        this.performanceStats.totalTime += layoutTime;
        
        // Update node layout box
        this.updateNodeLayoutBox(node, result);
        
        return result;
    }

    // Layout row direction
    layoutRow(node, constraints, isReverse, result) {
        const style = node.style;
        const gap = style.gap || 0;
        const justifyContent = style.justifyContent || 'flex-start';
        const alignItems = style.alignItems || 'stretch';
        const flexWrap = style.flexWrap || 'nowrap';
        
        const children = node.children;
        const childResults = [];
        
        // Calculate child sizes
        const childSizes = [];
        let totalFlexGrow = 0;
        let totalFixedWidth = 0;
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const constraint = constraints[i];
            
            const childSize = this.calculateChildSize(child, constraint, 'width');
            childSizes.push(childSize);
            
            if (childSize.flexGrow > 0) {
                totalFlexGrow += childSize.flexGrow;
            } else {
                totalFixedWidth += childSize.width;
            }
        }
        
        // Handle wrapping
        if (flexWrap === 'wrap') {
            this.layoutRowWithWrapping(node, childSizes, constraints, gap, isReverse, result);
            return;
        }
        
        // Calculate available space for flex items
        const availableSpace = constraint.width - totalFixedWidth - (gap * (children.length - 1));
        
        // Distribute remaining space to flex items
        let currentX = isReverse ? constraint.width : 0;
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const childSize = childSizes[i];
            const childResult = {
                x: 0,
                y: 0,
                width: childSize.width,
                height: childSize.height
            };
            
            // Calculate flex width
            if (childSize.flexGrow > 0 && totalFlexGrow > 0) {
                const extraWidth = (availableSpace * childSize.flexGrow) / totalFlexGrow;
                childResult.width = Math.max(childSize.width, childSize.width + extraWidth);
            }
            
            // Set position
            if (isReverse) {
                currentX -= childResult.width;
                childResult.x = currentX;
                currentX -= gap;
            } else {
                childResult.x = currentX;
                currentX += childResult.width + gap;
            }
            
            // Align vertically
            childResult.y = this.alignChildVertically(childResult, constraint, alignItems);
            
            childResults.push(childResult);
        }
        
        // Apply justify content
        this.applyJustifyContentRow(childResults, constraint, justifyContent, gap, isReverse);
        
        result.children = childResults;
    }

    // Layout column direction
    layoutColumn(node, constraints, isReverse, result) {
        const style = node.style;
        const gap = style.gap || 0;
        const justifyContent = style.justifyContent || 'flex-start';
        const alignItems = style.alignItems || 'stretch';
        const flexWrap = style.flexWrap || 'nowrap';
        
        const children = node.children;
        const childResults = [];
        
        // Calculate child sizes
        const childSizes = [];
        let totalFlexGrow = 0;
        let totalFixedHeight = 0;
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const constraint = constraints[i];
            
            const childSize = this.calculateChildSize(child, constraint, 'height');
            childSizes.push(childSize);
            
            if (childSize.flexGrow > 0) {
                totalFlexGrow += childSize.flexGrow;
            } else {
                totalFixedHeight += childSize.height;
            }
        }
        
        // Handle wrapping
        if (flexWrap === 'wrap') {
            this.layoutColumnWithWrapping(node, childSizes, constraints, gap, isReverse, result);
            return;
        }
        
        // Calculate available space for flex items
        const availableSpace = constraint.height - totalFixedHeight - (gap * (children.length - 1));
        
        // Distribute remaining space to flex items
        let currentY = isReverse ? constraint.height : 0;
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const childSize = childSizes[i];
            const childResult = {
                x: 0,
                y: 0,
                width: childSize.width,
                height: childSize.height
            };
            
            // Calculate flex height
            if (childSize.flexGrow > 0 && totalFlexGrow > 0) {
                const extraHeight = (availableSpace * childSize.flexGrow) / totalFlexGrow;
                childResult.height = Math.max(childSize.height, childSize.height + extraHeight);
            }
            
            // Set position
            if (isReverse) {
                currentY -= childResult.height;
                childResult.y = currentY;
                currentY -= gap;
            } else {
                childResult.y = currentY;
                currentY += childResult.height + gap;
            }
            
            // Align horizontally
            childResult.x = this.alignChildHorizontally(childResult, constraint, alignItems);
            
            childResults.push(childResult);
        }
        
        // Apply justify content
        this.applyJustifyContentColumn(childResults, constraint, justifyContent, gap, isReverse);
        
        result.children = childResults;
    }

    // Calculate child size constraints
    calculateChildConstraints(node, availableWidth, availableHeight) {
        const children = node.children;
        const constraints = [];
        
        for (const child of children) {
            const style = child.style;
            const constraint = {
                width: availableWidth,
                height: availableHeight,
                minWidth: style.minWidth || 0,
                minHeight: style.minHeight || 0,
                maxWidth: style.maxWidth || Infinity,
                maxHeight: style.maxHeight || Infinity
            };
            
            // Apply flex basis
            const flexBasis = style.flexBasis;
            if (flexBasis !== undefined) {
                if (typeof flexBasis === 'number') {
                    constraint.width = flexBasis;
                } else if (flexBasis === 'auto') {
                    // Use content size
                } else {
                    constraint.width = resolvePlaunaLayoutSize(flexBasis, availableWidth, { fallback: constraint.width });
                }
            }
            
            constraints.push(constraint);
        }
        
        return constraints;
    }

    // Calculate individual child size
    calculateChildSize(child, constraint, primaryDimension) {
        const style = child.style;
        const size = {
            width: constraint.width,
            height: constraint.height,
            flexGrow: style.flexGrow || 0,
            flexShrink: style.flexShrink || 1,
            flexBasis: style.flexBasis || 'auto'
        };
        
        // Apply explicit sizes
        if (style.width !== undefined) {
            size.width = this.parseSize(style.width, constraint.width);
        }
        if (style.height !== undefined) {
            size.height = this.parseSize(style.height, constraint.height);
        }
        
        // Apply min/max constraints
        size.width = Math.max(constraint.minWidth, Math.min(constraint.maxWidth, size.width));
        size.height = Math.max(constraint.minHeight, Math.min(constraint.maxHeight, size.height));
        
        return size;
    }

    // Parse size value (number, percentage, or auto)
    parseSize(value, containerSize) {
        return resolvePlaunaLayoutSize(value, containerSize);
    }

    // Get padding from style
    getPadding(node) {
        const style = node.style;
        return {
            left: style.paddingLeft || style.padding || 0,
            right: style.paddingRight || style.padding || 0,
            top: style.paddingTop || style.padding || 0,
            bottom: style.paddingBottom || style.padding || 0
        };
    }

    // Get border from style
    getBorder(node) {
        const style = node.style;
        return {
            left: style.borderLeftWidth || style.borderWidth || 0,
            right: style.borderRightWidth || style.borderWidth || 0,
            top: style.borderTopWidth || style.borderWidth || 0,
            bottom: style.borderBottomWidth || style.borderWidth || 0
        };
    }

    // Align child vertically
    alignChildVertically(childResult, constraint, alignItems) {
        switch (alignItems) {
            case 'flex-start':
                return 0;
            case 'flex-end':
                return constraint.height - childResult.height;
            case 'center':
                return (constraint.height - childResult.height) / 2;
            case 'stretch':
                return 0; // Child height should already be stretched
            default:
                return 0;
        }
    }

    // Align child horizontally
    alignChildHorizontally(childResult, constraint, alignItems) {
        switch (alignItems) {
            case 'flex-start':
                return 0;
            case 'flex-end':
                return constraint.width - childResult.width;
            case 'center':
                return (constraint.width - childResult.width) / 2;
            case 'stretch':
                return 0; // Child width should already be stretched
            default:
                return 0;
        }
    }

    // Apply justify content for row layout
    applyJustifyContentRow(children, constraint, justifyContent, gap, isReverse) {
        const totalWidth = children.reduce((sum, child) => sum + child.width, 0) + (gap * (children.length - 1));
        const extraSpace = constraint.width - totalWidth;
        
        if (extraSpace <= 0) return;
        
        let offset = 0;
        
        switch (justifyContent) {
            case 'flex-start':
                offset = 0;
                break;
            case 'flex-end':
                offset = extraSpace;
                break;
            case 'center':
                offset = extraSpace / 2;
                break;
            case 'space-between':
                // Distribute space between children
                const spaceBetween = extraSpace / (children.length - 1);
                let currentX = isReverse ? constraint.width : 0;
                
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    if (isReverse) {
                        child.x = currentX - child.width;
                        currentX -= child.width + spaceBetween;
                    } else {
                        child.x = currentX;
                        currentX += child.width + spaceBetween;
                    }
                }
                return;
            case 'space-around':
                // Distribute space around children
                const spaceAround = extraSpace / children.length;
                offset = spaceAround / 2;
                break;
            default:
                return;
        }
        
        // Apply offset
        for (const child of children) {
            child.x += offset;
        }
    }

    // Apply justify content for column layout
    applyJustifyContentColumn(children, constraint, justifyContent, gap, isReverse) {
        const totalHeight = children.reduce((sum, child) => sum + child.height, 0) + (gap * (children.length - 1));
        const extraSpace = constraint.height - totalHeight;
        
        if (extraSpace <= 0) return;
        
        let offset = 0;
        
        switch (justifyContent) {
            case 'flex-start':
                offset = 0;
                break;
            case 'flex-end':
                offset = extraSpace;
                break;
            case 'center':
                offset = extraSpace / 2;
                break;
            case 'space-between':
                const spaceBetween = extraSpace / (children.length - 1);
                let currentY = isReverse ? constraint.height : 0;
                
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    if (isReverse) {
                        child.y = currentY - child.height;
                        currentY -= child.height + spaceBetween;
                    } else {
                        child.y = currentY;
                        currentY += child.height + spaceBetween;
                    }
                }
                return;
            case 'space-around':
                const spaceAround = extraSpace / children.length;
                offset = spaceAround / 2;
                break;
            default:
                return;
        }
        
        // Apply offset
        for (const child of children) {
            child.y += offset;
        }
    }

    // Calculate container width
    calculateContainerWidth(node, childResults, availableWidth) {
        const style = node.style;
        
        if (style.width !== undefined) {
            return this.parseSize(style.width, availableWidth);
        }
        
        if (childResults.length === 0) {
            return 0;
        }
        
        // Calculate based on children
        const maxChildWidth = Math.max(...childResults.map(child => child.x + child.width));
        const padding = this.getPadding(node);
        const border = this.getBorder(node);
        
        return maxChildWidth + padding.left + padding.right + border.left + border.right;
    }

    // Calculate container height
    calculateContainerHeight(node, childResults, availableHeight) {
        const style = node.style;
        
        if (style.height !== undefined) {
            return this.parseSize(style.height, availableHeight);
        }
        
        if (childResults.length === 0) {
            return 0;
        }
        
        // Calculate based on children
        const maxChildHeight = Math.max(...childResults.map(child => child.y + child.height));
        const padding = this.getPadding(node);
        const border = this.getBorder(node);
        
        return maxChildHeight + padding.top + padding.bottom + border.top + border.bottom;
    }

    // Update node layout box
    updateNodeLayoutBox(node, result) {
        node.layoutBox.x = result.x;
        node.layoutBox.y = result.y;
        node.layoutBox.width = result.width;
        node.layoutBox.height = result.height;
        
        // Update child positions
        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            const childResult = result.children[i];
            
            if (childResult) {
                child.layoutBox.x = node.layoutBox.x + childResult.x;
                child.layoutBox.y = node.layoutBox.y + childResult.y;
                child.layoutBox.width = childResult.width;
                child.layoutBox.height = childResult.height;
            }
        }
    }

    // Generate cache key
    generateCacheKey(node, availableWidth, availableHeight) {
        const style = node.style;
        const childrenHash = node.children.map(child => child.id).join(',');
        
        return `${node.id}_${availableWidth}_${availableHeight}_${childrenHash}_${JSON.stringify(style)}`;
    }

    // Handle row wrapping (simplified version)
    layoutRowWithWrapping(node, childSizes, constraints, gap, isReverse, result) {
        // For now, implement as single row (wrapping to be implemented later)
        this.layoutRow(node, constraints, isReverse, result);
    }

    // Handle column wrapping (simplified version)
    layoutColumnWithWrapping(node, childSizes, constraints, gap, isReverse, result) {
        // For now, implement as single column (wrapping to be implemented later)
        this.layoutColumn(node, constraints, isReverse, result);
    }

    // Get performance stats
    getPerformanceStats() {
        return {
            ...this.performanceStats,
            averageLayoutTime: this.performanceStats.totalLayouts > 0 ? 
                this.performanceStats.totalTime / this.performanceStats.totalLayouts : 0,
            cacheHitRatio: this.performanceStats.cacheHits + this.performanceStats.cacheMisses > 0 ?
                this.performanceStats.cacheHits / (this.performanceStats.cacheHits + this.performanceStats.cacheMisses) : 0
        };
    }

    // Clear cache
    clearCache() {
        this.layoutCache.clear();
    }

    // Reset performance stats
    resetPerformanceStats() {
        this.performanceStats = {
            totalLayouts: 0,
            totalTime: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }
}
