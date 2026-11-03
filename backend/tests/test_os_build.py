"""The OS build reported by agents and posture snapshots."""

import unittest

from app.db.nodes import os_build_from


class OsBuildTests(unittest.TestCase):
    def test_build_as_reported(self):
        self.assertEqual(os_build_from({"build": "26100.33650"}), "26100.33650")
        self.assertEqual(os_build_from({"build": "7.0.0-42-generic"}), "7.0.0-42-generic")

    def test_build_number_with_update_revision(self):
        self.assertEqual(os_build_from({"buildNumber": "26100", "ubr": "33650"}), "26100.33650")
        self.assertEqual(os_build_from({"buildNumber": "26100", "ubr": 0}), "26100.0")

    def test_build_number_alone_is_not_used(self):
        # it would replace the more precise value from a posture snapshot
        self.assertIsNone(os_build_from({"buildNumber": "26100"}))
        self.assertIsNone(os_build_from({}))
