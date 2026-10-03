# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Generate the expected JHC1 fixture for binary-assets."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
sys.path.insert(0, str(ROOT))

from jhc import JhcPackage


def main():
    fixture_dir = Path(__file__).resolve().parent
    input_dir = fixture_dir / "input"
    out_dir = fixture_dir / "expected-decoded"
    out_dir.mkdir(parents=True, exist_ok=True)
    input_dir.mkdir(parents=True, exist_ok=True)

    # Write a small binary asset
    input_dir.joinpath("files").mkdir(exist_ok=True)
    image_bytes = bytes([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ])
    (input_dir / "files" / "image.bin").write_bytes(image_bytes)

    # Index HTML references the binary asset
    index_html = b'<!DOCTYPE html><html><body><img src="image.bin"></body></html>'
    (input_dir / "files" / "index.html").write_bytes(index_html)

    paths = ["files/index.html", "files/image.bin"]
    resources = {}
    for path in paths:
        resources[path] = (input_dir / path).read_bytes()
        (out_dir / path).parent.mkdir(parents=True, exist_ok=True)
        (out_dir / path).write_bytes(resources[path])

    file_hashes = {path: JhcPackage._sha256(content).hex() for path, content in resources.items()}

    manifest = {
        "format": "jhc-1.0",
        "applicationId": "test.binary-assets",
        "applicationVersion": "1.0.0",
        "name": "Binary Assets",
        "publisher": "fixtures",
        "entry": "files/index.html",
        "requiredFeatures": 0,
        "blockmap": {
            "format": "blockmap-v1",
            "packageId": "test.binary-assets",
            "version": "1.0.0",
            "files": file_hashes,
            "builtAt": "2026-01-01T00:00:00Z",
        },
    }

    container = JhcPackage.pack(manifest, resources, signer=None)
    (fixture_dir / "expected.jhcraw").write_bytes(container)

    (fixture_dir / "expected-manifest.json").write_text(
        JhcPackage._canonical_json(manifest), encoding="utf-8"
    )

    parsed = JhcPackage.parse(container)
    ir = {
        "header": parsed["header"],
        "manifest": parsed["manifest"],
        "directory": [
            {k: v for k, v in entry.items() if k != "decodedSha256"}
            for entry in parsed["directory"]
        ],
        "resourcePaths": sorted(parsed["resources"].keys()),
        "rootHash": parsed["rootHash"],
    }
    (fixture_dir / "expected-ir.json").write_text(json.dumps(ir, indent=2), encoding="utf-8")
    print(f"[binary-assets] generated expected.* in {fixture_dir}")


if __name__ == "__main__":
    main()
