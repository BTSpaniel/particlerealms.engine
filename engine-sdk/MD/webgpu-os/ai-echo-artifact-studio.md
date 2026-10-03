---
title: AI Echo Artifact Studio
description: File-backed, versioned work products and safe generative previews for AI Echo.
updated: 2026-08-01
---

# AI Echo Artifact Studio

AI Echo can turn substantial responses into durable work products that open
beside the conversation. Documents, code, data, tables, charts, declarative
interfaces, and static web presentations remain ordinary WebGPU OS files under
`/user/artifacts`. The Files app can browse them, and ordinary deletion sends
the complete artifact project to the Recycle Bin.

Artifact Studio is separate from [AI Echo Live Patch](ai-echo-live-patch.md).
Artifacts are user-owned content. Live Patch is the reviewed, reversible way
to promote selected content into an existing OS or browser surface.

## Interaction model

1. AI Echo calls a declared `artifacts.*` tool when a substantial work product
   should remain editable or previewable.
2. The Artifact Workspace validates the exact project, blocks likely secrets,
   writes an immutable revision, and verifies every file by SHA-256 readback.
3. Only a small revision-qualified artifact reference travels through the
   executor, conversation record, and Navi task. It binds the artifact ID,
   exact revision, and SHA-256 content hash, so an older message never silently
   resolves to a newer edit. Provider prose never becomes canonical state.
4. The response shows an artifact card. Opening it reveals Artifact Studio
   without leaving the task.
5. Direct edits create another immutable revision with compare-and-swap
   protection. Stale editors receive a revision conflict instead of silently
   overwriting newer work.
6. Copy, download, revision restore, Recycle Bin, and **Open in Files** remain
   direct user actions.

The Studio refreshes through the storage event stream already shared by Files,
other apps, tabs, and workers. It does not create a second synchronization or
locking layer.

## On-disk contract

Each artifact uses a locally generated identifier. Models choose content and
metadata, but they never choose an OS path.

```text
/user/artifacts/
  artifact_<random-id>/
    artifact.json
    <current entry and support files>
    .artifact/
      projection.json
    revisions/
      000001-<random>/
        revision.json
        <entry and support files>
      000002-<random>/
        revision.json
        <entry and support files>
```

The files directly inside `artifact_<random-id>` are the current, manageable
working projection shown by Files and Artifact Studio. Logical project paths
such as `src/`, `assets/`, and `data/` stay modular; they are not flattened or
hidden under an opaque revision key. `.artifact` and `revisions` are reserved
OS-owned metadata directories and cannot be supplied by a model as content.

`artifact.json` is the atomically advanced pointer. A revision records its
parent revision, parent content hash, entrypoint, file descriptors, source
provenance, and aggregate content hash. The manifest retains a bounded history
of committed revisions. Artifact Workspace first writes and verifies the
immutable revision, then publishes and verifies the direct working projection,
and advances `artifact.json` last. A crash may leave unreferenced derived files
or a revision directory, but cannot replace the last committed pointer with
partially written canonical content. Canonical reads continue to verify the
immutable revision and its root-level projection independently.

This boundary follows the browser platform rather than pretending it offers a
multi-file transaction. The [File System specification](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable)
defines safe replacement for one file; the project therefore uses immutable
revision files, per-file compare-and-swap, readback hashes, and manifest-last
publication to detect an interrupted multi-file projection. Artifact data is
still origin storage, so the OS storage-health and backup controls remain
authoritative under the [Storage Standard persistence model](https://storage.spec.whatwg.org/#persistence).

## Rendering trust tiers

| Tier | Artifact kinds | Execution boundary |
|---|---|---|
| Native | Document, code, data | DOM nodes built with `textContent`; no generated code runs. |
| Declarative | Table, chart, UI | A strict JSON grammar selects known components; unknown fields, nodes, URLs, depth, or size are rejected. |
| Opaque sandbox | Static web presentation | A unique-origin iframe with no script, same-origin, form, popup, download, navigation, or network authority and a restrictive content security policy. |

Declarative buttons emit typed artifact intents. They cannot call tools,
storage, the network, Live Patch, or credentials directly. An intent must
re-enter AI Echo's planner, Faculty runtime, Tool Firewall, exact approval, and
receipt path.

Generated web content is never inserted into AI Echo's DOM. Web previews retain
sanitized HTML and local or inline CSS, but all scripts, event handlers,
navigation targets, and JavaScript support files are removed. Interactive work
uses the strict declarative component renderer, whose current bounded input
values accompany each typed intent.

## Tool surface

The app-owned tools are:

- `os.ai-echo.artifacts.list`
- `os.ai-echo.artifacts.read`
- `os.ai-echo.artifacts.create`
- `os.ai-echo.artifacts.update`
- `os.ai-echo.artifacts.revisions`
- `os.ai-echo.artifacts.restore`
- `os.ai-echo.artifacts.trash`

Schemas reject unknown fields. Mutations declare the files authority domain,
exact predicted paths, classification access, and verification callback.
Update and restore bind the expected revision. Trash uses the OS Recycle Bin;
there is no model-facing permanent-delete tool.

## Security invariants

- Artifact IDs and revision keys require browser cryptographic randomness.
- Every stored file and revision is verified after write.
- Likely API keys, tokens, passwords, and private keys are rejected. The
  Artifact folder is an OS file workspace, not a secret vault. Secret scanning
  covers titles and summaries as well as file bodies.
- File paths cannot escape the artifact project or replace reserved metadata.
- Create and update reject ambiguous payloads that combine `files` with the
  single-file `content` or `filename` form. Entrypoints must name one supplied
  file, paths are unique case-insensitively, and only one file can have the
  entry role.
- Artifact references are bounded, revision-qualified, and hash-validated
  before entering durable run or conversation state; content is never copied
  into those records. Fork/import session remapping detaches references that
  cannot retain their original task scope.
- Private-Navi and restricted artifacts remain locally inspectable, but their
  metadata, content, paths, and originating tool arguments are withheld from
  remote provider context.
- Catalog discovery and creation are bounded to 512 direct artifact projects;
  listing never recursively walks arbitrary descendants.
- Corrupt manifests and hash mismatches fail closed.
- Live Patch cannot target the rendered artifact content root. Only the Studio
  chrome is eligible for reviewed appearance changes.
- The implementation is browser-native ES modules plus the existing Python
  tooling. It has no Node.js, npm, server runtime, or third-party artifact
  dependency.

## Choosing artifacts, files, and Live Patch

Use an artifact for a coherent work product that benefits from a card, preview,
revision history, or continued editing. Use normal workspace file tools when
the exact project layout is already known or the file belongs to an existing
codebase. Use Live Patch only when the user asks to change a running interface
and accepts the exact reviewed patch.

## Verification

Run the focused artifact workspace and tool-descriptor checks, followed by the
AI Echo smoke suite, import audit, documentation builders, and no-cache OS
bundle. The UI checks cover inline card to Studio navigation, session restore,
live file refresh, exact Files navigation, responsive layout, hostile
declarative input, and sandbox attributes.
