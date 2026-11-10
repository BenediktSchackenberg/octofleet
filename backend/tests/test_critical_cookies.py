"""Critical cookies: only cookies of sensitive domains count, with category, summary and warning codes."""
import unittest

from routers.security import classify_critical_cookies, domain_category, is_critical_domain


def _row(domain, secure=True, http_only=True):
    return {"username": "alice", "browser": "Edge", "profile": "Default", "domain": domain, "name": "sid",
            "expires_utc": None, "is_secure": secure, "is_http_only": http_only, "is_session": False,
            "is_expired": False}


class CriticalCookieTests(unittest.TestCase):
    def test_only_sensitive_domains_count(self):
        result = classify_critical_cookies("HOST", [_row(".msn.com"), _row(".wetransfer.com"),
                                                    _row("login.microsoftonline.com"), _row(".paypal.com")])
        self.assertEqual(result["count"], 2)
        self.assertEqual(sorted(result["summary"]), ["Auth Provider", "Banking/Finance"])

    def test_subdomains_but_not_lookalikes(self):
        self.assertTrue(is_critical_domain(".accounts.google.com"))
        self.assertFalse(is_critical_domain("notgoogle.com"))
        self.assertEqual(domain_category("www.bitwarden.com"), "Password Manager")

    def test_warning_codes(self):
        result = classify_critical_cookies("HOST", [_row(".github.com", secure=False, http_only=False)])
        self.assertEqual(result["warningCodes"], ["notSecure", "notHttpOnly", "authProvider"])
        self.assertEqual(len(result["warnings"]), 3)


if __name__ == "__main__":
    unittest.main()
