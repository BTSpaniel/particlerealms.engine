---
title: Particle Studio External Studies
description: Import, provenance, comparison, and interpretation contracts for external Particle Studio data.
audience: users, reviewers, and app developers
updated: 2026-07-13
---

# Particle Studio External Studies

Particle Studio can retain and compare bounded local scalar-series studies in
CSV or JSON. An external study is reference evidence with its own provenance;
it never automatically validates the active native or custom preview. (Source:
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

This page is for users and reviewers who prepare and interpret local external
study imports.

## Schema and limits

The canonical schema is `particle-realms.external-study` version 1. A project
may retain up to eight studies in canonical ID order. Each imported document
is limited to 4 MiB, each study to 64 series, and each series to 100,000 finite
samples. (Sources:
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

| Field | Purpose |
| --- | --- |
| `id`, `name` | Stable study identity and display name. |
| `solver`, `solverVersion` | Producer provenance. |
| `coordinateSystem` | Declared spatial frame or `unspecified`. |
| `units` | Optional quantity-to-unit metadata. |
| `source`, `author`, `reviewedBy` | Origin and review provenance. |
| `validation` | `unvalidated`, `reference`, `reviewed`, or `validated`. |
| `assumptions`, `limitations` | Explicit interpretation constraints. |
| `importedAt` | Canonical import timestamp. |
| `series` | Quantity, unit, and finite scalar samples. |
| `validatesNativePreview` | Always `false`. |

Every series has a stable ID, label, quantity, unit, and samples. A sample has
an index, numeric time, finite value, optional canonical timestamp, and quality
label. (Source:
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

## CSV format

CSV requires one header row and at least one data row. A `time` or `timestamp`
column is recognized case-insensitively. Other headers may declare a unit as
`quantity [unit]`; without brackets, the unit defaults to `1`. Quoted fields
and doubled quotes are supported. Non-finite value cells are skipped.
(Source: `webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

```csv
time,frame duration [ms],active particle count [count]
0.0,8.4,100000
0.5,8.7,100000
1.0,8.5,100000
```

Numeric time values are stored as time. Non-numeric time text is parsed as a
timestamp when possible. If there is no time column, row order supplies time
indices. CSV import options may add the study name, solver/version, coordinate
system, source, author, review metadata, assumptions, and limitations.

## JSON format

JSON may already use the canonical schema. For compatible object input without
the schema marker, the parser supplies the current schema/version and forces
`validatesNativePreview: false` before validation. The document must contain at
least one series with at least one finite sample. Serialization validates the
study before writing canonical JSON. (Source:
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

## Provenance and validation levels

Validation requires an explicit supported level and rejects any claim that the
study validates the native preview. A study marked `validated` must include a
reviewer, a named solver, and a solver version. This validates the imported
record's minimum provenance requirements only; it does not review equations,
mesh, convergence, calibration, or compatibility with the Studio model.
(Source: `webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

An unspecified coordinate system produces a warning and disables any
spatial-overlay interpretation. The current UI performs time-series comparison
only, so even a specified coordinate system does not activate a 3D overlay.

## Import workflow

1. In **Compare**, select a local CSV or JSON document.
2. Studio parses and normalizes the document within the import bounds.
3. Validation errors stop the import; warnings remain visible context.
4. A study with the same ID replaces the retained copy; otherwise it is added
   subject to the eight-study project limit.
5. Saving the project persists the normalized study as project-v2 content.

The UI labels every retained study as not validating the native preview and
logs the local import. (Sources:
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Comparison semantics

The Compare workspace selects a measured sensor series only when its quantity
and unit exactly match an external series. `compareExternalSeries()` compares
up to the shorter series length by array index and reports baseline, external,
delta, and ratio. A zero baseline produces a null ratio. The helper reports
whether units are equal, but callers must enforce compatibility; the Studio UI
does so before comparison. (Sources:
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

This comparison does not interpolate time, align timestamps, convert units,
transform coordinate systems, propagate uncertainty, or compute spatial error
norms. Array-index alignment is suitable only when the reviewer has established
that the records correspond.

## Security and interpretation

Imports are text-only, bounded, parsed locally, normalized to finite scalar
series, and stored as data. The current path does not execute scripts or send a
job to the named solver. Source and author fields are provenance strings, not
authenticated identities. Review metadata should therefore be verified
outside Studio when it matters. (Sources:
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Capability boundary

| Status | External-study capability |
| --- | --- |
| Implemented | Bounded local CSV/JSON scalar-series import, canonical schema and serialization, provenance fields, four validation levels, project persistence, compatible quantity/unit selection, and index-aligned delta/ratio. |
| Partial | Coordinate-system provenance is retained, but no spatial comparison is rendered; validation levels record provenance rather than certify model equivalence. |
| Unsupported | Remote job submission or status, commercial-solver adapter, geometry/boundary export, meshes, surface or volume fields, particle/pathline imports, spatial overlays, coordinate transforms, unit conversion, time interpolation, and automatic validation transfer. |

## See also

- [Particle Studio Fidelity and Validation](particle-studio-fidelity-and-validation.md)
- [Particle Studio Telemetry](particle-studio-telemetry.md)
- [Particle Studio User Guide](particle-studio-user-guide.md)
- [Particle Studio Test Plan](particle-studio-test-plan.md)
