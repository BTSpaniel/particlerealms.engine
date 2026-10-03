# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import json

import pytest

from bundler.config import (
    CYCLIC_BASELINE_FORMAT,
    RELEASE_TARGETS_FORMAT,
    cyclic_baseline_envelope,
    load_cyclic_baseline,
    load_release_targets,
)


def test_release_targets_read_legacy_and_current_but_reject_future(tmp_path):
    legacy = {
        "defaultTarget": "engine",
        "targets": {"engine": {"entry": ["engine/index.js"], "name": "engine"}},
    }
    path = tmp_path / "targets.json"
    path.write_text(json.dumps(legacy), encoding="utf-8")
    assert load_release_targets(path)["defaultTarget"] == "engine"

    current = {"format": RELEASE_TARGETS_FORMAT, "schema_version": 1, **legacy}
    path.write_text(json.dumps(current), encoding="utf-8")
    assert load_release_targets(path)["format"] == RELEASE_TARGETS_FORMAT

    current["schema_version"] = 2
    path.write_text(json.dumps(current), encoding="utf-8")
    with pytest.raises(ValueError, match="schema_version"):
        load_release_targets(path)


def test_cyclic_baseline_has_explicit_envelope_and_legacy_reader(tmp_path):
    cycles = [["a.js", "b.js"]]
    path = tmp_path / "cycles.json"
    path.write_text(json.dumps(cycles), encoding="utf-8")
    assert load_cyclic_baseline(path) == cycles

    envelope = cyclic_baseline_envelope(cycles)
    assert envelope["format"] == CYCLIC_BASELINE_FORMAT
    path.write_text(json.dumps(envelope), encoding="utf-8")
    assert load_cyclic_baseline(path) == cycles

    envelope["schema_version"] = 2
    path.write_text(json.dumps(envelope), encoding="utf-8")
    with pytest.raises(ValueError, match="Unsupported"):
        load_cyclic_baseline(path)

