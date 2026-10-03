// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ============================================================
// Particle Realms — Canonical Version Source
// ============================================================
// Import this module from anywhere in the engine or editor.
// The landing page (tests/index.html) also reads these values.
// ============================================================

export const ENGINE_VERSION  = '0.8.1';
export const EDITOR_VERSION  = '0.6.0';
export const PLAUNA_VERSION  = '0.2.0';
export const AGI_CORE_VERSION = '0.1.0';
export const BUILD_TAG       = 'alpha';

export const ENGINE_FULL = `v${ENGINE_VERSION}-${BUILD_TAG}`;
export const EDITOR_FULL = `v${EDITOR_VERSION}-${BUILD_TAG}`;
export const PLAUNA_FULL = `v${PLAUNA_VERSION}-${BUILD_TAG}`;
export const AGI_CORE_FULL = `v${AGI_CORE_VERSION}-${BUILD_TAG}`;

export const VERSION_BANNER  = `Particle Realms · Engine ${ENGINE_FULL} · Editor ${EDITOR_FULL} · Plauna ${PLAUNA_FULL} · AGI Core ${AGI_CORE_FULL}`;

// ============================================================
// Project Timeline
// ============================================================
export const ENGINE_STARTED  = '2025-11-17';   // first commit
export const EDITOR_STARTED  = '2025-12-03';   // first editor code

// ============================================================
// Codebase Stats  (update periodically)
// ============================================================
export const STATS = {
  engine: { files: 1136, lines: 445507 },
  editor: { files:  172, lines: 107035 },
  get totalFiles() { return this.engine.files + this.editor.files; },
  get totalLines() { return this.engine.lines + this.editor.lines; },
  subsystems: {
    'GPU Core':       { files:  55, category: 'core' },
    'Math Library':   { files:  34, category: 'core' },
    'ECS':            { files:  46, category: 'core' },
    'Particle Sim':   { files: 334, category: 'sim' },
    'Particle Render':{ files:  42, category: 'render' },
    'Rendering':      { files: 289, category: 'render' },
    'Shaders':        { files: 110, category: 'render' },
    'Physics':        { files:  50, category: 'sim' },
    'Audio':          { files:  62, category: 'core' },
    'AI':             { files:  43, category: 'sim' },
    'Voxel':          { files:  24, category: 'world' },
    'World':          { files:  48, category: 'world' },
  },
};
