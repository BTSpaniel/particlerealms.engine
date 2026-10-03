# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import unittest

from bundler.builder import minify_source
from bundler.transform import minify_html_in_template_literals, minify_html_template


class TestTemplateLiteralMinification(unittest.TestCase):
    def test_nested_template_whitespace_is_semantically_preserved(self):
        source = "const classes=x=>`base${x ? ` ${x} tail ` : ''}`;"

        minified = minify_source(source)

        self.assertIn("`base${x ? ` ${x} tail ` : ''}`", minified)

    def test_multiline_css_and_interpolation_boundaries_are_preserved(self):
        literal = "`\n.panel { display: grid; }\n${enabled ? ` active ${name} ` : ''}\n`"
        source = f"const css={literal};"

        minified = minify_source(source)

        self.assertIn(literal, minified)

    def test_tagged_template_literal_remains_tagged(self):
        source = "const value=tag` raw ${condition ? ` nested ` : ''} tail `;"

        minified = minify_source(source)

        self.assertIn("tag` raw ${condition ? ` nested ` : ''} tail `", minified)

    def test_regular_javascript_around_templates_is_still_minified(self):
        source = "function value ( input ) { /* remove */ return ` ${input} `; }"

        minified = minify_source(source)

        self.assertNotIn("/* remove */", minified)
        self.assertIn("` ${input} `", minified)

    def test_html_pass_never_pairs_templates_across_executable_code(self):
        source = (
            "const flip=/'/;__e.__default=class A{m(){const label=`don't`;}}\n"
            "function helperLongEnoughForRegression(){}\n"
            "const probe=/<div/;const later=`<div>later</div>`;"
        )

        transformed, saved = minify_html_in_template_literals(source)

        self.assertEqual(transformed, source)
        self.assertEqual(saved, 0)
        self.assertIn("}}\nfunction helperLongEnoughForRegression", transformed)

    def test_html_whitespace_is_preserved_byte_exact(self):
        source = "const view=`<p>Hello ${name}</p>\n<pre>  exact  </pre>`;"
        inner = "  <p>Hello ${name}</p>\n<pre>  exact  </pre>  "

        transformed, saved = minify_html_in_template_literals(source)

        self.assertEqual(transformed, source)
        self.assertEqual(saved, 0)
        self.assertEqual(minify_html_template(inner), inner)


if __name__ == "__main__":
    unittest.main()
