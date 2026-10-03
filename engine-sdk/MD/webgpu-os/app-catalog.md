---
title: App Catalog
description: Every built-in OS app grouped by purpose, with the authoritative registry and manifest fields (entry, surface, permissions, capabilities).
updated: 2026-09-21
---

# App Catalog

Every app shipped in the OS, grouped by purpose. The authoritative registry is `webgpu-os/apps/index.json`; each app's manifest (`apps/<id>/manifest.json`) declares its `entry`, `surface`, `permissions`, and `capabilities`. There are **50 built-in apps**.

> **Note:** Permissions listed here are typical for the category. The manifest is authoritative — see [Security & Trust Model](../concepts/security-model.md) for how they are gated.

## System & shell

| App | id | Purpose |
| --- | --- | --- |
| Quick Settings | `quick-settings` | Fast toggles for common system settings. |
| Command Palette | `command-palette` | Fuzzy command launcher for OS actions. |
| Notification History | `notification-history` | Past notifications from the notification center. |
| Control Panel | `control-panel` | Aggregated system configuration hub. |
| Settings | `settings` | Primary OS settings app. |
| Theme Manager | `theme-manager` | Manage and switch shell themes (`kernel/ThemeEngine`). |
| System Monitor | `sysmon` | Live system/resource monitoring. |
| Task Manager | `task-manager` | View and manage running app processes (`ProcessTable`). |
| Service Manager | `service-manager` | Manage background OS services. |

## Developer & diagnostics

| App | id | Purpose |
| --- | --- | --- |
| Dev Console | `devconsole` | In-OS developer console / REPL. |
| Terminal | `terminal` | Command-line terminal. |
| Log Viewer | `log-viewer` | Browse OS logs (e.g. `/os/logs/*`). |
| Command Registry | `cmd-registry` | Inspect registered commands (`CommandBus`). |
| GPU Manager | `gpu-manager` | GPU device/VRAM inspection (`GpuDeviceBroker`, `VRAMTracker`). |

## Files, storage & packages

| App | id | Purpose |
| --- | --- | --- |
| Files | `files` | File browser over the virtual filesystem. |
| Storage Manager | `storage-manager` | Manage OPFS/IndexedDB/mounts (`StorageManager`). |
| Package Manager | `pkg-manager` | Install/remove/update `.prpkg` packages (`PackageManager`). |
| Package Studio | `pkg-studio` | Build, sign, and inspect packages (`PackageBuilder`). |

## Security & accounts

| App | id | Purpose |
| --- | --- | --- |
| Permissions | `permissions` | Review/grant per-app capabilities (`Permissions`/`PermissionStore`). |
| User Management | `user-management` | Manage user profiles/sessions (`SessionStore`, `ProfileDriver`). |

## Network & browser

| App | id | Purpose |
| --- | --- | --- |
| Browser | `browser` | Web browser surface (`WebSurfaceDriver`, browser bridge). |
| Browser Bridge Manager | `browser-bridge-manager` | Manage the native browser bridge (`browser-bridge/`). |
| Tab Manager | `tab-manager` | Manage browser tabs. |
| Request Rule Manager | `request-rule-manager` | Manage network request rules / adblock (`RuleGraph`, extension). |
| Chatroom | `chatroom` | Networked chat (collab/net). |

## Productivity

| App | id | Purpose |
| --- | --- | --- |
| Calendar | `calendar` | Local-first scheduling with reminders, recurring events, recovery, subscriptions, and ICS, CSV, Google Takeout, Apple, and Outlook interchange. |
| Calculator | `calculator` | Calculator. |
| Notepad | `notepad` | Plain-text editor (writes via `fs.*`). |
| Clock | `clock` | Clock / timers. |

Calendar stores a versioned primary file and recovery copy, and uses browser storage as a fallback. Its background service runs reminders, daily-agenda notifications, and public calendar refreshes even when the Calendar window is closed. Month, week, day, and agenda views support quick creation, detail inspection, drag-to-move, time-grid resizing, recurring-event exceptions, tasks, attendees, meeting links, attachments, travel time, duplication, copy and paste, undo, and a 30-day trash. The taskbar date flyout shows the next seven days and exposes quick event creation.

Calendar previews imports before applying one undoable batch. It reads and writes RFC 5545 ICS data, including VEVENT, VTODO, RRULE, alarms, attendees, organizers, conferences, and attachments. This supports file exports from Google Calendar, Apple Calendar and iCloud, Microsoft Outlook, and other iCalendar applications. It also imports CSV and Google Takeout ZIP archives and can subscribe to public HTTP, HTTPS, or webcal feeds with conditional refresh and last-known-good recovery. Private Google, Microsoft, and Apple account synchronization is intentionally not presented as connected until the OS has provider-issued OAuth or CalDAV credentials and a secure token-vault flow; Calendar never asks users to paste provider passwords into ordinary settings. Calendar preferences are available from the app and the OS Control Panel. (Sources: `webgpu-os/factory/apps/calendar/store.js`, `webgpu-os/factory/apps/calendar/service.js`, `webgpu-os/factory/apps/calendar/interchange.js`, `webgpu-os/factory/apps/calendar/subscriptions.js`, `webgpu-os/factory/apps/calendar/settings-panel.js`, `webgpu-os/apps/calendar/manifest.json`.)

## Science & engineering

| App | id | Purpose |
| --- | --- | --- |
| [RealmForge](realmforge.md) | `os.realmforge` | Template-first modular workbench for source-authoritative `.proasset` assets, product-level construction, deterministic simulation, guarded AI operations, and trusted artifact publication. |
| [Smith Lab](smith-lab.md) | `os.smith-lab` | Guided 2D/3D Smith Chart learning, Touchstone measurement analysis, and deterministic impedance-matching synthesis. |

## Media & creative

Video Player (`os.video-player`) uses the engine media core for files, HTTP(S), HLS, playlists, and subtitles. Its **Watch Party** mode adds invitation links/codes and account-free browser viewers in the same app. The lightweight browser page also opens the complete player when no invitation is supplied. The host controls a party of up to five viewers; membership does not grant SecureMesh or OS authority. Legacy `os.watch-party` routes resolve to Video Player. See [Video Player and Watch Party](video-player-watch-party.md) for capabilities, deployment requirements, and codec validation limits.

| App | id | Purpose |
| --- | --- | --- |
| Paint | `paint` | Raster drawing app. |
| [Ambient Studio](ambient-studio.md) | `os.ambient-studio` | Typed-node and restricted-WGSL live wallpaper editor. |
| Sound | `sound` | Audio playback/synthesis (`AudioDriver`). |
| Music Studio | `os.music-studio` | Local composition, recording, sequencing, synthesis, mixing, score interchange, isolated music coding, MIDI, offline WAV export, and Particle Voice. |
| Particles | `particles` | GPU particle playground (engine `sim/particles`). |
| Fractal Studio | `fractal` | Mathematical 2D/3D renderer and live image, video, MP3/audio, feedback, and sound-fractal mixer. |

Music Studio is a dependency-free browser workstation. It provides an arrangement timeline, launcher, piano roll, drum sequencer, audio editor, 30 instruments, sample and natural-instrument synthesis, automation, mixer, effects, node routing, generator tools, MIDI import/export and live input, microphone recording, MusicXML/GPIF/GPX workflows, practice tools, an isolated Code Lab, audio analysis, and offline WAV rendering. Particle Voice runs from the repository's AGI implementation through the OS GPU broker and turns entered text into editable audio clips. Each voice take records its text, preset, pitch, word boundaries, and sample rate as synthesis provenance so it can support future singing-training workflows. Project data is stored through the app sandbox; imported binary material is chunked and content-addressed. (Sources: `webgpu-os/factory/apps/music-studio/MusicStudioApp.js`, `webgpu-os/factory/apps/music-studio/StudioRuntime.js`, `webgpu-os/factory/apps/music-studio/StudioRepository.js`, `webgpu-os/factory/apps/music-studio/VoiceWorkspace.js`, `webgpu-os/apps/music-studio/manifest.json`, `agi/particle_voice/model/ParticleVoiceModel.js`.)

Animated mathematical fractals now begin at the same native-first raster and iteration detail used by settled views instead of immediately falling to a low-resolution preview budget. A measured quality governor absorbs ordinary load through cadence, ignores short GPU spikes, and changes a bounded raster/detail tier only after sustained critical pressure. Detailed mode retains at least 96 percent raster scale and 98 percent iteration or ray-step detail, while hysteretic recovery returns the renderer to native quality after sustained headroom. Rapid pointer changes may present the already submitted live frame instead of starving presentation on generation churn, while target-size changes are deferred until the active GPU submission completes. The same continuity rule keeps feedback camera drags committing into the history ring. The live status strip and Console report the active quality tier, raster scale, detail scale, quality floor, and measured frame cost. (Sources: `webgpu-os/factory/apps/fractal/ProgressiveTileScheduler.js`, `webgpu-os/factory/apps/fractal/index.js`.)

Deep navigation uses a 65,536-decimal-digit on-demand CPU precision window around the current viewport, while the GPU receives only the local scaled mantissa/exponent delta and cached reference-orbit range needed for visible pixels. This removes the former 4,096-depth ceiling without allocating a world-sized texture: memory follows viewport dimensions, reference samples, and the currently requested coordinate precision. Presentation owns three persistent HDR surfaces—one back surface and two alternating completed frames—and reuses bounded temporal history to smooth mathematical animation. Direct pointer interaction raises the current-frame weight to limit ghosting and input lag. Feedback Studio retains its independent 32-frame recursion history on top of the same three-surface presentation ring. (Sources: `webgpu-os/factory/apps/fractal/DeepZoomMath.js`, `webgpu-os/factory/apps/fractal/index.js`.)

Fractal Studio includes a Feedback Studio workspace beside its mathematical renderer. Two media decks decode upright local images and looping videos through the shared engine surface pipeline, accept MP3 and other browser-decoded audio files, or take a user-approved live browser-tab capture so a playing YouTube tab can become a WebGPU feedback source. Independent source-axis flips are explicit effects rather than accidental orientation changes. Operators can inject visual media once or continuously, select 0–30 extra delay frames, apply radial feedback twist, and choose dual-beam, kaleidoscope, quadrant-fold, or three-way-prism splitting with controllable angle, mix, mirroring, and segment count.

One audio-reactive mixer owns source selection, FFT and envelope analysis, sound-fractal selection, and performance automation. It can analyze either media deck, an explicitly approved microphone, or separately shared tab/system audio. Its relative-energy analyzer derives low, middle, and high bands, spectral flux, spectral centroid, beat pulses, BPM confidence, beat phase, and four-beat bar position. Gentle, Balanced, and Intense Auto modes apply those signals as a non-destructive layer over the manual mixer. The layer drives deck crossfade, recursion gain, split geometry, camera motion, twist, and color. Turning Auto off restores the operator's manual values. (Sources: `webgpu-os/factory/apps/fractal/FractalAudioReactive.js`, `webgpu-os/factory/apps/fractal/FractalAutoMix.js`.)

The Performance Director adds Dream, Pulse, Prism, Cosmic, and Glitch looks. Adaptive mode selects looks from the current frequency balance and changes scenes on configurable two-, four-, eight-, or sixteen-bar boundaries. A deterministic shuffle bag prevents immediate repeats. Transitions span musical beats, and Reduced Flash bounds brightness and contrast changes by default. The live output includes a BPM and bar clock, twelve-band spectrum, look pads, one-action Auto, A/B crossfader, camera XY pad, Hold, Surprise, and Flip Mix. Keyboard shortcuts expose the same performance actions. These effective changes do not mutate the saved manual mixer. (Source: `webgpu-os/factory/apps/fractal/FractalPerformanceDirector.js`, `webgpu-os/factory/apps/fractal/index.js`.)

Captured audio analysis uses a zero-gain output to prevent duplicated sound and acoustic hearback, while local video and audio files remain audible through an owned OS audio session. All capture tracks, object URLs, GPU textures, media elements, and audio sessions remain lifecycle-owned. A persisted Console button, off by default, overlays bounded live diagnostics for renderer timing, delay-ring state, media transports, effective Auto Mix values, split geometry, attack/release audio bands, beat timing, Performance Director state, and errors. (Sources: `webgpu-os/factory/apps/fractal/FractalFeedbackRuntime.js`, `webgpu-os/factory/apps/fractal/FractalFeedbackMath.js`, `webgpu-os/factory/apps/fractal/FractalCaptureSource.js`, `webgpu-os/factory/apps/fractal/index.js`, `webgpu-os/apps/fractal/manifest.json`.)

## Games

| App | id | Purpose |
| --- | --- | --- |
| Minesweeper | `minesweeper` | Classic minesweeper. |
| Snake | `snake` | Classic snake. |
| Dimensional Pinball | `pinball` | Authored HDR/PBR pinball machine with deterministic physics, curved rails, gates, mission shots, five realities, multiball, procedural spatial audio, and accessible cabinet controls. |
| Solitaire | `solitaire` | Klondike solitaire. |

Dimensional Pinball runs its authoritative simulation at a seeded 240 Hz fixed step. The shared Dimensional Foundry layout defines a 6.5-degree playfield, curved cabinet crown, a stateful shooter return, active drain sensors below the resting flipper tips, ball-safe inlanes and outlanes, contact-triggered slingshots, an open flipper drain, dimension routes, and a qualified Shadow lock door. A displacement-based three-phase ball search waits 15 seconds before touching hardware, ignores false collision speed, pauses for a held-flipper cradle, recognizes downward drain progress, and safely re-serves a lone unrecoverable ball without changing score or ball count. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/index.js`, `webgpu-os/factory/apps/pinball/core/PinballSimWorld.js`.)

The machine is assembled from 58 immutable instances across 18 reusable semantic types. Ball, cabinet, door, flipper, gate, gravity well, insert, playfield, plunger, pop bumper, rail, ramp, sensor, shot, slingshot, standup target, trough, and wall packages own their physics, visuals, mechanics, wiring, initial runtime, and compatibility records. Coil and switch packages provide shared electromechanical subcomponents. A registry resolves deliberate aliases such as flapper, twanger, launcher, and drain; an order-preserving compiler projects the semantic assembly into the current solver collections; and a runtime adapter instantiates mutable devices with links back to their owning parts. See [Modular Pinball Parts](pinball-parts.md). (Sources: `webgpu-os/factory/apps/pinball/core/parts/index.js`, `webgpu-os/factory/apps/pinball/core/parts/assembly/PinballTableAssembler.js`, `webgpu-os/factory/apps/pinball/core/parts/assembly/PinballTableRuntime.js`.)

The electromechanical layer reuses the engine's spring-damper and motor-target math. The plunger stores Hooke-law spring energy and rebounds against a damped barrel stop. Each flipper advances through power stroke, EOS hold, release, and return-spring phases with reaction torque from the ball. Pop bumpers and slings combine passive rubber restitution with a debounced autofire coil and a shared travel state. That same state drives copper-coil PBR emission, linkage motion, bumper-ring travel, particles, and the live 240 Hz mechanism panel. Procedural spring links remain visual followers; deterministic scalar mechanics remain authoritative. (Sources: `engine/core/math/ConstraintMath.js`, `webgpu-os/factory/apps/pinball/core/parts/coil/ElectromechanicalActuator.js`, `webgpu-os/factory/apps/pinball/core/parts/flipper/index.js`, `webgpu-os/factory/apps/pinball/core/parts/plunger/index.js`.)

Seven ordered shots lead from the calibrated skill shot to one three-ball lock cycle, multiball, Super Jackpot, and the Chaos wizard mode. Matter, Particle, Gravity, Shadow, and Chaos alter active mechanisms through one atomic dimension event while preserving score and actor attribution. Only the current reality's physical route and shot guidance are rendered; the other dimensional machines leave both the collision world and the visual pass until shifted in. (Sources: `webgpu-os/factory/apps/pinball/core/PinballSimWorld.js`, `webgpu-os/factory/apps/pinball/render/TableRenderer3D.js`, `webgpu-os/factory/apps/pinball/ai/AdaptiveAI.js`.)

The GPU path reuses the engine PBR BRDF, renders into an HDR target, and applies selective bloom, ACES tone mapping, physical playfield inclination, fitted player and cinematic cameras, active particles, and a high-contrast ball. The app opens at a full 1180-by-820 workspace size. Windows at least 980 by 620 CSS pixels use one explicit landscape cockpit mode: the cabinet consumes the usable height while mission control and actuator instruments dock directly beside it, and the shooter power readout occupies the right instrument rail instead of covering the table. Short windows retain the safer complete-table fit. The shared UI style injector refreshes changed application CSS during remounts, preventing an older fullscreen layout from surviving a rebuilt app. A provenance-tracked sRGB Dimensional Foundry illustration supplies the printed playfield while the engine retains rails, mechanisms, inserts, materials, and lighting. Canvas 2D projects the same artwork beneath the same authored mechanisms, including the compressing copper spring and powered coils, as the complete fallback. Procedural audio uses separate music, voice, and effects buses and gives each ball-search phase physical feedback. (Sources: `webgpu-os/factory/sdk/ui/index.js`, `webgpu-os/factory/apps/pinball/index.js`, `webgpu-os/factory/apps/pinball/render/PlayfieldArt.js`, `webgpu-os/factory/apps/pinball/render/TableCamera.js`, `webgpu-os/factory/apps/pinball/render/TableRenderer3D.js`, `webgpu-os/factory/apps/pinball/render/PlayfieldRenderer2D.js`, `webgpu-os/factory/apps/pinball/audio/PinballAudio.js`.)

Left and Right Shift provide cabinet-style flipper controls alongside keyboard presets and multi-touch zones. Touch affordances appear only on touch-first coarse-pointer devices and remain completely hidden with a desktop mouse or trackpad. Settings cover motion, camera framing, bloom, flash, audio, quality, assistance, and input. F8 opens live render and physics statistics. (Sources: `webgpu-os/factory/apps/pinball/core/PinballInput.js`, `webgpu-os/factory/apps/pinball/index.js`, `webgpu-os/apps/pinball/manifest.json`.)

## Adding an app

Create `apps/<id>/manifest.json` + an entry module that default-exports a class with `async mount(root, syscalls)`, then add `<id>` to `apps/index.json`. See [Architecture](architecture.md) and the templates in `webgpu-os/templates/`.
