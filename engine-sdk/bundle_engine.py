#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""
Particle Engine Runtime Bundler — thin entry point.

The implementation now lives in the modular `bundler/` package
(config, textscan, transform, graph, compress, builder, site, signing, cli).

Usage:
  python bundle_engine.py --target webgpu-os
"""

import sys

# Candidate builds must not leave interpreter caches in their source checkout.
# Apply this before importing the bundler, including failures during preflight.
if any(argument.split("=", 1)[0] == "--stage-dir" for argument in sys.argv[1:]):
    sys.dont_write_bytecode = True

from bundler.cli import main

if __name__ == "__main__":
    raise SystemExit(main() or 0)
