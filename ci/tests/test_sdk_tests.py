# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Keep unavailable required CPU cases and setup failures visible in reports."""
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sdk_tests


class PublicBrowserReportingTests(unittest.TestCase):
    def test_unavailable_module_records_every_required_case_as_unexecuted(self):
        suite = {'id': 'rig-public', 'expectedCases': {'compiled': ['rig-public:identity', 'rig-public:finite-step']}}
        observed = sdk_tests.missing_cases(suite, 'compiled', 'Missing compiled export')
        self.assertEqual(observed['status'], 'FAIL')
        self.assertEqual([row['id'] for row in observed['cases']], suite['expectedCases']['compiled'])
        self.assertTrue(all(row['status'] == 'NOT_RUN' and not row['checks'] for row in observed['cases']))
        self.assertEqual(observed['cleanup']['status'], 'not_confirmed')

    def test_zero_case_initialization_failure_is_a_junit_error(self):
        with tempfile.TemporaryDirectory(prefix='sdk-public-junit-') as temporary:
            destination = Path(temporary) / 'report.xml'
            sdk_tests.write_junit({'status': 'FAIL', 'mounts': [], 'elapsedSeconds': 0,
                'error': 'Required compiled module absent'}, destination)
            root = ET.parse(destination).getroot()
            self.assertEqual(root.attrib['tests'], '1')
            self.assertEqual(root.attrib['errors'], '1')
            self.assertEqual(root.find('testcase/error').attrib['message'], 'Required compiled module absent')


if __name__ == '__main__':
    unittest.main()
