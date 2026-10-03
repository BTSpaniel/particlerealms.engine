#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Compatibility wrapper for generating the dispatch WGSL JS module."""

from __future__ import annotations

import sys

from generate_compute_shader_modules import main as generate_compute_shader_modules_main


if __name__ == "__main__":
    raise SystemExit(generate_compute_shader_modules_main(["--only", "dispatch_gen", "--no-metadata", *sys.argv[1:]]))
