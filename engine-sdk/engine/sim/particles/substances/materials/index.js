// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * materials/index.js — Auto-registers all substance definitions with SubstanceRegistry.
 *
 * Import this file to ensure all built-in substances are registered.
 * Each substance folder exports a default object assembled from its sub-files.
 */

import { registerSubstance } from '../SubstanceRegistry.js';

// Core substances (15)
import water from './water/index.js';
import lava from './lava/index.js';
import fire from './fire/index.js';
import smoke from './smoke/index.js';
import ice from './ice/index.js';
import metal from './metal/index.js';
import plasma from './plasma/index.js';
import oil from './oil/index.js';
import glass from './glass/index.js';
import stone from './stone/index.js';
import wax from './wax/index.js';
import wood from './wood/index.js';
import steam from './steam/index.js';
import sparks from './sparks/index.js';
import debris from './debris/index.js';

// Extended substances (6)
import mercury from './mercury/index.js';
import acid from './acid/index.js';
import blood from './blood/index.js';
import honey from './honey/index.js';
import sand from './sand/index.js';
import snow from './snow/index.js';

// Register all
const ALL_SUBSTANCES = [
  water, lava, fire, smoke, ice, metal, plasma,
  oil, glass, stone, wax, wood, steam, sparks, debris,
  mercury, acid, blood, honey, sand, snow,
];

for (const sub of ALL_SUBSTANCES) {
  registerSubstance(sub);
}

export { ALL_SUBSTANCES };
