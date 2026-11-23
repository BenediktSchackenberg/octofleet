"""Fleet updates: the reboot outlook per node, like the node page's estimate."""
import unittest

from routers.patches import _linux_reboot, _windows_reboot, linux_reboot_behavior


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



class LinuxRebootBehaviorTests(unittest.TestCase):
    """One estimate per package: the node's update list, the install dialog and the fleet view agree."""

    def test_per_package(self):
        for name, expected in (("linux-image-7.0.0-44-generic", "always"), ("linux-generic", "always"), ("linux-generic-hwe-24.04", "always"), ("linux-virtual", "always"),
                               ("kernel-core.x86_64", "always"), ("linux-cachyos", "always"),
                               ("libc6", "can"), ("systemd", "can"), ("openssl-libs.x86_64", "can"),
                               ("vim", "never"), ("linux-firmware", "never"), ("", "never"),
                               # tools and headers around the kernel do not change the running kernel
                               ("linux-headers-generic", "never"), ("linux-headers-7.0.0-44", "never"),
                               ("linux-tools-common", "never"), ("linux-libc-dev", "never"),
                               ("kernel-tools.x86_64", "never"), ("kernel-headers.x86_64", "never"),
                               ("linux-cachyos-headers", "never"), ("linux-image-amd64", "always"),
                               ("kernel.x86_64", "always"), ("kernel-modules-core.x86_64", "always"),
                               ("linux-modules-7.0.0-44-generic", "always"), ("linux-cachyos-lts", "always")):
            self.assertEqual(linux_reboot_behavior(name), expected, name)

    def test_fleet_follows_the_per_package_estimate(self):
        names = ["vim", "systemd", "linux-generic"]
        self.assertEqual(_linux_reboot(names, False), "needed")
        self.assertEqual(_linux_reboot(names[:2], False), "maybe")
        self.assertEqual(_linux_reboot(names[:1], False), "none")


if __name__ == "__main__":
    unittest.main()
