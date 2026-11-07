"""Install dates reported by the Windows agent."""

import unittest
from datetime import date

from routers.inventory import install_date_from


class InstallDateTests(unittest.TestCase):
    def test_agent_format(self):
        self.assertEqual(install_date_from("2024-10-15"), date(2024, 10, 15))

    def test_registry_format(self):
        self.assertEqual(install_date_from("20241015"), date(2024, 10, 15))

    def test_missing_or_invalid(self):
        for value in (None, "", "2024-13-01", "15.10.2024", "2024101", 20241015.5):
            with self.subTest(value=value):
                self.assertIsNone(install_date_from(value))


if __name__ == "__main__":
    unittest.main()
