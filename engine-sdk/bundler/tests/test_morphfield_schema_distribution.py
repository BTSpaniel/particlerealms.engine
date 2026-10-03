# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from bundler.site import (
    MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT,
    MORPHFIELD_SCHEMA_DIALECT,
    MORPHFIELD_SCHEMA_ID_ROOT,
    create_release_site_archive,
    lay_down_morphfield_schemas,
    morphfield_schema_deployment_paths,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_SCHEMA_ROOT = (
    REPOSITORY_ROOT / "engine" / "render" / "morphfield" / "schemas"
)


class TestMorphFieldSchemaDistribution(unittest.TestCase):
    def test_laydown_preserves_every_schema_byte_and_public_id(self):
        canonical_paths = tuple(sorted(CANONICAL_SCHEMA_ROOT.glob("*.schema.json")))
        self.assertTrue(canonical_paths)

        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp) / "site"
            copied = lay_down_morphfield_schemas(site, REPOSITORY_ROOT)

            self.assertEqual(copied, len(canonical_paths))
            self.assertEqual(
                morphfield_schema_deployment_paths(REPOSITORY_ROOT),
                tuple(
                    (MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT / source.name).as_posix()
                    for source in canonical_paths
                ),
            )
            for source in canonical_paths:
                deployed = site.joinpath(*MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT.parts, source.name)
                self.assertEqual(deployed.read_bytes(), source.read_bytes())
                document = json.loads(deployed.read_bytes())
                self.assertEqual(document["$schema"], MORPHFIELD_SCHEMA_DIALECT)
                self.assertEqual(
                    document["$id"],
                    f"{MORPHFIELD_SCHEMA_ID_ROOT}/{source.name}",
                )

    def test_archive_preserves_schema_bytes_at_public_routes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            site = root / "site"
            required_paths = morphfield_schema_deployment_paths(REPOSITORY_ROOT)
            lay_down_morphfield_schemas(site, REPOSITORY_ROOT)
            archive_path = root / "site.zip"

            create_release_site_archive(
                site,
                archive_path,
                required_paths=required_paths,
            )

            with zipfile.ZipFile(archive_path, "r") as archive:
                self.assertEqual(tuple(sorted(archive.namelist())), required_paths)
                for deployment_path in required_paths:
                    source = CANONICAL_SCHEMA_ROOT / Path(deployment_path).name
                    self.assertEqual(archive.read(deployment_path), source.read_bytes())

    def test_laydown_rejects_schema_id_that_does_not_match_its_route(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_dir = root / "engine" / "render" / "morphfield" / "schemas"
            source_dir.mkdir(parents=True)
            (source_dir / "scene.schema.json").write_text(
                json.dumps({
                    "$schema": MORPHFIELD_SCHEMA_DIALECT,
                    "$id": f"{MORPHFIELD_SCHEMA_ID_ROOT}/wrong.schema.json",
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, r"\$id mismatch"):
                lay_down_morphfield_schemas(root / "site", root)

    def test_laydown_rejects_duplicate_members_and_non_json_numbers(self):
        fixtures = {
            "duplicate": (
                '{"$schema":"https://json-schema.org/draft/2020-12/schema",'
                '"$id":"https://particlerealms.online/schemas/morphfield/v2/scene.schema.json",'
                '"type":"object","type":"array"}'
            ),
            "nonfinite": (
                '{"$schema":"https://json-schema.org/draft/2020-12/schema",'
                '"$id":"https://particlerealms.online/schemas/morphfield/v2/scene.schema.json",'
                '"x-invalid":NaN}'
            ),
            "overflowing-exponent": (
                '{"$schema":"https://json-schema.org/draft/2020-12/schema",'
                '"$id":"https://particlerealms.online/schemas/morphfield/v2/scene.schema.json",'
                '"x-invalid":1e400}'
            ),
        }
        for label, payload in fixtures.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                source_dir = root / "engine" / "render" / "morphfield" / "schemas"
                source_dir.mkdir(parents=True)
                (source_dir / "scene.schema.json").write_text(payload, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, r"duplicate JSON|non-JSON|finite runtime range"):
                    lay_down_morphfield_schemas(root / "site", root)


if __name__ == "__main__":
    unittest.main()
