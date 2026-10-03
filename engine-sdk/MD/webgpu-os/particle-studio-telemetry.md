---
title: Particle Studio Telemetry
description: Runtime metrics, sensor evidence, profiling, and legacy compatibility contracts in Particle Realms Studio.
audience: users, integrators, and app developers
updated: 2026-07-14
---

# Particle Studio Telemetry

Particle Realms Studio accepts measured values; it does not generate missing
measurements. Runtime metrics, sensor evidence, and external references use
separate contracts so derived values cannot silently become canonical truth.
(Sources:
`webgpu-os/factory/apps/particles/ParticleLabTelemetry.js`,
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`)

This page is for integrators and users who ingest, export, or interpret current
Studio measurements.

## Runtime telemetry

`ParticleLabTelemetry` accepts a sample only when it has a finite,
non-negative timestamp and at least one finite, non-negative supported metric.
Its default history is 120 samples; configured limits are clamped to 1..10,000.
Integer metrics are rounded and absent metrics remain absent. (Source:
`webgpu-os/factory/apps/particles/ParticleLabTelemetry.js`)

| Metric | Meaning | Value handling |
| --- | --- | --- |
| `fps` | Observed frames per second | Finite, non-negative number. |
| `frameMs` | Observed frame duration | Finite, non-negative milliseconds. |
| `submitMs` | Measured queue-submit duration | Recorded only when supplied. |
| `gpuMs` | Measured GPU duration | Recorded only when supplied. |
| `particleCount` | Active particle count | Rounded non-negative integer. |
| `particleBytes` | Allocated particle bytes | Rounded non-negative integer. |

Each metric can be exported as timestamp/value points. Summaries report count,
latest, minimum, maximum, average, and p95; an unsampled metric has a `null`
summary. Studio records an app runtime sample at an approximately 500 ms
cadence when those observations are available. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabTelemetry.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Sensor definitions

Sensor definitions use schema `particle-realms.sensor.v1`. A definition has a
stable ID, sensor type, quantity, unit, source ID, sampling rate, reduction,
value type, and stale policy. The runtime supports up to 4,096 definitions
(default 256) and 1..10,000 samples per sensor (default 600). (Source:
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`)

| Contract | Supported values |
| --- | --- |
| Sensor type | `point`, `line`, `plane`, `surface`, `region-average`, `region-integral`, `min-max`, `histogram`, `particle-count`, `compact-stream`, `performance` |
| Reduction | `latest`, `mean`, `sum`, `integral`, `min`, `max`, `min-max`, `histogram`, `count`, `rms` |
| Value type | `scalar`, `vector2`, `vector3`, `vector4`, `range`, `histogram` |
| Data quality | `good`, `uncertain`, `stale`, `missing`, `substituted`, `outlier`, `invalid` |

Sampling rates are bounded to 0.001..1,000 Hz. Validation checks that the
selected reduction and value type are compatible and that IDs remain unique.
(Source: `webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`)

## Sensor samples and provenance

Samples use schema `particle-realms.sensor-sample.v1`. Validation requires the
sample's sensor ID, quantity, unit, and source provenance to match its
definition. Sequence and timestamp must remain monotonic. Normal samples carry
a value; only `missing` and `invalid` quality permit a null value. The origin
identifies an ingested or compact-reduction source. (Source:
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`)

Staleness is calculated from the latest timestamp and the definition's stale
policy. It does not rewrite the recorded sample's original quality or value.
Rejected samples increment a diagnostic count rather than being repaired into
apparently valid measurements.

## Compact reductions

The reducer accepts at most 65,536 explicit finite values. It implements the
supported scalar reductions over that supplied input. An integral requires
explicit weights; the module does not guess cell size, area, volume, or time
spacing. Histogram output is bounded and explicit. (Source:
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`)

This is a data-contract and compact-reduction seam. It does not locate probes
in a solver, read arbitrary GPU fields, schedule a GPU reduction pass, or
calibrate a sensor. A host must supply the measured compact values and their
provenance.

## Analyze and export

The Analyze workspace displays registered definitions, accepted series,
latest values, quality, origin, rejection count, and bounded diagnostics. JSON
and CSV exports are sorted and retain provenance. Runtime metrics are projected
into predefined performance-sensor samples only when the corresponding metric
was supplied. Missing sources remain empty. (Sources:
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`,
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`)

## Stage attribution and adaptive quality

`ParticleProfilerAttribution` accepts only explicitly supplied timing for
`solver`, `sensor`, `view`, `post`, `preview`, and `readback` stages. Analyze
shows an empty row until a host supplies that stage; it does not divide frame
time heuristically. The quality governor separately uses observed `frameMs`
windows and authored policy to select Economy, Interactive, High, or Cinematic
behavior. (Sources:
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

## Legacy Twin runtime compatibility

`ParticleTwinRuntime` can maintain an append-only measured-truth history from
accepted sensor samples. Checkpoints reference historical truth for replay.
What-if branches are isolated from truth, and predicted records require a model
ID and version. Deterministic alert rules operate on accepted values; confidence
remains unestimated unless an external model supplies it. Acknowledgement
requires an actor. (Source:
`webgpu-os/factory/apps/particles/ParticleTwinRuntime.js`)

This module is retained for project and integration compatibility. The current
six-stage Studio exposes no Twin workspace and does not attach WebSocket,
REST, server-sent events, MQTT, industrial protocol, or other live transport.
No built-in prediction model or telemetry-to-solver actuation path is present.
(Sources: `webgpu-os/factory/apps/particles/ParticleTwinRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

The project persists only disconnected-safe Twin configuration and alert
rules. Credential-like configuration keys are rejected. Runtime truth,
checkpoints, branches, connector state, predictions, and acknowledgements are
process-local runtime state rather than project-v2 content. (Source:
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Capability boundary

| Status | Telemetry capability |
| --- | --- |
| Implemented | Bounded measured runtime metrics, strict sensor definitions and samples, compact reductions, explicit data quality, JSON/CSV export, and supplied stage attribution. |
| Partial | ParticleApp metrics populate performance sensors; other solver quantities require a host measurement/reduction integration. The legacy Twin runtime remains independently testable but is not a workspace. |
| Unsupported | Fabricated gap filling, live transport, automatic GPU probe pipelines, calibrated sensors, full-field capture, and telemetry actuation. |

## See also

- [Particle Studio User Guide](particle-studio-user-guide.md)
- [Particle Studio Fidelity and Validation](particle-studio-fidelity-and-validation.md)
- [Particle Studio Performance](particle-studio-performance.md)
- [Particle Studio External Studies](particle-studio-external-studies.md)
- [Particle Studio Integration Map](particle-studio-integration-map.md)
