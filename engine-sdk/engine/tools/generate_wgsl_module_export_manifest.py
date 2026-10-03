#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Generate source-level metadata for JS modules that export WGSL strings."""

from __future__ import annotations

import argparse
from collections import Counter
import json
import re
from pathlib import Path
from typing import Sequence


REPO_ROOT = Path(__file__).resolve().parents[2]
TARGET = REPO_ROOT / "engine/core/math/WGSLModuleExports.generated.js"
SCAN_ROOTS = (
    REPO_ROOT / "engine/render/shaders/modules",
    REPO_ROOT / "engine/render/shaders/materials",
)
EXPORT_CONST_RE = re.compile(r"\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=")
WGSL_EXPORT_NAME_RE = re.compile(r"(WGSL$|WGSL_|Shader$|Library$)")
REGISTERED_MODULE_EXPORT_CHUNKS: tuple[tuple[str, str, tuple[str, ...], str | None], ...] = (
    ("math_common", "engine/render/shaders/modules/chunks/math_common.js", ("scalar", "common"), None),
    ("struct_light", "engine/render/shaders/modules/chunks/structs_common.js", ("struct",), "lightStructWGSL"),
    ("struct_camera", "engine/render/shaders/modules/chunks/structs_common.js", ("struct",), "cameraStructWGSL"),
    ("struct_frame", "engine/render/shaders/modules/chunks/structs_common.js", ("struct",), "frameUniformsWGSL"),
    ("struct_pbr_material", "engine/render/shaders/modules/chunks/structs_common.js", ("struct", "material"), "pbrMaterialStructWGSL"),
    ("struct_standard_vertex_output", "engine/render/shaders/modules/chunks/structs_common.js", ("struct", "vertex"), "standardVertexOutputWGSL"),
    ("struct_fullscreen_vertex_output", "engine/render/shaders/modules/chunks/structs_common.js", ("struct", "vertex"), "fullscreenVertexOutputWGSL"),
    ("lighting_module", "engine/render/shaders/modules/chunks/lighting_common.js", ("lighting",), "lightingModuleWGSL"),
    ("noise2d", "engine/render/shaders/modules/chunks/noise2d.js", ("noise",), None),
    ("noise3d", "engine/render/shaders/modules/chunks/noise3d.js", ("noise",), None),
    ("packing", "engine/render/shaders/modules/chunks/packing.js", ("packing",), None),
    ("quaternion", "engine/render/shaders/modules/chunks/quaternion.js", ("quaternion",), None),
    ("sdf_primitives", "engine/render/shaders/modules/chunks/sdf_primitives.js", ("sdf", "geometry"), None),
    ("ray_intersect", "engine/render/shaders/modules/chunks/ray_intersect.js", ("ray",), None),
    ("ray_box_intersect", "engine/render/shaders/modules/chunks/raymarching.js", ("ray",), "rayBoxIntersectWGSL"),
    ("ray_sphere_intersect", "engine/render/shaders/modules/chunks/raymarching.js", ("ray",), "raySphereIntersectWGSL"),
    ("depth_utils", "engine/render/shaders/modules/chunks/raymarching.js", ("depth",), "depthUtilsWGSL"),
    ("trilinear_sample", "engine/render/shaders/modules/chunks/raymarching.js", ("sampling",), "trilinearSampleWGSL"),
    ("phase_functions", "engine/render/shaders/modules/chunks/raymarching.js", ("phase",), "phaseFunctionsWGSL"),
    ("beer_lambert", "engine/render/shaders/modules/chunks/raymarching.js", ("transmittance",), "beerLambertWGSL"),
    ("raymarching_module", "engine/render/shaders/modules/chunks/raymarching.js", ("raymarching",), "raymarchingModuleWGSL"),
    ("camera_utils", "engine/render/shaders/modules/chunks/camera_utils.js", ("camera",), None),
    ("ray_termination", "engine/render/shaders/modules/chunks/ray_termination.js", ("ray",), None),
    ("restir_guide_policy", "engine/render/shaders/modules/chunks/restir_guide_policy.js", ("restir",), None),
    ("area_lighting", "engine/render/shaders/modules/chunks/area_lighting.js", ("lighting",), None),
    ("ray_tracing", "engine/render/shaders/modules/chunks/ray_tracing.js", ("ray",), None),
    ("temporal_aa", "engine/render/shaders/modules/chunks/temporal_aa.js", ("taa",), None),
    ("texture_math", "engine/render/shaders/modules/chunks/texture_math.js", ("texture", "uv"), None),
    ("blend_math", "engine/render/shaders/modules/chunks/blend_math.js", ("blend", "alpha"), None),
    ("color_math", "engine/render/shaders/modules/chunks/color_math.js", ("color",), None),
    ("denoise", "engine/render/shaders/modules/chunks/denoise.js", ("denoise",), None),
    ("voronoi", "engine/render/shaders/modules/chunks/voronoi.js", ("voronoi", "noise"), None),
    ("voxel_world", "engine/render/shaders/modules/chunks/voxel_world.js", ("voxel",), None),
    ("volumetric_clouds", "engine/render/shaders/modules/chunks/volumetric_clouds.js", ("volume",), None),
    ("fire_turbulence", "engine/render/shaders/modules/chunks/fire_turbulence.js", ("fire", "noise"), None),
    ("magic_effects", "engine/render/shaders/modules/chunks/magic_effects.js", ("vfx",), None),
    ("electricity", "engine/render/shaders/modules/chunks/electricity.js", ("vfx",), None),
    ("anime_toon", "engine/render/shaders/modules/chunks/anime_toon.js", ("toon",), None),
    ("anime_explosion", "engine/render/shaders/modules/chunks/anime_explosion.js", ("vfx",), None),
    ("fractal_edges", "engine/render/shaders/modules/chunks/fractal_edges.js", ("fractal",), None),
    ("pathtracing_gi", "engine/render/shaders/modules/chunks/pathtracing_gi.js", ("path-tracing",), None),
    ("pbr_materials", "engine/render/shaders/modules/chunks/pbr_materials.js", ("pbr", "material"), None),
    ("pbr_brdf", "engine/render/shaders/materials/pbr_brdf.js", ("pbr", "material"), "pbrBrdfWGSL"),
    ("fluid_water_blur", "engine/render/shaders/modules/postfx/fluid_water_blur.js", ("fluid", "postfx"), None),
    ("fluid_water_composite", "engine/render/shaders/modules/postfx/fluid_water_composite.js", ("fluid", "postfx"), None),
    ("fluid_water_depth", "engine/render/shaders/modules/postfx/fluid_water_depth.js", ("fluid", "postfx"), None),
    ("fluid_water_thickness", "engine/render/shaders/modules/postfx/fluid_water_thickness.js", ("fluid", "postfx"), None),
    ("volume_isosurface", "engine/render/shaders/modules/postfx/volume_isosurface.js", ("volume", "postfx"), None),
    ("volume_smoke", "engine/render/shaders/modules/postfx/volume_smoke.js", ("volume", "postfx"), None),
    ("grid_splat_compute", "engine/render/shaders/modules/compute/grid_splat.js", ("grid", "compute"), "gridSplatComputeWGSL"),
    ("grid_clear_compute", "engine/render/shaders/modules/compute/grid_splat.js", ("grid", "compute"), "gridClearComputeWGSL"),
    ("grid_finalize_compute", "engine/render/shaders/modules/compute/grid_splat.js", ("grid", "compute"), "gridFinalizeComputeWGSL"),
    ("ray_portal", "engine/render/shaders/modules/proxy/ray_portal.js", ("ray", "proxy"), None),
    ("tlas_refit", "engine/render/shaders/modules/proxy/tlas_refit.js", ("tlas", "proxy"), None),
    ("particle_blackbody", "engine/render/shaders/modules/core/particles_blackbody.js", ("particle", "color"), None),
    ("particle_phase_vfx", "engine/render/shaders/modules/core/particles_phase_vfx.js", ("particle", "vfx"), None),
    ("spell_particles", "engine/render/shaders/modules/chunks/spell_particles.js", ("particle", "spell"), None),
    ("quadtree", "engine/render/shaders/modules/chunks/quadtree.js", ("quadtree",), None),
    ("shadows_ao", "engine/render/shaders/modules/chunks/shadows_ao.js", ("shadow", "ao"), "shadowsAoWGSL"),
    ("shadows_ao_macros", "engine/render/shaders/modules/chunks/shadows_ao.js", ("shadow", "ao"), "shadowsAoMacrosWGSL"),
    ("fullscreen_quad_vertex", "engine/render/shaders/modules/chunks/fullscreen_quad.js", ("vertex",), "fullscreenQuadVertexWGSL"),
    ("fullscreen_quad_explicit", "engine/render/shaders/modules/chunks/fullscreen_quad.js", ("vertex",), "fullscreenQuadExplicitWGSL"),
    ("light_attenuation", "engine/render/shaders/modules/chunks/lighting_common.js", ("lighting", "attenuation"), "lightAttenuationWGSL"),
    ("diffuse_lighting", "engine/render/shaders/modules/chunks/lighting_common.js", ("lighting", "diffuse"), "diffuseLightingWGSL"),
    ("specular_lighting", "engine/render/shaders/modules/chunks/lighting_common.js", ("lighting", "specular"), "specularLightingWGSL"),
    ("light_calculation", "engine/render/shaders/modules/chunks/lighting_common.js", ("lighting", "calculation"), "lightCalculationWGSL"),
    ("pbr_inputs_struct", "engine/render/shaders/materials/pbr_brdf.js", ("pbr", "material", "struct"), "pbrInputsStructWGSL"),
    ("pbr_brdf_functions", "engine/render/shaders/materials/pbr_brdf.js", ("pbr", "material", "brdf"), "pbrBrdfFunctionsWGSL"),
    ("pbr_extensions", "engine/render/shaders/materials/pbr_extensions.js", ("pbr", "material", "extension"), "pbrExtensionsWGSL"),
    ("pbr_ibl", "engine/render/shaders/materials/pbr_ibl.js", ("pbr", "material", "ibl"), "pbrIblWGSL"),
    ("pbr_material_uniforms", "engine/render/shaders/materials/pbr_material_uniforms.js", ("pbr", "material", "uniform"), "pbrMaterialUniformsWGSL"),
    ("shadow_pcf", "engine/render/shaders/materials/shadow_pcf.js", ("shadow", "pcf", "material"), "shadowPcfWGSL"),
    ("color_blend_lib", "engine/render/shaders/modules/lib/color/blend.js", ("color", "blend", "library"), "colorBlendWGSL"),
    ("density_falloff_lib", "engine/render/shaders/modules/lib/density/falloff.js", ("density", "falloff", "library"), "densityFalloffWGSL"),
    ("depth_linearize_lib", "engine/render/shaders/modules/lib/depth/linearize.js", ("depth", "library"), "depthLinearizeWGSL"),
    ("depth_reconstruct_lib", "engine/render/shaders/modules/lib/depth/reconstruct.js", ("depth", "reconstruct", "library"), "depthReconstructWGSL"),
    ("domain_warp_lib", "engine/render/shaders/modules/lib/distortion/domain_warp.js", ("distortion", "domain-warp", "library"), "domainWarpWGSL"),
    ("light_scatter_lib", "engine/render/shaders/modules/lib/lighting/scatter.js", ("lighting", "scatter", "library"), "lightScatterWGSL"),
    ("interpolation_lib", "engine/render/shaders/modules/lib/math/interpolation.js", ("interpolation", "easing", "library"), "interpolationWGSL"),
    ("hash_noise_lib", "engine/render/shaders/modules/lib/noise/hash.js", ("noise", "hash", "library"), "hashWGSL"),
    ("value_noise_lib", "engine/render/shaders/modules/lib/noise/value.js", ("noise", "value", "library"), "valueNoiseWGSL"),
    ("fbm_noise_lib", "engine/render/shaders/modules/lib/noise/fbm.js", ("noise", "fbm", "library"), "fbmWGSL"),
    ("curl_noise_lib", "engine/render/shaders/modules/lib/noise/curl.js", ("noise", "curl", "library"), "curlNoiseWGSL"),
    ("noise3d_lib", "engine/render/shaders/modules/lib/noise/noise3d.js", ("noise", "3d", "library"), "noise3dLibrary"),
    ("sdf_shapes_lib", "engine/render/shaders/modules/lib/sdf/shapes.js", ("sdf", "geometry", "library"), "sdfShapesLibrary"),
    ("color_lib_aggregate", "engine/render/shaders/modules/lib/color/index.js", ("color", "blend", "library", "aggregate"), "colorLibWGSL"),
    ("density_lib_aggregate", "engine/render/shaders/modules/lib/density/index.js", ("density", "falloff", "library", "aggregate"), "densityLibWGSL"),
    ("depth_lib_aggregate", "engine/render/shaders/modules/lib/depth/index.js", ("depth", "library", "aggregate"), "depthLibWGSL"),
    ("distortion_lib_aggregate", "engine/render/shaders/modules/lib/distortion/index.js", ("distortion", "domain-warp", "library", "aggregate"), "distortionLibWGSL"),
    ("lighting_lib_aggregate", "engine/render/shaders/modules/lib/lighting/index.js", ("lighting", "scatter", "library", "aggregate"), "lightingLibWGSL"),
    ("math_lib_aggregate", "engine/render/shaders/modules/lib/math/index.js", ("interpolation", "easing", "library", "aggregate"), "mathLibWGSL"),
    ("noise_lib_aggregate", "engine/render/shaders/modules/lib/noise/index.js", ("noise", "library", "aggregate"), "noiseLibWGSL"),
    ("full_shader_lib_aggregate", "engine/render/shaders/modules/lib/index.js", ("shader-library", "aggregate"), "fullShaderLibWGSL"),
)


def repo_id(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def is_wgsl_export_name(name: str) -> bool:
    return bool(WGSL_EXPORT_NAME_RE.search(name))


def scan_exports() -> dict[str, list[str]]:
    manifest: dict[str, list[str]] = {}
    for root in SCAN_ROOTS:
        for path in sorted(root.rglob("*.js"), key=repo_id):
            text = path.read_text(encoding="utf-8")
            exports = sorted({
                name for name in EXPORT_CONST_RE.findall(text)
                if is_wgsl_export_name(name)
            })
            if exports:
                manifest[repo_id(path)] = exports
    return manifest


def registered_chunks(manifest: dict[str, list[str]]) -> dict[str, dict[str, object]]:
    chunks: dict[str, dict[str, object]] = {}
    for registry_id, source_path, tags, requested_export_name in REGISTERED_MODULE_EXPORT_CHUNKS:
        if registry_id in chunks:
            raise SystemExit(f"Duplicate registered WGSL chunk id: {registry_id}")

        exports = manifest.get(source_path)
        if exports is None:
            raise SystemExit(f"Registered WGSL chunk source is missing from manifest: {source_path}")

        if requested_export_name is None:
            if len(exports) != 1:
                raise SystemExit(
                    f"Registered WGSL chunk {registry_id} needs an explicit export name: "
                    f"{source_path} exports {', '.join(exports)}"
                )
            compile_export_name = exports[0]
        else:
            compile_export_name = requested_export_name

        if compile_export_name not in exports:
            raise SystemExit(
                f"Registered WGSL chunk {registry_id} expects {compile_export_name}, "
                f"but {source_path} exports {', '.join(exports)}"
            )

        chunks[registry_id] = {
            "registryId": registry_id,
            "sourcePath": source_path,
            "compileExportName": compile_export_name,
            "tags": list(tags),
        }
    return chunks


def export_key(source_path: str, export_name: str) -> str:
    return f"{source_path}::{export_name}"


def unregistered_classification(source_path: str, export_name: str) -> tuple[str, str]:
    if source_path.startswith("engine/render/shaders/modules/lib/"):
        if source_path.endswith("/index.js") or source_path == "engine/render/shaders/modules/lib/index.js":
            return (
                "shader-library-aggregate",
                "Aggregate shader library export; classify before compiling as an isolated chunk.",
            )
        return (
            "shader-library-leaf",
            "Reusable shader library leaf export; candidate for future compile registration after prefix dependencies are declared.",
        )

    if source_path.startswith("engine/render/shaders/modules/passes/"):
        return (
            "render-pass-shader",
            "Complete render pass shader source; covered by tests/render-pass-compile-smoke.html and kept out of reusable chunk coverage until pass bind-group contracts are modeled.",
        )

    if source_path == "engine/render/shaders/modules/postfx/bloom.js":
        return (
            "postfx-pass-shader",
            "Post-processing bloom pass shader export; covered by tests/bloom-postfx-compile-smoke.html and kept separate from reusable WGSL chunk coverage.",
        )

    if source_path.startswith("engine/render/shaders/modules/core/"):
        return (
            "particle-runtime-shader",
            "Particle runtime shader source; covered by tests/particle-runtime-compile-smoke.html and kept out of reusable chunk coverage until particle pipeline contracts are modeled.",
        )

    if source_path == "engine/render/shaders/modules/compute/gpu_tile.js":
        return (
            "compute-utility",
            "Compute utility/tile shader source; covered by tests/gpu-tile-compile-smoke.html and kept out of reusable chunk registration.",
        )

    if source_path.startswith("engine/render/shaders/materials/"):
        if source_path == "engine/render/shaders/materials/pbr_brdf.js":
            return (
                "material-helper",
                "Material helper export; candidate for prefix-aware compile coverage after dependencies are explicit.",
            )
        if source_path.endswith("/unlit_world.js") or source_path.endswith("/voxel_world.js"):
            return (
                "material-runtime-shader",
                "Complete material shader source; covered by tests/material-runtime-compile-smoke.html and kept out of reusable chunk coverage until material pipeline contracts are modeled.",
            )
        return (
            "material-library",
            "Material library export; candidate for future compile coverage after material dependency metadata is declared.",
        )

    if source_path.startswith("engine/render/shaders/modules/chunks/"):
        return (
            "helper-export",
            "Secondary helper export from a registered chunk module; candidate for future registration after prefix dependencies are declared.",
        )

    raise SystemExit(f"Unclassified WGSL export: {source_path}::{export_name}")


def classify_exports(
    manifest: dict[str, list[str]],
    chunks: dict[str, dict[str, object]],
) -> dict[str, dict[str, object]]:
    registered_by_export = {
        (str(chunk["sourcePath"]), str(chunk["compileExportName"])): chunk
        for chunk in chunks.values()
    }
    classifications: dict[str, dict[str, object]] = {}

    for source_path, exports in manifest.items():
        for export_name in exports:
            registered_chunk = registered_by_export.get((source_path, export_name))
            if registered_chunk:
                classification = "registered-chunk"
                reason = "Registered reusable WGSL chunk with compile harness coverage."
                registered_chunk_id: str | None = str(registered_chunk["registryId"])
                compile_covered = True
                tags = list(registered_chunk["tags"]) if isinstance(registered_chunk["tags"], list) else []
            else:
                classification, reason = unregistered_classification(source_path, export_name)
                registered_chunk_id = None
                compile_covered = False
                tags = []

            classifications[export_key(source_path, export_name)] = {
                "sourcePath": source_path,
                "exportName": export_name,
                "classification": classification,
                "registeredChunkId": registered_chunk_id,
                "compileCovered": compile_covered,
                "tags": tags,
                "reason": reason,
            }

    return classifications


def generated_body(manifest: dict[str, list[str]]) -> str:
    chunks = registered_chunks(manifest)
    classifications = classify_exports(manifest, chunks)
    classification_counts = dict(sorted(Counter(
        entry["classification"] for entry in classifications.values()
    ).items()))
    lines = [
        "// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>",
        "//",
        "// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha",
        "",
        "// Generated by engine/tools/generate_wgsl_module_export_manifest.py.",
        "",
        "export const WGSL_MODULE_EXPORTS = Object.freeze({",
    ]
    for path, exports in manifest.items():
        lines.append(f"  {json.dumps(path)}: Object.freeze({json.dumps(exports)}),")
    lines.extend(
        [
            "});",
            "",
            "export const WGSL_REGISTERED_MODULE_EXPORT_CHUNKS = Object.freeze({",
        ]
    )
    for registry_id, chunk in chunks.items():
        lines.extend(
            [
                f"  {json.dumps(registry_id)}: Object.freeze({{",
                f"    registryId: {json.dumps(chunk['registryId'])},",
                f"    sourcePath: {json.dumps(chunk['sourcePath'])},",
                f"    compileExportName: {json.dumps(chunk['compileExportName'])},",
                f"    tags: Object.freeze({json.dumps(chunk['tags'])}),",
                "  }),",
            ]
        )
    lines.extend(
        [
            "});",
            "",
            "export const WGSL_MODULE_EXPORT_CLASSIFICATIONS = Object.freeze({",
        ]
    )
    for key, classification in classifications.items():
        lines.extend(
            [
                f"  {json.dumps(key)}: Object.freeze({{",
                f"    sourcePath: {json.dumps(classification['sourcePath'])},",
                f"    exportName: {json.dumps(classification['exportName'])},",
                f"    classification: {json.dumps(classification['classification'])},",
                f"    registeredChunkId: {json.dumps(classification['registeredChunkId'])},",
                f"    compileCovered: {json.dumps(classification['compileCovered'])},",
                f"    tags: Object.freeze({json.dumps(classification['tags'])}),",
                f"    reason: {json.dumps(classification['reason'])},",
                "  }),",
            ]
        )
    lines.extend(
        [
            "});",
            "",
            "export const WGSL_MODULE_EXPORT_CLASSIFICATION_COUNTS = Object.freeze({",
        ]
    )
    for classification, count in classification_counts.items():
        lines.append(f"  {json.dumps(classification)}: {count},")
    lines.extend(
        [
            "});",
            "",
            "export default WGSL_MODULE_EXPORTS;",
            "",
        ]
    )
    return "\n".join(lines)


def generate() -> None:
    TARGET.write_text(generated_body(scan_exports()), encoding="utf-8", newline="\n")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the generated manifest is stale")
    args = parser.parse_args(argv)

    before = TARGET.read_text(encoding="utf-8") if TARGET.exists() else None
    generate()

    if args.check and before != TARGET.read_text(encoding="utf-8"):
        raise SystemExit("WGSLModuleExports.generated.js was stale and has been regenerated")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
