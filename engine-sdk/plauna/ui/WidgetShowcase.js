// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WidgetShowcase - Display system for widget examples and variants.
 *
 * Architecture:
 * - Renders individual widget examples with state variations
 * - Creates structured showcase sections with title, description, and variants
 * - Supports variant grids, state grids, size grids, and color grids
 * - Uses PlaunaTextService for internationalization
 * - Returns UINode trees for integration with Plauna rendering
 *
 * Showcase structure:
 * - Container: Card-like container with title and description
 * - Variants grid: Auto-fit grid for widget variants
 * - States grid: Grid for different widget states (hover, active, disabled)
 * - Size grid: Grid for different widget sizes
 * - Color grid: Grid for different color variants
 */

import { UINode } from '../core/UINode.js';
import { PlaunaTextService } from '../text/pretext-service.js';

/**
 * WidgetShowcase - Widget example renderer.
 *
 * Showcase pattern:
 * - Creates structured sections for widget documentation
 * - Renders variants, states, sizes, and colors in grids
 * - Returns UINode trees for Plauna rendering
 * - Supports optional interactive mode
 */
export class WidgetShowcase {
  constructor() {
    this.textService = new PlaunaTextService();
    this.showcases = new Map();
  }

  /**
   * Create a showcase section for a widget.
   *
   * Showcase creation pattern:
   * - Creates card-like container with title and description
   * - Renders variants in auto-fit grid if provided
   * - Renders states grid if provided (hover, active, disabled)
   * - Renders size grid if provided
   * - Renders color grid if provided
   * - Returns UINode tree for Plauna rendering
   *
   * @param {string} widgetName - Name of the widget
   * @param {Object} options - Configuration options
   * @param {string} [options.title] - Section title (defaults to widgetName)
   * @param {string} [options.description] - Section description
   * @param {Array} [options.variants] - Variant configurations
   * @param {Array} [options.states] - State configurations
   * @param {Array} [options.sizes] - Size configurations
   * @param {Array} [options.colors] - Color configurations
   * @param {boolean} [options.interactive] - Enable interactive mode
   * @returns {UINode} Showcase container
   */
  createShowcase(widgetName, options = {}) {
    const {
      title = widgetName,
      description = '',
      variants = [],
      states = ['default'],
      sizes = [],
      colors = [],
      interactive = false
    } = options;

    const container = new UINode('showcase-container');
    container.setStyles({
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-lg)',
      padding: 'var(--spacing-lg)',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--border-radius-lg)',
      marginBottom: 'var(--spacing-xl)'
    });

    // Title
    const titleNode = new UINode('showcase-title');
    titleNode.setStyles({
      fontSize: 'var(--font-size-lg)',
      fontWeight: 'var(--font-weight-semibold)',
      color: 'var(--text-primary)',
      margin: '0'
    });
    titleNode.textContent = title;
    container.appendChild(titleNode);

    // Description
    if (description) {
      const descNode = new UINode('showcase-description');
      descNode.setStyles({
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-secondary)',
        margin: '0',
        marginTop: 'var(--spacing-sm)'
      });
      descNode.textContent = description;
      container.appendChild(descNode);
    }

    // Variants grid
    if (variants.length > 0) {
      const variantsContainer = new UINode('showcase-variants');
      variantsContainer.setStyles({
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 'var(--spacing-md)',
        marginTop: 'var(--spacing-md)'
      });

      variants.forEach((variant, index) => {
        const variantNode = this.createVariantCard(variant, index);
        variantsContainer.appendChild(variantNode);
      });

      container.appendChild(variantsContainer);
    }

    // States grid
    if (states.length > 0) {
      const statesLabel = new UINode('showcase-states-label');
      statesLabel.setStyles({
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--text-secondary)',
        marginTop: 'var(--spacing-lg)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      });
      statesLabel.textContent = 'States';
      container.appendChild(statesLabel);

      const statesContainer = new UINode('showcase-states');
      statesContainer.setStyles({
        display: 'flex',
        gap: 'var(--spacing-md)',
        flexWrap: 'wrap',
        marginTop: 'var(--spacing-sm)'
      });

      states.forEach((state, index) => {
        const stateNode = this.createStateCard(state, index);
        statesContainer.appendChild(stateNode);
      });

      container.appendChild(statesContainer);
    }

    // Sizes grid
    if (sizes.length > 0) {
      const sizesLabel = new UINode('showcase-sizes-label');
      sizesLabel.setStyles({
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--text-secondary)',
        marginTop: 'var(--spacing-lg)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      });
      sizesLabel.textContent = 'Sizes';
      container.appendChild(sizesLabel);

      const sizesContainer = new UINode('showcase-sizes');
      sizesContainer.setStyles({
        display: 'flex',
        gap: 'var(--spacing-md)',
        flexWrap: 'wrap',
        marginTop: 'var(--spacing-sm)',
        alignItems: 'center'
      });

      sizes.forEach((size, index) => {
        const sizeNode = this.createSizeCard(size, index);
        sizesContainer.appendChild(sizeNode);
      });

      container.appendChild(sizesContainer);
    }

    // Colors grid
    if (colors.length > 0) {
      const colorsLabel = new UINode('showcase-colors-label');
      colorsLabel.setStyles({
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--text-secondary)',
        marginTop: 'var(--spacing-lg)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      });
      colorsLabel.textContent = 'Colors';
      container.appendChild(colorsLabel);

      const colorsContainer = new UINode('showcase-colors');
      colorsContainer.setStyles({
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 'var(--spacing-md)',
        marginTop: 'var(--spacing-sm)'
      });

      colors.forEach((color, index) => {
        const colorNode = this.createColorCard(color, index);
        colorsContainer.appendChild(colorNode);
      });

      container.appendChild(colorsContainer);
    }

    this.showcases.set(widgetName, container);
    return container;
  }

  /**
   * Create a variant card
   * @private
   */
  createVariantCard(variant, index) {
    const card = new UINode(`variant-${index}`);
    card.setStyles({
      padding: 'var(--spacing-md)',
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--border-radius-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-sm)',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100px'
    });

    const label = new UINode(`variant-label-${index}`);
    label.setStyles({
      fontSize: 'var(--font-size-xs)',
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    });
    label.textContent = variant.label || `Variant ${index + 1}`;
    card.appendChild(label);

    if (variant.preview) {
      const preview = new UINode(`variant-preview-${index}`);
      preview.setStyles({
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-primary)'
      });
      preview.textContent = variant.preview;
      card.appendChild(preview);
    }

    return card;
  }

  /**
   * Create a state card
   * @private
   */
  createStateCard(state, index) {
    const card = new UINode(`state-${index}`);
    card.setStyles({
      padding: 'var(--spacing-sm) var(--spacing-md)',
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--border-radius-md)',
      fontSize: 'var(--font-size-xs)',
      color: 'var(--text-primary)',
      textTransform: 'capitalize',
      minWidth: '80px',
      textAlign: 'center'
    });

    card.textContent = state;
    return card;
  }

  /**
   * Create a size card
   * @private
   */
  createSizeCard(size, index) {
    const card = new UINode(`size-${index}`);
    card.setStyles({
      padding: 'var(--spacing-sm) var(--spacing-md)',
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--border-radius-md)',
      fontSize: 'var(--font-size-xs)',
      color: 'var(--text-primary)',
      textTransform: 'uppercase',
      minWidth: '60px',
      textAlign: 'center'
    });

    card.textContent = size;
    return card;
  }

  /**
   * Create a color card
   * @private
   */
  createColorCard(color, index) {
    const card = new UINode(`color-${index}`);
    card.setStyles({
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-sm)',
      alignItems: 'center'
    });

    const swatch = new UINode(`color-swatch-${index}`);
    swatch.setStyles({
      width: '100%',
      height: '60px',
      background: `var(--color-${color})`,
      borderRadius: 'var(--border-radius-md)',
      border: '1px solid var(--border-light)'
    });
    card.appendChild(swatch);

    const label = new UINode(`color-label-${index}`);
    label.setStyles({
      fontSize: 'var(--font-size-xs)',
      color: 'var(--text-secondary)',
      textTransform: 'capitalize'
    });
    label.textContent = color;
    card.appendChild(label);

    return card;
  }

  /**
   * Get showcase by widget name
   * @param {string} widgetName
   * @returns {UINode|null}
   */
  getShowcase(widgetName) {
    return this.showcases.get(widgetName) || null;
  }

  /**
   * Get all showcases
   * @returns {Map}
   */
  getAllShowcases() {
    return this.showcases;
  }

  /**
   * Clear all showcases
   */
  clear() {
    this.showcases.clear();
  }
}

// Export singleton instance
export const widgetShowcase = new WidgetShowcase();
