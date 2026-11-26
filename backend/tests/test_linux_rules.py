"""Linux approval rules (#271): rule validation, patterns, the approval state of a row, and the
packages a bulk installation sends. The SQL evaluation itself runs against PostgreSQL in the API
tests (tests/api/test_linux_approval_rules.py)."""
import json
import unittest
from datetime import datetime, timedelta, timezone

import linux_rules as lr

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
RING = "4b1c4c5e-55a1-4a43-9b1a-1f2f6a0a3a11"


class ValidateTests(unittest.TestCase):
    def test_defaults(self):
        rule = lr.validate({"name": " Security "})
        self.assertEqual(rule["name"], "Security")
        self.assertEqual((rule["enabled"], rule["action"], rule["min_age_hours"], rule["ring_ids"]),
                         (False, "approve", 0, []))

    def test_fields(self):
        rule = lr.validate({"name": "r", "enabled": True, "ring_ids": [RING, RING.upper()], "security_only": True,
                            "min_severity": "Important", "packages": ["openssl*", "openssl*"],
                            "releases": ["ubuntu:24.*"], "repositories": ["*-security"], "min_age_hours": 72,
                            "expedite": True})
        self.assertEqual(rule["ring_ids"], [RING])
        self.assertEqual(rule["packages"], ["openssl*"])
        self.assertEqual((rule["min_severity"], rule["min_age_hours"], rule["expedite"]), ("Important", 72, True))

    def test_exclusion_ignores_approval_fields(self):
        rule = lr.validate({"name": "x", "action": "exclude", "packages": ["linux-image-*"], "min_age_hours": 5,
                            "expedite": True})
        self.assertEqual((rule["min_age_hours"], rule["expedite"], rule["security_only"]), (0, False, False))

    def test_update_merges_over_the_current_rule(self):
        current = lr.validate({"name": "r", "packages": ["a*"], "min_age_hours": 24})
        rule = lr.validate({"enabled": True, "id": "ignored", "created_at": "ignored"}, current)
        self.assertEqual((rule["packages"], rule["min_age_hours"], rule["enabled"]), (["a*"], 24, True))

    def test_invalid(self):
        for body in (None, [], {"name": ""}, {"name": "x" * 201}, {"name": "x", "action": "allow"},
                     {"name": "x", "enabled": "true"}, {"name": "x", "ring_ids": ["nope"]},
                     {"name": "x", "ring_ids": "abc"}, {"name": "x", "group_id": 5},
                     {"name": "x", "min_age_hours": -1}, {"name": "x", "min_age_hours": 1.5},
                     {"name": "x", "min_age_hours": True}, {"name": "x", "min_age_hours": lr.MAX_AGE_HOURS + 1},
                     {"name": "x", "packages": ["a b"]}, {"name": "x", "packages": ["a;b"]},
                     {"name": "x", "packages": "openssl"}, {"name": "x", "packages": ["p"] * 101},
                     {"name": "x", "releases": ["Ubuntu:24.04"]}, {"name": "x", "min_severity": "High"},
                     {"name": "x", "min_severity": "Low"},  # without security_only
                     {"name": "x", "action": "exclude"}, {"name": "x", "description": 5}):
            with self.assertRaises(lr.RuleError, msg=body):
                lr.validate(body)


class PatternTests(unittest.TestCase):
    def test_glob_to_like(self):
        self.assertEqual(lr.glob_to_like("openssl*"), "openssl%")
        self.assertEqual(lr.glob_to_like("lib?"), "lib_")
        # LIKE's own wildcards and the escape character are literal
        self.assertEqual(lr.glob_to_like("python3_x%"), "python3\\_x\\%")
        self.assertEqual(lr.glob_to_like("a\\b"), "a\\\\b")

    def test_rule_args_carry_like_patterns(self):
        args = lr.rule_args(lr.validate({"name": "r", "packages": ["lib_*"], "repositories": ["*-security"],
                                         "releases": ["debian:*"]}))
        self.assertEqual(args[11:14], (["debian:%"], ["%-security"], ["lib\\_%"]))

    def test_preview_json(self):
        data = lr.preview_json(lr.validate({"name": "p", "ring_ids": [RING], "packages": ["a*"]}))
        self.assertEqual((data["ring_ids"], data["package_like"], data["action"]), ([RING], ["a%"], "approve"))
        json.dumps(data)


def row(package="openssl", arch="amd64", version="1", excluded=False, approved_at=NOW - timedelta(hours=1),
        phased=False):
    return {"package": package, "arch": arch, "version": version, "excluded": excluded, "approved_at": approved_at,
            "phased": phased}


class StateTests(unittest.TestCase):
    def test_states(self):
        self.assertEqual(lr.approval_state(row(), NOW), "approved")
        self.assertEqual(lr.approval_state(row(approved_at=NOW), NOW), "approved")
        self.assertEqual(lr.approval_state(row(approved_at=NOW + timedelta(seconds=1)), NOW), "waiting")
        self.assertEqual(lr.approval_state(row(approved_at=None), NOW), "not_approved")
        # an exclusion wins, whatever the approval says
        self.assertEqual(lr.approval_state(row(excluded=True), NOW), "excluded")
        # apt holds it back on the node: not evaluated (EVALUATE leaves it out, so approved_at is NULL)
        self.assertEqual(lr.approval_state(row(phased=True, approved_at=None), NOW), "phased")


class InstallPackagesTests(unittest.TestCase):
    def test_only_approved_with_exact_versions(self):
        rows = [row("openssl", version="3.0.13-0ubuntu3.6"), row("curl", approved_at=None),
                row("vim", approved_at=NOW + timedelta(days=1)), row("linux-image-generic", excluded=True)]
        self.assertEqual(lr.install_packages(rows, NOW), [{"name": "openssl", "version": "3.0.13-0ubuntu3.6"}])

    def test_phased_updates_are_left_out(self):
        rows = [row("openssl", version="3.0.13-0ubuntu3.6"), row("libsqlite3-0", phased=True)]
        self.assertEqual(lr.install_packages(rows, NOW), [{"name": "openssl", "version": "3.0.13-0ubuntu3.6"}])

    def test_multiarch_names_get_the_architecture(self):
        rows = [row("libc6", "amd64", "2.39-0ubuntu8.6"), row("libc6", "i386", "2.39-0ubuntu8.6"),
                row("tzdata", "all", "2025b")]
        self.assertEqual(lr.install_packages(rows, NOW), [
            {"name": "libc6:amd64", "version": "2.39-0ubuntu8.6"}, {"name": "libc6:i386", "version": "2.39-0ubuntu8.6"},
            {"name": "tzdata", "version": "2025b"}])

    def test_dnf_names_stay_as_reported(self):
        rows = [row("openssl-libs.x86_64", "x86_64", "1:3.5.1-4.el9_8"), row("openssl-libs.i686", "i686", "1:3.5.1-4.el9_8")]
        self.assertEqual([p["name"] for p in lr.install_packages(rows, NOW)], ["openssl-libs.x86_64", "openssl-libs.i686"])


class SqlShapeTests(unittest.TestCase):
    """Guards for the statements: parameters, materialized scopes, no unguarded uuid casts."""
    def test_parameters(self):
        for sql in (lr.EVALUATE, lr.NODE_DETAIL, lr.APPLY, lr.SCOPE_NODES):
            self.assertIn("$3::text[]", sql)
        self.assertNotIn("$2", lr.FLEET_STATE)

    def test_phased_rows_are_not_evaluated(self):
        # the cache (APPLY, RECOUNT_DUE, FLEET_STATE), the preview and the bulk payload all build on EVALUATE
        pending = lr.EVALUATE.split("pending AS MATERIALIZED")[1].split("), matches AS")[0]
        self.assertIn("WHERE NOT u.phased", pending)
        self.assertIn("u.phased", lr.NODE_DETAIL)

    def test_ring_nodes_limited_to_the_target_nodes(self):
        ring_nodes = lr.EVALUATE.split("ring_nodes AS MATERIALIZED")[1].split("), scope AS")[0]
        self.assertIn("JOIN target t ON t.node_id = dg.node_id", ring_nodes)

    def test_deleted_nodes_are_left_out(self):
        # linux_data_current outlives a node deleted directly: evaluation and fleet state check nodes
        for sql in (lr.EVALUATE, lr.NODE_INFO, lr.FLEET_STATE):
            self.assertIn("EXISTS (SELECT 1 FROM nodes n WHERE n.id = ", sql)

    def test_deleted_ring_group_makes_an_exclusion_cover_all_nodes(self):
        dangling = lr.EVALUATE.split("dangling AS MATERIALIZED")[1].split("), ring_nodes AS")[0]
        self.assertIn("EXISTS (SELECT 1 FROM groups g WHERE g.id = pr.node_group_id)", dangling)

    def test_text_node_ids_are_cast_only_when_they_are_uuids(self):
        for sql in (lr.FLEET_STATE, lr.RECOUNT_DUE):
            self.assertNotIn("= l.node_id::uuid", sql)
            self.assertNotIn("= d.node_id::uuid", sql)


if __name__ == "__main__":
    unittest.main()
