# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import pytest

from jhc import JhcPackage, JhcPackageError


def test_reader_rejects_future_manifest_format_before_decoding_resources():
    package = JhcPackage.pack(
        {
            "applicationId": "test.format-contract",
            "applicationVersion": "1.0.0",
            "entry": "files/main.js",
        },
        {"files/main.js": b"export default true;"},
    )
    tampered = package.replace(b'"jhc-1.0"', b'"jhc-9.0"', 1)

    with pytest.raises(JhcPackageError, match="Unsupported JHC manifest"):
        JhcPackage.parse(tampered)
