"""Fleet updates: the state of the newest installation until the node has finished it."""
import unittest
from datetime import datetime, timedelta, timezone

from routers.patches import install_state

T = datetime(2026, 11, 15, 15, 23, 10, tzinfo=timezone.utc)  # installation finished
WIN_OUT = '=== MAIN COMMAND ===\n{"installed":["KB5136489"],"failed":[],"reboot_required":true,"error":null}\n'


def job(status="success", policy="force", output=WIN_OUT, **extra):
    return {"id": "j1", "status": status, "completed_at": T if status != "running" else None,
            "reboot_policy": policy, "output": output, **extra}


class InstallStateTests(unittest.TestCase):
    def test_running_job(self):
        self.assertEqual(install_state(job(status="running"), None, None, T)["state"], "installing")

    def test_restarting_until_the_node_searches_again(self):
        # the search after the installation ran before the job finished; the restart follows
        state = install_state(job(), T - timedelta(seconds=10), True, T + timedelta(minutes=3))
        self.assertEqual(state["state"], "restarting")
        self.assertEqual(state["restart_at"], (T + timedelta(minutes=1)).isoformat())
        # the agent searches after the restart: finished
        self.assertIsNone(install_state(job(), T + timedelta(minutes=7), False, T + timedelta(minutes=8)))
        # a node that does not come back is no longer "restarting" after the grace time
        self.assertIsNone(install_state(job(), T - timedelta(seconds=10), True, T + timedelta(hours=3)))

    def test_scheduled_restart(self):
        at = T + timedelta(hours=6)
        state = install_state(job(policy="schedule", reboot_schedule_time=at.isoformat().replace("+00:00", "Z")),
                              T - timedelta(seconds=10), True, T + timedelta(hours=1))
        self.assertEqual((state["state"], state["restart_at"]), ("restarting", at.isoformat()))

    def test_no_reboot_ordered(self):
        self.assertEqual(install_state(job(policy="no_reboot"), T - timedelta(seconds=10), True, T)["state"], "awaiting_restart")
        self.assertIsNone(install_state(job(policy="no_reboot"), T + timedelta(hours=1), False, T + timedelta(hours=1)))

    def test_nothing_pending(self):
        self.assertIsNone(install_state(None, None, None, T))
        no_reboot = WIN_OUT.replace('"reboot_required":true', '"reboot_required":false')
        self.assertIsNone(install_state(job(output=no_reboot), T - timedelta(seconds=10), False, T))

    def test_linux_output(self):
        out = "=== MAIN COMMAND ===\nSetting up linux-image-7.0.0-44-generic ...\nReboot required: yes (linux-image-7.0.0-44-generic)\n"
        self.assertEqual(install_state(job(output=out), T - timedelta(seconds=10), True, T)["state"], "restarting")
        self.assertIsNone(install_state(job(output="Reboot required: no\n"), T - timedelta(seconds=10), False, T))


if __name__ == "__main__":
    unittest.main()
