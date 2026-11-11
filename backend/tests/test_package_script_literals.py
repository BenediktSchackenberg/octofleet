"""Package names and URLs must stay data when inserted into agent commands."""

import unittest

from main import _powershell_literal


class PackageScriptLiteralTests(unittest.TestCase):
    def test_quote_cannot_end_the_literal(self):
        value = "https://example.test/a'; Write-Host injected; #"
        self.assertEqual(
            _powershell_literal(value),
            "'https://example.test/a''; Write-Host injected; #'",
        )


if __name__ == "__main__":
    unittest.main()
