# Plauna Modular CSS System - Implementation Guide

## Overview

This guide explains the new modular CSS architecture for Plauna, which includes:
- **LayerManager**: Semantic z-index management system
- **Design Tokens**: CSS custom properties mapped to DesignTokens
- **Modular CSS Files**: Co-located styles for each widget
- **Theme Support**: "Bright" and "Night" themes via `data-theme` attribute

## Architecture

### 1. LayerManager (`style/LayerManager.js`)

Provides semantic z-index constants organized by stacking context:

```javascript
import { 
  zModalPanel, 
  zModalBackdrop, 
  zDropdown, 
  zTooltip,
  getStackingContextCSS 
} from '../style/LayerManager.js';

// Use in WidgetStyleManager
const styles = {
  ...getStackingContextCSS('z-modal-panel'),
  // Creates: { isolation: 'isolate', zIndex: 101 }
};
```

**Z-Index Hierarchy:**
- `z-layout-backdrop`: 0
- `z-layout-surface`: 1
- `z-layout-widget-gallery`: 2
- `z-modal-backdrop`: 100
- `z-modal-panel`: 101
- `z-dropdown`: 101
- `z-tooltip`: 102
- `z-notification-toast`: 103
- `z-notification-alert`: 104

### 2. Design Tokens (`styles/tokens.css`)

Maps DesignTokens to CSS custom properties with theme support:

```css
:root {
  /* Colors */
  --color-primary-500: #0ea5e9;
  
  /* Spacing */
  --spacing-md: 12px;
  
  /* Z-Index Layers */
  --z-modal-panel: 101;
}

/* Bright Theme */
[data-theme="bright"] {
  --bg-primary: #ffffff;
  --text-primary: #0f172a;
}

/* Night Theme */
[data-theme="night"] {
  --bg-primary: #0a0a0f;
  --text-primary: #e4e4e7;
}
```

### 3. Modular CSS Files

Each widget has a co-located CSS file using CSS custom properties:

```css
/* widgets/Primitive/Button.css */
.button {
  padding: var(--spacing-md);
  background: var(--button-bg-primary);
  color: var(--button-text-primary);
  border-radius: var(--border-radius-md);
}

.button--primary {
  background: var(--button-bg-primary);
}

.button--secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
```

### 4. Main Stylesheet (`styles/plauna-modular.css`)

Uses native CSS `@import` to load all modular styles:

```css
@import url('./tokens.css');
@import url('../widgets/Primitive/Button.css');
@import url('../widgets/Form/Input.css');
/* ... etc ... */
```

## Usage

### Switching Themes

Set the `data-theme` attribute on the root element:

```javascript
// Bright theme
document.documentElement.setAttribute('data-theme', 'bright');

// Night theme
document.documentElement.setAttribute('data-theme', 'night');
```

CSS variables automatically update based on the theme:

```css
[data-theme="bright"] {
  --bg-primary: #ffffff;
  --text-primary: #0f172a;
}

[data-theme="night"] {
  --bg-primary: #0a0a0f;
  --text-primary: #e4e4e7;
}
```

### Using LayerManager in WidgetStyleManager

```javascript
import { getStackingContextCSS, zModalPanel } from '../style/LayerManager.js';

generateModalStyles(tokens, variant) {
  return {
    ...getStackingContextCSS('z-modal-panel'),
    // Other styles...
  };
}
```

### Creating New Widget Styles

1. Create a CSS file next to the widget JavaScript:
   ```
   widgets/Primitive/MyWidget.js
   widgets/Primitive/MyWidget.css
   ```

2. Use CSS custom properties:
   ```css
   .my-widget {
     padding: var(--spacing-md);
     background: var(--bg-primary);
     color: var(--text-primary);
     border-radius: var(--border-radius-md);
   }
   ```

3. Add to `plauna-modular.css`:
   ```css
   @import url('../widgets/Primitive/MyWidget.css');
   ```

## Stacking Context Isolation

Use `isolation: isolate` to create stacking contexts without side effects:

```css
.modal {
  isolation: isolate;
  z-index: var(--z-modal-panel);
  position: fixed;
}

.dropdown {
  isolation: isolate;
  z-index: var(--z-dropdown);
  position: fixed;
}
```

This prevents z-index conflicts between components.

## CSS Variables Reference

### Colors
- `--color-primary-500`, `--color-primary-600`, etc.
- `--color-success`, `--color-warning`, `--color-error`, `--color-info`
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-quaternary`
- `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-disabled`
- `--border-light`, `--border-medium`, `--border-dark`, `--border-subtle`

### Spacing
- `--spacing-xs` (4px), `--spacing-sm` (8px), `--spacing-md` (12px)
- `--spacing-lg` (16px), `--spacing-xl` (24px), `--spacing-2xl` (32px), `--spacing-3xl` (48px)

### Typography
- `--font-size-xs` (12px), `--font-size-sm` (14px), `--font-size-md` (16px)
- `--font-size-lg` (18px), `--font-size-xl` (20px), `--font-size-2xl` (24px)
- `--font-weight-normal`, `--font-weight-medium`, `--font-weight-semibold`, `--font-weight-bold`
- `--line-height-tight`, `--line-height-normal`, `--line-height-relaxed`

### Border Radius
- `--border-radius-sm` (4px), `--border-radius-md` (6px), `--border-radius-lg` (8px)
- `--border-radius-xl` (12px), `--border-radius-full` (9999px)

### Shadows
- `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`

### Z-Index Layers
- `--z-layout-backdrop` (0), `--z-layout-surface` (1), `--z-layout-widget-gallery` (2)
- `--z-modal-backdrop` (100), `--z-modal-panel` (101)
- `--z-dropdown-backdrop` (100), `--z-dropdown` (101)
- `--z-tooltip` (102), `--z-notification-toast` (103), `--z-notification-alert` (104)

### Transitions
- `--transition-fast` (150ms ease), `--transition-base` (200ms ease), `--transition-slow` (300ms ease)

## File Structure

```
plauna/
├── style/
│   ├── LayerManager.js          (NEW: Semantic z-index management)
│   ├── ThemeManager.js          (EXISTING: Theme switching)
│   ├── DesignTokens.js          (EXISTING: Design tokens)
│   ├── WidgetStyleManager.js    (UPDATED: Uses LayerManager)
│   └── index.js                 (NEW: Exports all style modules)
├── styles/
│   ├── tokens.css               (NEW: CSS custom properties)
│   ├── plauna.css               (EXISTING: Original styles, kept as backup)
│   └── plauna-modular.css       (NEW: Modular CSS with @imports)
└── widgets/
    ├── Primitive/
    │   ├── Button.js
    │   ├── Button.css            (NEW: Modular styles)
    │   ├── Modal.js
    │   ├── Modal.css             (NEW: Modular styles)
    │   └── ... (40+ CSS files)
    ├── Form/
    │   ├── Input.js
    │   ├── Input.css             (NEW: Modular styles)
    │   └── ... (CSS files)
    ├── Layout/
    │   ├── Container.js
    │   ├── Container.css         (NEW: Modular styles)
    │   └── ... (CSS files)
    └── ... (other categories)
```

## Migration Path

### Phase 1: Coexistence (Current)
- Old `plauna.css` remains unchanged
- New `plauna-modular.css` with @imports is available
- Both can coexist without conflicts

### Phase 2: Gradual Adoption
- Update HTML to use `plauna-modular.css` instead of `plauna.css`
- Test theme switching and z-index layering
- Verify no visual regressions

### Phase 3: Cleanup
- Once fully tested, remove old `plauna.css`
- Archive as `plauna.css.backup` for reference

## Testing Checklist

- [ ] Theme switching works (bright → night → bright)
- [ ] All z-index layers are correct (modals above dropdowns, etc.)
- [ ] CSS variables apply correctly to all widgets
- [ ] Stacking context isolation prevents z-index conflicts
- [ ] Responsive design works on mobile/tablet/desktop
- [ ] No visual regressions compared to old CSS
- [ ] Performance is acceptable (no layout thrashing)

## Best Practices

1. **Always use CSS custom properties** instead of hardcoded values
2. **Use semantic z-index constants** from LayerManager instead of magic numbers
3. **Apply `isolation: isolate`** to components with fixed/absolute positioning
4. **Support both themes** by using `[data-theme]` selectors
5. **Keep CSS co-located** with widget JavaScript files
6. **Use BEM naming** for CSS classes (`.widget`, `.widget__element`, `.widget--variant`)
7. **Responsive design first** - mobile styles, then desktop overrides

## Troubleshooting

### Z-index not working?
- Check if parent has `position: relative` or `isolation: isolate`
- Verify `z-index` value is higher than siblings
- Use LayerManager constants for consistency

### Theme not switching?
- Ensure `data-theme` attribute is set on `<html>` or `<body>`
- Check browser DevTools to see if CSS variables are updating
- Verify `[data-theme]` selectors in CSS

### CSS variables not applying?
- Check if variable name is correct (case-sensitive)
- Verify variable is defined in `:root` or `[data-theme]` selector
- Use browser DevTools to inspect computed styles

## References

- [Smashing Magazine: Managing Z-Index](https://www.smashingmagazine.com/2021/02/css-z-index-stacking-contexts-explained/)
- [Josh W. Comeau: What The Heck, z-index??](https://www.joshwcomeau.com/css/stacking-contexts/)
- [MDN: CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
- [MDN: Stacking Context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Positioned_Layout/Understanding_z-index/The_stacking_context)
