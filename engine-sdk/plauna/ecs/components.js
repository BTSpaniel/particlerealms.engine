// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Plauna ECS Components
 * Follow existing engine component registration patterns.
 */

import { defineComponentType } from '../../engine/ecs/components/ComponentRegistry.js';

function createPlaunaComponent(name, defaults) {
    return defineComponentType({
        name,
        version: 1,
        defaults,
    });
}

// =============================================================================
// ROOT AND WORKBENCH COMPONENTS
// =============================================================================

export const UIRoot = createPlaunaComponent('UIRoot', {
    appId: "",
    activeWorkspace: "",
    theme: "dark",
});

export const UIWorkspace = createPlaunaComponent('UIWorkspace', {
    id: "",
    label: "",
    shellEntity: 0,
    persistKey: "",
});

export const UIZone = createPlaunaComponent('UIZone', {
    kind: "center", // left, center, right, bottom, overlay, floating
    parentWorkspace: 0,
    order: 0,
    visible: true,
});

export const UIGroup = createPlaunaComponent('UIGroup', {
    zone: 0,
    kind: "tabs", // tabs, split, stack
    orientation: "horizontal", // horizontal, vertical
    ratio: 0.5,
    children: [], // Array of entity IDs
    activeChild: 0,
});

// =============================================================================
// VIEWS AND LAYOUT COMPONENTS
// =============================================================================

export const UIView = createPlaunaComponent('UIView', {
    id: "",
    kind: "",
    title: "",
    renderMode: "dom", // dom, dom+gpu, gpu
    mount: "panel", // panel, floating, overlay
    closable: true,
});

export const UILayout = createPlaunaComponent('UILayout', {
    minW: 240,
    minH: 120,
    preferredW: null,
    preferredH: null,
    grow: 1,
    shrink: 1,
});

export const UIAnchor = createPlaunaComponent('UIAnchor', {
    targetEntity: 0,
    mode: "none", // none, screen, world
    sidePreference: ["right", "left", "bottom"],
    align: "start", // start, center, end
    gap: 8,
    keepInBounds: true,
});

// =============================================================================
// SURFACE COMPONENTS
// =============================================================================

export const UISurface = createPlaunaComponent('UISurface', {
    kind: "viewport", // viewport, clipped, warped
    source: "", // camera name, texture ID, etc.
    shape: "rect", // rect, polygon, circle
    clipEntity: 0,
    warpEntity: 0,
    interactive: true,
});

export const UIShape = createPlaunaComponent('UIShape', {
    type: "rect", // rect, polygon, circle
    points: [], // Array of [x, y] for polygons
    path: "", // SVG path string
});

export const UIWarp = createPlaunaComponent('UIWarp', {
    type: "none", // none, curve, mesh, portal
    mesh: "", // mesh asset ID
    params: {}, // warp parameters
});

// =============================================================================
// STATE AND BINDING COMPONENTS
// =============================================================================

export const UIBinding = createPlaunaComponent('UIBinding', {
    sourceEntity: 0,
    sourceComponent: "",
    propMap: {}, // property mapping
});

export const UIState = createPlaunaComponent('UIState', {
    visible: true,
    pinned: false,
    floating: false,
    focused: false,
    selected: false,
    collapsed: false,
});

export const UIInput = createPlaunaComponent('UIInput', {
    pointerEvents: true,
    keyboardFocus: false,
    draggable: false,
    resizable: false,
    hitShape: "auto", // auto, rect, circle, polygon
});

export const UIText = createPlaunaComponent('UIText', {
    text: "",
    fontFamily: "Inter",
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 20,
    gpuText: false,
    wrapMode: "word", // word, char, none
    measureMode: "pretext", // pretext, dom
});

export const UITextLayout = createPlaunaComponent('UITextLayout', {
    styleKey: "",
    maxWidth: null,
    lineClamp: null,
    overflow: "wrap", // wrap, ellipsis, clip
    useSegments: false,
    cacheKey: "",
});

// =============================================================================
// PANEL-SPECIFIC COMPONENTS
// =============================================================================

export const UIPanel = createPlaunaComponent('UIPanel', {
    kind: "", // inspector, hierarchy, viewport, assets, console
    title: "",
    icon: "",
    defaultSize: { w: 320, h: 240 },
    minSize: { w: 240, h: 120 },
    resizable: true,
    dockable: true,
});

export const UITab = createPlaunaComponent('UITab', {
    title: "",
    icon: "",
    closable: true,
    dirty: false,
    tooltip: "",
});

export const UISplit = createPlaunaComponent('UISplit', {
    direction: "horizontal", // horizontal, vertical
    sizes: [], // Array of ratios
    resizable: true,
    minSizes: [], // Minimum sizes for each pane
});

// =============================================================================
// NEST AND FOOD COMPONENTS (for ant colony demo integration)
// =============================================================================

export const UINest = createPlaunaComponent('UINest', {
    position: { x: 0, y: 0 },
    radius: 16,
    capacity: 1000,
    antCount: 0,
});

export const UIFoodSource = createPlaunaComponent('UIFoodSource', {
    position: { x: 0, y: 0 },
    radius: 25,
    amount: 100,
    depletionRate: 0.1,
});

// =============================================================================
// GPU RENDERING COMPONENTS
// =============================================================================

export const UIGPUResource = createPlaunaComponent('UIGPUResource', {
    type: "", // buffer, texture, pipeline, bindGroup
    usage: "", // vertex, storage, uniform, etc.
    size: 0,
    format: "",
});

export const UIAtlas = createPlaunaComponent('UIAtlas', {
    type: "", // font, icon, texture
    width: 0,
    height: 0,
    channels: 4,
    items: [], // Array of atlas items
});

export const UIGlyph = createPlaunaComponent('UIGlyph', {
    char: "",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    advance: 0,
    bearing: { x: 0, y: 0 },
});

// =============================================================================
// WORKBENCH LAYOUT COMPONENTS
// =============================================================================

export const UIDockLayout = createPlaunaComponent('UIDockLayout', {
    zones: {
        left: { width: 0, visible: true },
        center: { width: 1, visible: true },
        right: { width: 0, visible: true },
        bottom: { height: 0, visible: true },
        overlay: { visible: true }
    },
    splitters: {
        left: 0.2,
        right: 0.8,
        bottom: 0.8
    }
});

export const UIFloatingWindow = createPlaunaComponent('UIFloatingWindow', {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    title: "",
    resizable: true,
    minimizable: true,
    alwaysOnTop: false,
});
