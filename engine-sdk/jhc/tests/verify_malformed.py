# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Verify malformed JHC1 corpus in Python."""

import json
import sys
from pathlib import Path

from jhc import JhcPackage, JhcPackageError


def main():
    base = Path(__file__).resolve().parent / "malformed"
    idx = json.loads((base / "index.json").read_text(encoding="utf-8"))
    all_ok = True
    for c in idx["cases"]:
        data = (base / f"{c['name']}.jhc").read_bytes()
        try:
            JhcPackage.parse(data)
            print("FAIL", c["name"], "no error raised")
            all_ok = False
        except JhcPackageError as e:
            if e.code == c["expectedCode"]:
                print("PASS", c["name"], e.code)
            else:
                print("FAIL", c["name"], "expected", c["expectedCode"], "got", e.code, e.message)
                all_ok = False
        except Exception as e:
            print("FAIL", c["name"], "unexpected", type(e).__name__, e)
            all_ok = False
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
