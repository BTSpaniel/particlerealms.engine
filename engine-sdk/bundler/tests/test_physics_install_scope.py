# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Legacy-path metadata guards, without installing or executing native physics."""
import unittest

from tools.install_physics_runtime import require_legacy_install_scope


class PhysicsInstallScopeTests(unittest.TestCase):
    def test_existing_legacy_modes_and_flow_component_remain_admissible(self):
        for build in ({}, {'sectionsAbi': 1, 'thermalIncluded': False},
                      {'flowComponent': {'abi': 1}, 'thermalIncluded': False}):
            with self.subTest(build=build):
                require_legacy_install_scope(build)

    def test_unadmitted_features_cannot_use_the_legacy_path(self):
        for key in ('sectionsV3Abi', 'sectionsV3PreparationAbi', 'thermalIncluded'):
            for value in (1, True, 2, '1'):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, 'explicit combined'):
                    require_legacy_install_scope({key: value})

    def test_missing_feature_metadata_cannot_hide_linked_exports(self):
        for name in ('_pr_blast_stress_sections_v3_preparation_abi', '_pr_wood_thermal_mr_step'):
            for build in ({'expectedAddonExports': [name]},
                          {'commands': [['em++', '-sEXPORTED_FUNCTIONS=_malloc,' + name]]}):
                with self.subTest(build=build), self.assertRaisesRegex(ValueError, 'explicit combined'):
                    require_legacy_install_scope(build)


if __name__ == '__main__':
    unittest.main()
