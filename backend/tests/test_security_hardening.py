"""App Control for Business (WDAC), AppLocker and VBS from the Windows agent's security section, normalised."""
import unittest

from security_hardening import app_control, applocker, vbs

DEVICE_GUARD = {"available": True, "codeIntegrityPolicyEnforcementStatus": 2,
                "usermodeCodeIntegrityPolicyEnforcementStatus": 0, "virtualizationBasedSecurityStatus": 2,
                "securityServicesConfigured": [1, 2], "securityServicesRunning": [2]}


class AppControlTests(unittest.TestCase):
    def test_enforcement_per_mode(self):
        for status, state in ((0, "off"), (1, "audit"), (2, "enforced"), (7, "unknown"), (None, "unknown")):
            sec = {"deviceGuard": {**DEVICE_GUARD, "usermodeCodeIntegrityPolicyEnforcementStatus": status}}
            self.assertEqual(app_control(sec)["userMode"], state, status)
        self.assertEqual(app_control({"deviceGuard": DEVICE_GUARD})["kernelMode"], "enforced")

    def test_missing_class_is_unknown(self):
        # older Windows: no DeviceGuard namespace
        result = app_control({"deviceGuard": {"available": False, "error": "Invalid namespace"}, "appControl": {}})
        self.assertEqual((result["kernelMode"], result["userMode"]), ("unknown", "unknown"))
        self.assertEqual(result["vulnerableDriverBlocklist"], "unknown")
        self.assertIsNone(result["policies"])
        self.assertEqual(result["error"], "Invalid namespace")

    def test_older_agent_sends_nothing(self):
        self.assertIsNone(app_control({"firewall": {}}))
        self.assertIsNone(vbs({"firewall": {}}))
        self.assertIsNone(applocker({"firewall": {}}))

    def test_policies_and_blocklist(self):
        result = app_control({"deviceGuard": DEVICE_GUARD, "appControl": {
            "policySource": "citool", "vulnerableDriverBlocklistEnable": 0, "policies": [
                {"policyId": "d2bda982-ccf6-4344-ac5b-0b44427b6816", "basePolicyId": "D2BDA982-CCF6-4344-AC5B-0B44427B6816",
                 "friendlyName": "Microsoft Windows Driver Policy", "version": "10.0.26100.4",
                 "isSystemPolicy": True, "isSignedPolicy": True, "isEnforced": True},
                {"policyId": "{11111111-0000-0000-0000-000000000000}",
                 "basePolicyId": "{22222222-0000-0000-0000-000000000000}", "friendlyName": "Line of business"},
                {"policyId": "{0283AC0F-FFF1-49AE-ADA1-8A933130CAD6}"},  # from the policy files: id only
                "garbage",
            ]}})
        self.assertEqual(result["vulnerableDriverBlocklist"], "off")
        self.assertEqual(result["policySource"], "citool")
        driver, supplemental, file_only = result["policies"]
        self.assertEqual((driver["name"], driver["signed"], driver["supplemental"]),
                         ("Microsoft Windows Driver Policy", True, False))
        self.assertTrue(supplemental["supplemental"])
        self.assertEqual((file_only["name"], file_only["supplemental"], file_only["enforced"]), (None, None, None))

    def test_blocklist_on(self):
        result = app_control({"deviceGuard": DEVICE_GUARD, "appControl": {"vulnerableDriverBlocklistEnable": 1}})
        self.assertEqual(result["vulnerableDriverBlocklist"], "on")


class VbsTests(unittest.TestCase):
    def test_services(self):
        result = vbs({"deviceGuard": DEVICE_GUARD})
        self.assertEqual(result["status"], "running")
        self.assertEqual(result["services"], {"credentialGuard": "notRunning", "hvci": "running", "systemGuard": "off"})

    def test_status_values(self):
        for status, state in ((0, "off"), (1, "notRunning"), (2, "running"), (None, "unknown")):
            self.assertEqual(vbs({"deviceGuard": {**DEVICE_GUARD, "virtualizationBasedSecurityStatus": status}})["status"], state)

    def test_unavailable_is_unknown(self):
        result = vbs({"deviceGuard": {"available": False, "error": "Access denied"}})
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(set(result["services"].values()), {"unknown"})
        self.assertEqual(result["error"], "Access denied")


class AppLockerTests(unittest.TestCase):
    def test_collections(self):
        result = applocker({"appLocker": {"available": True, "appIdSvcStatus": "Running", "collections": [
            {"type": "Exe", "enforcementMode": "AuditOnly", "ruleCount": 3},
            {"type": "Script", "enforcementMode": "Enabled", "ruleCount": 1},
            {"type": "Msi", "enforcementMode": "NotConfigured", "ruleCount": 2},  # rules without a mode: enforced
            {"type": "Dll", "enforcementMode": "Enabled", "ruleCount": 0},  # no rules: nothing is restricted
        ]}})
        states = {c["type"]: (c["state"], c["ruleCount"]) for c in result["collections"]}
        self.assertEqual(states, {"exe": ("audit", 3), "msi": ("enforced", 2), "script": ("enforced", 1),
                                  "dll": ("off", 0), "appx": ("off", 0)})
        self.assertEqual(result["appIdSvc"], "running")

    def test_not_available(self):
        result = applocker({"appLocker": {"available": False, "error": "Get-AppLockerPolicy is not recognized",
                                          "appIdSvcStatus": None}})
        self.assertEqual({c["state"] for c in result["collections"]}, {"unknown"})
        self.assertEqual(result["appIdSvc"], "unknown")
        self.assertEqual(result["error"], "Get-AppLockerPolicy is not recognized")

    def test_unexpected_values_do_not_raise(self):
        result = applocker({"appLocker": {"available": True, "collections": [{"type": "Exe", "ruleCount": "x"}, 5]}})
        self.assertEqual(result["collections"][0]["state"], "off")


if __name__ == "__main__":
    unittest.main()
