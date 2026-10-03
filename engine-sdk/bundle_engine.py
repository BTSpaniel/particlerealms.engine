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

from bundler.cli import main

if __name__ == "__main__":
    raise SystemExit(main() or 0)
