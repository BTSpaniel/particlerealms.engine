---
title: Tetrahedral Cage Ray-Tracing Lab
description: Original engine cage compilation, CPU reference traversal, and opt-in WebGPU acceleration experiments in the PBR playground.
updated: 2026-09-21
---

# Tetrahedral Cage Ray-Tracing Lab

The tetrahedral cage lab tests ray tracing of independently deforming copies of dense meshes. It is an opt-in experiment, not a replacement for the engine's renderers, physics, particles, or normal PBR playground scene.

## Implementation and provenance

This repository independently implements the publicly described idea of keeping dense geometry static while deforming a coarse cage and transforming rays back into rest space. The source, WGSL shaders, procedural workload, binary container, and tests were written for Particle Realms. No AMD source, shader, binary asset, or proprietary layout is included. The technique is credited to the [AMD public research description](https://gpuopen.com/learn/how-tetrahedral-cages-significantly-reduce-bvh-memory-usage/); its published performance numbers are not results for this engine.

The engine module clips triangles into tetrahedra, preserves source and cage barycentric coordinates, and builds deterministic static micro-BVHs. A BVH is a bounding-volume hierarchy used to skip geometry a ray cannot hit. Each animation frame updates affine cage transforms and a top-level hierarchy. The playground implements traversal as WebGPU compute shaders, not native hardware ray-query instructions.

Sources: `engine/core/math/TetrahedralCageAccel.js`, `engine/core/math/TetrahedralCageCompiler.js`, `tests/playground/src/demos/pbr/tetraCageShaders.js`, and `tetraCageRayRuntime.js`.

## Open the experiment

Start the repository server:

```bash
python start_server.py
```

Open `http://127.0.0.1:9001/tests/playground/?demo=pbr&tetraCageLab=1`. Alternatively, open PBR and press **T** or select **Enable lab**. The normal sculpture-court renderer remains the default. The lab pauses it during measurement so its GPU work does not contaminate the comparison.

Choose the source triangle count, instance ladder, ray resolution, and sample cohort. **Run comparison** executes the selected cases. **Export receipt** saves measurements and evidence limitations as JSON. **Cancel** stops the run without publishing a partial measurement cohort. Disabling the lab returns to the normal scene.

The initial procedural ribbon has 1,152 source triangles and 36 tetrahedra. Clipping can increase the actual triangle count. Receipts distinguish source triangles from stored micro-triangles and report real allocated GPU buffers. An unsupported workload fails explicitly; it is not silently reduced.

Sources: `tests/playground/src/demos/pbr/tetraCageLab.js`, `tetraCageBenchmarkPanel.js`, `tetraCageBenchmarkAdapter.js`, and `tests/playground/src/demos/pbr.js`.

## Compile a reusable asset

Python owns files and launches installed headless Chrome, Edge, or Chromium to execute the canonical engine ES modules. No Node or npm is required. Existing output files are never overwritten.

```bash
python tools/compile_tetrahedral_cage.py --ribbon --output ribbon.tcage
python tools/compile_tetrahedral_cage.py --input mesh.json --grid 1 6 1 --output mesh-cage.tcage
```

The input JSON uses flat xyz `vertices` and triangle `indices`. Supply both `cageVertices` and `tetrahedra` for an authored cage; otherwise the compiler makes a conforming six-tetrahedra-per-cell grid around the mesh. Different explicit grid resolutions produce separate animation LOD assets. There is no automatic deformation-error-driven LOD selector.

Decode an asset in a browser module:

```javascript
import { decodeTetrahedralCagePackage } from '/engine/core/math/TetrahedralCageCompiler.js';

const response = await fetch('/ribbon.tcage');
if (!response.ok) throw new Error(`Asset request failed: ${response.status}`);
const { packageData, manifest } = decodeTetrahedralCagePackage(await response.arrayBuffer());
console.log(packageData.microTriangles.byteLength, manifest.metrics);
```

The container preserves typed-array bits, including integer fields packed into BVH node records. The decoder validates block boundaries and versioning. GPU runtime admission additionally validates geometry, ownership, tree topology, bounds, and device buffer limits. Manifest metadata is descriptive, not a trust or authenticity guarantee.

Sources: `tools/compile_tetrahedral_cage.py`, `tools/tetrahedral_cage_compile.js`, and `engine/core/math/TetrahedralCageCompiler.js`.

## Interpret the evidence

The three lab paths compare static geometry, explicitly deformed dense micro-geometry, and shared rest-space cage micro-geometry. The exact dynamic baseline is a partitioned dense BVH reference using the same clipped mesh, not an optimized hardware DXR or Vulkan implementation. Correctness checks compare the same deterministic pose against a CPU reference. This tests traversal equivalence for cage deformation; it does not prove fidelity to arbitrary skeletal animation or a higher-resolution physical simulation.

GPU timestamps measure acceleration work. Host end-to-end samples also include cage evaluation, uploads, submission, and readback performed by the adapter. The preview is a diagnostic image, not the full PBR shading pipeline. Short durations can fall below timestamp resolution, and fixed sequential case order can introduce thermal drift.

The harness therefore keeps acceleration-only measurements **INCONCLUSIVE** for full renderer adoption. Its decision profile additionally requires 1920×1080 primary-plus-shadow rays, at least 32 instances, at least 50,000 source triangles, and 2,000 measured frames for supported p95 statistics. Gates require at least 4× acceleration-memory reduction, 4× update speedup, p95 frame time at most 16.67 ms, trace cost at most 1.5× static, and bounded hit, distance, normal, and silhouette error. A gate is not evidence unless its inputs were actually measured.

Source: `tests/playground/src/demos/pbr/tetraCageBenchmark.js`.

## Boundaries and validation

Use cages for dense meshes whose animation can be represented by a much smaller, non-inverting tetrahedral structure. Static meshes already share geometry. UI, fluids, procedural fields, and unrelated engine systems do not gain this representation automatically.

Singular and orientation-flipping deformations are rejected. Conditioning checks are scale-relative, with a default dimensionless threshold of `1e-7` for float32 stability. Clipping tolerances and minimum triangle area still require care for extreme scales. Authored cages must form a conforming, non-overlapping volume; shared-face and duplicate-cell checks are not a general intersection proof for arbitrary non-adjacent cells. The current GPU hierarchy retains entries for empty tetrahedra, so sparse cages have overhead.

Run the focused regressions:

```bash
python tests/run_tetrahedral_cage_accel.py
python tests/run_playground_pbr_tetra_cage_benchmark.py
python tests/run_playground_pbr_tetra_cage_live.py
```

The live runner requires Python Playwright, installed Chrome, and WebGPU. It exercises actual GPU traversal and the actual PBR panel, including receipt export, cancellation, and return to the default scene. Its artifacts go to `tmp/tetra-cage-lab-validation/`. It is a correctness diagnostic, not a published performance benchmark.

## See also

- [Rendering](rendering.md)
- [Math contract](math-contract.md)
- [Engine architecture](architecture.md)
