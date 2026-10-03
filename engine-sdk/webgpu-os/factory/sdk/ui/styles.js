// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/styles.js — the shared component stylesheet.
 *
 * One injected stylesheet of `.fx-*` classes built entirely from design tokens.
 * This is the modern look every ported app inherits: rounded geometry, soft
 * elevation, accent gradients, focus rings, and smooth motion. Components in
 * controls.js / components.js attach these classes — no per-app CSS.
 */

import { ensureTokens } from './tokens.js';

const CSS = `
.fx-scope{font-family:var(--fx-font);font-size:var(--fx-text-md);color:var(--fx-text);
  font-weight:var(--fx-weight-normal);line-height:1.5;-webkit-font-smoothing:antialiased;}
.fx-scope *{box-sizing:border-box;}
.fx-scope ::selection{background:var(--fx-accent-soft);}

/* Scrollbars */
.fx-scope ::-webkit-scrollbar{width:10px;height:10px;}
.fx-scope ::-webkit-scrollbar-thumb{background:var(--fx-border-strong);border-radius:var(--fx-radius-pill);
  border:2px solid transparent;background-clip:content-box;}
.fx-scope ::-webkit-scrollbar-thumb:hover{background:var(--fx-text-faint);background-clip:content-box;}

/* Surfaces */
.fx-surface{background:var(--fx-bg-surface);border:1px solid var(--fx-border);border-radius:var(--fx-radius-lg);}
.fx-raised{background:var(--fx-bg-raised);border:1px solid var(--fx-border);border-radius:var(--fx-radius);
  box-shadow:var(--fx-shadow-sm);}
.fx-card,.fx-panel{color:var(--fx-text);background-color:var(--fx-bg-raised);
  background-image:var(--fx-panel-decoration,linear-gradient(145deg,color-mix(in srgb,var(--fx-accent) 5%,transparent),transparent 48%),
    linear-gradient(color-mix(in srgb,var(--fx-chrome-cool) 3%,transparent) 1px,transparent 1px),
    linear-gradient(90deg,color-mix(in srgb,var(--fx-chrome-cool) 3%,transparent) 1px,transparent 1px));
  background-size:auto,24px 24px,24px 24px;border:1px solid var(--fx-chrome-border);border-radius:var(--fx-radius-lg);
  box-shadow:var(--fx-shadow-sm),inset 0 1px 0 color-mix(in srgb,var(--fx-text) 4%,transparent);}
.fx-card{padding:var(--fx-space-4);}

/* Buttons */
.fx-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--fx-space-2);
  font:inherit;font-weight:var(--fx-weight-medium);font-size:var(--fx-text-md);
  padding:8px 14px;border-radius:var(--fx-radius);border:1px solid var(--fx-border);
  background:var(--fx-bg-input);color:var(--fx-text);cursor:pointer;user-select:none;
  transition:background var(--fx-dur-fast) var(--fx-ease),border-color var(--fx-dur-fast) var(--fx-ease),
    transform var(--fx-dur-fast) var(--fx-ease),box-shadow var(--fx-dur-fast) var(--fx-ease);}
.fx-btn:hover{background:var(--fx-bg-hover);border-color:var(--fx-border-strong);}
.fx-btn:active{background:var(--fx-bg-active);transform:translateY(1px);}
.fx-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--fx-accent-soft),0 0 0 1px var(--fx-accent);}
.fx-btn:disabled{opacity:0.45;cursor:not-allowed;}
.fx-btn--primary{background:var(--fx-accent-grad);color:var(--fx-text-on-accent);border-color:transparent;
  font-weight:var(--fx-weight-bold);box-shadow:var(--fx-shadow-sm);}
.fx-btn--primary:hover{filter:brightness(1.06);background:var(--fx-accent-grad);}
.fx-btn--ghost{background:transparent;border-color:transparent;}
.fx-btn--ghost:hover{background:var(--fx-bg-hover);}
.fx-btn--danger{color:var(--fx-danger);border-color:color-mix(in srgb,var(--fx-danger) 40%,transparent);}
.fx-btn--danger:hover{background:color-mix(in srgb,var(--fx-danger) 14%,transparent);}
.fx-btn--icon{padding:8px;width:34px;height:34px;border-radius:var(--fx-radius);}
.fx-btn--sm{padding:5px 10px;font-size:var(--fx-text-sm);}
.fx-btn--block{width:100%;}

/* Inputs */
.fx-input,.fx-select,.fx-textarea{font:inherit;font-size:var(--fx-text-md);color:var(--fx-text);
  background:var(--fx-bg-input);border:1px solid var(--fx-border);border-radius:var(--fx-radius);
  padding:8px 11px;width:100%;outline:none;transition:border-color var(--fx-dur-fast) var(--fx-ease),
    box-shadow var(--fx-dur-fast) var(--fx-ease),background var(--fx-dur-fast) var(--fx-ease);}
.fx-select{color-scheme:var(--os-color-scheme,dark);}
.fx-select option,.fx-select optgroup{background:var(--fx-bg-raised);color:var(--fx-text);}
.fx-select option:disabled{color:var(--fx-text-faint);}
.fx-menu-select{position:relative;display:flex;align-items:center;gap:8px;min-height:36px;padding-right:9px;cursor:pointer;user-select:none;}
.fx-menu-select__value{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fx-menu-select__chevron{flex:0 0 auto;color:var(--fx-text-muted);font-size:14px;line-height:1;}
.fx-menu-select__popup{position:absolute;z-index:100;top:calc(100% + 5px);left:0;min-width:100%;width:max-content;max-width:min(340px,calc(100vw - 24px));max-height:220px;overflow:auto;padding:5px;border:1px solid var(--fx-border-strong);border-radius:var(--fx-radius);background:var(--fx-bg-raised);color:var(--fx-text);box-shadow:var(--fx-shadow-lg);}
.fx-menu-select__popup[hidden]{display:none;}
.fx-menu-select--up .fx-menu-select__popup{top:auto;bottom:calc(100% + 5px);}
.fx-menu-select .fx-menu-select__popup[popover]{position:fixed;inset:auto;margin:0;}
.fx-menu-select__option{display:block;width:100%;min-height:31px;padding:6px 9px;border:0;border-radius:calc(var(--fx-radius) - 3px);background:transparent;color:var(--fx-text);font:inherit;text-align:left;white-space:nowrap;cursor:pointer;}
.fx-menu-select__option:hover,.fx-menu-select__option.active{background:var(--fx-bg-hover);}
.fx-menu-select__option[aria-selected="true"]{background:var(--fx-accent-soft);color:var(--fx-accent);font-weight:var(--fx-weight-bold);}
.fx-menu-select__option:disabled{color:var(--fx-text-faint);cursor:not-allowed;}
.fx-menu-select:focus-visible{border-color:var(--fx-accent);box-shadow:0 0 0 3px var(--fx-accent-soft);}
.fx-input::placeholder{color:var(--fx-text-faint);}
.fx-input:hover,.fx-select:hover,.fx-textarea:hover{border-color:var(--fx-border-strong);}
.fx-input:focus,.fx-select:focus,.fx-textarea:focus{border-color:var(--fx-accent);
  box-shadow:0 0 0 3px var(--fx-accent-soft);}
.fx-textarea{resize:vertical;min-height:80px;line-height:1.55;}

/* Toggle */
.fx-toggle{position:relative;width:40px;height:23px;border-radius:var(--fx-radius-pill);
  background:var(--fx-bg-active);border:1px solid var(--fx-border);cursor:pointer;flex:0 0 auto;
  transition:background var(--fx-dur) var(--fx-ease);}
.fx-toggle::after{content:'';position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;
  background:var(--fx-text);transition:transform var(--fx-dur) var(--fx-ease),background var(--fx-dur) var(--fx-ease);}
.fx-toggle[aria-checked="true"]{background:var(--fx-accent-grad);border-color:transparent;}
.fx-toggle[aria-checked="true"]::after{transform:translateX(17px);background:var(--fx-text-on-accent);}

/* Slider */
.fx-slider{-webkit-appearance:none;appearance:none;width:100%;height:5px;border-radius:var(--fx-radius-pill);
  background:var(--fx-bg-active);outline:none;cursor:pointer;}
.fx-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;
  background:var(--fx-accent);box-shadow:var(--fx-shadow-sm);cursor:pointer;transition:transform var(--fx-dur-fast);}
.fx-slider::-webkit-slider-thumb:hover{transform:scale(1.15);}

/* Accessible pane splitter */
.fx-splitter{position:relative;z-index:4;align-self:stretch;justify-self:stretch;min-width:0;min-height:0;
  background:transparent;outline:none;touch-action:none;user-select:none;-webkit-user-select:none;}
.fx-splitter::before{content:'';position:absolute;background:var(--fx-border-faint);border-radius:var(--fx-radius-pill);
  transition:background var(--fx-dur-fast) var(--fx-ease),box-shadow var(--fx-dur-fast) var(--fx-ease);}
.fx-splitter--vertical{width:100%;cursor:col-resize;}
.fx-splitter--vertical::before{top:0;bottom:0;left:50%;width:1px;transform:translateX(-50%);}
.fx-splitter--horizontal{height:100%;cursor:row-resize;}
.fx-splitter--horizontal::before{left:0;right:0;top:50%;height:1px;transform:translateY(-50%);}
.fx-splitter:hover::before,.fx-splitter--dragging::before{background:var(--fx-accent);box-shadow:0 0 0 1px var(--fx-accent-soft);}
.fx-splitter:focus-visible::before{background:var(--fx-accent);box-shadow:0 0 0 2px var(--fx-bg-app),0 0 0 4px var(--fx-accent);}

@media (forced-colors:active){
  .fx-splitter::before{background:CanvasText;}
  .fx-splitter:hover::before,.fx-splitter--dragging::before,.fx-splitter:focus-visible::before{background:Highlight;box-shadow:none;}
}

@media (prefers-reduced-motion:reduce){
  .fx-splitter::before{transition:none;}
}

/* Segmented control */
.fx-segmented{display:inline-flex;background:color-mix(in srgb,var(--fx-bg-input) 76%,var(--fx-bg-surface));border:1px solid var(--fx-chrome-border);
  border-radius:var(--fx-radius);padding:3px;gap:2px;}
.fx-segmented__item{padding:5px 12px;border-radius:calc(var(--fx-radius) - 3px);font-size:var(--fx-text-sm);
  font-weight:var(--fx-weight-medium);color:var(--fx-text-muted);cursor:pointer;border:none;background:transparent;
  transition:all var(--fx-dur-fast) var(--fx-ease);}
.fx-segmented__item:hover{color:var(--fx-text);}
.fx-segmented__item[aria-selected="true"],.fx-segmented__item[aria-checked="true"]{background:var(--fx-accent-grad);color:var(--fx-text-on-accent);
  font-weight:var(--fx-weight-bold);}

/* Elements */
.fx-label{font-size:var(--fx-text-sm);color:var(--fx-text-muted);font-weight:var(--fx-weight-medium);}
.fx-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:var(--fx-radius-pill);
  font-size:var(--fx-text-xs);font-weight:var(--fx-weight-bold);background:var(--fx-accent-soft);
  color:var(--fx-accent);text-transform:uppercase;letter-spacing:.04em;}
.fx-divider{height:1px;background:var(--fx-border-faint);border:none;margin:var(--fx-space-3) 0;}
.fx-icon{display:inline-flex;align-items:center;justify-content:center;line-height:1;}

/* Layout: app shell */
.fx-shell,.fx-workspace{color:var(--fx-text);background-color:var(--fx-bg-app);
  background-image:var(--fx-workspace-decoration,
    radial-gradient(ellipse at 8% -12%,color-mix(in srgb,var(--fx-accent) 20%,transparent),transparent 36rem),
    radial-gradient(ellipse at 95% 4%,color-mix(in srgb,var(--fx-accent-strong) 10%,transparent),transparent 30rem),
    radial-gradient(circle,color-mix(in srgb,var(--fx-chrome-cool) 9%,transparent) .6px,transparent 1px));
  background-size:auto,auto,48px 48px;}
.fx-shell{display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;overflow:hidden;}
.fx-toolbar,.fx-chrome-bar{color:var(--fx-text);background-color:var(--fx-bg-surface);
  background-image:linear-gradient(110deg,color-mix(in srgb,var(--fx-accent) 7%,transparent),transparent 70%);
  border-color:var(--fx-chrome-border);backdrop-filter:var(--fx-chrome-filter,blur(min(var(--os-blur,14px),14px)));
  -webkit-backdrop-filter:var(--fx-chrome-filter,blur(min(var(--os-blur,14px),14px)));}
.fx-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--fx-space-2);padding:var(--fx-space-2) var(--fx-space-3);
  border-bottom:1px solid var(--fx-chrome-border);flex:0 0 auto;min-height:44px;}
.fx-toolbar__spacer{flex:1;min-width:0;}
.fx-toolbar__title{font-weight:var(--fx-weight-bold);font-size:var(--fx-text-lg);letter-spacing:-.01em;overflow-wrap:anywhere;}
.fx-toolbar>.fx-icon{width:30px;height:30px;flex:0 0 auto;border-radius:var(--fx-radius);border:1px solid var(--fx-chrome-border);
  background:linear-gradient(140deg,var(--fx-accent-soft),color-mix(in srgb,var(--fx-chrome-cool) 7%,transparent));}
.fx-toolbar__brand{display:grid;gap:2px;min-width:0;line-height:1.2;}
.fx-toolbar__subtitle{color:var(--fx-text-muted);font-family:var(--fx-font-mono);font-size:var(--fx-text-xs);letter-spacing:.035em;}
.fx-body{flex:1;min-height:0;overflow:auto;padding:var(--fx-space-4);}
.fx-sidebar{flex:0 0 auto;width:220px;background:var(--fx-bg-surface);border-right:1px solid var(--fx-border);
  overflow:auto;padding:var(--fx-space-2);}
.fx-statusbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--fx-space-3);padding:5px var(--fx-space-3);
  background:var(--fx-bg-surface);border-top:1px solid var(--fx-chrome-border);font-size:var(--fx-text-xs);font-family:var(--fx-font-mono);
  color:var(--fx-text-muted);flex:0 0 auto;min-height:28px;}
.fx-row{display:flex;align-items:center;gap:var(--fx-space-2);}
.fx-col{display:flex;flex-direction:column;gap:var(--fx-space-2);}

/* Shared page hierarchy and explicit states, usable without the app-shell layout. */
.fx-section-header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 20px;margin-bottom:var(--fx-space-3);min-width:0;}
.fx-section-header__copy{flex:1 1 220px;min-width:0;}
.fx-section-header__eyebrow{font:var(--fx-weight-bold) var(--fx-text-xs)/1.4 var(--fx-font-mono);color:var(--fx-chrome-ink);letter-spacing:.08em;text-transform:uppercase;}
.fx-section-header__title{margin:3px 0 0;font-size:var(--fx-text-xl);line-height:1.2;letter-spacing:-.025em;overflow-wrap:anywhere;}
.fx-section-header__description{margin:5px 0 0;max-width:720px;color:var(--fx-text-muted);font-size:var(--fx-text-sm);line-height:1.5;}
.fx-section-header__meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:100%;min-width:0;}
.fx-status-badge{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 8px;border:1px solid var(--fx-border);
  border-radius:var(--fx-radius-pill);background:var(--fx-bg-input);color:var(--fx-text-muted);font-family:var(--fx-font-mono);
  font-size:var(--fx-text-xs);line-height:1.3;vertical-align:middle;overflow-wrap:anywhere;}
.fx-status-badge__label{font-weight:var(--fx-weight-medium);}
.fx-status-badge__state{font-weight:var(--fx-weight-bold);}
.fx-status-badge[data-state="available"]{color:var(--fx-success-ink);border-color:color-mix(in srgb,var(--fx-success) 32%,var(--fx-border));background:color-mix(in srgb,var(--fx-success) 7%,var(--fx-bg-raised));}
.fx-status-badge[data-state="disabled"],.fx-status-badge[data-state="missing"]{color:var(--fx-warning-ink);border-color:color-mix(in srgb,var(--fx-warning) 32%,var(--fx-border));}
.fx-status-badge[data-state="denied"],.fx-status-badge[data-state="error"]{color:var(--fx-danger-ink);border-color:color-mix(in srgb,var(--fx-danger) 32%,var(--fx-border));}

/* Shared compute diagnostics: compact readiness and one searchable catalog. */
.fx-compute-status{display:grid;gap:14px;min-width:0;container-type:inline-size;}
.fx-compute-status>.fx-section-header{margin:0;}
.fx-compute-backends{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start;}
.fx-compute-backend{display:grid;gap:9px;min-width:0;padding:13px;}
.fx-compute-backend__heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;}
.fx-compute-backend__heading h3{margin:0;min-width:0;font-size:var(--fx-text-sm);line-height:1.4;overflow-wrap:anywhere;}
.fx-compute-backend__heading>.fx-status-badge{flex:0 0 auto;}
.fx-compute-backend__actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:5px 8px;}
.fx-compute-backend__actions>.fx-btn{max-width:100%;white-space:normal;text-align:left;}
.fx-compute-count{color:var(--fx-text-muted);font:var(--fx-text-xs)/1.5 var(--fx-font-mono);}
.fx-compute-note{margin:0;color:var(--fx-text-muted);font-size:var(--fx-text-sm);line-height:1.5;overflow-wrap:anywhere;}
.fx-compute-facts{display:flex;flex-wrap:wrap;gap:6px;align-items:start;}
.fx-compute-facts>.fx-status-badge{font-size:var(--fx-text-xs);}
.fx-compute-context{margin:0;padding:9px 12px;border-left:3px solid var(--fx-chrome-border);background:var(--fx-accent-soft);
  border-radius:var(--fx-radius-sm);color:var(--fx-text-muted);font-size:var(--fx-text-sm);line-height:1.5;}
.fx-compute-facts-detail{border-top:1px solid var(--fx-border);padding-top:8px;min-width:0;font-size:var(--fx-text-xs);}
.fx-compute-facts-detail>summary{color:var(--fx-text-muted);cursor:pointer;padding:2px 0;overflow-wrap:anywhere;}
.fx-compute-facts-detail[open]>.fx-compute-facts{margin-top:10px;}
.fx-compute-facts-detail>summary:focus-visible,.fx-compute-operation>summary:focus-visible{outline:2px solid var(--fx-accent);outline-offset:3px;border-radius:2px;}
.fx-compute-catalog{padding:16px;min-width:0;}
.fx-compute-catalog__heading{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:5px 12px;margin-bottom:12px;}
.fx-compute-catalog__heading h3{margin:0;font-size:var(--fx-text-md);}
.fx-compute-catalog__tools{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,210px) auto;align-items:center;gap:8px;}
.fx-compute-catalog__tools>.fx-input,.fx-compute-catalog__tools>.fx-select{width:100%;min-width:0;}
.fx-compute-catalog__hint{margin:10px 0 14px;font-size:var(--fx-text-xs);}
.fx-compute-catalog__list{min-width:0;}
.fx-compute-catalog__empty{margin:16px 0 0;padding:18px;border:1px dashed var(--fx-border);border-radius:var(--fx-radius);
  color:var(--fx-text-muted);font-size:var(--fx-text-sm);line-height:1.6;}
.fx-compute-operation{border-top:1px solid var(--fx-border);min-width:0;}
.fx-compute-operation[hidden],.fx-compute-catalog__empty[hidden]{display:none;}
.fx-compute-operation>summary{display:grid;grid-template-columns:14px minmax(0,1.1fr) minmax(0,1fr) auto;align-items:center;gap:8px 12px;
  min-height:60px;padding:10px 2px;list-style:none;cursor:pointer;}
.fx-compute-operation>summary::-webkit-details-marker{display:none;}
.fx-compute-operation>summary::before{content:'\u203a';font-size:18px;color:var(--fx-text-muted);text-align:center;}
.fx-compute-operation[open]>summary::before{content:'\u2304';}
.fx-compute-operation>summary:hover{background:var(--fx-bg-hover);}
.fx-compute-operation__name{display:grid;gap:3px;min-width:0;overflow-wrap:anywhere;}
.fx-compute-operation__name>strong{font-size:var(--fx-text-sm);font-weight:var(--fx-weight-medium);}
.fx-compute-operation__name>span,.fx-compute-operation__coverage{color:var(--fx-text-muted);font-size:var(--fx-text-xs);line-height:1.5;overflow-wrap:anywhere;}
.fx-compute-precision{font-family:var(--fx-font-mono);font-size:var(--fx-text-xs);color:var(--fx-text-muted);}
.fx-compute-operation .fx-compute-precision{overflow-wrap:anywhere;max-width:100px;}
.fx-compute-contract{padding:4px 14px 16px 28px;min-width:0;}
.fx-compute-contract__fields{display:grid;grid-template-columns:minmax(90px,.3fr) minmax(0,1fr);gap:6px 16px;margin:0 0 12px;font-size:var(--fx-text-xs);line-height:1.5;}
.fx-compute-contract__fields>dt{color:var(--fx-text-muted);overflow-wrap:anywhere;}
.fx-compute-contract__fields>dd{margin:0;overflow-wrap:anywhere;}
.fx-compute-contract h4{margin:12px 0 6px;font-size:var(--fx-text-xs);font-weight:var(--fx-weight-medium);}
.fx-compute-contract__json{margin:0;padding:10px;border-radius:var(--fx-radius-sm);background:var(--fx-bg-input);color:var(--fx-text-muted);
  font:var(--fx-text-xs)/1.5 var(--fx-font-mono);white-space:pre-wrap;overflow-wrap:anywhere;}
.fx-compute-error{margin:0;color:var(--fx-danger-ink);font-size:var(--fx-text-sm);overflow-wrap:anywhere;}
.fx-compute-footnote{font-size:var(--fx-text-xs);}
.fx-compute-status--compact{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:var(--fx-text-sm);}
@container (max-width:1050px){.fx-compute-backends{grid-template-columns:repeat(2,minmax(0,1fr));}}
@container (max-width:650px){
  .fx-compute-backends{grid-template-columns:minmax(0,1fr);}
  .fx-compute-catalog{padding:12px;}
  .fx-compute-catalog__tools{grid-template-columns:minmax(0,1fr) auto;}
  .fx-compute-catalog__tools>.fx-input{grid-column:1 / -1;}
  .fx-compute-operation>summary{grid-template-columns:12px minmax(0,1fr) auto;gap:4px 8px;}
  .fx-compute-operation>summary::before{grid-row:1 / 3;}
  .fx-compute-operation__coverage{grid-column:2;grid-row:2;}
  .fx-compute-operation .fx-compute-precision{grid-column:3;grid-row:1 / 3;max-width:65px;}
  .fx-compute-contract{padding-left:20px;padding-right:0;}
}
@media (forced-colors:active){
  .fx-compute-context{background:Canvas;color:CanvasText;border-color:CanvasText;}
  .fx-compute-note,.fx-compute-precision,.fx-compute-error,.fx-compute-count,.fx-compute-operation__coverage,
  .fx-compute-operation__name>span,.fx-compute-facts-detail>summary,.fx-compute-contract__json{color:CanvasText;}
}

/* List */
.fx-list{display:flex;flex-direction:column;gap:2px;}
.fx-list__item{display:flex;align-items:center;gap:var(--fx-space-3);padding:9px var(--fx-space-3);
  border-radius:var(--fx-radius);cursor:pointer;color:var(--fx-text);transition:background var(--fx-dur-fast) var(--fx-ease);}
.fx-list__item:hover{background:var(--fx-bg-hover);}
.fx-list__item[aria-selected="true"]{background:var(--fx-accent-soft);color:var(--fx-accent);}

/* Field (label + control) */
.fx-field{display:flex;flex-direction:column;gap:6px;}
.fx-field--row{flex-direction:row;align-items:center;justify-content:space-between;}

/* Empty state */
.fx-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--fx-space-3);
  padding:var(--fx-space-8);color:var(--fx-text-faint);text-align:center;height:100%;}
.fx-empty__icon{font-size:42px;opacity:.5;}

@keyframes fx-fade-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
.fx-animate-in{animation:fx-fade-in var(--fx-dur) var(--fx-ease) both;}
@keyframes fx-spin{to{transform:rotate(360deg);}}

/* Arcade / game shell — full-bleed stage with toolbar + statusbar rails */
.fx-game{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-height:0;overflow:hidden;
  background:var(--fx-game-backdrop);color:var(--fx-text);}
.fx-game__stage{position:relative;min-height:0;overflow:auto;display:grid;place-items:center;
  padding:var(--fx-space-6);isolation:isolate;}
.fx-game__bg{position:absolute;inset:0;width:100%;height:100%;z-index:-2;}

/* LED readout (counters, timers, scores) */
.fx-led{display:inline-flex;align-items:center;justify-content:center;min-width:54px;padding:3px 10px;
  border-radius:var(--fx-radius-sm);border:1px solid color-mix(in srgb,var(--fx-led-red) 30%,transparent);
  background:rgba(0,0,0,.55);color:var(--fx-led-red);font-family:var(--fx-font-led);font-weight:800;
  font-size:18px;letter-spacing:.1em;text-align:center;
  box-shadow:inset 0 0 12px rgba(0,0,0,.6),0 0 10px color-mix(in srgb,var(--fx-led-red) 28%,transparent);}
.fx-led--green{color:var(--fx-led-green);border-color:color-mix(in srgb,var(--fx-led-green) 32%,transparent);
  box-shadow:inset 0 0 12px rgba(0,0,0,.6),0 0 10px color-mix(in srgb,var(--fx-led-green) 26%,transparent);}
.fx-led--amber{color:var(--fx-led-amber);border-color:color-mix(in srgb,var(--fx-led-amber) 32%,transparent);
  box-shadow:inset 0 0 12px rgba(0,0,0,.6),0 0 10px color-mix(in srgb,var(--fx-led-amber) 26%,transparent);}

/* Centered result overlay (win/lose/pause panels over a game stage) */
.fx-overlay{position:absolute;inset:0;z-index:20;display:grid;place-items:center;
  background:color-mix(in srgb,var(--fx-bg-app) 62%,transparent);backdrop-filter:blur(6px);
  animation:fx-fade-in var(--fx-dur) var(--fx-ease) both;}
.fx-overlay[hidden]{display:none;}
.fx-overlay__card{display:flex;flex-direction:column;align-items:center;gap:var(--fx-space-3);text-align:center;
  padding:var(--fx-space-6) var(--fx-space-8);border-radius:var(--fx-radius-xl);max-width:340px;
  background:var(--fx-bg-surface);border:1px solid var(--fx-border);box-shadow:var(--fx-shadow-lg);}
.fx-overlay__title{font-size:var(--fx-text-2xl);font-weight:var(--fx-weight-bold);}
.fx-overlay__detail{color:var(--fx-text-muted);font-size:var(--fx-text-md);}
.fx-overlay--win .fx-overlay__title{color:var(--fx-led-green);}
.fx-overlay--lose .fx-overlay__title{color:var(--fx-danger);}

/* Decoration never overrides accessibility or the active OS appearance. */
.theme-reduce-transparency{--fx-workspace-decoration:none;--fx-panel-decoration:none;--fx-chrome-filter:none;}
:host-context(.theme-reduce-transparency){--fx-workspace-decoration:none;--fx-panel-decoration:none;--fx-chrome-filter:none;}
@media (prefers-reduced-transparency:reduce){
  .fx-scope{--fx-workspace-decoration:none;--fx-panel-decoration:none;--fx-chrome-filter:none;}
}
@media (prefers-reduced-motion:reduce){
  .fx-scope,.fx-scope *,.fx-scope *::before,.fx-scope *::after{
    animation-duration:.001ms!important;animation-iteration-count:1!important;transition:none!important;}
}
@media (forced-colors:active){
  .fx-shell,.fx-workspace,.fx-card,.fx-panel,.fx-toolbar,.fx-chrome-bar,.fx-statusbar,.fx-status-badge,.fx-toolbar>.fx-icon{
    color:CanvasText;background:Canvas;border-color:CanvasText;background-image:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;}
  .fx-section-header__eyebrow,.fx-section-header__description,.fx-toolbar__subtitle{color:CanvasText;}
  .fx-status-badge[data-state]{color:CanvasText;background:Canvas;border-color:CanvasText;}
  .fx-segmented__item[aria-selected="true"],.fx-segmented__item[aria-checked="true"]{background:Highlight;color:HighlightText;}
}
`;

/**
 * Inject tokens + the component stylesheet into a root (document or a ShadowRoot).
 * Pass a ShadowRoot to style content mounted inside shadow DOM (e.g. apps embedded
 * by Control Panel). Idempotent by *presence* of the style tag — so it correctly
 * re-injects if the root was cleared (e.g. Control Panel rebuilds its shadow on
 * every render). Defaults to the document.
 */
export function ensureStyles(root) {
  if (typeof document === 'undefined') return;
  const r = root || document;
  ensureTokens(r);
  const target = (r.nodeType === 9 /* Document */) ? r.head : r; // ShadowRoot → itself
  if (!target || (target.querySelector && target.querySelector('#fx-ui-styles'))) return;
  const style = document.createElement('style');
  style.id = 'fx-ui-styles';
  style.textContent = CSS;
  target.appendChild(style);
}
