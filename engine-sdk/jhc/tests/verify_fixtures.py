# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Verify all JHC1 fixtures can be parsed and decoded in Python."""

import json
import sys
from pathlib import Path

from jhc import JhcPackage


def main():
    base = Path(__file__).resolve().parent / "fixtures"
    index = json.loads((base / "fixtures.json").read_text(encoding="utf-8"))
    all_ok = True
    for name in index["fixtures"]:
        fixture_dir = base / name
        container = (fixture_dir / "expected.jhcraw").read_bytes()
        expected = {}
        decoded_dir = fixture_dir / "expected-decoded"
        if decoded_dir.exists():
            for p in decoded_dir.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(decoded_dir).as_posix()
                    expected[rel] = p.read_bytes()
        try:
            parsed = JhcPackage.parse(container)
            resources = parsed["resources"]
            for rel, expected_bytes in expected.items():
                actual = resources.get(rel)
                if actual is None:
                    print("FAIL", name, rel, "missing")
                    all_ok = False
                elif actual != expected_bytes:
                    print("FAIL", name, rel, "content mismatch")
                    all_ok = False
            print("PASS", name, f"{len(resources)} resources")
        except Exception as e:
            print("FAIL", name, type(e).__name__, e)
            all_ok = False
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
