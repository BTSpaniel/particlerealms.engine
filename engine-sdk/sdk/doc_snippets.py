# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Extract the exact curated SDK examples exercised by browser acceptance."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


EXAMPLES = {
    "engine-source": ("MD/guides/sdk-distribution.md", "source", "engine"),
    "engine-compiled": ("MD/guides/sdk-distribution.md", "compiled", "engine"),
    "plauna-source": ("MD/plauna/getting-started.md", "source", "plauna"),
}
MARKER = re.compile(r"^<!-- sdk-example: ([a-z][a-z0-9-]*) -->\s*$")


def extract_sdk_doc_snippets(sdk_root: str | Path) -> list[dict]:
    """Return declared Markdown fences without rewriting their JavaScript.

    The fixed inventory makes a removed, renamed or duplicated acceptance
    example an error rather than silently reducing the executed test count.
    """
    root = Path(sdk_root).resolve()
    found = {}
    for relative in sorted({spec[0] for spec in EXAMPLES.values()}):
        document = root / relative
        if not document.resolve().is_relative_to(root):
            raise ValueError(f"SDK example document escapes the SDK: {relative}")
        lines = document.read_bytes().decode("utf-8").splitlines(keepends=True)
        for index, line in enumerate(lines):
            marker = MARKER.fullmatch(line.rstrip("\r\n"))
            if marker is None:
                continue
            identifier = marker.group(1)
            if identifier not in EXAMPLES or EXAMPLES[identifier][0] != relative:
                raise ValueError(f"Unknown or misplaced SDK example: {identifier}")
            if identifier in found:
                raise ValueError(f"Duplicate SDK example: {identifier}")
            opening = index + 1
            while opening < len(lines) and not lines[opening].strip():
                opening += 1
            if opening == len(lines) or lines[opening].strip() != "```javascript":
                raise ValueError(f"SDK example must immediately precede a JavaScript fence: {identifier}")
            closing = opening + 1
            while closing < len(lines) and lines[closing].strip() != "```":
                closing += 1
            if closing == len(lines):
                raise ValueError(f"Unclosed SDK example: {identifier}")
            code = "".join(lines[opening + 1:closing])
            if not code.strip():
                raise ValueError(f"Empty SDK example: {identifier}")
            _, mode, kind = EXAMPLES[identifier]
            found[identifier] = {
                "id": identifier, "mode": mode, "kind": kind, "path": relative,
                "line": opening + 2, "sha256": hashlib.sha256(code.encode("utf-8")).hexdigest(),
                "code": code,
            }
    missing = sorted(EXAMPLES.keys() - found.keys())
    if missing:
        raise ValueError("Missing SDK examples: " + ", ".join(missing))
    return [found[identifier] for identifier in EXAMPLES]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sdk_root", type=Path)
    args = parser.parse_args(argv)
    print(json.dumps(extract_sdk_doc_snippets(args.sdk_root), indent=2))


if __name__ == "__main__":
    main()
