# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Production log removal must preserve executable control flow and data."""

import unittest

from bundler.browser_syntax import assert_browser_classic_script_syntax
from bundler.transform import strip_console_calls


class ConsoleStrippingTests(unittest.TestCase):
    def test_unbraced_control_flow_and_expression_bodies(self):
        source = """
        if (true) console.debug('settling'); else console.info('ready');
        while (false) console.debug('loop');
        for (;false;) console.debug('loop');
        do console.debug('once'); while (false);
        const callback = () => console.debug('arrow');
        const value = true ? console.debug('yes') : undefined;
        function result() { return console.debug('return'); }
        """
        output, saved = strip_console_calls(source)
        self.assertEqual(output.count('(void 0)'), 7)
        self.assertIn("else console.info('ready')", output)
        self.assertEqual(saved, len(source) - len(output))
        assert_browser_classic_script_syntax(output, label='console-control-flow')

    def test_literals_comments_and_other_objects_are_preserved(self):
        source = r"""
        const text = "console.debug('data')";
        const template = `console.debug('template') ${')'}`;
        const pattern = /console.debug\('regex'\)/;
        // console.debug('comment')
        owner.console.debug('member');
        owner?.console.debug('optional member');
        console.warn('keep');
        """
        self.assertEqual(strip_console_calls(source), (source, 0))

    def test_nested_calls_and_regex_parentheses(self):
        source = "console.debug(fn(/[(]/, `outer ${`)`}`, /* ) */ (1 + 2)));next();"
        output, _ = strip_console_calls(source)
        self.assertEqual(output, '(void 0);next();')
        assert_browser_classic_script_syntax(output, label='console-nested')


if __name__ == '__main__':
    unittest.main()
