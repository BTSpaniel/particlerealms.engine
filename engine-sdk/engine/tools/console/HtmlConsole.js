// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const CONSOLE_REDACTED_KEY = /(?:^|-)(?:authorization|cookies?|credentials?|password|passwd|secret|session-key|api-key|access-token|refresh-token|token)$/;

function isSensitiveConsoleKey(key) {
  const normalized = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
  return CONSOLE_REDACTED_KEY.test(normalized);
}

function boundedConsoleString(value, limit) {
  const text = String(value);
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}... [${text.length - limit} chars omitted]`;
}

function safeConsoleType(value) {
  try {
    if (Array.isArray(value)) return "Array";
  } catch { /* revoked or hostile proxies are represented generically */ }
  return typeof value === "object" ? "Object" : typeof value;
}

function projectConsoleValue(value, state, depth, key = "") {
  if (isSensitiveConsoleKey(key)) return "[redacted]";
  if (value === null) return null;
  if (value === undefined) return "undefined";
  if (typeof value === "string") return boundedConsoleString(value, state.maxStringLength);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (depth >= state.maxDepth) return `[${safeConsoleType(value)} depth limit]`;
  if (state.seen.has(value)) return "[Circular]";
  state.seen.add(value);

  if (value instanceof Error) {
    return {
      name: boundedConsoleString(value.name || "Error", 128),
      message: boundedConsoleString(value.message || "", state.maxStringLength),
      ...(typeof value.code === "string" ? { code: boundedConsoleString(value.code, 128) } : {}),
      ...(typeof value.stack === "string" ? { stack: "[omitted; use the sanitized JavaScript fault projection]" } : {}),
    };
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort((left, right) => left.localeCompare(right));
  const selected = keys.slice(0, state.maxEntries);
  const projected = Array.isArray(value) ? [] : {};
  for (const childKey of selected) {
    const descriptor = descriptors[childKey];
    const child = Object.prototype.hasOwnProperty.call(descriptor, "value")
      ? projectConsoleValue(descriptor.value, state, depth + 1, childKey)
      : "[Accessor]";
    if (Array.isArray(projected) && /^\d+$/.test(childKey)) projected[Number(childKey)] = child;
    else projected[childKey] = child;
  }
  if (keys.length > selected.length) {
    projected[Array.isArray(projected) ? selected.length : "__truncated__"] =
      `[${keys.length - selected.length} entries omitted]`;
  }
  return projected;
}

/**
 * Render console-hook arguments without invoking getters or leaking common
 * credential fields. Output is deliberately bounded so one diagnostic object
 * cannot freeze the in-OS console or flood a durable log.
 */
export function formatConsoleHookArguments(args, options = {}) {
  const state = {
    seen: new WeakSet(),
    maxDepth: Math.max(1, Math.min(8, Math.floor(Number(options.maxDepth) || 4))),
    maxEntries: Math.max(1, Math.min(128, Math.floor(Number(options.maxEntries) || 32))),
    maxStringLength: Math.max(64, Math.min(8_192, Math.floor(Number(options.maxStringLength) || 1_024))),
  };
  const maxTotalLength = Math.max(256, Math.min(65_536, Math.floor(Number(options.maxTotalLength) || 8_192)));
  const rendered = Array.from(args ?? [], value => {
    if (typeof value === "string") return boundedConsoleString(value, state.maxStringLength);
    try {
      return JSON.stringify(projectConsoleValue(value, state, 0));
    } catch {
      return `[Unserializable ${safeConsoleType(value)}]`;
    }
  }).join(" ");
  return rendered.length <= maxTotalLength
    ? rendered
    : `${rendered.slice(0, maxTotalLength)}... [${rendered.length - maxTotalLength} chars omitted]`;
}

export function createHtmlConsole(options = {}) {
  if (typeof document === "undefined") {
    throw new Error("HtmlConsole requires a DOM environment (document is undefined)");
  }

  const maxLines =
    typeof options.maxLines === "number" && options.maxLines > 0
      ? Math.floor(options.maxLines)
      : 200;
  const mirrorToConsole = options.mirrorToConsole !== false;
  const consoleHookFilter =
    typeof options.consoleHookFilter === "function"
      ? options.consoleHookFilter
      : null;
  const tag = options.tag || "";
  const appearance = options.appearance || {};

  let element = null;
  let wrapper = null;
  let toggleBtn = null;
  let isCollapsed = options.startCollapsed !== false;
  const expandedMaxHeight = options.maxHeight || "20vh";
  const handleHeight = options.handleHeight || 24;
  const toggleBackground = appearance.toggleBackground || "rgba(2, 6, 23, 0.95)";
  const toggleTextColor = appearance.toggleTextColor || "#94a3b8";
  const toggleBorderColor = appearance.toggleBorderColor || "#1f2937";
  const toggleHoverColor = appearance.toggleHoverColor || "#38bdf8";
  const consoleBackground = appearance.consoleBackground || "rgba(2, 6, 23, 0.95)";
  const consoleTextColor = appearance.consoleTextColor || "#e5e7eb";
  const consoleBorderColor = appearance.consoleBorderColor || "#1f2937";
  const fontFamily = appearance.fontFamily || "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  const fontSize = appearance.fontSize || "11px";
  const lineHeight = appearance.lineHeight || "1.4";
  const backdropFilter = appearance.backdropFilter || "blur(10px)";
  const hoverBackground = appearance.hoverBackground || "rgba(56, 189, 248, 0.1)";
  const timestampColor = appearance.timestampColor || "#6b7280";
  const infoColor = appearance.infoColor || "#38bdf8";
  const warnColor = appearance.warnColor || "#f59e0b";
  const errorColor = appearance.errorColor || "#ef4444";
  const debugColor = appearance.debugColor || "#10b981";
  const dataBackground = appearance.dataBackground || "rgba(15, 23, 42, 0.8)";
  const dataBorderColor = appearance.dataBorderColor || infoColor;
  const dataTextColor = appearance.dataTextColor || "#d1d5db";
  const scrollbarTrackColor = appearance.scrollbarTrackColor || "rgba(2, 6, 23, 0.5)";
  const scrollbarThumbColor = appearance.scrollbarThumbColor || "#374151";
  const scrollbarThumbHoverColor = appearance.scrollbarThumbHoverColor || toggleHoverColor;
  const panelPadding = appearance.panelPadding || "8px 12px";
  const collapsedPadding = appearance.collapsedPadding || "0 12px";
  const transitionDuration = appearance.transitionDuration || "0.32s";
  const transitionEasing = appearance.transitionEasing || "cubic-bezier(0.22, 1, 0.36, 1)";
  const fadeSize = appearance.fadeSize || "32px";
  const fadeOverlayColor = appearance.fadeOverlayColor || consoleBackground;
  const panelRadius = appearance.panelRadius || "0px";

  function applySheetState() {
    if (!element) {
      return;
    }

    if (wrapper) {
      wrapper.style.transform = isCollapsed
        ? "translateY(100%)"
        : "translateY(0)";
    }

    element.style.opacity = isCollapsed ? "0" : "1";
    element.style.pointerEvents = isCollapsed ? "none" : "auto";
    element.style.maxHeight = expandedMaxHeight;
    element.style.padding = panelPadding;
    element.style.borderRadius = panelRadius;
    element.style.transform = isCollapsed ? "translateY(8px)" : "translateY(0)";

    if (toggleBtn) {
      toggleBtn.innerHTML = isCollapsed ? "▲ Console" : "▼ Console";
    }
  }

  if (options.element && options.element.nodeType === 1) {
    element = options.element;
  } else if (options.selector && typeof options.selector === "string") {
    element = document.querySelector(options.selector) || null;
  }

  if (!element) {
    // Create wrapper for toggle button + console
    wrapper = document.createElement("div");
    wrapper.id = (options.id || "engine-console") + "-wrapper";
    wrapper.style.position = "fixed";
    wrapper.style.left = "0";
    wrapper.style.right = "0";
    wrapper.style.bottom = "0";
    wrapper.style.zIndex = "9999";
    wrapper.style.overflow = "visible";
    wrapper.style.transition = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
    wrapper.style.willChange = "transform";
    
    // Create toggle button
    toggleBtn = document.createElement("button");
    toggleBtn.id = (options.id || "engine-console") + "-toggle";
    toggleBtn.innerHTML = isCollapsed ? "▲ Console" : "▼ Console";
    toggleBtn.style.cssText = `
      position: absolute;
      top: -${handleHeight}px;
      left: 50%;
      transform: translateX(-50%);
      background: ${toggleBackground};
      color: ${toggleTextColor};
      border: 1px solid ${toggleBorderColor};
      border-bottom: none;
      border-radius: 6px 6px 0 0;
      padding: 4px 16px;
      font-size: ${fontSize};
      font-family: inherit;
      cursor: pointer;
      transition: all ${transitionDuration} ${transitionEasing};
    `;
    toggleBtn.onmouseenter = () => toggleBtn.style.color = toggleHoverColor;
    toggleBtn.onmouseleave = () => toggleBtn.style.color = toggleTextColor;
    
    element = document.createElement("div");
    element.id = options.id || "engine-console";
    
    // Professional styling - smaller default height
    element.style.position = "relative";
    element.style.maxHeight = expandedMaxHeight;
    element.style.overflowY = "auto";
    element.style.fontFamily = fontFamily;
    element.style.fontSize = fontSize;
    element.style.lineHeight = lineHeight;
    element.style.background = consoleBackground;
    element.style.color = consoleTextColor;
    element.style.padding = panelPadding;
    element.style.boxSizing = "border-box";
    element.style.borderTop = `1px solid ${consoleBorderColor}`;
    element.style.backdropFilter = backdropFilter;
    element.style.transition = `opacity ${transitionDuration} ${transitionEasing}, transform ${transitionDuration} ${transitionEasing}`;
    element.style.opacity = "1";
    element.style.borderRadius = panelRadius;
    
    toggleBtn.onclick = () => {
      isCollapsed = !isCollapsed;
      applySheetState();
    };
    
    // Custom scrollbar
    const style = document.createElement("style");
    style.textContent = `
      #${element.id}::-webkit-scrollbar {
        width: 6px;
      }
      #${element.id}::-webkit-scrollbar-track {
        background: ${scrollbarTrackColor};
      }
      #${element.id}::-webkit-scrollbar-thumb {
        background: ${scrollbarThumbColor};
        border-radius: 3px;
      }
      #${element.id}::-webkit-scrollbar-thumb:hover {
        background: ${scrollbarThumbHoverColor};
      }
      #${element.id} .log-entry {
        margin: 1px 0;
        padding: 2px 6px;
        border-radius: 2px;
        transition: background-color 0.2s;
      }
      #${element.id} .log-entry:hover {
        background-color: ${hoverBackground};
      }
      #${element.id} .timestamp {
        color: ${timestampColor};
        font-weight: 500;
        margin-right: 6px;
      }
      #${element.id} .log-error {
        color: ${errorColor};
        font-weight: 600;
      }
      #${element.id} .log-warn {
        color: ${warnColor};
        font-weight: 600;
      }
      #${element.id} .log-info {
        color: ${infoColor};
        font-weight: 500;
      }
      #${element.id} .log-debug {
        color: ${debugColor};
        font-weight: 500;
      }
      #${element.id} .log-data {
        margin-top: 2px;
        margin-left: 10px;
        padding: 4px 6px;
        background-color: ${dataBackground};
        border-left: 2px solid ${dataBorderColor};
        border-radius: 2px;
        color: ${dataTextColor};
        font-size: 10px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${element.id}::after {
        content: "";
        position: sticky;
        display: block;
        left: 0;
        right: 0;
        bottom: 0;
        height: ${fadeSize};
        margin-top: calc(${fadeSize} * -1);
        background: linear-gradient(to bottom, rgba(0, 0, 0, 0), ${fadeOverlayColor});
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
    
    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(element);
    document.body.appendChild(wrapper);
    applySheetState();
  }

  const entries = [];

  // Separately bounded support-bundle records. These contain only projected
  // strings, never live objects, accessors, Error stacks, or console arguments.
  const diagnosticRecords = [];
  const snapshots = [];
  let originalConsole = null;

  const levelStyles = {
    ERROR: { color: "#ef4444" },    // Red
    WARN: { color: "#f59e0b" },     // Amber
    INFO: { color: "#38bdf8" },     // Cyan
    DEBUG: { color: "#10b981" },    // Green
  };

  function formatTimestamp(date) {
    return date.toISOString().slice(11, 23);
  }

  function push(level, message, data, { mirror = true } = {}) {
    const now = new Date();
    const timestamp = formatTimestamp(now);
    const levelKey = level || "INFO";
    const tagPrefix = tag ? `[${tag}] ` : "";
    const projectedMessage = formatConsoleHookArguments([message], {
      maxDepth: 2,
      maxEntries: 16,
      maxStringLength: 1_024,
      maxTotalLength: 2_048,
    });
    const projectedData = data === undefined || data === null
      ? ""
      : formatConsoleHookArguments([data], {
        maxDepth: 3,
        maxEntries: 24,
        maxStringLength: 1_024,
        maxTotalLength: 4_096,
      });

    const row = document.createElement("div");
    row.className = `log-entry log-${levelKey.toLowerCase()}`;

    const tsSpan = document.createElement("span");
    tsSpan.className = "timestamp";
    tsSpan.textContent = timestamp;

    const msgSpan = document.createElement("span");
    msgSpan.className = `log-${levelKey.toLowerCase()}`;
    msgSpan.textContent = `${tagPrefix}${projectedMessage}`;

    row.appendChild(tsSpan);
    row.appendChild(document.createTextNode(" "));
    row.appendChild(msgSpan);

    if (data !== undefined && data !== null) {
      const dataEl = document.createElement("div");
      dataEl.className = "log-data";
      dataEl.textContent =
        projectedData;
      row.appendChild(dataEl);
    }

    element.appendChild(row);
    entries.push(row);
    diagnosticRecords.push(Object.freeze({
      at: now.toISOString(),
      level: levelKey,
      tag: boundedConsoleString(tag, 96),
      message: projectedMessage,
      ...(projectedData ? { data: projectedData } : {}),
    }));

    if (entries.length > maxLines) {
      const oldest = entries.shift();
      if (oldest && oldest.parentNode === element) {
        element.removeChild(oldest);
      }
    }

    if (diagnosticRecords.length > maxLines) diagnosticRecords.shift();

    element.scrollTop = element.scrollHeight;

    if (mirrorToConsole && mirror) {
      const styleInfo = levelStyles[levelKey] || { color: "#ffffff" };
      const style = `color: ${styleInfo.color}; font-weight: bold;`;
      const formatted = `[${timestamp}] ${tagPrefix}${message}`;

      const baseConsole = originalConsole || console;
      let method;
      if (levelKey === "ERROR") {
        method = baseConsole.error || console.error;
      } else if (levelKey === "WARN") {
        method = baseConsole.warn || console.warn;
      } else if (levelKey === "DEBUG") {
        method = baseConsole.debug || baseConsole.log || console.debug || console.log;
      } else {
        method = baseConsole.log || console.log;
      }

      if (data !== undefined && data !== null) {
        method.call(console, `%c${formatted}`, style, data);
      } else {
        method.call(console, `%c${formatted}`, style);
      }
    }
  }

  function info(message, data) {
    push("INFO", message, data);
  }

  function warn(message, data) {
    push("WARN", message, data);
  }

  function error(message, data) {
    push("ERROR", message, data);
  }

  function debug(message, data) {
    push("DEBUG", message, data);
  }

  function clear() {
    entries.length = 0;

    diagnosticRecords.length = 0;
    element.innerHTML = "";
    snapshots.length = 0;
  }

  function setVisible(visible) {
    isCollapsed = !visible;
    applySheetState();
  }

  // Structured snapshot API: store rich debug state without spamming UI.
  // Tests can call addSnapshot(tag, payload) once per logical event, then
  // call copySnapshots() when the user hits the Copy button in the UI.
  function addSnapshot(tag, payload) {
    const now = new Date();
    const timestamp = formatTimestamp(now);
    snapshots.push({
      timestamp,
      tag: boundedConsoleString(tag, 96),
      payload: formatConsoleHookArguments([payload], {
        maxDepth: 4,
        maxEntries: 32,
        maxStringLength: 1_024,
        maxTotalLength: 8_192,
      }),
    });

    if (snapshots.length > maxLines) snapshots.shift();
  }

  function copySnapshots() {
    const structured = {
      tag,
      generatedAt: new Date().toISOString(),
      snapshotCount: snapshots.length,
      snapshots,
    };
    try {
      return JSON.stringify(structured, null, 2);
    } catch (e) {
      return JSON.stringify({ error: "Failed to stringify snapshots", message: String(e) });
    }
  }

  function attachConsoleHooks() {
    if (typeof console === "undefined") {
      return () => {};
    }
    if (originalConsole) {
      // Already attached
      return () => {};
    }

    originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug,
    };

    console.log = (...args) => {
      if (originalConsole.log) {
        originalConsole.log.apply(console, args);
      }
      if (!shouldRecordConsoleHook("log", args)) return;
      push("DEBUG", formatConsoleHookArguments(args), null, { mirror: false });
    };

    console.error = (...args) => {
      if (originalConsole.error) {
        originalConsole.error.apply(console, args);
      }
      if (!shouldRecordConsoleHook("error", args)) return;
      push("ERROR", formatConsoleHookArguments(args), null, { mirror: false });
    };

    console.warn = (...args) => {
      if (originalConsole.warn) {
        originalConsole.warn.apply(console, args);
      }
      if (!shouldRecordConsoleHook("warn", args)) return;
      push("WARN", formatConsoleHookArguments(args), null, { mirror: false });
    };

    console.info = (...args) => {
      if (originalConsole.info) {
        originalConsole.info.apply(console, args);
      }
      if (!shouldRecordConsoleHook("info", args)) return;
      push("INFO", formatConsoleHookArguments(args), null, { mirror: false });
    };

    if (console.debug) {
      console.debug = (...args) => {
        if (originalConsole.debug) {
          originalConsole.debug.apply(console, args);
        }
        if (!shouldRecordConsoleHook("debug", args)) return;
        push("DEBUG", formatConsoleHookArguments(args), null, { mirror: false });
      };
    }

    return function detachConsoleHooks() {
      if (!originalConsole) {
        return;
      }
      console.log = originalConsole.log;
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
      console.info = originalConsole.info;
      if (originalConsole.debug) {
        console.debug = originalConsole.debug;
      }
      originalConsole = null;
    };
  }

  function shouldRecordConsoleHook(level, args) {

    if (!consoleHookFilter) return true;

    try {

      return consoleHookFilter(level, args) !== false;

    } catch {

      return true;

    }

  }

  function diagnosticTail(limit = 120) {
    const count = Math.max(0, Math.min(maxLines, Math.floor(Number(limit) || 0)));
    if (!count) return [];
    return diagnosticRecords.slice(-count).map(record => ({ ...record }));
  }



  return {
    element,
    wrapper,
    toggleButton: toggleBtn,
    info,
    debug,
    warn,
    error,
    clear,
    setVisible,
    addSnapshot,
    copySnapshots,

    diagnosticTail,
    attachConsoleHooks,
  };
}
