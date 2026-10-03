// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { noise2dWGSL } from "../chunks/noise2d.js";
import { particlesBillboardVertexWGSL } from "./particles_billboard_vertex.js";
import { particlesBillboardFragmentWGSL } from "./particles_billboard_fragment.js";

// Billboard particle shader - combines vertex and fragment shaders
export const particlesBillboardWGSL = noise2dWGSL + particlesBillboardVertexWGSL + particlesBillboardFragmentWGSL;
