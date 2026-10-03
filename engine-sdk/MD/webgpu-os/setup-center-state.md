---
title: Setup Center State and Migration
description: Setup Center ownership, generation fencing, review drafts, three-way compare-and-swap receipts, and conservative legacy migration.
updated: 2026-08-24
---

# Setup Center State and Migration

This page documents Setup Center's implemented state contract for OS and UX
maintainers. Setup Center coordinates onboarding and records conflict-safe
review progress. It does not become a second theme, profile, workspace, AI,
Companion, privacy, or system-release authority.

## State ownership

Setup Center stores two versioned aggregate records:

| Record | Scope | Contents |
| --- | --- | --- |
| Account setup state | Active account and operator generation | Experience version, required/completed progress, section review metadata, bounded receipts |
| Device setup state | Installation/device | Device-owned Installation section review metadata and bounded receipts |

Account state and drafts use the account-scoped `AppSandbox`. Device state uses
an explicitly device-scoped sandbox. `SetupStateService` participates in
`OperatorContext`: it freezes, drains, closes old sandboxes, binds the new
account generation, and resumes only after the new scope is current. A stale
mutation cannot publish into another account. (Source:
`webgpu-os/kernel/setup/SetupStateService.js`.)

The current sections are Overview, Appearance, Profile, AI Echo, Workspace,
Installation, Privacy, and Welcome. Installation is device-owned; the other
sections are account-owned. Overview, Appearance, Profile, Workspace, Privacy,
and Welcome are required for the current experience version. (Source:
`webgpu-os/kernel/setup/SetupContracts.js`.)

## Non-authoritative design

Each section currently stores one `reviewed` field plus revision, provenance,
and audit timestamp. It does not store the actual theme, profile, AI route,
credential, workspace, privacy policy, or release package. The Setup Center UI
links users to the existing authoritative surfaces for those changes. Closing a
returning-account draft with no edits changes no canonical settings. (Sources:
`webgpu-os/kernel/setup/SetupContracts.js`,
`webgpu-os/factory/apps/setup-center/SetupCenterApp.js`, and
`webgpu-os/factory/apps/settings/SettingsApp.js`.)

This separation is important: a setup receipt proves that a section was
reviewed. It does not grant authority to overwrite the setting described by
that section.

## Onboarding lifecycle

Profile creation remains User Management-owned. After a verified profile
becomes the active published `OperatorContext` generation, the onboarding
coordinator resolves the canonical `os.setup-center` manifest and factory before
mutating setup state. It then selects a mode:

- `first` for a newly created or required current experience;
- `returning` once per experience version for an existing unfinished account;
- `interrupted` when a durable draft already exists;
- `automatic` when the caller wants Setup Center to derive the mode;
- `recovery` and `update-handoff` for explicit recovery/update entry points.

Returning setup must open with an empty dirty set. A completed or already
presented experience is not forced open again. Setup Center remains launchable
as a normal OS app afterward. (Sources:
`webgpu-os/kernel/setup/SetupOnboardingCoordinator.js`,
`webgpu-os/kernel/setup/SetupContracts.js`, and
`webgpu-os/apps/setup-center/manifest.json`.)

## Draft and three-way commit

Opening Setup Center creates or resumes an account-owned draft. Each section
captures:

- owner, base revision, and SHA-256 base hash;
- base field values and desired field values;
- the exact dirty-field set;
- a draft ID, account ID, mode, and audit timestamps.

`commitSection()` uses field-level three-way compare-and-swap:

| Current value | Result |
| --- | --- |
| Equals desired | Record idempotent success. |
| Equals base | Apply the explicit user change and advance revision/provenance. |
| Differs from base and desired | Preserve current data and report a conflict. |

The service verifies the section base hash whenever its revision still equals
the draft base revision. Every mutation has a stable mutation ID and an
idempotent receipt that records applied, already-satisfied, and conflicting
fields. A UI review supplies its desired `reviewed` value to `commitSection()`;
the service updates the draft and commits it inside the same serialized kernel
mutation so another Setup Center window cannot substitute a different pending
value between those steps. `saveDraft()` remains available for an explicitly
staged draft. Section receipts bind the requested reviewed value, so reusing a
mutation ID with the opposite intent fails closed. Receipts are bounded; a
replay with the same ID must match the original kind, section, owner, and
reviewed intent. (Sources:
`webgpu-os/kernel/setup/SetupContracts.js` and
`webgpu-os/kernel/setup/SetupStateService.js`.)

Completing setup requires every required section's `reviewed` value to be true.
The service commits completion before deleting the draft and reconciles a crash
that occurs between those writes by recognizing the existing completion
receipt. Discard deletes only the setup draft. Because current Setup Center
does not own live setting previews, discard has no authority to roll back theme
or other service state. Each open Setup Center instance leases the shared draft;
closing an instance releases only its lease, and the service removes a pristine
draft only after the final lease closes. A stale window therefore cannot erase
another active window's review draft. (Source:
`webgpu-os/kernel/setup/SetupStateService.js`.)

## Legacy/default migration

Legacy migration is deliberately narrower than general settings migration. The
implemented API imports one section's legacy `reviewed` marker and records a
source ID, source revision, provenance, factory default, and timestamp. It does
not import canonical theme, profile, workspace, AI, credential, privacy, or
release data. (Source: `webgpu-os/kernel/setup/SetupStateService.js`.)

Precedence uses revisions and provenance, not wall-clock ordering:

1. Skip a legacy generated default or a value equal to the stated factory
   default.
2. Record idempotent success when source and destination already agree.
3. Apply a real legacy value only when the destination is pristine
   `generated-default`, revision `0`, with no prior update timestamp.
4. Preserve `user` or `imported` destination data and record a conflict.
5. Preserve a destination with a newer revision.
6. Preserve ambiguous non-default data and require review.

Timestamps remain on receipts for audit. They never authorize overwrite.
Mutation receipts make migration replay idempotent, so an old source cannot
later overwrite a changed destination. (Source:
`webgpu-os/kernel/setup/SetupContracts.js`.)

The broader desktop/app-settings migration uses its own verified, allowlisted
copy/hash/compare-and-swap process and must not be conflated with Setup Center
review migration. See [Operator, SecureMesh, and Agent Boundaries](operator-securemesh.md#legacy-desktop-and-settings-migration).

## Guarded APIs

The kernel exposes:

- `setup.status()` and `setup.onChange()` for bounded read projection;
- `setup.open()`, `setup.draft()`, `acknowledgePresentation()`, `saveDraft()`,
  `commitSection()`, `complete()`, `close()`, `discard()`, and
  `migrateLegacy()` for the canonical Setup Center surface.

Mutations require `setup.manage` and are reserved to `os.setup-center`. Read
projection requires `setup.read`. Setup Center never receives direct release
registry, OPFS, trust-root, package, or secret-vault access. The system-release
projection is independently guarded. (Source: `webgpu-os/kernel/Syscalls.js`.)

## Recovery behavior

An interrupted draft remains account-scoped and resumes only under the same
account. A future or malformed setup schema fails validation rather than being
silently normalized. An operator switch revokes the old service generation and
closes both sandboxes. A returning account sees current authoritative summaries
and an empty dirty set, so merely opening and closing Setup Center preserves the
desktop and settings. (Sources: `webgpu-os/kernel/setup/SetupContracts.js`,
`webgpu-os/kernel/setup/SetupStateService.js`, and
`webgpu-os/kernel/setup/SetupOnboardingCoordinator.js`.)

## Verification commands

```powershell
python tests/network/run_realm_browser_tests.py `
  tests/webgpu-os-setup-center.html `
  tests/webgpu-os-operator-runtime.html `
  --timeout-ms 60000
```

These suites cover first/returning/interrupted setup, empty-dirty open, CAS
conflicts, migration precedence and replay, generation fencing, profile
switches, and integration with existing operator state. (Sources:
`tests/webgpu-os-setup-center.test.js` and
`tests/webgpu-os-operator-runtime.test.js`.)

## See also

- [Installed System Releases](installed-system-releases.md)
- [Runtime Handoff, Realm Host, and Update Swarm](runtime-handoff-and-update-swarm.md)
- [Operator, SecureMesh, and Agent Boundaries](operator-securemesh.md)
- [Security and Trust Model](../concepts/security-model.md)
