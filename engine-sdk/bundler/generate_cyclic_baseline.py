# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Generate bundler/cyclic_baseline.json from current engine/platform bundles."""

import json
from pathlib import Path
from types import SimpleNamespace
from bundler.config import (
    ROOT,
    SKIP_PATTERNS,
    atomic_write_json_file,
    cyclic_baseline_envelope,
    resolve_bundle_configuration,
)
from bundler.graph import ModuleGraph


def _entries_for_target(name):
    args = SimpleNamespace(
        target=name, targets_config=str(ROOT / 'release_targets.json'),
        entry=['engine/EngineBootstrap.js'], include_agi=False,
        include_plauna=False, include_webgpu_os=False, include_editor=False,
        name='baseline', eager=False, site_profile=None, build_site=False, build_sdk=False,
    )
    entries, _ = resolve_bundle_configuration(args)
    return entries


def main():
    graph = ModuleGraph(ROOT, SKIP_PATTERNS, cyclic_baseline=None)
    for target in ('engine', 'platform'):
        for entry in _entries_for_target(target):
            graph.walk(entry)

    cycles = []
    seen = set()
    for cycle in graph.cycles:
        ids = frozenset(graph.mod_id(p) for p in cycle)
        if ids in seen:
            continue
        seen.add(ids)
        cycles.append(sorted(ids))

    out = ROOT / 'bundler' / 'cyclic_baseline.json'
    atomic_write_json_file(out, cyclic_baseline_envelope(cycles))
    print(f'Wrote {len(cycles)} baseline cycles to {out}')


if __name__ == '__main__':
    main()
