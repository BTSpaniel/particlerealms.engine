// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * WidgetGallery - Storybook-Style Widget Showcase
 * ============================================================================
 *
 * WidgetGallery is a Storybook-like gallery that renders real interactive widget
 * instances from widget.stories() definitions. It's used for development and
 * documentation of Plauna widgets.
 *
 * RENDERING STRATEGY:
 * - Uses widgetRenderer.render() directly to bypass the broken require() in create()
 * - Instantiates widgets with new WidgetClass(id, storyOptions)
 * - Renders each widget to DOM in preview cells
 * - Adds interactive state badges (on/off/animating/sending toast)
 * - Wires click/change/input events to emit toast notifications
 *
 * GALLERY STRUCTURE:
 * - Header: Title and theme selector dropdown
 * - Tabs: Category navigation (Primitive, Input, Form, Layout, Navigation, etc.)
 * - Content Area: Grid of widget story previews
 * - Story Cell: Widget preview + label + state badges
 *
 * STORY PATTERN:
 * Each widget defines static stories() returning named configurations:
 *   static stories() {
 *       return {
 *           'Story Name': { variant: 'primary', size: 'md' },
 *           'Another Story': { disabled: true }
 *       };
 *   }
 *
 * SPECIAL HANDLING:
 * - Tooltips: Appended to document.body for correct overlay positioning
 * - Toasts: Call show() immediately for visible demos
 * - State Badges: Display on/off/animating/sending-toast indicators
 * - Interactive Events: Click/change/input emit toast notifications
 *
 * DATA ATTRIBUTES:
 * - data-widget: Widget ID (e.g., 'button', 'badge')
 * - data-variant: Story variant name
 * - data-size: Story size name
 * - data-story: Story name
 *
 * TOAST INTEGRATION:
 * - Uses global Toast from ToastManager
 * - Emits toasts on widget interactions for immediate feedback
 * - Toast position defaults to top-right
 *
 * THEME SELECTOR:
 * - Async dropdown in header
 * - Calls shell.setTheme() on change
 * - Refreshes gallery on theme change
 */

/**
 * WidgetGallery - Storybook-Style Widget Showcase.
 *
 * Gallery pattern:
 * - Renders interactive widget instances from widget.stories() definitions
 * - Storybook-like interface for widget documentation
 * - Category tabs for organized navigation
 * - Interactive state badges and toast notifications
 * - Theme selector integration
 *
 * Rendering strategy:
 * - Uses widgetRenderer.render() directly (bypasses broken require() in create())
 * - Instantiates widgets with new WidgetClass(id, storyOptions)
 * - Renders each widget to DOM in preview cells
 * - Wires click/change/input events to toast notifications
 */

import { Toast } from '../ui/ToastManager.js';
import { PageTransition } from '../motion/PageTransition.js';
import { DIRTY, NODE_STATE } from '../core/UINode.js';
import { Input as FormInput } from '../widgets/Input/Input.js';
import { Number as FormNumber } from '../widgets/Input/Number.js';
import { Range as FormRange } from '../widgets/Input/Range.js';
import { Button as FormButton } from '../widgets/Input/Button.js';
import { Switch as FormSwitch } from '../widgets/Form/Switch.js';
import { Textarea as FormTextarea } from '../widgets/Form/Textarea.js';

let _galleryIdSequence = 0;

function _newGalleryId(prefix) {
    return `${prefix}-${Date.now()}-${++_galleryIdSequence}`;
}

const TEXT_SIZE_PRESETS = {
    xs: '12px',
    sm: '14px',
    md: '16px',
    lg: '18px',
    xl: '20px'
};

const CUSTOMIZATION_SCHEMAS = {
    button: [
        {
            key: 'text',
            label: 'Text',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.text ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'warning', 'success'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'primary',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['sm', 'md', 'lg'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            group: 'Appearance',
            read: (instance) => instance.icon ?? '',
            apply: (instance, value, state) => instance.setIcon(value, state.values.iconPosition || instance.iconPosition || 'left')
        },
        {
            key: 'iconPosition',
            label: 'Icon Position',
            type: 'select',
            group: 'Appearance',
            options: ['left', 'right'],
            read: (instance) => instance.iconPosition ?? 'left',
            apply: (instance, value, state) => instance.setIcon(state.values.icon || instance.icon || '', value)
        },
        {
            key: 'disabled',
            label: 'Disabled',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.disabled ?? storyOptions.disabled ?? false),
            apply: (instance, value) => instance.setDisabled(Boolean(value))
        },
        {
            key: 'loading',
            label: 'Loading',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.hasState?.(NODE_STATE.LOADING) ?? storyOptions.loading ?? false),
            apply: (instance, value) => instance.setLoading(Boolean(value))
        }
    ],
    badge: [
        {
            key: 'label',
            label: 'Label',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.label ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'secondary', 'success', 'warning', 'error', 'info', 'outline', 'subtle'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'primary',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'shape',
            label: 'Shape',
            type: 'select',
            group: 'Appearance',
            options: ['rounded', 'pill', 'square'],
            read: (instance, storyOptions) => instance.shape ?? storyOptions.shape ?? 'rounded',
            apply: (instance, value) => {
                instance.shape = value;
                instance.setupStyles();
                instance.markDirty(DIRTY.STYLE | DIRTY.PAINT);
            }
        },
        {
            key: 'dot',
            label: 'Dot',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.dot ?? storyOptions.dot ?? false),
            apply: (instance, value) => instance.setDot(Boolean(value))
        },
        {
            key: 'count',
            label: 'Count',
            type: 'number',
            group: 'Content',
            read: (instance) => instance.count ?? 0,
            min: 0,
            step: 1,
            apply: (instance, value) => instance.setCount(Number(value))
        },
        {
            key: 'maxCount',
            label: 'Max Count',
            type: 'number',
            group: 'Advanced',
            read: (instance) => instance.maxCount ?? 99,
            min: 1,
            step: 1,
            apply: (instance, value) => instance.setMaxCount(Number(value))
        },
        {
            key: 'showZero',
            label: 'Show Zero',
            type: 'boolean',
            group: 'Advanced',
            read: (instance, storyOptions) => Boolean(instance.showZero ?? storyOptions.showZero ?? false),
            apply: (instance, value) => instance.setShowZero(Boolean(value))
        },
        {
            key: 'position',
            label: 'Position',
            type: 'select',
            group: 'Advanced',
            options: ['static', 'top-right', 'top-left'],
            read: (instance, storyOptions) => instance.position ?? storyOptions.position ?? 'static',
            apply: (instance, value) => {
                instance.position = value;
                instance.setupStyles();
                instance.markDirty(DIRTY.STYLE | DIRTY.PAINT);
            }
        }
    ],
    avatar: [
        {
            key: 'src',
            label: 'Image URL',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.src ?? storyOptions.src ?? '',
            apply: (instance, value) => instance.setSrc(value)
        },
        {
            key: 'name',
            label: 'Name',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.name ?? storyOptions.name ?? '',
            apply: (instance, value) => instance.setName(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'shape',
            label: 'Shape',
            type: 'select',
            group: 'Appearance',
            options: ['circle', 'square', 'rounded'],
            read: (instance, storyOptions) => instance.shape ?? storyOptions.shape ?? 'circle',
            apply: (instance, value) => instance.setShape(value)
        },
        {
            key: 'status',
            label: 'Status',
            type: 'select',
            group: 'State',
            options: [null, 'online', 'offline', 'busy', 'away', 'focus'],
            read: (instance, storyOptions) => instance.status ?? storyOptions.status ?? null,
            apply: (instance, value) => instance.setStatus(value || null)
        },
        {
            key: 'fallback',
            label: 'Fallback',
            type: 'select',
            group: 'Content',
            options: ['initials', 'icon', 'placeholder'],
            read: (instance, storyOptions) => instance.fallback ?? storyOptions.fallback ?? 'initials',
            apply: (instance, value) => instance.setFallback(value)
        },
        {
            key: 'showStatus',
            label: 'Show Status',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.showStatus ?? storyOptions.showStatus ?? true),
            apply: (instance, value) => instance.setShowStatus(Boolean(value))
        },
        {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            group: 'Content',
            read: (instance) => instance.icon ?? '',
            apply: (instance, value) => instance.setIcon(value)
        }
    ],
    chip: [
        {
            key: 'label',
            label: 'Label',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.label ?? storyOptions.label ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setLabel(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'primary', 'secondary', 'success', 'warning', 'error'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'removable',
            label: 'Removable',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.removable ?? storyOptions.removable ?? false),
            apply: (instance, value) => instance.setRemovable(Boolean(value))
        },
        {
            key: 'disabled',
            label: 'Disabled',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.disabled ?? storyOptions.disabled ?? false),
            apply: (instance, value) => instance.setDisabled(Boolean(value))
        }
    ],
    modal: [
        {
            key: 'title',
            label: 'Title',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.title ?? storyOptions.title ?? '',
            apply: (instance, value) => instance.setTitle(value)
        },
        {
            key: 'content',
            label: 'Content',
            type: 'textarea',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'open',
            label: 'Open',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.open ?? storyOptions.open ?? false),
            apply: (instance, value) => {
                instance.open = Boolean(value);
                if (typeof instance.updateOpenState === 'function') {
                    instance.updateOpenState();
                }
                instance.markDirty(DIRTY.PAINT);
            }
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['sm', 'md', 'lg'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        }
    ],
    panel: [
        {
            key: 'title',
            label: 'Title',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.title ?? storyOptions.title ?? '',
            apply: (instance, value) => instance.setTitle(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'card', 'elevated', 'outlined', 'ghost'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        }
    ],
    progress: [
        {
            key: 'value',
            label: 'Value',
            type: 'range',
            group: 'Content',
            min: 0,
            max: (instance) => Number(instance.max ?? 100),
            step: 1,
            read: (instance, storyOptions) => Number(instance.value ?? storyOptions.value ?? 0),
            visibleWhen: (instance) => !Boolean(instance.indeterminate),
            apply: (instance, value) => instance.setValue(Number(value))
        },
        {
            key: 'max',
            label: 'Max',
            type: 'number',
            group: 'Content',
            min: 1,
            step: 1,
            read: (instance, storyOptions) => Number(instance.max ?? storyOptions.max ?? 100),
            apply: (instance, value) => instance.setMax(Number(value))
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'success', 'warning', 'error', 'info'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'type',
            label: 'Type',
            type: 'select',
            group: 'Appearance',
            options: ['linear', 'circular'],
            read: (instance, storyOptions) => instance.type ?? storyOptions.type ?? 'linear',
            apply: (instance, value) => instance.setType(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
            read: (instance, storyOptions) => instance.size ?? storyOptions.size ?? 'md',
            apply: (instance, value) => instance.setSize(value)
        },
        {
            key: 'indeterminate',
            label: 'Indeterminate',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.indeterminate ?? storyOptions.indeterminate ?? false),
            apply: (instance, value) => instance.setIndeterminate(Boolean(value))
        },
        {
            key: 'showPercentage',
            label: 'Show Percentage',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.showPercentage ?? storyOptions.showPercentage ?? true),
            apply: (instance, value) => instance.setShowPercentage(Boolean(value))
        },
        {
            key: 'animated',
            label: 'Animated',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.animated ?? storyOptions.animated ?? true),
            apply: (instance, value) => instance.setAnimated(Boolean(value))
        }
    ],
    skeleton: [
        {
            key: 'type',
            label: 'Type',
            type: 'select',
            group: 'Appearance',
            options: ['text', 'avatar', 'button', 'card', 'image', 'input', 'paragraph'],
            read: (instance, storyOptions) => instance.type ?? storyOptions.type ?? 'text',
            apply: (instance, value) => instance.setType(value)
        },
        {
            key: 'width',
            label: 'Width',
            type: 'text',
            group: 'Appearance',
            read: (instance, storyOptions) => instance.width ?? storyOptions.width ?? '100%',
            apply: (instance, value) => instance.setWidth(value)
        },
        {
            key: 'height',
            label: 'Height',
            type: 'text',
            group: 'Appearance',
            read: (instance, storyOptions) => instance.height ?? storyOptions.height ?? '20px',
            apply: (instance, value) => instance.setHeight(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'rounded', 'sharp', 'circle'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'animated',
            label: 'Animated',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.animated ?? storyOptions.animated ?? true),
            apply: (instance, value) => instance.setAnimated(Boolean(value))
        },
        {
            key: 'count',
            label: 'Count / Lines',
            type: 'number',
            group: 'Content',
            min: 1,
            step: 1,
            read: (instance, storyOptions) => Number(instance.lines ?? instance.count ?? storyOptions.count ?? 1),
            visibleWhen: (instance) => instance.type === 'paragraph',
            apply: (instance, value) => {
                const next = Math.max(1, Number(value) || 1);
                instance.lines = next;
                instance.count = next;
                instance.setupStyles();
                instance.buildSkeleton();
                instance.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        },
        {
            key: 'circleSize',
            label: 'Circle Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
            read: (instance, storyOptions) => instance.circleSize ?? storyOptions.circleSize ?? 'md',
            visibleWhen: (instance) => instance.type === 'avatar',
            apply: (instance, value) => {
                instance.circleSize = value;
                instance.setupStyles();
                instance.buildSkeleton();
                instance.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        },
        {
            key: 'buttonSize',
            label: 'Button Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
            read: (instance, storyOptions) => instance.buttonSize ?? storyOptions.buttonSize ?? 'md',
            visibleWhen: (instance) => instance.type === 'button',
            apply: (instance, value) => {
                instance.buttonSize = value;
                instance.setupStyles();
                instance.buildSkeleton();
                instance.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        }
    ],
    text: [
        {
            key: 'content',
            label: 'Content',
            type: 'textarea',
            group: 'Content',
            read: (instance, storyOptions) => instance.text ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setText(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['body', 'heading-1', 'heading-2', 'heading-3', 'caption', 'label', 'code'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'body',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'size',
            label: 'Size',
            type: 'select',
            group: 'Appearance',
            options: ['xs', 'sm', 'md', 'lg', 'xl'],
            read: (instance, storyOptions) => instance._galleryTextSize ?? storyOptions.size ?? 'md',
            apply: (instance, value) => {
                instance._galleryTextSize = value;
                instance.setFontSize(TEXT_SIZE_PRESETS[value] || TEXT_SIZE_PRESETS.md);
            }
        },
        {
            key: 'maxLines',
            label: 'Max Lines',
            type: 'number',
            group: 'Advanced',
            min: 1,
            step: 1,
            read: (instance, storyOptions) => instance.maxLines ?? storyOptions.maxLines ?? 0,
            apply: (instance, value) => instance.setMaxLines(Number(value) || null)
        },
        {
            key: 'overflow',
            label: 'Overflow',
            type: 'select',
            group: 'Advanced',
            options: ['wrap', 'nowrap', 'clip'],
            read: (instance, storyOptions) => instance.overflow ?? storyOptions.overflow ?? 'wrap',
            apply: (instance, value) => instance.setOverflow(value)
        },
        {
            key: 'selectable',
            label: 'Selectable',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.selectable ?? storyOptions.selectable ?? true),
            apply: (instance, value) => instance.setSelectable(Boolean(value))
        },
        {
            key: 'editable',
            label: 'Editable',
            type: 'boolean',
            group: 'State',
            read: (instance, storyOptions) => Boolean(instance.editable ?? storyOptions.editable ?? false),
            apply: (instance, value) => instance.setEditable(Boolean(value))
        }
    ],
    tooltip: [
        {
            key: 'content',
            label: 'Content',
            type: 'text',
            group: 'Content',
            read: (instance, storyOptions) => instance.content ?? storyOptions.content ?? '',
            apply: (instance, value) => instance.setContent(value)
        },
        {
            key: 'placement',
            label: 'Placement',
            type: 'select',
            group: 'Appearance',
            options: ['top', 'bottom', 'left', 'right'],
            read: (instance, storyOptions) => instance.placement ?? storyOptions.placement ?? 'top',
            apply: (instance, value) => instance.setPlacement(value)
        },
        {
            key: 'variant',
            label: 'Variant',
            type: 'select',
            group: 'Appearance',
            options: ['default', 'primary', 'success', 'warning', 'error', 'inverse'],
            read: (instance, storyOptions) => instance.variant ?? storyOptions.variant ?? 'default',
            apply: (instance, value) => instance.setVariant(value)
        },
        {
            key: 'delay',
            label: 'Delay',
            type: 'number',
            group: 'State',
            min: 0,
            step: 25,
            read: (instance, storyOptions) => Number(instance.delay ?? storyOptions.delay ?? 300),
            apply: (instance, value) => {
                instance.delay = Number(value) || 0;
                instance.markDirty(DIRTY.PAINT);
            }
        },
        {
            key: 'trigger',
            label: 'Trigger',
            type: 'select',
            group: 'State',
            options: ['hover', 'focus', 'click'],
            read: (instance) => instance.trigger ?? 'hover',
            apply: (instance, value) => {
                instance.trigger = value;
                if (typeof instance.detach === 'function') {
                    instance.detach();
                }
                instance.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            }
        },
        {
            key: 'offset',
            label: 'Offset',
            type: 'number',
            group: 'Advanced',
            min: 0,
            step: 1,
            read: (instance, storyOptions) => Number(instance.offset ?? storyOptions.offset ?? 8),
            apply: (instance, value) => {
                instance.offset = Number(value) || 0;
                if (instance.visible) {
                    instance.updatePosition();
                }
                instance.markDirty(DIRTY.PAINT);
            }
        }
    ]
};

/**
 * WidgetGallery - Interactive widget showcase.
 *
 * Gallery architecture:
 * - Storybook-like interface for widget documentation
 * - Renders real interactive widget instances
 * - Category-based navigation with tabs
 * - Interactive state badges (on/off/animating/sending toast)
 * - Toast integration for immediate feedback
 */
export class WidgetGallery {
    constructor(shell, options = {}) {
        this.shell = shell;
        this.toast = options.toast || Toast;
        this.activeCategory = null;
        this._tabEls = new Map();
        this._containerEl = null;
        this._contentEl = null;
        this._pageTransition = null;
    }

    /**
     * Mount the gallery to a DOM element.
     *
     * Mounting pattern:
     * - Creates gallery app container with flex layout
     * - Builds header with title and theme selector
     * - Builds category tabs for navigation
     * - Creates content area for widget previews
     * - Activates first category on mount
     *
     * @param {HTMLElement} root - Root DOM element
     */
    mount(root) {
        root.innerHTML = '';

        const app = this._el('div', {
            id: 'plauna-gallery',
            style: `
                display: flex;
                flex-direction: column;
                background: var(--bg-primary);
                color: var(--text-primary);
                font-family: system-ui, -apple-system, 'Inter', sans-serif;
                font-size: 14px;
                line-height: 1.5;
            `
        });

        app.appendChild(this._buildHeader());
        app.appendChild(this._buildTabs());

        this._contentEl = this._el('div', {
            id: 'plauna-gallery-content',
            style: `
                flex: 1;
                padding: 24px;
                padding-bottom: 200px;
            `
        });
        app.appendChild(this._contentEl);

        root.appendChild(app);

        // Activate first category
        const cats = this.shell.getAllCategories();
        if (cats.length > 0) {
            this._selectCategory(cats[0].id);
        }
    }

    // ── Header ────────────────────────────────────────────────────

    _buildHeader() {
        const header = this._el('header', {
            style: `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 24px;
                height: 52px;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border-light);
                position: sticky;
                top: 0;
                z-index: var(--z-sticky);
                flex-shrink: 0;
            `
        });

        const title = this._el('div', {
            style: `
                font-size: 16px;
                font-weight: var(--font-weight-semibold);
                color: var(--text-primary);
                display: flex;
                align-items: center;
                gap: 8px;
            `
        });
        title.innerHTML = '<span style="font-size:20px">🎨</span> Plauna DevShell';

        const controls = this._el('div', { style: 'display:flex;gap:8px;align-items:center;' });

        const themeSelect = this._el('select', {
            style: `
                padding: 5px 10px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border-medium);
                border-radius: var(--border-radius-md);
                color: var(--text-primary);
                cursor: pointer;
                font-size: 12px;
                font-family: inherit;
                outline: none;
            `
        });

        const loadingOpt = document.createElement('option');
        loadingOpt.textContent = 'Loading themes…';
        loadingOpt.disabled = true;
        themeSelect.appendChild(loadingOpt);

        this.shell.getAvailableThemes().then(themes => {
            themeSelect.innerHTML = '';
            const current = this.shell.getTheme();
            themes.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                opt.selected = t.id === current;
                themeSelect.appendChild(opt);
            });
        });

        themeSelect.addEventListener('change', async () => {
            themeSelect.disabled = true;
            await this.shell.setTheme(themeSelect.value);
            themeSelect.disabled = false;
        });

        const statsEl = this._el('span', {
            style: 'font-size:11px;color:var(--text-tertiary);'
        });
        const total = this.shell.getAllWidgets().length;
        statsEl.textContent = `${total} widgets`;

        controls.appendChild(statsEl);
        controls.appendChild(themeSelect);
        header.appendChild(title);
        header.appendChild(controls);
        return header;
    }

    // ── Category Tabs ─────────────────────────────────────────────

    _buildTabs() {
        const nav = this._el('nav', {
            style: `
                display: flex;
                align-items: stretch;
                gap: 0;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border-light);
                overflow-x: auto;
                padding: 0 24px;
                flex-shrink: 0;
                scrollbar-width: none;
            `
        });

        this.shell.getAllCategories().forEach(cat => {
            const btn = this._el('button', {
                style: `
                    padding: 10px 16px;
                    background: transparent;
                    border: none;
                    border-bottom: 2px solid transparent;
                    color: var(--text-secondary);
                    cursor: pointer;
                    font-size: 13px;
                    font-family: inherit;
                    font-weight: var(--font-weight-medium);
                    white-space: nowrap;
                    transition: color var(--transition-fast), border-color var(--transition-fast);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                `
            });
            btn.innerHTML = `<span>${cat.icon || ''}</span><span>${cat.name}</span><span style="font-size:10px;color:var(--text-tertiary)">${cat.items.length}</span>`;
            btn.addEventListener('click', () => this._selectCategory(cat.id));
            this._tabEls.set(cat.id, btn);
            nav.appendChild(btn);
        });

        return nav;
    }

    _selectCategory(catId) {
        // Update active tab styling immediately
        this._tabEls.forEach((btn, id) => {
            if (id === catId) {
                btn.style.color = 'var(--color-primary)';
                btn.style.borderBottomColor = 'var(--color-primary)';
            } else {
                btn.style.color = 'var(--text-secondary)';
                btn.style.borderBottomColor = 'transparent';
            }
        });

        // First render (mount) should not animate; subsequent clicks use PageTransition.
        if (!this._pageTransition || this.activeCategory === null) {
            this._pageTransition = new PageTransition({
                target: this._contentEl,
                type: 'slide-left',
                duration: 280,
                reducedMotion: true
            });
            this.activeCategory = catId;
            this._renderCategory(catId);
            return;
        }

        const cats = this.shell.getAllCategories();
        const oldIndex = cats.findIndex(c => c.id === this.activeCategory);
        const newIndex = cats.findIndex(c => c.id === catId);
        const direction = newIndex >= oldIndex ? 'slide-left' : 'slide-right';

        this.activeCategory = catId;
        this._pageTransition.start(() => {
            this._renderCategory(catId);
        }, { type: direction });
    }

    // ── Category Renderer ─────────────────────────────────────────

    _renderCategory(catId) {
        this._contentEl.innerHTML = '';

        const cats = this.shell.getAllCategories();
        const cat = cats.find(c => c.id === catId);
        if (!cat || cat.items.length === 0) {
            this._contentEl.innerHTML = `<p style="color:var(--text-tertiary);padding:24px 0">No widgets in this category.</p>`;
            return;
        }

        cat.items.forEach(WidgetClass => {
            const card = this._buildWidgetCard(WidgetClass);
            if (card) this._contentEl.appendChild(card);
        });
    }

    // ── Widget Card ───────────────────────────────────────────────

    _buildWidgetCard(WidgetClass) {
        const stories = this._getStories(WidgetClass);

        const card = this._el('div', {
            style: `
                background: var(--bg-secondary);
                border: 1px solid var(--border-light);
                border-radius: var(--border-radius-lg);
                margin-bottom: 20px;
                overflow: visible;
            `
        });

        // Card header
        const cardHead = this._el('div', {
            style: `
                padding: 14px 20px;
                border-bottom: 1px solid var(--border-light);
                display: flex;
                align-items: center;
                gap: 10px;
            `
        });
        const headTitle = this._el('span', { style: 'font-weight:var(--font-weight-semibold);font-size:15px;color:var(--text-primary)' });
        headTitle.textContent = `${WidgetClass.icon || ''} ${WidgetClass.name}`.trim();

        const headDesc = this._el('span', { style: 'font-size:12px;color:var(--text-tertiary);margin-left:4px;' });
        headDesc.textContent = WidgetClass.description || '';

        const idBadge = this._el('code', {
            style: `
                margin-left: auto;
                font-size: 11px;
                background: var(--bg-tertiary);
                color: var(--text-tertiary);
                padding: 2px 8px;
                border-radius: var(--border-radius-sm);
            `
        });
        idBadge.textContent = WidgetClass.id;

        cardHead.appendChild(headTitle);
        cardHead.appendChild(headDesc);
        cardHead.appendChild(idBadge);
        card.appendChild(cardHead);

        // Stories grid
        const grid = this._el('div', {
            style: `
                display: flex;
                flex-wrap: wrap;
                gap: 1px;
                background: var(--border-light);
            `
        });

        Object.entries(stories).forEach(([storyName, storyOptions]) => {
            const storyEl = this._buildStoryCell(WidgetClass, storyName, storyOptions);
            grid.appendChild(storyEl);
        });

        card.appendChild(grid);
        return card;
    }

    // ── Story Cell ────────────────────────────────────────────────

    _buildStoryCell(WidgetClass, storyName, storyOptions) {
        const cell = this._el('div', {
            style: `
                background: var(--bg-secondary);
                padding: 16px 20px;
                flex: 1;
                min-width: 180px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                overflow: visible;
            `
        });

        const label = this._el('div', {
            style: 'font-size:11px;font-weight:var(--font-weight-medium);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;'
        });
        label.textContent = storyName;

        const statusRow = this._el('div', {
            style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;'
        });

        const preview = this._el('div', {
            style: 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:40px;'
        });
        preview.className = 'plauna-story-preview';

        try {
            const id = _newGalleryId(`${WidgetClass.id}-${storyName.replace(/\s+/g, '-').toLowerCase()}`);
            const instance = new WidgetClass(id, storyOptions);
            const customization = this._buildCustomizationPanel(WidgetClass, instance, storyName, storyOptions, preview, statusRow);

            if (WidgetClass.id === 'skeleton') {
                preview.style.alignItems = 'flex-start';
                preview.style.justifyContent = 'flex-start';
                preview.style.minHeight = '64px';
                preview.style.paddingTop = '4px';
            }

            cell.appendChild(label);
            cell.appendChild(customization.toolbar);
            cell.appendChild(customization.panel);
            cell.appendChild(statusRow);
            cell.appendChild(preview);
            customization.render();
        } catch (err) {
            const errEl = this._el('span', { style: 'font-size:11px;color:var(--color-error);' });
            errEl.textContent = `Error: ${err.message}`;
            cell.appendChild(label);
            cell.appendChild(errEl);
        }

        return cell;
    }

    _getCustomizationSchema(WidgetClass) {
        return CUSTOMIZATION_SCHEMAS[WidgetClass.id] || [];
    }

    _buildCustomizationPanel(WidgetClass, instance, storyName, storyOptions, preview, statusRow) {
        const schema = this._getCustomizationSchema(WidgetClass);
        const state = {
            storyOptions: { ...storyOptions },
            values: {},
            controls: new Map(),
            currentDom: null,
            triggerEl: null
        };

        const groups = new Map();
        schema.forEach((field) => {
            const groupName = field.group || 'General';
            if (!groups.has(groupName)) {
                groups.set(groupName, []);
            }
            groups.get(groupName).push(field);
            const resolved = this._resolveSchemaValue(field, instance, state.storyOptions);
            state.values[field.key] = resolved;
        });

        const toolbar = this._el('div', {
            style: `
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:12px;
                padding:10px 12px;
                border:1px solid var(--border-light);
                border-radius:var(--border-radius-md);
                background:var(--bg-primary);
            `
        });

        const toolbarLabel = this._el('div', {
            style: 'display:flex;flex-direction:column;gap:2px;min-width:0;'
        });
        toolbarLabel.innerHTML = `
            <span style="font-size:12px;font-weight:600;color:var(--text-primary);">Customize</span>
            <span style="font-size:11px;color:var(--text-tertiary);">Live props and token-driven tweaks</span>
        `;

        const toggle = new FormButton(_newGalleryId(`gallery-toggle-${WidgetClass.id}`), {
            text: 'Show controls',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                const open = panel.style.display !== 'flex';
                panel.style.display = open ? 'flex' : 'none';
                toggle.setText(open ? 'Hide controls' : 'Show controls');
                toggle.setVariant(open ? 'primary' : 'secondary');
                toggle.setSelected(open);
            }
        });

        toolbar.appendChild(toolbarLabel);
        toolbar.appendChild(this._mountFormWidget(toggle));

        const panel = this._el('div', {
            style: `
                display:none;
                flex-direction:column;
                gap:12px;
                padding:12px;
                border:1px solid var(--border-light);
                border-radius:var(--border-radius-md);
                background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
            `
        });

        const buildControl = (field) => {
            const row = this._el('div', {
                style: `
                    display:flex;
                    flex-direction:column;
                    gap:8px;
                    min-width:0;
                    padding:10px 12px;
                    border:1px solid var(--border-light);
                    border-radius:var(--border-radius-md);
                    background:var(--bg-primary);
                `
            });
            row.dataset.field = field.key;

            const labelRow = this._el('div', {
                style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;'
            });
            const label = this._el('span', {
                style: 'font-size:11px;font-weight:700;letter-spacing:0.02em;color:var(--text-secondary);text-transform:uppercase;'
            });
            label.textContent = field.label;
            labelRow.appendChild(label);

            if (field.token || field.helper) {
                const note = this._el('span', {
                    style: 'font-size:11px;color:var(--text-tertiary);text-align:right;'
                });
                note.textContent = field.token ? `Token: ${field.token}` : field.helper;
                labelRow.appendChild(note);
            }

            const mount = this._el('div', {
                style: 'display:flex;flex-direction:column;gap:8px;min-width:0;'
            });

            const record = this._createCustomizationControl(field, instance, state, (value) => {
                state.values[field.key] = value;
                this._applyCustomizationValue(field, instance, value, state);
                this._syncCustomizationControls(instance, state);
                this._renderCustomizationPreview(WidgetClass, instance, storyName, state, preview, statusRow);
            });

            mount.appendChild(record.element || this._mountFormWidget(record.widget));
            row.appendChild(labelRow);
            row.appendChild(mount);
            state.controls.set(field.key, {
                ...record,
                row,
                mount
            });
            return row;
        };

        const groupedFields = Array.from(groups.entries());
        groupedFields.forEach(([groupName, fields]) => {
            const group = this._el('div', {
                style: 'display:flex;flex-direction:column;gap:8px;'
            });
            const heading = this._el('div', {
                style: 'font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.04em;'
            });
            heading.textContent = groupName;
            group.appendChild(heading);
            fields.forEach((field) => group.appendChild(buildControl(field)));
            panel.appendChild(group);
        });

        this._syncCustomizationControls(instance, state);

        return {
            toolbar,
            panel,
            render: () => {
                this._renderCustomizationPreview(WidgetClass, instance, storyName, state, preview, statusRow);
                this._wirePreviewNotifications(preview, WidgetClass, instance, storyName, state.storyOptions);
            }
        };
    }

    _resolveSchemaValue(field, instance, storyOptions) {
        const value = typeof field.read === 'function' ? field.read(instance, storyOptions) : storyOptions[field.key];
        if (field.type === 'boolean') return Boolean(value);
        if (field.type === 'number' || field.type === 'range') return Number(value ?? 0);
        return value ?? '';
    }

    _applyCustomizationValue(field, instance, value, state) {
        state.storyOptions[field.key] = value;
        if (typeof field.apply === 'function') {
            field.apply(instance, value, state);
            return;
        }

        const setterName = `set${field.key.charAt(0).toUpperCase()}${field.key.slice(1)}`;
        if (typeof instance[setterName] === 'function') {
            instance[setterName](value);
            return;
        }

        instance[field.key] = value;
        if (typeof instance.markDirty === 'function') {
            instance.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    _mountFormWidget(widget) {
        if (!widget) {
            return this._el('div');
        }

        if (widget.buttonElement instanceof HTMLElement) {
            return widget.buttonElement;
        }

        if (typeof this.shell?.render === 'function') {
            const rendered = this.shell.render(widget);
            if (rendered) {
                return rendered;
            }
        }

        return widget.element || widget;
    }

    _normalizeCustomizationOptions(field, instance, state) {
        const rawOptions = typeof field.options === 'function' ? field.options(instance, state) : field.options || [];
        return rawOptions.map((option) => {
            if (option && typeof option === 'object') {
                const rawValue = option.value ?? option.id ?? option.key ?? '';
                const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
                const label = option.label ?? option.text ?? (value === '' ? 'none' : value);
                return {
                    value,
                    label: String(label),
                    disabled: Boolean(option.disabled)
                };
            }

            const value = option === null || option === undefined ? '' : String(option);
            return {
                value,
                label: option === null || option === undefined ? 'none' : String(option),
                disabled: false
            };
        });
    }

    _createCustomizationControl(field, instance, state, onChange) {
        const controlId = _newGalleryId(`gallery-control-${field.key}`);
        const currentValue = state.values[field.key];

        if (field.type === 'boolean') {
            const widget = new FormSwitch(controlId, {
                checked: Boolean(currentValue),
                label: '',
                size: 'sm',
                variant: 'primary'
            });
            const handler = () => onChange(Boolean(widget.checked));
            widget.addEventListener('change', handler);
            return {
                kind: 'boolean',
                widget,
                sync: (value) => {
                    const checked = Boolean(value);
                    if (widget.checked !== checked) {
                        widget.setChecked(checked);
                    }
                }
            };
        }

        if (field.type === 'range') {
            const min = typeof field.min === 'function' ? field.min(instance, state) : field.min ?? 0;
            const max = typeof field.max === 'function' ? field.max(instance, state) : field.max ?? 100;
            const step = field.step ?? 1;
            const widget = new FormRange(controlId, {
                value: Number(currentValue ?? 0),
                min,
                max,
                step,
                label: '',
                size: 'md',
                showValue: true
            });
            const handler = () => onChange(Number(widget.value));
            widget.addEventListener('input', handler);
            widget.addEventListener('change', handler);
            return {
                kind: 'range',
                widget,
                sync: (value) => {
                    const minValue = typeof field.min === 'function' ? field.min(instance, state) : field.min;
                    const maxValue = typeof field.max === 'function' ? field.max(instance, state) : field.max;
                    if (minValue !== undefined && minValue !== null && typeof widget.setMin === 'function') {
                        widget.setMin(minValue);
                    }
                    if (maxValue !== undefined && maxValue !== null && typeof widget.setMax === 'function') {
                        widget.setMax(maxValue);
                    }
                    if (field.step !== undefined && typeof widget.setStep === 'function') {
                        widget.setStep(field.step);
                    }
                    const next = Number(value ?? 0);
                    if (Number(widget.value) !== next) {
                        widget.setValue(next);
                    }
                }
            };
        }

        if (field.type === 'number') {
            const min = typeof field.min === 'function' ? field.min(instance, state) : field.min;
            const max = typeof field.max === 'function' ? field.max(instance, state) : field.max;
            const step = field.step ?? 1;
            const widget = new FormNumber(controlId, {
                value: Number(currentValue ?? 0),
                min,
                max,
                step,
                label: '',
                size: 'sm'
            });
            const handler = () => onChange(Number(widget.value));
            widget.addEventListener('input', handler);
            widget.addEventListener('change', handler);
            return {
                kind: 'number',
                widget,
                sync: (value) => {
                    const minValue = typeof field.min === 'function' ? field.min(instance, state) : field.min;
                    const maxValue = typeof field.max === 'function' ? field.max(instance, state) : field.max;
                    if (minValue !== undefined && minValue !== null && typeof widget.setMin === 'function') {
                        widget.setMin(minValue);
                    }
                    if (maxValue !== undefined && maxValue !== null && typeof widget.setMax === 'function') {
                        widget.setMax(maxValue);
                    }
                    if (field.step !== undefined && typeof widget.setStep === 'function') {
                        widget.setStep(field.step);
                    }
                    const next = Number(value ?? 0);
                    if (Number(widget.value) !== next) {
                        widget.setValue(next);
                    }
                }
            };
        }

        if (field.type === 'textarea') {
            const widget = new FormTextarea(controlId, {
                value: String(currentValue ?? ''),
                placeholder: field.placeholder || `Enter ${field.label.toLowerCase()}`,
                label: '',
                rows: field.rows || 4,
                size: 'sm'
            });
            const handler = () => onChange(String(widget.value ?? ''));
            widget.addEventListener('input', handler);
            widget.addEventListener('change', handler);
            return {
                kind: 'textarea',
                widget,
                sync: (value) => {
                    const next = String(value ?? '');
                    if (widget.value !== next) {
                        widget.setValue(next);
                    }
                }
            };
        }

        if (field.type === 'select') {
            const container = this._el('div', {
                style: 'display:flex;flex-wrap:wrap;gap:8px;'
            });
            const record = {
                kind: 'select',
                widget: null,
                element: container,
                buttons: [],
                optionSignature: ''
            };

            const buildButtons = (options) => {
                container.innerHTML = '';
                record.buttons = options.map((option, index) => {
                    const button = new FormButton(`${controlId}-${index}`, {
                        text: option.label,
                        variant: 'secondary',
                        size: 'sm',
                        onClick: () => {
                            if (!option.disabled) {
                                onChange(option.value === '' ? null : option.value);
                            }
                        }
                    });
                    if (option.disabled) {
                        button.setDisabled(true);
                    }
                    const element = this._mountFormWidget(button);
                    container.appendChild(element);
                    return { option, button };
                });
            };

            record.rebuild = (options) => {
                buildButtons(options);
            };
            record.sync = (value) => {
                const normalized = value === null || value === undefined ? '' : String(value);
                record.buttons.forEach(({ option, button }) => {
                    const selected = option.value === normalized;
                    if (typeof button.setSelected === 'function') {
                        button.setSelected(selected);
                    }
                    if (typeof button.setActive === 'function') {
                        button.setActive(selected);
                    }
                    if (typeof button.setVariant === 'function') {
                        button.setVariant(selected ? 'primary' : 'secondary');
                    }
                });
            };

            const initialOptions = this._normalizeCustomizationOptions(field, instance, state);
            record.optionSignature = JSON.stringify(initialOptions);
            buildButtons(initialOptions);
            record.sync(currentValue);
            return record;
        }

        const widget = new FormInput(controlId, {
            value: String(currentValue ?? ''),
            placeholder: field.placeholder || `Enter ${field.label.toLowerCase()}`,
            label: '',
            size: 'sm'
        });
        const handler = () => onChange(String(widget.value ?? ''));
        widget.addEventListener('input', handler);
        widget.addEventListener('change', handler);
        return {
            kind: 'text',
            widget,
            sync: (value) => {
                const next = String(value ?? '');
                if (widget.value !== next) {
                    widget.setValue(next);
                }
            }
        };
    }

    _syncCustomizationControls(instance, state) {
        const schema = this._getCustomizationSchema(instance.constructor);
        schema.forEach((field) => {
            const record = state.controls.get(field.key);
            if (!record) return;

            const currentValue = this._resolveSchemaValue(field, instance, state.storyOptions);
            state.values[field.key] = currentValue;

            if (record.kind === 'select') {
                const options = this._normalizeCustomizationOptions(field, instance, state);
                const signature = JSON.stringify(options);
                if (signature !== record.optionSignature && typeof record.rebuild === 'function') {
                    record.optionSignature = signature;
                    record.rebuild(options);
                }
            }

            if (typeof record.sync === 'function') {
                record.sync(currentValue);
            }

            if (typeof field.visibleWhen === 'function') {
                record.row.style.display = field.visibleWhen(instance) ? '' : 'none';
            } else {
                record.row.style.display = '';
            }
        });
    }

    _renderCustomizationPreview(WidgetClass, instance, storyName, state, preview, statusRow) {
        if (!preview) return;

        if (WidgetClass.id === 'tooltip' && typeof instance.detach === 'function') {
            instance.detach();
        }

        if (state.currentDom && state.currentDom.parentNode) {
            state.currentDom.remove();
        }
        if (state.triggerEl && state.triggerEl.parentNode) {
            state.triggerEl.remove();
        }

        preview.innerHTML = '';
        preview.style.position = WidgetClass.id === 'tooltip' ? 'relative' : preview.style.position || 'static';

        const setPreviewMeta = (domEl) => {
            if (!domEl) return;
            domEl.setAttribute('data-widget', WidgetClass.id);
            if (state.storyOptions.variant) domEl.setAttribute('data-variant', state.storyOptions.variant);
            if (state.storyOptions.size) domEl.setAttribute('data-size', state.storyOptions.size);
            if (state.storyOptions.story) domEl.setAttribute('data-story', state.storyOptions.story);
        };

        try {
            if (WidgetClass.id === 'tooltip') {
                preview.style.minHeight = '72px';
                const trigger = this._el('button', {
                    type: 'button',
                    style: `
                        padding: 8px 14px;
                        background: var(--bg-tertiary);
                        border: 1px solid var(--border-medium);
                        border-radius: var(--border-radius-md);
                        color: var(--text-primary);
                        font: inherit;
                        cursor: pointer;
                    `
                });
                trigger.textContent = 'Hover me';

                const domEl = this.shell.render(instance);
                if (domEl) {
                    setPreviewMeta(domEl);
                    preview.appendChild(trigger);
                    document.body.appendChild(domEl);
                    state.currentDom = domEl;
                    state.triggerEl = trigger;

                    if (typeof instance.attachTo === 'function') {
                        instance.attachTo(trigger);
                    }
                } else {
                    preview.appendChild(trigger);
                    preview.appendChild(this._fallbackPreview(WidgetClass, state.storyOptions));
                }
            } else if (WidgetClass.id === 'toast') {
                const domEl = this.shell.render(instance);
                if (domEl) {
                    setPreviewMeta(domEl);
                    preview.appendChild(domEl);
                    state.currentDom = domEl;
                    requestAnimationFrame(() => {
                        if (typeof instance.show === 'function') {
                            instance.show();
                        }
                    });
                } else {
                    preview.appendChild(this._fallbackPreview(WidgetClass, state.storyOptions));
                }
            } else {
                const domEl = this.shell.render(instance);
                if (domEl) {
                    setPreviewMeta(domEl);
                    if (WidgetClass.id === 'skeleton') {
                        domEl.style.alignSelf = 'flex-start';
                    }
                    preview.appendChild(domEl);
                    state.currentDom = domEl;
                } else {
                    preview.appendChild(this._fallbackPreview(WidgetClass, state.storyOptions));
                }
            }
        } catch (err) {
            const errEl = this._el('span', { style: 'font-size:11px;color:var(--color-error);' });
            errEl.textContent = `Error: ${err.message}`;
            preview.appendChild(errEl);
        }

        statusRow.innerHTML = '';
        this._appendStateBadges(statusRow, this._getWidgetStateBadges(WidgetClass, instance, state.storyOptions));
    }

    _wirePreviewNotifications(preview, WidgetClass, instance, storyName, storyOptions, targetEl = null) {
        const emitToast = (verb, tone = 'info') => {
            if (!this.toast?.show) return;

            const stateText = this.getWidgetStateLabel(WidgetClass, instance, storyOptions);
            const message = `${WidgetClass.name} · ${storyName} · ${verb}${stateText ? ` · ${stateText}` : ''}`;
            this.toast.show(message, tone, { duration: 2400 });
        };

        const handleClick = () => {
            emitToast('clicked', 'info');
        };

        const handleChange = () => {
            emitToast('changed', 'success');
        };

        const handleInput = () => {
            emitToast('updated', 'info');
        };

        preview.addEventListener('click', handleClick);
        preview.addEventListener('change', handleChange);
        preview.addEventListener('input', handleInput);
    }

    _getWidgetStateBadges(WidgetClass, instance, storyOptions) {
        const badges = [];
        const isDisabled = Boolean(instance?.disabled ?? storyOptions?.disabled);
        const isLoading = Boolean(instance?.hasState?.(NODE_STATE.LOADING) ?? storyOptions?.loading);
        const isAnimated = Boolean(instance?.animated ?? storyOptions?.animated ?? instance?.indeterminate ?? storyOptions?.indeterminate);

        if (WidgetClass.id === 'button') {
            badges.push({ label: isDisabled ? 'disabled' : 'enabled', tone: isDisabled ? 'muted' : 'success' });
            if (isLoading) {
                badges.push({ label: 'loading', tone: 'warning' });
            }
        } else if (WidgetClass.id === 'progress') {
            badges.push({ label: isDisabled ? 'disabled' : 'enabled', tone: isDisabled ? 'muted' : 'success' });
            if (isAnimated || instance?.indeterminate) {
                badges.push({ label: 'animating', tone: 'warning' });
            }
        } else if (WidgetClass.id === 'tooltip') {
            badges.push({ label: instance?.visible ? 'on' : 'off', tone: instance?.visible ? 'success' : 'muted' });
            badges.push({ label: 'send toast', tone: 'info' });
        } else if (WidgetClass.id === 'toast') {
            badges.push({ label: 'sending toast', tone: 'warning' });
            badges.push({ label: storyOptions?.position || 'top-right', tone: 'info' });
        } else {
            badges.push({ label: isDisabled ? 'disabled' : 'enabled', tone: isDisabled ? 'muted' : 'success' });
            if (isAnimated) {
                badges.push({ label: 'animating', tone: 'warning' });
            }
        }

        return badges;
    }

    getWidgetStateLabel(WidgetClass, instance, storyOptions) {
        const badges = this._getWidgetStateBadges(WidgetClass, instance, storyOptions);
        return badges.map((badge) => badge.label).join(' · ');
    }

    _appendStateBadges(container, badges) {
        if (!container || !Array.isArray(badges)) return;

        badges.forEach((badge) => {
            const el = this._el('span', {
                style: `
                    display:inline-flex;
                    align-items:center;
                    gap:4px;
                    padding:3px 8px;
                    border-radius:999px;
                    font-size:11px;
                    font-weight:600;
                    letter-spacing:0.02em;
                    background:${this._badgeBackground(badge.tone)};
                    color:${this._badgeColor(badge.tone)};
                    border:1px solid ${this._badgeBorder(badge.tone)};
                `
            });
            el.textContent = badge.label;
            container.appendChild(el);
        });
    }

    _badgeBackground(tone) {
        switch (tone) {
            case 'success': return 'rgba(16, 185, 129, 0.14)';
            case 'warning': return 'rgba(245, 158, 11, 0.16)';
            case 'info': return 'rgba(59, 130, 246, 0.14)';
            case 'muted': return 'rgba(148, 163, 184, 0.12)';
            default: return 'rgba(59, 130, 246, 0.14)';
        }
    }

    _badgeColor(tone) {
        switch (tone) {
            case 'success': return 'var(--color-success)';
            case 'warning': return '#fbbf24';
            case 'info': return 'var(--color-primary-500)';
            case 'muted': return 'var(--text-secondary)';
            default: return 'var(--text-primary)';
        }
    }

    _badgeBorder(tone) {
        switch (tone) {
            case 'success': return 'rgba(16, 185, 129, 0.35)';
            case 'warning': return 'rgba(245, 158, 11, 0.35)';
            case 'info': return 'rgba(59, 130, 246, 0.35)';
            case 'muted': return 'rgba(148, 163, 184, 0.30)';
            default: return 'rgba(59, 130, 246, 0.35)';
        }
    }

    _fallbackPreview(WidgetClass, options) {
        const el = this._el('div', {
            style: `
                padding: 6px 12px;
                background: var(--bg-tertiary);
                border: 1px dashed var(--border-medium);
                border-radius: var(--border-radius-md);
                font-size: 12px;
                color: var(--text-tertiary);
            `
        });
        el.textContent = `${WidgetClass.name} (no DOM output)`;
        return el;
    }

    // ── Stories Resolution ────────────────────────────────────────

    _getStories(WidgetClass) {
        if (typeof WidgetClass.stories === 'function') {
            try { return WidgetClass.stories(); } catch { /* fall through */ }
        }
        // Fallback: single Default story from getDefaultOptions
        const defaults = typeof WidgetClass.getDefaultOptions === 'function'
            ? WidgetClass.getDefaultOptions()
            : {};
        return { Default: defaults };
    }

    // ── Helpers ───────────────────────────────────────────────────

    _el(tag, attrs = {}) {
        const el = document.createElement(tag);
        Object.entries(attrs).forEach(([k, v]) => {
            if (k === 'style') el.style.cssText = v;
            else el.setAttribute(k, v);
        });
        return el;
    }
}
