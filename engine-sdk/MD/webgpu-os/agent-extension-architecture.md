---
title: AI Echo Agent Extension Architecture
description: How WebGPU OS separates workspace instructions, on-demand skills, isolated agents, typed tools, deterministic policy, and reviewed memory.
updated: 2026-08-29
---

# AI Echo Agent Extension Architecture

This page is for contributors who write project instructions, skills, agents, tools, policy, or durable memory for AI Echo. It defines which layer to use, how progressive disclosure works, and which security boundaries the current implementation enforces.

## Choose the smallest extension layer

Modern agent systems separate durable context from task-specific workflows and executable authority. AI Echo follows the same division, with stricter local authority boundaries.

| Need | Extension layer | Loaded or run |
| --- | --- | --- |
| Repository or path convention | Workspace instruction or rule | For every applicable task |
| Specialized repeatable workflow | `SKILL.md` | On demand after activation |
| Parallel or context-heavy responsibility | Isolated agent | In a bounded independent context with an explicit handoff |
| Exact external action or structured observation | Typed tool or MCP adapter | Only through its declared schema and live authority path |
| Invariant that must run or block predictably | Deterministic hook or kernel policy | At the defined lifecycle boundary |
| Durable fact or decision | Reviewed memory | Only after provenance, scope, retention, and review are established |

Do not put every behavior into a large always-on prompt. Keep workspace instructions short. Move specialized procedures into skills. Use tools only for exact operations, hooks only for deterministic enforcement, and memory only for reviewed durable knowledge. (Source: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`.)

This layer choice aligns with the public [Agent Skills specification](https://agentskills.io/specification), [Claude Code skills](https://code.claude.com/docs/en/skills), [Claude Code project memory](https://code.claude.com/docs/en/memory), [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [OpenAI Codex skills](https://developers.openai.com/codex/skills/), and [OpenAI Codex `AGENTS.md` guidance](https://developers.openai.com/codex/guides/agents-md/). Gemini, GitHub Copilot, and Cursor document the same broad split between persistent instructions and on-demand skills: [Gemini context files](https://geminicli.com/docs/cli/gemini-md/), [Gemini Agent Skills](https://geminicli.com/docs/cli/skills/), [GitHub Copilot custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions), [GitHub Copilot skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Cursor rules](https://cursor.com/docs/rules), and [Cursor skills](https://cursor.com/docs/skills).

## Workspace instructions are scoped guidance

`loadWorkspaceConventions()` loads bounded instruction evidence from the active workspace. Root-level instruction families include:

- `AGENTS.md` and `AGENTS.override.md` from the workspace root through applicable target ancestors.
- `CLAUDE.md` and `.claude/CLAUDE.md`.
- `GEMINI.md`.
- `.github/copilot-instructions.md`.
- `.cursorrules` and `.windsurfrules`.
- Existing project files: `CONVENTIONS.md`, `STYLE.md`, `RULES.md`, and `.ai-echo/RULES.md`.

The loader also finds bounded modular rules in `.ai-echo/rules/*.md`, `rules/*.md`, `.claude/rules/*.md`, `.github/instructions/*.instructions.md`, and `.cursor/rules/*.mdc`. It recognizes a small frontmatter subset for `paths`, `globs`, `applyTo`, and `alwaysApply`. Path-scoped rules apply only when they match a normalized target path. A closer `AGENTS.override.md` replaces `AGENTS.md` in the same directory, and applicable `AGENTS` files remain ordered from broad to specific. (Source: `webgpu-os/apps/ai-echo/WorkspaceConventions.js`.)

Instruction contents are non-executable evidence. The loader does not follow imports, execute hooks, or grant tools or permissions. It caps target paths, directories, discovered entries, files, per-file text, and combined context. It returns source paths, content hashes, omissions, matched targets, and provenance when metadata is requested. AI Echo resolves mounted workspace intent and target paths before loading conventions into the Navi context. (Sources: `webgpu-os/apps/ai-echo/WorkspaceConventions.js`, `webgpu-os/apps/ai-echo/factory.js`.)

## Skills use progressive disclosure

The Agent Skills format puts `name` and `description` in YAML frontmatter and the instructions in the Markdown body. The public specification recommends three disclosure stages: catalog metadata, activated instructions, then supporting resources only when needed. AI Echo mirrors those stages for built-in and reviewed guidance Faculties. Metadata projection does not retain instruction bodies or resource locators. Activation adds instructions. An explicit supporting-resource request discloses trusted built-in resource URIs. (Sources: [Agent Skills progressive disclosure](https://agentskills.io/specification#progressive-disclosure), `webgpu-os/apps/ai-echo/GuidanceFaculty.js`, `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`.)

`DynamicSkillEngine` activates reviewed guidance from bounded evidence:

- Exact `/skill-id` or `$skill-id` invocation in the current objective.
- Positive trigger phrases and a conservative description-term match.
- Required live tool compatibility.
- Optional include and exclude path scopes.
- Enabled state and built-in or explicit human-review status.

Quoted text, code blocks, and negated clauses do not create positive activation evidence. Evaluation returns reason codes and matched evidence for inspection. The prompt projection then removes activation scores, provenance, capabilities, and authority fields before the model receives active guidance. Required tools are compatibility gates only. Skill selection does not widen the current turn's offered tool surface. (Sources: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`, `webgpu-os/apps/ai-echo/factory.js`.)

## Portable workspace packages are read-only

`discoverWorkspaceSkillPackages(storage, options)` discovers project packages from these roots, in deterministic precedence order:

1. `.agents/skills/`
2. `.claude/skills/`
3. `.github/skills/`
4. `.gemini/skills/`
5. `.cursor/skills/`

Each package must be an immediate `<name>/SKILL.md` child. The strict portable parser requires folder-matching lowercase names, a useful description, bounded frontmatter and body content, and only `name`, `description`, `license`, `compatibility`, `metadata`, and experimental `allowed-tools` fields. It rejects unsafe paths, malformed Unicode, unsupported YAML features, duplicates, invalid winners, ambiguous collisions, and incomplete higher-precedence scans. (Source: `webgpu-os/apps/ai-echo/WorkspaceSkillPackages.js`.)

Discovery returns metadata and diagnostics without exposing instruction bodies, hashes, package paths, or resource listings through the catalog. Exact activation is an application API call:

```javascript
const packages = await discoverWorkspaceSkillPackages(storage, {
  workspaceRoot: "/mnt/project"
});

const catalog = packages.catalog;
const activated = packages.activate("release-audit");
```

`activate(name)` returns the exact instruction body, content hash, and provenance for one validated name. The current loader is intentionally instruction-only: it does not read or enumerate `scripts/`, `references/`, or `assets`; it never executes package code; and `allowed-tools` becomes `requestedToolHints` with `requestedToolHintsAreAuthority: false`. Discovery or activation does not auto-approve, auto-enable, import, or execute a workspace package. The loader API is not currently connected to AI Echo's reviewed persistent skill catalog. (Source: `webgpu-os/apps/ai-echo/WorkspaceSkillPackages.js`.)

## Tools and hooks remain separate authority systems

A skill can explain how to use a tool. It cannot mint the capability to call one. `ToolRouter` binds live descriptors and schemas, rejects suspicious or undeclared parameters, gates calls on capabilities and affordances, and treats every result as an untrusted observation. `ToolDriver` owns stable tool schemas. `ToolActionReview` explains risk and validates the declared argument shape, but it is not an authority source. AI Echo's WebMCP bridge applies the same rule to page-owned tools: page descriptions, schemas, and annotations remain untrusted until exact rediscovery and review. (Sources: `webgpu-os/kernel/tools/ToolRouter.js`, `webgpu-os/kernel/ToolDriver.js`, `webgpu-os/kernel/execution/ToolActionReview.js`, `webgpu-os/apps/ai-echo/AgentToolset.js`.)

Use a deterministic hook or kernel policy when a rule must always run, block, or verify at a lifecycle boundary. Do not encode such an invariant only as prompt prose. Imported hook text and skill scripts do not become WebGPU OS hooks by being present in a package. (Source: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`.)

The current workspace loaders do not discover vendor agent-definition folders or install vendor hooks. Isolated agents, typed adapters, and deterministic hooks are layer choices in the built-in architecture guidance; they are not capabilities imported from `.claude/agents/`, `.github/agents/`, or skill package files. (Sources: `webgpu-os/apps/ai-echo/WorkspaceConventions.js`, `webgpu-os/apps/ai-echo/WorkspaceSkillPackages.js`, `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`.)

### Programmatic Faculty orchestrates existing authority

Programmatic Faculty lets the planner run one bounded orchestration program in
an isolated Faculty Worker. Before any Worker opens, the runner parses a closed
subset containing `const` tool results, awaited tool actions, literal arrays and
objects, input or prior-result literal property paths, and one final return.
Loops, functions, operators, constructors, arbitrary calls, globals, and
dynamic keys are rejected. Only the canonical compiled body receives frozen
`input` and `tools`, not the kernel, ambient credentials, or a way to mint
capabilities. The host binds the explicit
`navi-programmatic-bounded-source-v1` profile and separate submitted-source and
canonical-compiled-source hashes to the exact Navi, request, task, session,
planner round, and sorted live descriptor and schema hashes. It also binds the
input, allowlists, and call budgets. Only exact `safe_read` tools without
external or step-up authority enter this lane. (Sources:
`webgpu-os/kernel/navi/NaviProgrammaticFacultyRunner.js` and
`webgpu-os/kernel/execution/TwoPassPlannerFinalizer.js`.)

The Kernel reserves an exact resource lease for one Worker against the active
task and covenant. The host consumes `workerCount: 1` only after source and
input validation plus the initial abort check, immediately before opening the
sandbox. After any asynchronous consume or durable reconciliation, the Kernel
rechecks the exact task branch and full resource vector, captured Continuity and
ResourceService identities, and active Covenant ID, revision, full ceiling
vector, and effective window at the final Worker-open boundary. The task and
Covenant bindings also enter the deterministic lease hash. A private
ResourceService marker distinguishes true post-commit
reservation, consume, settle, and release failures from copied error codes;
each is reconciled from the exact lease, while an unknown outcome fails closed
for recovery. A started Worker
settles the full terminal usage vector on success or failure, while a
proven-unstarted run releases its unused reservation. Resource denial opens no
Worker and dispatches no tool. (Sources:
`webgpu-os/kernel/KernelBootstrap.js` and
`webgpu-os/kernel/navi/NaviFacultyWorkerHost.js`.)

`tools.call()` preserves committed serial order. `tools.parallel()` accepts
only a completely validated bounded batch of independent safe reads. Every
inner call still passes through the normal authorization, Faculty,
`ToolRouter`, verification, accounting, and receipt path. Mutating, external,
and approval-bearing tools use the ordinary planner path instead. Large prior
observations remain request-local: AI Echo scrubs the provider projection before
retaining it, and `tools.readResult()` can read only bounded slices through the
request-bound host resolver. A result handle grants no tool or storage
authority. (Sources:
`webgpu-os/kernel/execution/NaviToolResultContext.js`,
`webgpu-os/kernel/navi/NaviProgrammaticFacultyRunner.js`, and
`webgpu-os/kernel/KernelBootstrap.js`.)

Pure-local speculation is a separate, stricter scheduling optimization. A
shadow can start only for a certified pure, deterministic, kernel-owned,
local-only, no-egress, no-authority operation. The canonical call must still
finish live authorization before it can adopt one exact matching shadow value;
verification and Faculty receipt settlement remain canonical. Mutation,
external access, approvals, descriptor drift, branch drift, or argument drift
forbid adoption. Acceptance is not reported as a hit: only one-shot
`ToolDriver` consumption credits adoption and estimated saved latency; every
other settlement is reported separately without content. (Sources:
`webgpu-os/kernel/navi/NaviPureLocalSpeculation.js` and
`webgpu-os/kernel/ToolDriver.js`.)

Programmatic Faculty and speculative lifecycle telemetry is content-free. An
event declaring `contentIncluded: false` never receives the task state or
objective, and its detail projection excludes tool arguments, results, values,
and secret bytes. (Source:
`webgpu-os/kernel/execution/TwoPassPlannerFinalizer.js`.)

The current closed lane admits only the audited `calculator.evaluate` kernel
implementation. Generic synchronous transforms are excluded until their CPU
and heap use can be preempted by a quota-capable Worker or interpreter.

## Slash commands project the live OS registries

AI Echo does not maintain a second hardcoded command catalog. Typing `/` builds a bounded metadata projection from the current AppRegistry, manifest actions, app subsurfaces, opt-in CommandBus entries, ToolDriver descriptors, and reviewed guidance skills. Canonical names remain source-qualified:

- `/app:<app-id>` opens a current launchable app.
- `/action:<app-id>:<action-id>` requests a current manifest action.
- `/go:<app-id>:<subsurface-id>` opens a current app view.
- `/cmd:<command>` invokes only commands that explicitly opted into search.
- `/tool:<tool-name> <task>` requests one exact currently declared tool through the normal agent authority path.
- `/skill:<skill-id> <task>` selects one enabled built-in or human-reviewed guidance skill for the current turn.

Short aliases appear only when they are globally unique. A collision removes the alias instead of choosing a first or last winner. Register, update, unregister, package enable or disable, and tool lifecycle events revise the discovery catalog. AI Echo also reloads and revalidates the exact descriptor and current package state at submission. A stale, missing, orphaned, hidden, background, overlay, or disabled app surface cannot dispatch. (Sources: `webgpu-os/apps/ai-echo/SlashCommandRegistry.js`, `webgpu-os/apps/ai-echo/factory.js`, `webgpu-os/kernel/SearchManager.js`, `webgpu-os/packages/PackageManager.js`.)

Local app, view, action, and opt-in OS command rows never enter the model path. Tool and skill rows are different: they start a normal AI turn without granting new authority. An exact tool must already be live, declared to AI Echo, locally permitted, owned by a present enabled package, and schema-visible; that exact tool is the only task tool offered for the turn, and it is checked again immediately before provider dispatch. A selected skill must remain enabled and retain its exact human-review binding through dispatch. Slash-shaped composer input also requires a browser-trusted operator edit or palette selection and a browser-trusted submission bound to that unchanged draft. Synthetic events, direct ToolDriver execution, shell parsing, pasted-command execution, and unknown-command chat fallback are deliberately absent. (Sources: `webgpu-os/apps/ai-echo/factory.js`, `webgpu-os/kernel/CommandBus.js`, `webgpu-os/kernel/tools/ToolRouter.js`.)

This follows current composer conventions in [ChatGPT slash commands](https://learn.chatgpt.com/docs/reference/slash-commands), [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [Claude Code skills](https://code.claude.com/docs/en/skills), and [Gemini CLI commands](https://geminicli.com/docs/reference/commands). WebGPU OS is stricter at the authority boundary: discovery metadata never becomes permission, app state is checked at dispatch, tool selection stays inside the reviewed ToolRouter path, and command failures cannot be reported as success.

## Memory requires provenance and review

Durable memory stores accepted facts and decisions, not hidden reasoning, transient scratch work, or unreviewed imported text. Document ingestion treats source files as untrusted evidence, produces proposals, and requires explicit review before canonical promotion. A scan or digest alone changes no Navi knowledge. (Sources: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`, `webgpu-os/apps/ai-echo/DocumentIngestService.js`; see [AI Echo Design and Knowledge Workflows](ai-echo-design-and-knowledge-workflows.md).)

## Author a portable skill

Use the portable core for behavior shared across clients. Put vendor-only invocation, agent, model, hook, tool, or UI behavior in a clearly named adapter.

1. Create `.agents/skills/<name>/SKILL.md`.
2. Use a lowercase, hyphenated `name` that exactly matches the folder.
3. Write a description that states what the skill does, when to use it, and when not to use it.
4. Keep the body focused on inputs, bounded steps, outputs, stop conditions, validation, and failure handling.
5. Keep specialized reference material outside the core body for clients that support third-stage resources.
6. Treat `allowed-tools` as a compatibility hint, never as a portable permission grant.
7. Test activation with positive, near-miss, quoted, code-block, negated, wrong-path, and missing-tool cases.
8. Test the outcome with representative tasks, not only keyword detection.

```markdown
---
name: release-audit
description: Audit a release against repository gates and return receipt-backed failures. Use before a release candidate. Do not use for ordinary feature planning.
compatibility: Requires the project test commands documented in repository instructions.
---

## Release audit

## Inputs

- The exact release target.
- Applicable repository instructions.
- Existing deterministic verification commands.

## Procedure

1. Resolve the target and applicable rules.
2. Run only declared verification commands through the live authority path.
3. Stop on missing authority, changed descriptors, or incomplete evidence.
4. Report passed, failed, and unresolved gates separately.
```

The format follows the [Agent Skills `SKILL.md` specification](https://agentskills.io/specification). WebGPU OS intentionally validates a strict, bounded subset in `WorkspaceSkillPackages.js`.

## Evaluate activation and outcomes

An activation set should include expected matches and hard negatives:

| Objective | Expected result | Reason |
| --- | --- | --- |
| `Run /release-audit for this candidate.` | Activate | Exact current-turn invocation |
| `Audit this release candidate.` | Activate if reviewed metadata supplies matching evidence | Positive task evidence |
| `Do not run release-audit.` | Do not activate | Negated clause |
| `Explain the literal command /release-audit.` | Do not activate | A descriptive mention is not an invocation |
| `Plan the next feature.` | Do not activate | Near-miss task |
| `Audit generated output` outside an allowed path | Do not activate | Path exclusion |

Activation accuracy is necessary but insufficient. Outcome evaluation should also verify that the extension chose the correct layer, respected tool and memory authority, stopped on missing evidence, produced the declared output, and left a receipt-backed verification trail. The built-in `agent_extension_architect` guidance records positive, near-miss, adversarial, and model-projection evaluation cases for this purpose. (Source: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`.)

## See also

- [AI Echo Design and Knowledge Workflows](ai-echo-design-and-knowledge-workflows.md)
- [Security & Trust Model](../concepts/security-model.md)
- [Navi Architecture and Delivery](navi-architecture-and-delivery.md)
- [Agent Skills client implementation guide](https://agentskills.io/client-implementation/adding-skills-support)
