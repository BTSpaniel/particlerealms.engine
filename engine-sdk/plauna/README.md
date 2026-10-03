# Plauna - Advanced UI System for Particle Engine

Plauna is a browser-first UI runtime and workbench system that extends Particle Engine with advanced UI capabilities including hybrid DOM/GPU rendering, text measurement, and surface management.

## Features

- **Hybrid Rendering**: DOM, DOM+GPU, and pure GPU rendering modes
- **Text Engine**: DOM-free text measurement and layout using Pretext-style approach
- **Surface Graph**: GPU-accelerated surfaces with clipping, warping, and composition
- **Workbench Layout**: Dockable panels, tabs, splitters, and floating windows
- **ECS Integration**: Dedicated UI world with component-driven state
- **Zero Dependencies**: Pure ES modules, no build step required

## Architecture

Plauna integrates with Particle Engine using the same patterns as the existing editor:

- **Bootstrap Integration**: Available through `EngineEditorBootstrap.js` as `PE.Plauna`
- **VGPU Bridge**: Uses existing VGPU abstraction for GPU work
- **ECS Components**: Extends existing component system for UI state
- **Editor Enhancement**: Optionally enhances existing panels without breaking changes

## Quick Start

### Basic Usage

```javascript
import { initializePlauna } from './engine/EngineEditorBootstrap.js';

// Initialize Plauna
const plauna = await initializePlauna({
    root: document.getElementById('plauna-root'),
    getVGPU: () => viewport.vgpu,
    engine: window.ParticleEngine,
    editor: editorApp,
    useCSS: true,
    textEngine: 'pretext'
});

// Enhance existing panels
await plauna.enhanceExistingPanels(editorApp.panels);
```

### Text Measurement

```javascript
// Prepare text for measurement
const handle = plauna.textService.prepare('Hello, world!', {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400
});

// Layout text with wrapping
const layout = plauna.textService.layout(handle, 300, 24);
console.log(`Lines: ${layout.lineCount}, Height: ${layout.height}px`);
```

### Surface Management

```javascript
// Create GPU surface
const surface = plauna.createSurface({
    id: 'viewport-surface',
    kind: 'viewport',
    shape: 'rect',
    interactive: true
});
```

## Integration with Editor

Plauna automatically integrates with the existing Particle Engine editor:

1. **Optional Loading**: Plauna loads only when enabled in project settings
2. **Panel Enhancement**: Existing panels get enhanced capabilities without replacement
3. **Shared Resources**: Uses same VGPU instance and ECS patterns
4. **Gradual Migration**: Can enable features individually

## File Structure

```
/plauna
  /core
    index.js          # Main Plauna exports
    app.js            # PlaunaApp class
    registry.js       # View/surface registry
    events.js         # Event system
  /ecs
    components.js     # UI ECS components
  /text
    pretext-service.js # Text measurement service
  /surface
    surface-manager.js # GPU surface management
  /particle
    bridge.js         # VGPU integration bridge
  /styles
    plauna.css        # Plauna styles (extends editor theme)
  index.js           # Plauna entry point
  README.md          # This file
```

## API Reference

### PlaunaApp

Main application class that manages the entire Plauna system.

```javascript
const app = await createPlaunaApp(options);
```

**Options:**
- `root`: DOM element for Plauna root
- `getVGPU`: Function that returns VGPU instance
- `engine`: Particle Engine instance
- `editor`: EditorApp instance (optional)
- `useCSS`: Load Plauna CSS (default: true)
- `textEngine`: Text engine to use (default: 'pretext')

**Methods:**
- `registerView(id, config)`: Register a view type
- `registerSurface(id, config)`: Register a surface type
- `createSurface(config)`: Create a surface instance
- `measureText(text, style)`: Measure text without DOM
- `enhanceExistingPanels(panels)`: Enhance existing editor panels

### Text Service

DOM-free text measurement and layout system.

```javascript
const service = plauna.textService;
```

**Methods:**
- `prepare(text, style)`: Prepare text for measurement
- `layout(handle, width, lineHeight)`: Layout text with line breaking
- `measureElement(element)`: Measure existing DOM element
- `invalidateFont(styleKey)`: Clear font cache

### Surface Manager

GPU surface rendering and management.

```javascript
const manager = plauna.surfaceManager;
```

**Methods:**
- `create(config)`: Create a surface
- `updateSurface(id, updates)`: Update surface properties
- `destroySurface(id)`: Destroy a surface
- `hitTest(id, x, y)`: Test if point hits surface

## ECS Components

Plauna defines UI components that integrate with the existing ECS system:

- `UIRoot`: Root application state
- `UIWorkspace`: Workspace configuration
- `UIZone`: Layout zones (left, center, right, bottom)
- `UIView`: View instances
- `UILayout`: Layout constraints
- `UISurface`: GPU surface definitions
- `UIText`: Text content and styling

## Rendering Modes

### DOM Mode
- Use for standard UI elements (inspector, forms, menus)
- Full CSS support, accessibility, and text editing
- Best for text-heavy interfaces

### DOM+GPU Mode
- Use for viewports with GPU overlays
- DOM for structure, GPU for advanced rendering
- Ideal for editor panels with visual content

### GPU Mode
- Use for warped panels, particle-reactive UI
- Pure GPU rendering with WGSL shaders
- Best for performance-critical visualizations

## Testing

Run the Plauna integration test:

```
http://localhost:8000/tests/plauna-test.html
```

This tests:
- Bootstrap integration
- Module loading
- ECS integration
- Text measurement
- Surface management

## Development

Plauna follows Particle Engine's development principles:

- **Browser First**: Pure ES modules, no Node.js dependency
- **Zero Dependencies**: No npm packages, no build step required
- **GPU Native**: All GPU work through VGPU abstraction
- **ECS Driven**: UI state in ECS components
- **Incremental**: Gradual enhancement without breaking changes

## License

All rights reserved. Part of Particle Engine.
