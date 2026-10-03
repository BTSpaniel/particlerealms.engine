# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Run the shipped SDK's offline rebuild acceptance without development files."""
from pathlib import Path
import sys

sys.dont_write_bytecode = True
SDK = Path(__file__).resolve().parents[1] / 'engine-sdk'
sys.path.insert(0, str(SDK))
from sdk.rebuild_acceptance import main


if __name__ == '__main__':
    raise SystemExit(main(['--sdk', str(SDK), *sys.argv[1:]]))
