"""Install dates reported by the Windows agent."""

import unittest
from datetime import date

from routers.inventory import get_software, install_date_from


class InstallDateTests(unittest.TestCase):
    def test_agent_format(self):
        self.assertEqual(install_date_from("2024-10-15"), date(2024, 10, 15))

    def test_registry_format(self):
        self.assertEqual(install_date_from("20241015"), date(2024, 10, 15))

    def test_missing_or_invalid(self):
        for value in (None, "", "2024-13-01", "15.10.2024", "2024101", 20241015.5):
            with self.subTest(value=value):
                self.assertIsNone(install_date_from(value))


class SoftwareResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_software_response_keeps_old_and_new_date_fields(self):
        class Connection:
            async def fetchrow(self, query, node_id):
                return {"id": "test-node"}

            async def fetch(self, query, node_id):
                return [{"name": "Example", "install_date": date(2024, 10, 15)}]

        class Acquire:
            async def __aenter__(self):
                return Connection()

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class Pool:
            def acquire(self):
                return Acquire()

        response = await get_software("test-node", Pool())
        program = response["data"]["installedPrograms"][0]
        self.assertEqual(program["install_date"], date(2024, 10, 15))
        self.assertEqual(program["installDate"], program["install_date"])


if __name__ == "__main__":
    unittest.main()
