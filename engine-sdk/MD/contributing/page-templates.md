---
title: Page Templates
description: Copy-paste skeletons for new pages (overview, guide, reference, explanation) and guidance on when to use each.
updated: 2026-06-05
---

# Page Templates

Copy-paste skeletons for new pages. The full files live in `MD/_templates/`; this page explains when to use each and shows the shape.

## When to use which

| Template | Use for |
| --- | --- |
| `_templates/overview.md` | A subsystem or major-area landing page (what/who, module map). |
| `_templates/guide.md` | A task-based how-to (prerequisites → steps → verify). |
| `_templates/tutorial.md` | A longer, end-to-end learning path with a concrete goal. |
| `_templates/api-entry.md` | A hand-written reference entry (most reference is auto-generated). |

## Overview skeleton

```markdown
# <Subsystem> Overview

<One or two sentences: what this is and who it's for.>

## What it provides
- ...

## Module map
| Module | Path | Purpose |
| --- | --- | --- |

## Next steps
- [Architecture](architecture.md)
- [Getting Started](getting-started.md)
```

## Guide skeleton

```markdown
# <Task>

<What the reader will accomplish.>

## Prerequisites
- ...

## Steps
1. ...

## Verify
- ...

## See also
- ...
```

## API entry skeleton

```markdown
# `functionName(param1, param2)`

**Description:** <what it does and what it returns.>

**Parameters:**
- `param1` (`type`): <description.>
- `param2` (`type`, optional): <description. Default: ...>

**Returns:** <description.>

**Raises:**
- `ErrorType`: <when.>

**Example:**
```js
// runnable example
```
```

## See also

- [Docs Style Guide](docs-style-guide.md)
- [API Reference Standard](api-reference-standard.md)
