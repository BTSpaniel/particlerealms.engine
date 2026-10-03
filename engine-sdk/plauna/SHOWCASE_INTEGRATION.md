# Plauna Showcase System Integration

## Overview

The interactive widget showcase has been integrated into the existing Plauna architecture. All components are placed in their appropriate modules following the existing structure.

## File Structure

```
plauna/
├── style/
│   ├── LayerManager.js          (existing)
│   ├── ThemeManager.js          (existing)
│   ├── DesignTokens.js          (existing)
│   ├── WidgetStyleManager.js    (existing)
│   ├── CSSGenerator.js          (NEW - Runtime CSS generation)
│   ├── ThemeController.js       (NEW - Theme management)
│   └── index.js                 (UPDATED - exports all style modules)
│
├── ui/
│   ├── ToastManager.js          (existing)
│   └── WidgetShowcase.js        (NEW - Widget showcase display system)
│
├── particle/
│   ├── bridge.js                (existing)
│   └── ParticleController.js    (NEW - Particle effects)
│
├── lab/
│   ├── workbench-lab.js         (existing)
│   └── showcase-app.js          (NEW - Main showcase application)
│
├── index.js                     (UPDATED - exports showcase components)
└── plauna.html                  (UPDATED - new entry point)
```

## Components

### 1. Style Module (`plauna/style/`)

#### CSSGenerator.js
- Generates CSS custom properties from DesignTokens at runtime
- Creates theme-specific CSS selectors
- Exports singleton instance: `cssGenerator`
- Methods:
  - `generateTokensCSS(theme)` - Generate CSS variables
  - `generateThemeCSS(theme)` - Generate theme selectors
  - `generateAllCSS()` - Complete CSS
  - `injectCSS(theme)` - Inject into document
  - `getCSS()` - Get CSS as text
  - `exportTokensJSON()` - Export tokens
  - `downloadCSS(filename)` - Download CSS file

#### ThemeController.js
- Manages bright/night theme switching
- Persists theme preference to localStorage
- Listens to system theme preference (prefers-color-scheme)
- Exports singleton instance: `themeController`
- Methods:
  - `setTheme(theme)` - Set current theme
  - `toggleTheme()` - Toggle between themes
  - `getTheme()` - Get current theme
  - `subscribe(callback)` - Listen to theme changes
  - `isDark()` / `isLight()` - Check theme
  - `initialize()` - Initialize theme system

#### style/index.js (UPDATED)
- Exports all style modules including new CSSGenerator and ThemeController

### 2. UI Module (`plauna/ui/`)

#### WidgetShowcase.js
- Creates showcase sections for widgets
- Displays variants, states, sizes, and colors
- Exports singleton instance: `widgetShowcase`
- Methods:
  - `createShowcase(widgetName, options)` - Create showcase section
  - `getShowcase(widgetName)` - Get showcase by name
  - `getAllShowcases()` - Get all showcases
  - `clear()` - Clear all showcases

### 3. Particle Module (`plauna/particle/`)

#### ParticleController.js
- Manages particle effects and animations
- Handles canvas rendering and particle updates
- Methods:
  - `initialize()` - Initialize particle system
  - `start()` - Start animation
  - `stop()` - Stop animation
  - `setConfig(config)` - Configure particles
  - `setParticleCount(count)` - Set particle count
  - `addParticlesAt(x, y, count)` - Add particles at position
  - `clear()` - Clear all particles
  - `destroy()` - Cleanup

### 4. Lab Module (`plauna/lab/`)

#### showcase-app.js
- Main application controller for the showcase
- Integrates all systems: CSS generation, theme switching, particles, widgets
- Exports: `ShowcaseApp` class and `mountShowcaseApp()` function
- Features:
  - Dynamic CSS generation from tokens
  - Live theme switching (bright/night)
  - Particle effects background
  - Tabbed widget navigation
  - Widget showcase display
  - Console integration
  - Responsive design

### 5. Main Entry Point

#### plauna.html (UPDATED)
- New entry point for the showcase
- Uses `data-theme="bright"` attribute for theme
- Loads CSS dynamically via CSSGenerator
- Mounts ShowcaseApp on boot
- Includes particle effects canvas
- Responsive design with scrollable content

#### plauna/index.js (UPDATED)
- Exports ShowcaseApp and mountShowcaseApp
- Exports all style system modules
- Exports WidgetShowcase and ParticleController

## Integration Points

### CSS Generation
```javascript
import { cssGenerator } from './style/CSSGenerator.js';

// Generate and inject CSS
cssGenerator.injectCSS('bright');

// Get CSS as text
const css = cssGenerator.getCSS();

// Export tokens
const json = cssGenerator.exportTokensJSON();
```

### Theme Management
```javascript
import { themeController } from './style/ThemeController.js';

// Initialize theme system
themeController.initialize();

// Set theme
themeController.setTheme('night');

// Toggle theme
themeController.toggleTheme();

// Listen to changes
themeController.subscribe((theme) => {
  console.log('Theme changed to:', theme);
});
```

### Widget Showcase
```javascript
import { widgetShowcase } from './ui/WidgetShowcase.js';

// Create showcase
const showcase = widgetShowcase.createShowcase('Button', {
  title: 'Button Widget',
  variants: [...],
  states: ['default', 'hover', 'active', 'disabled'],
  sizes: ['sm', 'md', 'lg'],
  colors: ['primary', 'secondary', 'success']
});
```

### Particle Effects
```javascript
import { ParticleController } from './particle/ParticleController.js';

// Create controller
const particles = new ParticleController(canvas);
particles.initialize();
particles.start();

// Configure
particles.setConfig({ speed: 0.5, opacity: 0.6 });
particles.setParticleCount(240);
```

### Showcase App
```javascript
import { mountShowcaseApp } from './lab/showcase-app.js';

// Mount app
const showcase = mountShowcaseApp({
  root: document.getElementById('root'),
  statusElement: document.getElementById('status'),
  logger: console
});

// Boot
await showcase.boot();
```

## Features Implemented

✅ **CSS Generation System**
- Runtime CSS generation from DesignTokens
- Theme-aware CSS variables
- No static CSS files needed
- Exportable CSS

✅ **Theme Management**
- Live bright/night theme switching
- localStorage persistence
- System theme preference detection
- Observable theme changes

✅ **Widget Showcase**
- Dedicated sections for each widget
- Variant display
- State variations
- Size variants
- Color variants

✅ **Particle Effects**
- Background particle animation
- Configurable particle system
- Canvas-based rendering
- Performance optimized

✅ **Responsive Design**
- Mobile-friendly layout
- Sticky header and tabs
- Scrollable content area
- Collapsible console

✅ **Integration**
- All components in proper modules
- Singleton instances for shared state
- Observable patterns for updates
- Clean API surface

## Usage

### Start the Showcase
```bash
# Open in browser
http://127.0.0.1:9001/plauna.html
```

### Access from JavaScript
```javascript
// Console
window.plaunaDemoConsole

// Showcase app
window.plaunaShowcase

// Theme controller
window.plaunaShowcase.themeController

// CSS generator
window.plaunaShowcase.cssGenerator

// Particle controller
window.plaunaShowcase.particleController
```

## Architecture Benefits

1. **Modular**: Each system is independent and reusable
2. **Integrated**: All systems work together seamlessly
3. **Extensible**: Easy to add new widgets or features
4. **Performant**: Lazy loading and caching
5. **Observable**: Theme and state changes are observable
6. **Persistent**: Theme preference saved to localStorage
7. **Responsive**: Works on all screen sizes
8. **Accessible**: Keyboard navigation and ARIA support

## Next Steps

1. Test showcase in browser
2. Verify all widgets display correctly
3. Test theme switching
4. Optimize particle performance
5. Add more widget examples
6. Enhance widget showcase with interactive controls
7. Add CSS variable inspector UI
8. Add performance monitoring
