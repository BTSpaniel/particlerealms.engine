# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Canonical app coverage, safe static HTML, and public-copy catalogue checks."""

from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from bundler.app_catalog import (
    CATALOG_END, CATALOG_START, homepage_app_catalog, render_homepage_app_cards,
    render_homepage_app_catalog, update_homepage_app_catalog,
)
from bundler.config import ROOT
from bundler.site import copy_release_site


class _Cards(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.cards = []
        self.links = []
        self.tags = []
        self.text = []
        self.feed(source)

    def handle_starttag(self, tag, attributes):
        self.tags.append(tag)
        values = dict(attributes)
        if tag == "article":
            self.cards.append(values)
        if tag == "a":
            self.links.append(values)

    def handle_data(self, data):
        self.text.append(data)


class HomepageAppCatalogTests(unittest.TestCase):
    def _fixture(self, root, manifests):
        apps = root / "webgpu-os/apps"
        apps.mkdir(parents=True)
        folders = []
        for position, manifest in enumerate(manifests):
            folder = f"example-{position}"
            folders.append(folder)
            directory = apps / folder
            directory.mkdir()
            (directory / "manifest.json").write_text(json.dumps({
                "entry": "./app.js", "surface": "window", **manifest,
            }), encoding="utf-8")
            (directory / "app.js").write_text("export const ready = true;\n", encoding="utf-8")
        (apps / "index.json").write_text(json.dumps(folders), encoding="utf-8")
        return apps

    def test_every_visible_canonical_app_has_native_links_and_correct_session_policy(self):
        apps = ROOT / "webgpu-os/apps"
        folders = json.loads((apps / "index.json").read_text(encoding="utf-8"))
        manifests = [json.loads((apps / folder / "manifest.json").read_text(encoding="utf-8")) for folder in folders]
        visible = {item["appId"]: item for item in manifests
                   if item.get("hidden") is not True and item.get("surface") != "background"}
        parsed = _Cards(render_homepage_app_cards(ROOT))
        self.assertEqual(len(parsed.cards), len(visible))
        self.assertEqual({card["data-app-id"] for card in parsed.cards}, set(visible))
        expected_unavailable = {"os.the-virtual-realm"}
        self.assertEqual(len(parsed.links), (len(visible) - len(expected_unavailable)) * 2)
        expected_profile = {"os.browser-bridge-manager", "os.tab-manager", "os.request-rule-manager"}
        self.assertEqual({card["data-app-id"] for card in parsed.cards if card["data-app-requires-profile"] == "true"}, expected_profile)
        self.assertEqual({card["data-app-id"] for card in parsed.cards if card["data-app-available"] == "false"}, expected_unavailable)
        for card in parsed.cards:
            app_id = card["data-app-id"]
            expected_session = "profile" if app_id in expected_profile else "demo"
            self.assertEqual(card["data-app-category"], visible[app_id]["category"])
            self.assertEqual(card["data-app-default-session"], expected_session)
            links = [link for link in parsed.links if link["data-app-id"] == app_id]
            if app_id in expected_unavailable:
                self.assertEqual(links, [])
                continue
            self.assertEqual(sum("data-app-demo-load" in link for link in links), 1)
            self.assertEqual(sum("data-app-demo-open" in link for link in links), 1)
            for link in links:
                self.assertEqual(link["data-app-name"], visible[app_id]["name"])
                self.assertEqual(urlsplit(link["href"]).path, "/webgpu-os/app.html")
                self.assertEqual(parse_qs(urlsplit(link["href"]).query), {"app": [app_id], "session": [expected_session]})
        self.assertIn("browser", visible)
        self.assertIn("theme-manager", visible)
        self.assertIn("Coming soon", "".join(parsed.text))
        self.assertIn("This world experience is still in development.", "".join(parsed.text))
        self.assertTrue(set(parsed.tags) <= {"article", "span", "h3", "p", "a"})

    def test_new_manifest_appears_without_a_second_membership_registry_and_hidden_app_does_not(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root, [
                {"appId": "new-app", "name": "A New App", "description": "Authored description", "category": "research-tools"},
                {"appId": "hidden-app", "name": "Background Service", "hidden": True},
                {"appId": "background-app", "name": "Unhidden Background Service", "surface": "background"},
            ])
            cards = homepage_app_catalog(root)
            self.assertEqual([item["appId"] for item in cards], ["new-app"])
            self.assertEqual(cards[0]["summary"], "Authored description")
            self.assertEqual(cards[0]["categoryLabel"], "Research Tools")

    def test_manifest_text_is_escaped_in_text_attributes_and_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app_id = 'browser<&"'
            name = '<script>alert("name")</script>'
            description = '<img src=x onerror="alert(1)"> & notes'
            self._fixture(root, [{"appId": app_id, "name": name, "description": description,
                                  "icon": '<svg onload="alert(2)">', "category": 'test" category'}])
            parsed = _Cards(render_homepage_app_cards(root))
            self.assertTrue(set(parsed.tags) <= {"article", "span", "h3", "p", "a"})
            self.assertEqual(parsed.cards[0]["data-app-id"], app_id)
            self.assertIn(name, "".join(parsed.text))
            self.assertIn(description, "".join(parsed.text))
            self.assertEqual(parse_qs(urlsplit(parsed.links[0]["href"]).query)["app"], [app_id])
            self.assertFalse(any(attribute.startswith("on") for card in parsed.cards for attribute in card))

    def test_only_managed_block_changes_and_check_mode_never_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root, [{"appId": "new-app", "name": "Example"}])
            prefix = '<main data-authored="unchanged">\n    ' + CATALOG_START
            suffix = CATALOG_END + '\n</main>\n<script>const authored = "untouched";</script>\n'
            source = prefix + '\nold cards\n    ' + suffix
            rendered = render_homepage_app_catalog(source, root)
            self.assertTrue(rendered.startswith(prefix))
            self.assertTrue(rendered.endswith(suffix))
            self.assertEqual(render_homepage_app_catalog(rendered, root), rendered)
            path = root / "page.html"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stale"):
                update_homepage_app_catalog(path, root, check=True)
            self.assertEqual(path.read_text(encoding="utf-8"), source)
            self.assertTrue(update_homepage_app_catalog(path, root))
            self.assertFalse(update_homepage_app_catalog(path, root, check=True))

    def test_missing_duplicate_and_reversed_markers_are_rejected(self):
        for source in ("", CATALOG_START, CATALOG_START + CATALOG_END + CATALOG_START, CATALOG_END + CATALOG_START):
            with self.subTest(source=source), self.assertRaises(ValueError):
                render_homepage_app_catalog(source, ROOT)

    def test_normal_public_copier_refreshes_stale_cards_before_other_site_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root, [{"appId": "copied-app", "name": "Copied Name"}])
            tests = root / "tests"
            tests.mkdir()
            source = "<main>" + CATALOG_START + "stale" + CATALOG_END + "</main>"
            (tests / "index.html").write_text(source, encoding="utf-8")
            with mock.patch("bundler.site.RELEASE_INCLUDE", ("index.html",)), mock.patch(
                "bundler.site._lay_down_academy_starter_engine_closure", side_effect=RuntimeError("stop after catalogue"),
            ):
                with self.assertRaisesRegex(RuntimeError, "stop after catalogue"):
                    copy_release_site(root, root / "release")
            deployed = (root / "release/.staging/site/index.html").read_text(encoding="utf-8")
            self.assertEqual(deployed, render_homepage_app_catalog(source, root))
            self.assertEqual((tests / "index.html").read_text(encoding="utf-8"), source)

    def test_checked_in_homepage_catalogue_is_current(self):
        self.assertFalse(update_homepage_app_catalog(ROOT / "tests/index.html", ROOT, check=True))


if __name__ == "__main__":
    unittest.main()
