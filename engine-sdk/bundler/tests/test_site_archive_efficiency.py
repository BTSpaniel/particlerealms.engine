# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Guard ZIP codec selection and single-pass integrity verification."""
from unittest.mock import patch
import zipfile

import pytest

from bundler.site import create_release_site_archive


def test_compressed_runtime_parts_are_stored_but_other_binary_data_is_deflated(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    names = [f"runtime.min.js.{codec}.{'a' * 24}.part-0000.bin" for codec in ("gz", "br", "zst")]
    names += ["ordinary.bin", f"kit.zip.{'a' * 24}.part-0000.bin", "invalid.gz.hash.part-0000.bin"]
    for name in names:
        (site / name).write_bytes(b"repeated source bytes\n" * 1024)
    first, second = tmp_path / "first.zip", tmp_path / "second.zip"
    create_release_site_archive(site, first)
    create_release_site_archive(site, second)
    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as zipped:
        assert zipped.testzip() is None
        for index, name in enumerate(names):
            assert zipped.read(name) == (site / name).read_bytes()
            assert zipped.getinfo(name).compress_type == (zipfile.ZIP_STORED if index < 3 else zipfile.ZIP_DEFLATED)


@pytest.mark.parametrize("name", ["member.txt", "member.png"])
def test_crc_only_corruption_blocks_atomic_publication(tmp_path, name):
    site = tmp_path / "site"
    site.mkdir()
    (site / name).write_bytes(b"correct unmodified member data" * 100)
    output = tmp_path / "release.zip"
    output.write_bytes(b"previous verified release")
    original = zipfile.ZipFile

    def corrupt_crc(path, mode="r", *args, **kwargs):
        if mode == "r":
            with original(path) as archive:
                offset = archive.start_dir + 16  # Central-directory CRC-32.
            data = bytearray(path.read_bytes())
            data[offset] ^= 1
            path.write_bytes(data)
        return original(path, mode, *args, **kwargs)

    with patch("bundler.site.zipfile.ZipFile", side_effect=corrupt_crc):
        with pytest.raises(RuntimeError, match="CRC/read failed.*Bad CRC-32"):
            create_release_site_archive(site, output)
    assert output.read_bytes() == b"previous verified release"
    assert not output.with_suffix(".zip.tmp").exists()


def test_source_drift_after_write_blocks_byte_parity_publication(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    source = site / "member.txt"
    source.write_text("original", encoding="utf-8")
    output = tmp_path / "release.zip"
    output.write_bytes(b"previous verified release")
    original = zipfile.ZipFile

    def change_source(path, mode="r", *args, **kwargs):
        if mode == "r":
            source.write_text("changed after archive write", encoding="utf-8")
        return original(path, mode, *args, **kwargs)

    with patch("bundler.site.zipfile.ZipFile", side_effect=change_source):
        with pytest.raises(RuntimeError, match="byte-parity mismatch"):
            create_release_site_archive(site, output)
    assert output.read_bytes() == b"previous verified release"
