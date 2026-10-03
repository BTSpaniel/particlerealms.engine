// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { noise2dWGSL } from "../chunks/noise2d.js";
import { particlesPointVertexWGSL } from "./particles_point_vertex.js";
import { particlesPointFragmentWGSL } from "./particles_point_fragment.js";

// Point particle shader - combines vertex and fragment shaders
export const particlesPointWGSL = noise2dWGSL + particlesPointVertexWGSL + particlesPointFragmentWGSL;
