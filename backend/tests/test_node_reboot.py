"""Reboot button: request validation, the reboot state until the node reports, logged-on users."""
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import node_reboot
from job_types import JOB_COMMAND_TYPES

NOW = datetime(2026, 11, 23, 10, 0, tzinfo=timezone.utc)
NODE = "6f1c1f5e-1111-4a6b-9a52-0d1b2c3d4e5f"


class ParseRequestTests(unittest.TestCase):
    def test_now_is_in_a_minute(self):
        p = node_reboot.parse_request({"when": "now"}, NOW)
        self.assertEqual(p, {"action": "reboot", "at": "2026-11-23T10:01:00Z", "message": None})

    def test_in_minutes(self):
        p = node_reboot.parse_request({"when": "in", "minutes": 30, "message": "Updates"}, NOW)
        self.assertEqual(p["at"], "2026-11-23T10:30:00Z")
        self.assertEqual(p["message"], "Updates")
        for bad in (0, -5, 10081, "30", 1.5, True, None):
            with self.assertRaises(ValueError, msg=bad):
                node_reboot.parse_request({"when": "in", "minutes": bad}, NOW)

    def test_at_time(self):
        p = node_reboot.parse_request({"when": "at", "at": "2026-11-23T22:00:00+01:00"}, NOW)
        self.assertEqual(p["at"], "2026-11-23T21:00:00Z")
        for bad in ("2026-11-23T10:00:30Z",          # less than a minute ahead
                    "2026-12-01T10:00:00Z",          # more than 7 days
                    "2026-11-23T22:00:00",           # no offset
                    "tomorrow", None):
            with self.assertRaises(ValueError, msg=bad):
                node_reboot.parse_request({"when": "at", "at": bad}, NOW)

    def test_message_is_one_clean_line(self):
        p = node_reboot.parse_request({"when": "now", "message": "  Save your work\n\x07now\t "}, NOW)
        self.assertEqual(p["message"], "Save your work now")
        with self.assertRaises(ValueError):
            node_reboot.parse_request({"when": "now", "message": "x" * 201}, NOW)
        with self.assertRaises(ValueError):
            node_reboot.parse_request({"when": "now", "message": 5}, NOW)

    def test_cancel_and_unknown(self):
        self.assertEqual(node_reboot.parse_request({"action": "cancel", "when": "bogus"}, NOW), {"action": "cancel"})
        with self.assertRaises(ValueError):
            node_reboot.parse_request({"when": "later"}, NOW)

    def test_node_ids(self):
        self.assertEqual(node_reboot.node_ids({"node_ids": [NODE, NODE]}), [NODE])
        for bad in ({}, {"node_ids": []}, {"node_ids": "x"}, {"node_ids": ["SRV01"]}, {"node_ids": [1]}):
            with self.assertRaises(ValueError, msg=bad):
                node_reboot.node_ids(bad)
        import uuid
        with self.assertRaises(ValueError):
            node_reboot.node_ids({"node_ids": [str(uuid.uuid4()) for _ in range(501)]})

    def test_job_type_is_allowed(self):
        self.assertIn("reboot", JOB_COMMAND_TYPES)


def job(status, at=NOW + timedelta(minutes=1), completed=None, action="reboot", error=None):
    return {"id": "j1", "status": status, "completed_at": completed.isoformat() if completed else None,
            "payload": {"action": action, "at": at.isoformat()}, "error": error}


class RebootStateTests(unittest.TestCase):
    def test_none(self):
        self.assertIsNone(node_reboot.reboot_state(None, None, NOW))

    def test_scheduled_until_the_agent_answers(self):
        s = node_reboot.reboot_state(job("pending"), NOW - timedelta(hours=1), NOW)
        self.assertEqual(s["state"], "scheduled")
        self.assertEqual(s["restart_at"], (NOW + timedelta(minutes=1)).isoformat())

    def test_restarting_until_the_node_reports_after_the_reboot(self):
        at = NOW - timedelta(minutes=5)
        j = job("success", at=at, completed=at - timedelta(minutes=1))
        # reported before the reboot: still restarting (the badge stays)
        self.assertEqual(node_reboot.reboot_state(j, at - timedelta(minutes=10), NOW)["state"], "restarting")
        self.assertEqual(node_reboot.reboot_state(j, None, NOW)["state"], "restarting")
        # reported after it: done
        self.assertIsNone(node_reboot.reboot_state(j, at + timedelta(minutes=3), NOW))
        # a node that never comes back stops counting as restarting after the grace time
        self.assertIsNone(node_reboot.reboot_state(j, None, at + node_reboot.RESTART_GRACE + timedelta(seconds=1)))

    def test_later_reboot_stays_restarting_while_waiting(self):
        at = NOW + timedelta(hours=3)
        j = job("success", at=at, completed=NOW - timedelta(minutes=1))
        self.assertEqual(node_reboot.reboot_state(j, NOW, NOW)["state"], "restarting")

    def test_failed_until_the_node_reports_again(self):
        done = NOW - timedelta(minutes=2)
        j = job("failed", completed=done, error="shutdown not found")
        s = node_reboot.reboot_state(j, done - timedelta(minutes=1), NOW)
        self.assertEqual((s["state"], s["error"]), ("failed", "shutdown not found"))
        self.assertIsNone(node_reboot.reboot_state(j, done + timedelta(minutes=1), NOW))

    def test_cancel_job_or_cancelled_job_clears(self):
        self.assertIsNone(node_reboot.reboot_state(job("success", action="cancel", completed=NOW), None, NOW))
        self.assertIsNone(node_reboot.reboot_state(job("pending", action="cancel"), None, NOW))
        self.assertIsNone(node_reboot.reboot_state(job("cancelled", completed=NOW), None, NOW))

    def test_naive_and_string_times(self):
        at = NOW - timedelta(minutes=5)
        j = job("success", at=at, completed=at)
        reported = (at + timedelta(minutes=2)).replace(tzinfo=None)
        self.assertIsNone(node_reboot.reboot_state(j, reported, NOW))
        self.assertIsNone(node_reboot.reboot_state(j, (at + timedelta(minutes=2)).isoformat(), NOW))


class LoggedOnUsersTests(unittest.TestCase):
    def setUp(self):
        node_reboot._logged_on.clear()

    def test_unknown_until_reported(self):
        self.assertIsNone(node_reboot.logged_on_users(NODE))
        node_reboot.remember_logged_on_users(NODE, "not a list")
        self.assertIsNone(node_reboot.logged_on_users(NODE))

    def test_reported_list_is_cleaned(self):
        node_reboot.remember_logged_on_users(NODE, [
            {"user": "CORP\\anna", "session": "RDP-Tcp#3", "since": None},
            {"user": "  ", "session": "tty1"}, "junk", {"session": "x"},
            {"user": "bob", "session": "pts/0", "since": "2026-11-23 09:01"},
        ])
        self.assertEqual([u["user"] for u in node_reboot.logged_on_users(NODE)], ["CORP\\anna", "bob"])
        node_reboot.remember_logged_on_users(NODE, [])
        self.assertEqual(node_reboot.logged_on_users(NODE), [])

    def test_old_report_counts_as_unknown(self):
        node_reboot.remember_logged_on_users(NODE, [{"user": "bob"}])
        with mock.patch.object(time, "monotonic", return_value=time.monotonic() + node_reboot.USERS_MAX_AGE + 1):
            self.assertIsNone(node_reboot.logged_on_users(NODE))


class NodeTests(unittest.TestCase):
    def test_os_family(self):
        self.assertEqual(node_reboot.os_family("Microsoft Windows Server 2025", False), "windows")
        self.assertEqual(node_reboot.os_family("CachyOS Linux", False), "linux")
        self.assertEqual(node_reboot.os_family(None, True), "linux")
        self.assertIsNone(node_reboot.os_family("macOS 15", False))

    def test_blocker(self):
        row = {"removal_state": None, "os_family": "linux"}
        self.assertIsNone(node_reboot.blocker(row))
        self.assertEqual(node_reboot.blocker({**row, "removal_state": "uninstall_pending"}), "removal")
        self.assertIsNone(node_reboot.blocker({**row, "removal_state": "uninstall_failed"}))  # the agent still runs
        self.assertEqual(node_reboot.blocker({**row, "os_family": None}), "unsupported_os")

    def test_open_sessions_match_the_node_by_uuid_node_id_or_hostname(self):
        from routers import terminal
        from screen_session import ScreenSessionState, screen_session_manager
        from shell_session import ShellSessionState, shell_session_manager
        row = {"id": NODE, "node_id": "SRV01", "hostname": "srv01"}
        term = terminal.TerminalSession("t1", NODE, "bash")
        stale = terminal.TerminalSession("t2", NODE, "bash")
        stale.last_viewer -= terminal.TERMINAL_VIEWER_ACTIVE_SECONDS + 1  # page closed
        other = terminal.TerminalSession("t3", "OTHER", "bash")
        screen = mock.Mock(node_id="SRV01", state=ScreenSessionState.ACTIVE)
        shell_open = mock.Mock(node_id="srv01", state=ShellSessionState.PENDING)
        shell_closed = mock.Mock(node_id="SRV01", state=ShellSessionState.CLOSED)
        with mock.patch.dict(terminal._terminal_sessions, {"t1": term, "t2": stale, "t3": other}, clear=True), \
                mock.patch.dict(screen_session_manager.sessions, {"s": screen}, clear=True), \
                mock.patch.dict(shell_session_manager._sessions, {"a": shell_open, "b": shell_closed}, clear=True):
            self.assertEqual(node_reboot.open_sessions(row), {"terminal": 1, "screen": 1, "shell": 1})


if __name__ == "__main__":
    unittest.main()
