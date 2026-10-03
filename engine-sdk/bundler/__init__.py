# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Particle Engine runtime bundler (modular package).

The former monolithic bundle_engine.py now lives here, split into
cohesive submodules. Public entry point: bundler.cli.main.
"""

from .cli import main

__all__ = ["main"]
