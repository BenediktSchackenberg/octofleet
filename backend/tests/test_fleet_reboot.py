"""Fleet updates: the reboot outlook per node, like the node page's estimate."""
import unittest

from routers.patches import _linux_reboot, _windows_reboot


class FleetRebootTests(unittest.TestCase):
    def test_linux(self):
        self.assertEqual(_linux_reboot(["vim"], True), "pending")
        self.assertEqual(_linux_reboot(["vim", "linux-image-7.0.0-44-generic"], False), "needed")
        self.assertEqual(_linux_reboot(["libssl3t64", "vim"], False), "maybe")
        # Arch and derivatives: the kernel package is named linux, linux-lts, linux-cachyos, ...
        for kernel in ("linux", "linux-lts", "linux-zen", "linux-cachyos", "linux-cachyos-lts"):
            self.assertEqual(_linux_reboot(["vim", kernel], False), "needed", kernel)
        for other in ("linux-firmware", "linux-api-headers", "util-linux"):
            self.assertEqual(_linux_reboot([other], False), "none", other)
        self.assertEqual(_linux_reboot(["systemd-resolved"], False), "maybe")
        self.assertEqual(_linux_reboot(["vim", "linuxdoc-tools"], False), "none")
        self.assertEqual(_linux_reboot([], False), "none")

    def test_windows(self):
        self.assertEqual(_windows_reboot(True, []), "pending")
        self.assertEqual(_windows_reboot(False, ["never", "always"]), "needed")
        self.assertEqual(_windows_reboot(False, ["can", None]), "maybe")
        self.assertEqual(_windows_reboot(False, ["never", None]), "unknown")
        self.assertEqual(_windows_reboot(None, ["never"]), "none")


if __name__ == "__main__":
    unittest.main()
