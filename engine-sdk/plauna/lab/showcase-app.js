// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ShowcaseApp - Thin shell that boots the Plauna engine and mounts WidgetGallery
 */

import { PlaunaDevShell } from '../boot.js';
import { Toast } from '../ui/ToastManager.js';
import { Notify } from '../notifications/NotificationSystem.js';
import { PlaunaSmartContextMenu } from '../ui/SmartContextMenu.js';
import { WidgetGallery } from '../ui/WidgetGallery.js';

export class ShowcaseApp {
  constructor(options = {}) {
    this.root = options.root || document.getElementById('root');
    this.statusElement = options.statusElement || null;
    this.logger = options.logger || null;
    this.shell = null;
    this.gallery = null;
    this.smartContextMenu = null;
    this._styleLinks = [];
  }

  async boot() {
    try {
      this._status('Booting Plauna engine...');

      this.shell = await PlaunaDevShell.boot(this.root, {
        logger: this.logger
      });

      this._status('Mounting widget gallery...');

      this._loadWidgetStyles();
      Toast.initialize({ position: 'top-right', maxToasts: 5, defaultDuration: 4000 });
      Notify.initialize({ enableToasts: true, enableConsole: true, enableSounds: false, minLevel: 'info' });

      this.gallery = new WidgetGallery(this.shell);
      this.gallery.mount(this.root);

      this.smartContextMenu = new PlaunaSmartContextMenu({
        app: this.shell,
        root: this.root,
        visualTree: null,
        domRenderer: this.shell.widgetRenderer,
        console: this.logger || console,
        radius: 140,
        maxNearby: 6,
        maxActions: 6,
        enabled: true
      });

      this._status(null);

    } catch (error) {
      if (this.logger) this.logger.error('Failed to boot:', error);
      this._status(`Error: ${error.message}`, true);
      throw error;
    }
  }

  _status(msg, isError = false) {
    const el = this.statusElement;
    if (!el) return;
    if (msg === null) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
      el.textContent = msg;
      if (isError) el.style.color = '#ef4444';
    }
  }

  _loadWidgetStyles() {
    if (typeof document === 'undefined') return;

    const styles = [
      '../widgets/Primitive/Button.css',
      '../widgets/Primitive/Tooltip.css',
      '../widgets/Primitive/Progress.css',
      '../widgets/Feedback/Toast.css'
    ];

    styles.forEach((relativePath) => {
      const href = new URL(relativePath, import.meta.url).href;
      if (document.querySelector(`link[data-plauna-style="${href}"]`)) {
        return;
      }

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.plaunaStyle = href;
      document.head.appendChild(link);
      this._styleLinks.push(link);
    });
  }

  destroy() {
    if (this.smartContextMenu) {
      this.smartContextMenu.destroy();
      this.smartContextMenu = null;
    }

    if (typeof Toast.dismissAll === 'function') {
      Toast.dismissAll();
    }

    if (this.root) this.root.innerHTML = '';
  }
}

export function mountShowcaseApp(options = {}) {
  return new ShowcaseApp(options);
}
