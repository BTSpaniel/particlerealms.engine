// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function isGroupLayer(layer) {
    return layer?.type === 'group';
}

export function hierarchyParent(doc, layerOrId) {
    const layer = resolveLayer(doc, layerOrId);
    const parentId = typeof layer?.parentId === 'string' ? layer.parentId : '';
    if (!layer || !parentId || parentId === layer.id) return null;
    const parent = (doc?.layers ?? []).find(candidate => candidate.id === parentId) ?? null;
    return isGroupLayer(parent) ? parent : null;
}

export function hierarchyParentId(doc, layerOrId) {
    return hierarchyParent(doc, layerOrId)?.id ?? null;
}

export function childLayers(doc, parentOrId = null) {
    const parentId = typeof parentOrId === 'string' ? parentOrId : parentOrId?.id ?? null;
    return (doc?.layers ?? []).filter(layer => hierarchyParentId(doc, layer) === parentId);
}

export function siblingLayers(doc, layerOrId) {
    return childLayers(doc, hierarchyParentId(doc, layerOrId));
}

export function layerDepth(doc, layerOrId) {
    let depth = 0;
    let current = resolveLayer(doc, layerOrId);
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        current = hierarchyParent(doc, current);
        if (current) depth += 1;
    }
    return depth;
}

export function layerEffectiveState(doc, layerOrId) {
    let visible = true;
    let opacity = 1;
    let current = resolveLayer(doc, layerOrId);
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        visible = visible && current.visible !== false;
        opacity *= finiteOpacity(current.opacity);
        current = hierarchyParent(doc, current);
    }
    return { visible, opacity: Math.max(0, Math.min(1, opacity)) };
}

export function expandLayerAncestors(doc, layerOrId) {
    let current = hierarchyParent(doc, layerOrId);
    const visited = new Set();
    let changed = false;
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        if (current.expanded === false) {
            current.expanded = true;
            changed = true;
        }
        current = hierarchyParent(doc, current);
    }
    return changed;
}

export function hierarchyRows(doc) {
    const rows = [];
    const emitted = new Set();
    const visit = (layer, depth, ancestorVisible) => {
        if (!layer || emitted.has(layer.id)) return;
        emitted.add(layer.id);
        const visible = ancestorVisible && layer.visible !== false;
        const children = isGroupLayer(layer) ? childLayers(doc, layer) : [];
        rows.push({
            layer,
            depth,
            hasChildren: children.length > 0,
            effectiveVisible: visible,
        });
        if (isGroupLayer(layer) && layer.expanded !== false) {
            for (const child of children.slice().reverse()) visit(child, depth + 1, visible);
        }
    };
    for (const layer of childLayers(doc).slice().reverse()) visit(layer, 0, true);
    for (const layer of (doc?.layers ?? []).slice().reverse()) visit(layer, 0, true);
    return rows;
}

export function hierarchyRenderEntries(doc) {
    const entries = [];
    const emitted = new Set();
    const visit = (layer, parentState) => {
        if (!layer || emitted.has(layer.id)) return;
        emitted.add(layer.id);
        const state = {
            visible: parentState.visible && layer.visible !== false,
            opacity: Math.max(0, Math.min(1, parentState.opacity * finiteOpacity(layer.opacity))),
        };
        entries.push({ layer, ...state });
        if (isGroupLayer(layer)) {
            for (const child of childLayers(doc, layer)) visit(child, state);
        }
    };
    for (const layer of childLayers(doc)) visit(layer, { visible: true, opacity: 1 });
    for (const layer of doc?.layers ?? []) visit(layer, { visible: true, opacity: 1 });
    return entries;
}

export function moveLayerWithinHierarchy(doc, layerOrId, direction) {
    const layer = resolveLayer(doc, layerOrId);
    if (!layer || !['up', 'down'].includes(direction)) return false;
    const siblings = siblingLayers(doc, layer);
    const position = siblings.indexOf(layer);
    const target = siblings[position + (direction === 'up' ? 1 : -1)];
    if (!target) return false;
    const sourceIndex = doc.layers.indexOf(layer);
    const targetIndex = doc.layers.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return false;
    [doc.layers[sourceIndex], doc.layers[targetIndex]] = [doc.layers[targetIndex], doc.layers[sourceIndex]];
    return true;
}

export function placeLayerWithinHierarchy(doc, sourceOrId, targetOrId, placement = 'after') {
    const source = resolveLayer(doc, sourceOrId);
    const target = resolveLayer(doc, targetOrId);
    if (!source || !target || source === target || !['before', 'after', 'inside'].includes(placement)) return false;
    if (placement === 'inside' && !isGroupLayer(target)) return false;
    if (isHierarchyDescendant(doc, target, source)) return false;

    const sourceIndex = doc.layers.indexOf(source);
    if (sourceIndex < 0) return false;
    doc.layers.splice(sourceIndex, 1);

    source.parentId = placement === 'inside'
        ? target.id
        : hierarchyParentId(doc, target);
    if (placement === 'inside') target.expanded = true;

    const targetIndex = doc.layers.indexOf(target);
    const insertionIndex = placement === 'before' ? targetIndex + 1 : targetIndex;
    doc.layers.splice(Math.max(0, insertionIndex), 0, source);
    normalizeLayerHierarchy(doc);
    expandLayerAncestors(doc, source);
    return true;
}

export function indentLayerWithinHierarchy(doc, layerOrId) {
    const layer = resolveLayer(doc, layerOrId);
    if (!layer) return false;
    const siblings = siblingLayers(doc, layer);
    const position = siblings.indexOf(layer);
    const parent = siblings[position + 1];
    if (!isGroupLayer(parent)) return false;
    layer.parentId = parent.id;
    return true;
}

export function outdentLayerWithinHierarchy(doc, layerOrId) {
    const layer = resolveLayer(doc, layerOrId);
    const parent = hierarchyParent(doc, layer);
    if (!layer || !parent) return false;
    layer.parentId = hierarchyParentId(doc, parent);
    const sourceIndex = doc.layers.indexOf(layer);
    if (sourceIndex < 0) return false;
    doc.layers.splice(sourceIndex, 1);
    const parentIndex = doc.layers.indexOf(parent);
    doc.layers.splice(Math.max(0, parentIndex), 0, layer);
    return true;
}

export function normalizeLayerHierarchy(doc) {
    const layers = doc?.layers ?? [];
    const groups = new Map(layers.filter(isGroupLayer).map(layer => [layer.id, layer]));
    for (const layer of layers) {
        if (!groups.has(layer.parentId) || layer.parentId === layer.id) layer.parentId = null;
    }
    for (const layer of layers) {
        const visited = new Set([layer.id]);
        let current = hierarchyParent(doc, layer);
        while (current) {
            if (visited.has(current.id)) {
                layer.parentId = null;
                break;
            }
            visited.add(current.id);
            current = hierarchyParent(doc, current);
        }
        layer.expanded = layer.expanded !== false;
    }
    return doc;
}

function resolveLayer(doc, layerOrId) {
    if (!layerOrId) return null;
    return typeof layerOrId === 'string'
        ? (doc?.layers ?? []).find(layer => layer.id === layerOrId) ?? null
        : layerOrId;
}

function isHierarchyDescendant(doc, candidate, ancestor) {
    let current = hierarchyParent(doc, candidate);
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        if (current.id === ancestor.id) return true;
        visited.add(current.id);
        current = hierarchyParent(doc, current);
    }
    return false;
}

function finiteOpacity(value) {
    const opacity = Number(value);
    return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
}
