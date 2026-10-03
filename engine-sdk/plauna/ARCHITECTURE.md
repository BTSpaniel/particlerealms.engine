# Plauna Architecture Documentation

This document provides a comprehensive overview of the Plauna UI system architecture, patterns, and relationships. It's intended to help AI agents and developers understand how the codebase is structured.

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Rendering Pipeline](#rendering-pipeline)
4. [Widget System](#widget-system)
5. [Theme System](#theme-system)
6. [Workspace System](#workspace-system)
7. [Notification System](#notification-system)
8. [Development Tools](#development-tools)
9. [File Structure](#file-structure)
10. [Key Patterns](#key-patterns)

---

## Overview

Plauna is a retained-mode UI system built for the Particle Engine. It provides a widget library, theme system, virtual desktops, and GPU panel support.

### Key Design Principles

- **Retained Mode**: UI tree persists in memory and is incrementally updated (unlike virtual DOM)
- **Dirty Flags**: Bits track what parts of the tree need re-rendering
- **Modular**: Widgets, themes, and workspaces are independent modules
- **GPU-Ready**: Supports WebGPU panels for hardware-accelerated rendering
- **Developer-Friendly**: Built-in inspector, hot reload, and context menu

### Technology Stack

- **Core**: Vanilla JavaScript (ES modules)
- **Rendering**: DOM + WebGPU (via WorkspaceCompositor)
- **Styling**: CSS variables (custom properties)
- **Themes**: File-based JSON manifests
- **Animation**: TransitionEngine with CSS transitions
- **Text**: Pretext internationalization service

---

## Core Architecture

### PlaunaApp

The main application class that integrates Plauna with the Particle Engine.

**Location**: `plauna/core/app.js`

**Responsibilities**:
- Manages VisualTree (retained-mode UI tree)
- Manages DOMRenderer (renders tree to DOM)
- Manages PlaunaEventSystem (event handling)
- Manages ThemeManager (theme application)
- Manages development tools (inspector, hot reload, etc.)

**Usage**:
```javascript
const app = await createPlaunaApp({
    root: document.body,
    getVGPU: () => vgpuInstance,
    engine: particleEngine
});
await app.mount();
```

### VisualTree

Retained-mode UI tree that holds UINode instances.

**Location**: `plauna/core/VisualTree.js`

**Responsibilities**:
- Maintains root UINode reference
- Provides traversal methods (pre-order, post-order, etc.)
- Processes dirty flags for incremental updates
- Manages node lifecycle

**Key Methods**:
- `getRoot()`: Get root UINode
- `setRoot(node)`: Set root UINode
- `traverse(callback, node)`: Traverse tree recursively
- `processStyleDirty(nodes)`: Process style dirty flags

### UINode

Base class for all UI nodes in the retained visual tree.

**Location**: `plauna/core/UINode.js`

**Responsibilities**:
- Tree structure (parent, children, siblings)
- Dirty flag tracking
- Layout box (position, size, margins, padding)
- Event handlers
- Accessibility (ARIA attributes)

**Dirty Flags** (bitmask):
- `STYLE`: CSS styles changed
- `LAYOUT`: Position/size changed
- `PAINT`: Visual appearance changed
- `TEXT`: Text content changed
- `ACCESSIBILITY`: ARIA attributes changed
- `CHILDREN`: Child nodes added/removed
- `FOCUS`: Focus state changed

**Node State** (bitmask):
- `VISIBLE`: Node is visible
- `FOCUSED`: Node has keyboard focus
- `HOVERED`: Mouse is over the node
- `ACTIVE`: Node is being pressed
- `DISABLED`: Node is disabled
- `FOCUSABLE`: Node can receive focus

---

## Rendering Pipeline

### Two-Stage Rendering

Plauna uses two different renderers for different purposes:

#### WidgetRenderer

Converts single UINode widgets to DOM elements. Used by widgets themselves.

**Location**: `plauna/widgets/WidgetRenderer.js`

**Flow**:
1. Widget creates UINode tree in constructor
2. Widget calls `widgetRenderer.render(node)` to get DOM element
3. DOM element is returned and inserted into document

**Mapping Tables**:
- `nodeToDOM`: UINode → HTMLElement
- `domToNode`: HTMLElement → UINode (reverse lookup)

**Special Handling**:
- SVG elements use `createElementNS`
- Raw HTMLElements are returned directly
- Sets `element._plaunaNode` for reverse lookup

#### DOMRenderer

Renders entire visual tree from game/engine to DOM. Used by PlaunaApp.

**Location**: `plauna/core/DOMRenderer.js`

**Flow**:
1. PlaunaApp creates VisualTree with root UINode
2. DOMRenderer.render(visualTree) renders entire tree
3. Incremental updates via dirty flags

**Dirty Flag Processing**:
- `DIRTY.STYLE`: Re-apply inline styles
- `DIRTY.LAYOUT`: Re-compute position/size
- `DIRTY.PAINT`: Re-render entire node
- `DIRTY.TEXT`: Update text content
- `DIRTY.CHILDREN`: Re-render child subtree

### Rendering Flow Diagram

```
UINode Tree (VisualTree)
    ↓
WidgetRenderer (for individual widgets) or DOMRenderer (for full tree)
    ↓
DOM Elements
    ↓
Browser Display
```

---

## Widget System

### Widget Registry

Central registry for all Plauna widgets.

**Location**: `plauna/widgets/index.js`

**Exports**:
- `widgets`: Flat array of all widget classes
- `widgetRegistry`: Map of widget.id → widget class
- `categories`: Map of category name → array of widgets
- Helper functions: `getWidget()`, `getWidgetsByCategory()`, `searchWidgets()`

**Widget Categories**:
- **Primitive**: Button, Badge, Avatar, Chip, etc.
- **Input**: Search, Color, Date, File, etc.
- **Form**: Checkbox, Radio, Switch, Select, etc.
- **Layout**: Card, Grid, Panel, Divider, etc.
- **Navigation**: Menu, Tabs, Sidebar, etc.
- **DataViews**: List, Table, Tree, etc.
- **Feedback**: Alert, Toast, Spinner, etc.

### Widget Pattern

Each widget class must have:

**Static Properties**:
- `id`: Unique string identifier (e.g., 'button')
- `name`: Display name (e.g., 'Button')
- `category`: Category name (e.g., 'primitive')
- `icon`: Emoji or icon for UI display
- `description`: Short description
- `tags`: Array of searchable tags
- `dependencies`: Array of required widget IDs

**Static Methods**:
- `getDefaultOptions()`: Returns default configuration
- `stories()`: Returns named story configurations for showcase

**Instance Methods**:
- `constructor(id, options)`: Initializes widget
- `build()`: Creates UINode tree structure
- `update()`: Updates widget state

**IMPORTANT**: Do NOT use `widget.create()` - it has `require()` that breaks in ESM. Instead, instantiate directly:
```javascript
const button = new Button('my-button', { variant: 'primary' });
```

### WidgetGallery

Storybook-style gallery for widget development and documentation.

**Location**: `plauna/ui/WidgetGallery.js`

**Features**:
- Renders real widget instances from `stories()` definitions
- Category navigation tabs
- Theme selector dropdown
- Interactive state badges (on/off/animating/sending toast)
- Toast notifications on widget interactions

**Special Handling**:
- Tooltips appended to `document.body` for correct positioning
- Toasts called immediately for visible demos
- Click/change/input events emit toast notifications

---

## Modern Primitive Design Patterns

Plauna's primitive widgets (Button, Avatar, Chip, Badge, etc.) follow modern UI design patterns inspired by Material Design 3, Apple Human Interface Guidelines, and contemporary web design systems.

### Surface Patterns

Modern surfaces use subtle elevation and depth rather than flat colors:

- **Soft shadows**: `var(--shadow-sm)` for base elevation, `var(--shadow-md)` for hover
- **Backdrop filters**: `saturate(1.05) blur(8px)` for glassy layered effects
- **Subtle borders**: Low-opacity borders (e.g., `rgba(148, 163, 184, 0.18)`) for definition
- **Larger border-radius**: `var(--border-radius-lg)` for buttons, `var(--border-radius-full)` for pills/chips
- **Preserved base shadow**: Base shadow is maintained across hover/focus states for consistent depth

### Accessibility Patterns

All primitives follow WCAG 2.1 guidelines for keyboard navigation and screen reader support:

- **Focus rings**: Dual-layer shadows with outer ring (3px primary color) and inner shadow for visibility
- **Outline offset**: 2px spacing between focus ring and element for clear separation
- **Keyboard focusable**: `NODE_STATE.FOCUSABLE` set when not disabled
- **ARIA labels**: Generated with fallback chains (name → alt → initials) for avatars
- **Role assignment**: Semantic roles (button, status, presentation) based on widget type
- **ariaLive**: "polite" for status badges to announce changes

### Touch Target Patterns

Touch targets meet or exceed WCAG 2.1 minimum 44x44px recommendation:

- **Button sizes**: sm (36px), md (44px), lg (52px) minimum widths
- **Chip height**: 32px minimum height for better touch targets
- **Padding**: Generous padding (5px 12px for md chips) for comfortable tapping
- **Spacing**: Gap between elements using `var(--spacing-xs)` for visual separation

### Variant Patterns

Semantic color variants use alpha transparency for theme compatibility:

- **Alpha-transparent backgrounds**: RGBA values (e.g., `rgba(14, 165, 233, 0.12)`) work across light/dark themes
- **Stronger borders**: Higher opacity borders (e.g., `rgba(14, 165, 233, 0.24)`) for definition
- **Semantic colors**: Primary (actions), Success (confirmation), Warning (caution), Error (destructive)
- **Disabled state**: Reduced opacity (0.6), neutral background, removed shadow

### State Management

Interaction states use NODE_STATE bitmasks for efficient updates:

- **HOVERED**: Scale transform (1.05x) and elevated shadow for tactile feedback
- **FOCUSED**: Dual-layer focus ring with primary color
- **ACTIVE**: Press state with subtle scale or shadow change
- **DISABLED**: Reduced opacity, not-allowed cursor, flat appearance
- **Dirty flags**: DIRTY.PAINT, DIRTY.STYLE, DIRTY.ACCESSIBILITY trigger re-renders

### Interaction Patterns

Modern interactions provide clear feedback and smooth transitions:

- **Scale transforms**: 1.05x scale on hover/focus for tactile feedback
- **Shadow elevation**: Base shadow → elevated shadow on hover → focus ring on focus
- **Smooth transitions**: 150-160ms ease transitions on transform, shadow, background, border
- **Border preservation**: Borders maintained across states (not cleared on blur)
- **State restoration**: All states restored to base values on mouseleave/blur

### Progressive Enhancement

Widgets gracefully degrade when resources fail:

- **Image loading**: Async loading with error handling and fallbacks (initials → icon → placeholder)
- **Text fallback**: Alt text, initials, or placeholder when images fail
- **Content structure**: Flexible DOM structure supports optional elements (avatars, icons, remove buttons)

## Theme System

### ThemeLoader

File-based theme discovery and loading system.

**Location**: `plauna/themes/ThemeLoader.js`

**Theme Structure**:
```
plauna/themes/
├── _base/theme.json          # Base theme with all defaults
├── dark/theme.json           # Dark theme (extends _base)
├── light/theme.json          # Light theme (extends _base)
├── high-contrast/theme.json  # High contrast (extends dark)
├── custom/theme.json         # User template (extends dark)
└── index.json                # Registry of discoverable themes
```

**Theme Manifest** (theme.json):
```json
{
  "name": "Theme Name",
  "description": "Theme description",
  "extends": "parent-theme-id",
  "variables": {
    "color-primary": "#3b82f6",
    "spacing-md": "16px",
    "null-values-inherit-from-parent": null
  }
}
```

**Resolution Cascade** (highest priority wins):
1. _base theme defaults
2. Parent theme variables (if `extends` is set)
3. Current theme variables
4. Runtime overrides (`applyOverrides()`)

**CSS Variable Application**:
- Variables written to `<style data-plauna-theme="1">` on `:root`
- Format: `--variable-name: value;`
- Overrides use separate `<style data-plauna-overrides="1">` tag

### ThemeManager

Legacy theme manager (being replaced by ThemeLoader).

**Location**: `plauna/style/ThemeManager.js`

Still used in some parts of the codebase. Will be phased out.

### DesignTokens

Central design system token management.

**Location**: `plauna/style/DesignTokens.js`

**Token Categories**:
- `spacing`: Size tokens (xs, sm, md, lg, xl, 2xl, etc.)
- `typography`: Font families, sizes, weights, line heights
- `colors`: Color palettes (primary, secondary, success, warning, error)
- `motion`: Animation durations, easings
- `borderRadius`: Border radius values
- `shadows`: Shadow definitions
- `zIndex`: Z-index layer values

**Access Pattern**:
```javascript
tokens.get('spacing.md')      // Returns spacing medium value
tokens.get('colors.primary')  // Returns primary color
tokens.get('typography.fontSizes.sm')  // Returns small font size
```

**Observer Pattern**:
- Observers subscribe to token changes
- Used by WidgetStyleManager to regenerate styles on theme changes

---

## Workspace System

### WorkspaceManager

Virtual desktop management for multi-panel layouts.

**Location**: `plauna/workspace/WorkspaceManager.js`

**Workspace Concept**:
- A Workspace is a virtual desktop that holds panels
- Each workspace has its own layout mode
- Workspaces are DOM layers stacked over the canvas
- Only one workspace is active/visible at a time

**Panel Types**:
- **DOMPanel**: Wrapper for Plauna widgets (div-based)
- **GPUPanel**: WebGPU texture panel (for GPU-accelerated content)

**Layout Modes**:
- **fullscreen**: One panel fills the entire workspace
- **float**: Draggable, resizable windows with z-order
- **split**: Recursive binary tree layout (like tmux/VS Code)
- **tile**: Auto-arranged grid layout

**Single Constraint**:
- Only one WebGPU canvas context allowed per page
- Only one GPUDevice instance shared across all workspaces
- GPU panels share the same device and canvas

**Public API**:
- `createWorkspace({ name, layout })`: Create new workspace
- `switchTo(id)`: Switch active workspace
- `createPanel(type, options)`: Create panel in active workspace
- `list()`: List all workspaces
- `activeWorkspace`: Get currently active workspace

**Keyboard Shortcuts**:
- `Ctrl+``: Open workspace switcher
- Arrow keys: Navigate switcher
- Enter: Switch to selected workspace
- Escape: Close switcher

### WorkspaceCompositor

GPU blit pipeline for GPU panels.

**Location**: `plauna/workspace/WorkspaceCompositor.js`

**Responsibilities**:
- Blits GPU panel textures to canvas swap chain
- Iterates visible GPU panels in z-order
- Required for GPU panel support

### WorkspaceSwitcher

HUD overlay for workspace switching.

**Location**: `plauna/workspace/WorkspaceSwitcher.js`

**Features**:
- Shows thumbnails of all workspaces
- Keyboard navigation with arrow keys
- Enter to switch workspace

---

## Notification System

### NotificationSystem

Centralized notification management.

**Location**: `plauna/notifications/NotificationSystem.js`

**Notification Channels**:
1. **Toasts**: UI notifications via ToastManager
2. **Console**: Browser console.log/error/warn
3. **Sounds**: Optional audio feedback (Web Audio API)

**Notification Levels** (priority order):
- `debug` (0): Development debugging
- `info` (1): General information
- `success` (2): Success confirmations
- `warning` (3): Warning messages
- `error` (4): Error messages
- `critical` (5): Critical errors

**Notification Types**:
- `system`: System-level notifications
- `action`: User action feedback
- `validation`: Form validation errors
- `performance`: Performance metrics
- `security`: Security-related alerts
- `network`: Network request status

**Convenience Methods**:
- `debug(message, type, data)`
- `info(message, type, data)`
- `success(message, type, data)`
- `warning(message, type, data)`
- `error(message, type, data)`
- `critical(message, type, data)`

### ToastManager

Unified toast notification system.

**Location**: `plauna/ui/ToastManager.js`

**Toast Positions**:
- `top-right` (default)
- `top-left`
- `top-center`
- `bottom-right`
- `bottom-left`
- `bottom-center`

**Toast Types**:
- `success`: Green checkmark, 3s duration
- `error`: Red X, 5s duration
- `warning`: Yellow warning, 4s duration
- `info`: Blue info, 3s duration
- `loading`: Gray spinner, indefinite

**Toast Lifecycle**:
1. `show(options)`: Creates toast element
2. Animate in: Slide-in animation
3. Display: Shows for duration (or indefinite)
4. Animate out: Slide-out animation
5. Remove: Element removed from DOM

**Global Singleton**:
```javascript
Toast.initialize();
Toast.show('Hello world', 'info');
```

---

## Development Tools

### PlaunaSmartContextMenu

Context-aware right-click menu for UI inspection.

**Location**: `plauna/ui/SmartContextMenu.js`

**Scanning Algorithm**:
1. On right-click, scans visual tree around cursor
2. Uses adaptive radius based on node density
3. Scores each node based on type, role, text content, distance
4. Returns top N nodes within scan radius

**Node Scoring**:
- Inside node: +1000 + inset depth
- Has role: +22
- Has text content: +10
- Has className: +8
- Button type: +25
- Input type: +18
- Menu type: +15
- Small area: +6

**Adaptive Radius**:
- Base radius: 140px (configurable)
- Density >= 8: 48% of base (72px min)
- Density >= 6: 55% of base (80px min)
- Density >= 4: 65% of base (90px min)
- Density >= 2: 80% of base (112px min)
- Density < 2: 100% of base (140px)

**DOM Fallback**:
- If visualTree is unavailable (e.g., in showcase shell), falls back to DOM scanning
- Uses `element._plaunaNode` back-reference set by WidgetRenderer

### TreeInspector

Visual tree inspector for debugging.

**Location**: `plauna/editor/TreeInspector.js`

**Features**:
- Displays UINode tree structure
- Shows node properties and state
- Highlights selected nodes
- Allows node manipulation

### StyleInspector

Style inspector for debugging.

**Location**: `plauna/editor/StyleInspector.js`

**Features**:
- Displays computed styles for selected node
- Shows CSS variable values
- Allows style manipulation

### HotReload

Hot module replacement for development.

**Location**: `plauna/editor/HotReload.js`

**Features**:
- Watches for module changes
- Reloads modules without full page refresh
- Preserves app state where possible

---

## File Structure

```
plauna/
├── boot.js                      # Engine bootstrap (PlaunaDevShell)
├── index.js                     # Package exports
├── core/
│   ├── app.js                   # PlaunaApp (main application)
│   ├── UINode.js                # Base UI node class
│   ├── VisualTree.js            # Retained-mode UI tree
│   ├── DOMRenderer.js           # Visual tree to DOM renderer
│   ├── events.js                # Event system
│   └── registry.js              # Component registry
├── widgets/
│   ├── index.js                 # Widget registry
│   ├── WidgetRenderer.js        # UINode to DOM converter
│   ├── Primitive/               # Primitive widgets
│   │   ├── Button.js
│   │   ├── Badge.js
│   │   ├── Avatar.js
│   │   ├── Chip.js
│   │   ├── Progress.js
│   │   ├── Tooltip.js
│   │   └── ...
│   ├── Input/                   # Input widgets
│   ├── Form/                    # Form widgets
│   ├── Layout/                  # Layout widgets
│   ├── Navigation/              # Navigation widgets
│   ├── DataViews/               # Data view widgets
│   └── Feedback/                # Feedback widgets
│       ├── Toast.js
│       ├── Alert.js
│       └── ...
├── style/
│   ├── ThemeManager.js          # Legacy theme manager
│   ├── DesignTokens.js          # Design token system
│   └── WidgetStyleManager.js    # Widget style generation
├── themes/
│   ├── ThemeLoader.js           # Theme discovery/loading
│   ├── _base/theme.json         # Base theme defaults
│   ├── dark/theme.json          # Dark theme
│   ├── light/theme.json         # Light theme
│   ├── high-contrast/theme.json # High contrast theme
│   ├── custom/theme.json        # User template
│   └── index.json               # Theme registry
├── workspace/
│   ├── WorkspaceManager.js      # Virtual desktop manager
│   ├── Workspace.js             # Single workspace
│   ├── Panel.js                 # Panel types (DOM/GPU)
│   ├── PanelLayout.js           # Layout engine
│   ├── WorkspaceCompositor.js   # GPU blit pipeline
│   └── WorkspaceSwitcher.js     # Workspace switcher HUD
├── notifications/
│   └── NotificationSystem.js    # Centralized notifications
├── ui/
│   ├── ToastManager.js          # Toast notification system
│   ├── WidgetGallery.js         # Storybook-style gallery
│   └── SmartContextMenu.js      # Context-aware menu
├── lab/
│   ├── showcase-app.js          # Showcase application
│   └── workbench-lab.js         # Development workbench
└── console/
    └── PlaunaConsole.js         # Console utilities
```

---

## Key Patterns

### 1. Retained Mode with Dirty Flags

Instead of virtual DOM diffing, Plauna uses retained mode with dirty flags:

```javascript
// Mark node as dirty when state changes
this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);

// Renderer processes dirty flags incrementally
if (node.dirty & DIRTY.STYLE) {
    this.updateNodeStyle(node);
}
```

### 2. Widget Instantiation Pattern

Avoid `widget.create()` (broken in ESM), use direct instantiation:

```javascript
// ❌ Wrong (has require() that breaks in ESM)
const button = Button.create('my-button', options);

// ✅ Correct (direct instantiation)
const button = new Button('my-button', options);
```

### 3. Story Pattern for Widgets

Define named story configurations for the gallery:

```javascript
static stories() {
    return {
        'Primary Button': { variant: 'primary', size: 'md' },
        'Disabled': { disabled: true },
        'Loading': { loading: true }
    };
}
```

### 4. Theme Extension Pattern

Themes extend parent themes and only override what's needed:

```json
{
  "extends": "dark",
  "variables": {
    "color-primary": "#3b82f6",
    "null-values-inherit": null
  }
}
```

### 5. Observer Pattern for Tokens

DesignTokens use observer pattern for change notifications:

```javascript
tokens.addObserver((path, value, oldValue) => {
    console.log(`${path} changed from ${oldValue} to ${value}`);
});
```

### 6. Back-Reference Pattern

DOM elements store reference to their UINode:

```javascript
element._plaunaNode = node;  // Set by WidgetRenderer
```

Used by SmartContextMenu for DOM fallback scanning.

---

## Common Gotchas

1. **Don't use widget.create()**: It has `require()` that breaks in ESM. Use `new WidgetClass()` instead.

2. **Toast positioning in showcase**: Tooltips must be appended to `document.body` for correct overlay positioning in the showcase environment.

3. **Direct DOM manipulation for immediate updates**: In the showcase renderer, `UINode.setStyle` might not trigger immediate DOM updates for all properties. Use direct DOM manipulation for `opacity`, `transform`, and `pointerEvents`.

4. **ThemeLoader BASE_URL**: Must be `'./'` not `'./themes/'` because ThemeLoader lives inside themes/ directory.

5. **GPU panel constraint**: Only one WebGPU canvas context allowed per page. All GPU panels share the same device and canvas.

6. **Dirty flag propagation**: When a node's children change, the parent must be marked as `DIRTY.CHILDREN`.

7. **Widget stories**: Use correct property names (e.g., `content` not `label` for Badge, `name` not `initials` for Avatar).

---

## Summary

Plauna is a retained-mode UI system with:
- **VisualTree** for retained-mode UI tree management
- **UINode** as base class for all UI elements
- **WidgetRenderer** and **DOMRenderer** for rendering
- **WidgetRegistry** for widget discovery and instantiation
- **ThemeLoader** for file-based theme management
- **WorkspaceManager** for virtual desktops
- **NotificationSystem** and **ToastManager** for user feedback
- **SmartContextMenu** for context-aware inspection
- **Development tools** (inspector, hot reload) for debugging

The architecture is modular, GPU-ready, and designed for both production use and development workflows.
