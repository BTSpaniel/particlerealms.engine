# Plauna Themes

Each theme lives in its own folder. Drop a folder in here, register it in
`index.json`, and it becomes available engine-wide — no code changes needed.

---

## Folder structure

```
plauna/themes/
  _base/           ← Foundation — defines every variable with a default value
  dark/            ← Built-in dark theme
  light/           ← Built-in light theme
  high-contrast/   ← WCAG AAA accessible theme
  custom/          ← Starter template — copy this and rename
  my-brand/        ← Your theme goes here
  index.json       ← Registry — list your folder name here
  ThemeLoader.js   ← Loading engine (you don't need to touch this)
```

---

## Creating your own theme

### 1. Copy the `custom` folder

```
plauna/themes/my-brand/
  theme.json
```

### 2. Edit `theme.json`

```json
{
  "id": "my-brand",
  "name": "My Brand",
  "description": "Company brand colours",
  "author": "You",
  "version": "1.0.0",
  "extends": "dark",

  "vars": {
    "--color-primary": "#7c3aed",
    "--color-success": "#059669",
    "--bg-primary":    null,
    "--text-primary":  null
  }
}
```

**Rules:**
- `"extends"` — which theme to inherit from. Omit a var or set it to `null`
  to keep the parent's value. Only override what you actually want to change.
- Every var in `_base/theme.json` is available to override.
- You can chain inheritance: `my-brand` → `dark` → `_base`.

### 3. Register it

Open `index.json` and add your folder name:

```json
{
  "themes": ["_base", "dark", "light", "high-contrast", "custom", "my-brand"]
}
```

That's it. The engine picks it up automatically.

---

## Available variables

All variables are defined in `_base/theme.json`. Here's a quick reference:

| Group         | Variables |
|---------------|-----------|
| Backgrounds   | `--bg-primary` `--bg-secondary` `--bg-tertiary` `--bg-quaternary` |
| Text          | `--text-primary` `--text-secondary` `--text-tertiary` `--text-disabled` |
| Borders       | `--border-light` `--border-medium` `--border-dark` `--border-subtle` |
| Brand colours | `--color-primary` `--color-success` `--color-warning` `--color-error` `--color-info` |
| Shadows       | `--shadow-sm` `--shadow-md` `--shadow-lg` `--shadow-xl` |
| Spacing       | `--spacing-xs` → `--spacing-3xl` |
| Typography    | `--font-size-xs` → `--font-size-2xl` · `--font-weight-*` |
| Radius        | `--border-radius-sm` → `--border-radius-full` |
| Motion        | `--transition-fast` `--transition-base` `--transition-slow` |
| Z-index       | `--z-base` `--z-dropdown` `--z-sticky` `--z-overlay` `--z-modal` `--z-toast` |

---

## Runtime overrides (per-session)

You can layer extra vars on top of the active theme at runtime — useful for
user preference panels or live customisation:

```js
const shell = await PlaunaDevShell.boot(root);

// Apply overrides (stacks on top of the active theme)
shell.applyOverrides({
  '--color-primary': '#7c3aed',
  '--border-radius-md': '12px',
});

// Remove all overrides
shell.clearOverrides();
```

---

## Switching themes programmatically

```js
// Switch by id
await shell.setTheme('light');

// Toggle dark ↔ light
const newTheme = await shell.toggleTheme();

// List available themes
const themes = await shell.getAvailableThemes();
// → [{ id, name, description, author, extends }, ...]

// Access the loader directly for advanced use
const vars = await shell.themeLoader.listVars();
```
