# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import base64
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from bundler.cli import (
    _deployed_bundle_manifest_path,
    _signed_os_release_requires_fresh_build,
    _validate_deployed_official_package_inventory,
)
from bundler.official_inventory import (
    OFFICIAL_PACKAGE_ASSIGNMENT,
    OFFICIAL_PACKAGE_INVENTORY_FORMAT,
    assert_manifest_official_package_inventory,
    assert_official_package_inventory_matches_source,
    build_official_package_inventory,
    extract_official_package_records,
    official_package_inventory_from_source,
)


def _official_record(package_id, version, digest_character, faculty_id=None):
    digest = digest_character * 64
    tagged = f"sha256:256:{digest}"
    fingerprint = f"publisher-{digest_character}"
    navi_faculty = None
    build_params = {"official": True}
    if faculty_id:
        navi_faculty = {
            "facultyId": faculty_id,
            "facultyVersion": version,
            "manifest": {
                "facultyId": faculty_id,
                "version": version,
                "provenance": {"packageHash": tagged},
            },
        }
        build_params.update({
            "facultyId": faculty_id,
            "versionStrategy": "content-addressed-v1",
            "revisionInputHash": tagged,
        })
    manifest = {
        "id": package_id,
        "version": version,
        "publisher": "organization:particle-realms",
    }
    if navi_faculty:
        manifest["naviFaculty"] = navi_faculty
    return {
        "version": version,
        "container": base64.b64encode(f"container:{package_id}:{version}".encode()).decode("ascii"),
        "envelope": {
            "manifest": manifest,
            "blockmap": {
                "packageId": package_id,
                "version": version,
                "merkleRoot": digest,
            },
            "signature": {
                "publisher": "organization:particle-realms",
                "fingerprint": fingerprint,
            },
            "cert": {
                "fingerprint": fingerprint,
                "issuerFingerprint": "ring0-root",
                "notBefore": "2026-08-01T00:00:00Z",
                "notAfter": "2027-11-04T00:00:00Z",
            },
            "provenance": {"buildParams": build_params},
        },
    }


def _preamble(records):
    return (
        "// generated official evidence\n"
        + OFFICIAL_PACKAGE_ASSIGNMENT
        + json.dumps(records, separators=(",", ":"), sort_keys=True)
        + ";"
    )


class TestOfficialPackageInventory(unittest.TestCase):
    def setUp(self):
        self.records = {
            "os.zeta": _official_record("os.zeta", "2.0.0", "b"),
            "os.navi-faculty.alpha": _official_record(
                "os.navi-faculty.alpha",
                "1.0.0+rev.aaaaaaaaaaaaaaaa",
                "a",
                "faculty:particle-realms:alpha",
            ),
        }
        self.source = _preamble(self.records) + "\n(function(){return true;}());"

    def test_inventory_is_content_free_sorted_and_bound_to_embedded_records(self):
        extracted = extract_official_package_records(self.source)
        inventory = build_official_package_inventory(extracted)

        self.assertEqual(inventory["format"], OFFICIAL_PACKAGE_INVENTORY_FORMAT)
        self.assertEqual(
            [item["packageId"] for item in inventory["packages"]],
            ["os.navi-faculty.alpha", "os.zeta"],
        )
        faculty = inventory["packages"][0]
        self.assertEqual(faculty["facultyId"], "faculty:particle-realms:alpha")
        self.assertEqual(faculty["resourceRoot"], "sha256:256:" + "a" * 64)
        self.assertEqual(faculty["packageHash"], faculty["resourceRoot"])
        self.assertEqual(faculty["revisionInputHash"], faculty["resourceRoot"])
        self.assertNotIn('"container":', json.dumps(inventory))
        self.assertRegex(faculty["containerSha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(faculty["envelopeSha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(faculty["recordSha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(faculty["certificateNotAfter"], "2027-11-04T00:00:00Z")
        self.assertEqual(
            assert_official_package_inventory_matches_source(self.source, inventory),
            2,
        )

    def test_pretty_registry_whitespace_preserves_property_order_and_inventory_bindings(self):
        literal = "\r\n \t" + json.dumps(self.records, indent=2, ensure_ascii=True) + "\n "
        source = "// supplied public registry\n" + OFFICIAL_PACKAGE_ASSIGNMENT + literal + ";\n(function(){return true;}());"
        before = source.encode("utf-8")
        extracted = extract_official_package_records(source)
        self.assertEqual(list(extracted), list(self.records))
        for package_id in self.records:
            self.assertEqual(list(extracted[package_id]), list(self.records[package_id]))
            self.assertEqual(list(extracted[package_id]["envelope"]), list(self.records[package_id]["envelope"]))
        self.assertEqual(json.dumps(extracted, separators=(",", ":")),
                         json.dumps(self.records, separators=(",", ":")))
        expected = official_package_inventory_from_source(self.source)
        self.assertEqual(official_package_inventory_from_source(source), expected)
        self.assertEqual(assert_official_package_inventory_matches_source(source, expected), 2)
        self.assertEqual(source.encode("utf-8"), before)
        self.assertIn(OFFICIAL_PACKAGE_ASSIGNMENT + literal + ";", source)

    def test_assignment_whitespace_does_not_admit_missing_or_non_json_registry(self):
        for literal in (" \r\n\t", "\n /* comment */ {}", "\u00a0{}", "\n []", "\n null"):
            with self.subTest(literal=literal), self.assertRaises(ValueError):
                extract_official_package_records(OFFICIAL_PACKAGE_ASSIGNMENT + literal + ";")

    def test_inventory_rejects_embedded_record_or_binding_drift(self):
        inventory = official_package_inventory_from_source(self.source)
        changed = dict(self.records)
        changed["os.zeta"] = _official_record("os.zeta", "2.0.1", "c")
        with self.assertRaisesRegex(ValueError, "do not match"):
            assert_official_package_inventory_matches_source(_preamble(changed), inventory)

        broken = json.loads(json.dumps(self.records))
        broken["os.zeta"]["envelope"]["manifest"]["version"] = "9.0.0"
        with self.assertRaisesRegex(ValueError, "version drifted"):
            build_official_package_inventory(broken)

        broken_faculty = json.loads(json.dumps(self.records))
        broken_faculty["os.navi-faculty.alpha"]["envelope"]["manifest"][
            "naviFaculty"
        ]["facultyVersion"] = "9.0.0"
        with self.assertRaisesRegex(ValueError, "Faculty version drifted"):
            build_official_package_inventory(broken_faculty)

        duplicated = self.source + "\n" + _preamble(self.records)
        with self.assertRaisesRegex(ValueError, "exactly one"):
            extract_official_package_records(duplicated)

    def test_build_and_deployed_manifests_require_exact_inventory(self):
        inventory = official_package_inventory_from_source(self.source)
        self.assertEqual(
            assert_manifest_official_package_inventory(
                {"name": "particle-os", "officialPackages": inventory},
                inventory,
            ),
            2,
        )
        with self.assertRaisesRegex(ValueError, "missing or stale"):
            assert_manifest_official_package_inventory({"name": "particle-os"}, inventory)

        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp)
            for profile, bundle_name in (
                ("webgpu-os", "particle-os"),
                ("platform", "particle-platform"),
            ):
                path = _deployed_bundle_manifest_path(site, profile, bundle_name)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    json.dumps({"name": bundle_name, "officialPackages": inventory}),
                    encoding="utf-8",
                )
                self.assertEqual(
                    _validate_deployed_official_package_inventory(
                        site, profile, bundle_name, inventory
                    ),
                    2,
                )

            platform_path = _deployed_bundle_manifest_path(
                site, "platform", "particle-platform"
            )
            platform_path.write_text(
                json.dumps({"name": "particle-platform", "officialPackages": {
                    "format": OFFICIAL_PACKAGE_INVENTORY_FORMAT,
                    "packages": [],
                }}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "failed official package verification"):
                _validate_deployed_official_package_inventory(
                    site, "platform", "particle-platform", inventory
                )
            self.assertEqual(
                _validate_deployed_official_package_inventory(
                    site, "webgpu-os", "particle-os", inventory
                ),
                2,
            )

    def test_each_signed_os_target_bypasses_cross_target_cache_reuse(self):
        for target in ("webgpu-os", "platform"):
            with self.subTest(target=target):
                self.assertTrue(_signed_os_release_requires_fresh_build(SimpleNamespace(
                    target=target,
                    include_webgpu_os=True,
                    production=True,
                    release=False,
                )))


if __name__ == "__main__":
    unittest.main()
