"""The terminal poll tells the agent whether a terminal page for its node is open (#283).

The agents poll fast only while `active` is true and slowly otherwise, so the flag must be true
while the page is open, false once it is gone, and only for the node the page belongs to.
"""
import asyncio
import time
import unittest

from routers import terminal


def pending(node_id):
    return asyncio.run(terminal.get_pending_terminal_commands(node_id, None))


def get_output(session_id):
    return asyncio.run(terminal.get_terminal_output(session_id, None))


class TerminalActiveFlagTest(unittest.TestCase):
    def setUp(self):
        terminal._terminal_sessions.clear()

    def tearDown(self):
        terminal._terminal_sessions.clear()

    def open_page(self, node_id="NODE-A"):
        session = terminal.TerminalSession("s-" + node_id, node_id, "powershell")
        terminal._terminal_sessions[session.session_id] = session
        return session

    def test_no_session_idle(self):
        self.assertEqual(pending("NODE-A"), {"commands": [], "active": False})

    def test_open_page_active(self):
        self.open_page()
        self.assertTrue(pending("NODE-A")["active"])

    def test_other_node_not_active(self):
        self.open_page("NODE-B")
        self.assertFalse(pending("NODE-A")["active"])

    def test_page_gone_idle(self):
        session = self.open_page()
        session.last_viewer = time.monotonic() - terminal.TERMINAL_VIEWER_ACTIVE_SECONDS - 1
        self.assertFalse(pending("NODE-A")["active"])

    def test_output_poll_keeps_it_active(self):
        session = self.open_page()
        session.last_viewer = time.monotonic() - terminal.TERMINAL_VIEWER_ACTIVE_SECONDS - 1
        get_output(session.session_id)  # the page asks for output every 0.5 s
        self.assertTrue(pending("NODE-A")["active"])

    def test_commands_always_active(self):
        session = self.open_page()
        session.last_viewer = time.monotonic() - terminal.TERMINAL_VIEWER_ACTIVE_SECONDS - 1
        session.pending_commands.append("hostname")
        answer = pending("NODE-A")
        self.assertTrue(answer["active"])
        self.assertEqual(answer["commands"][0]["commands"], ["hostname"])
        self.assertEqual(session.pending_commands, [])


if __name__ == "__main__":
    unittest.main()
