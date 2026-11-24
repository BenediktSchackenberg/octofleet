"""App Control for Business (WDAC), AppLocker and virtualization-based security (VBS, HVCI, Credential Guard).

The Windows agent's security section (SecurityCollector) sends them nearly as Windows reports them:
`deviceGuard` (Win32_DeviceGuard numbers), `appControl` (active policies, vulnerable driver blocklist) and
`appLocker` (effective policy per rule collection, AppIDSvc status). They are normalised here into the states
the node's Security tab shows. Anything missing or unexpected is "unknown"; a section the agent did not send
at all (older agents) is None.
"""
from typing import Any, Optional

UNKNOWN = "unknown"

# Win32_DeviceGuard.CodeIntegrityPolicyEnforcementStatus / UsermodeCodeIntegrityPolicyEnforcementStatus
ENFORCEMENT = {0: "off", 1: "audit", 2: "enforced"}
# Win32_DeviceGuard.VirtualizationBasedSecurityStatus
VBS_STATUS = {0: "off", 1: "notRunning", 2: "running"}
# Win32_DeviceGuard.SecurityServicesConfigured / SecurityServicesRunning
SECURITY_SERVICES = {1: "credentialGuard", 2: "hvci", 3: "systemGuard"}
APPLOCKER_COLLECTIONS = ("exe", "msi", "script", "dll", "appx")


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _int(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _ints(value: Any) -> Optional[set]:
    return {v for v in value if _int(v) is not None} if isinstance(value, list) else None


def _text(value: Any) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _bool(value: Any) -> Optional[bool]:
    return value if isinstance(value, bool) else None


def _device_guard(sec: dict) -> Optional[dict]:
    device_guard = sec.get("deviceGuard")
    if not isinstance(device_guard, dict):
        return None
    return device_guard if device_guard.get("available") is True else {}


def app_control(sec: dict) -> Optional[dict]:
    """Enforcement in kernel and user mode (off/audit/enforced/unknown), active policies, driver blocklist."""
    if "deviceGuard" not in sec and "appControl" not in sec:
        return None
    device_guard = _device_guard(sec) or {}
    info = _dict(sec.get("appControl"))
    blocklist = _int(info.get("vulnerableDriverBlocklistEnable"))

    policies = None
    if isinstance(info.get("policies"), list):
        policies = [{
            "policyId": _text(p.get("policyId")),
            "basePolicyId": _text(p.get("basePolicyId")),
            "name": _text(p.get("friendlyName")),
            "version": _text(p.get("version")),
            "systemPolicy": _bool(p.get("isSystemPolicy")),
            "signed": _bool(p.get("isSignedPolicy")),
            "enforced": _bool(p.get("isEnforced")),
            # a supplemental policy names another policy as its base
            "supplemental": (None if not (p.get("policyId") and p.get("basePolicyId"))
                             else str(p["policyId"]).strip("{}").lower() != str(p["basePolicyId"]).strip("{}").lower()),
        } for p in info["policies"] if isinstance(p, dict)]

    return {
        "kernelMode": ENFORCEMENT.get(_int(device_guard.get("codeIntegrityPolicyEnforcementStatus")), UNKNOWN),
        "userMode": ENFORCEMENT.get(_int(device_guard.get("usermodeCodeIntegrityPolicyEnforcementStatus")), UNKNOWN),
        "vulnerableDriverBlocklist": {1: "on", 0: "off"}.get(blocklist, UNKNOWN),
        "policySource": _text(info.get("policySource")),
        "policies": policies,
        "error": _text(_dict(sec.get("deviceGuard")).get("error")) or _text(info.get("error")),
    }


def vbs(sec: dict) -> Optional[dict]:
    """VBS status and the security services on it (running / notRunning = configured only / off / unknown)."""
    device_guard = _device_guard(sec)
    if device_guard is None:
        return None
    configured = _ints(device_guard.get("securityServicesConfigured"))
    running = _ints(device_guard.get("securityServicesRunning"))

    def service_state(number):
        if running is not None and number in running:
            return "running"
        if configured is None or running is None:
            return UNKNOWN
        return "notRunning" if number in configured else "off"

    return {
        "status": VBS_STATUS.get(_int(device_guard.get("virtualizationBasedSecurityStatus")), UNKNOWN),
        "services": {name: service_state(number) for number, name in SECURITY_SERVICES.items()},
        "error": _text(_dict(sec.get("deviceGuard")).get("error")),
    }


def _collection_state(mode: Optional[str], rule_count: int) -> str:
    # No rules: AppLocker allows every file of that type. "NotConfigured" with rules is enforced
    # (that is the default enforcement mode once a collection has rules).
    if rule_count == 0:
        return "off"
    return {"auditonly": "audit", "enabled": "enforced", "notconfigured": "enforced"}.get((mode or "").lower(), UNKNOWN)


def applocker(sec: dict) -> Optional[dict]:
    """Per rule collection: state (enforced/audit/off/unknown), mode and rule count; whether AppIDSvc runs."""
    info = sec.get("appLocker")
    if not isinstance(info, dict):
        return None
    available = info.get("available") is True
    reported = {}
    for c in info.get("collections") or []:
        if isinstance(c, dict) and _text(c.get("type")):
            reported[c["type"].strip().lower()] = c

    collections = []
    for name in APPLOCKER_COLLECTIONS:
        c = reported.get(name)
        if not available:
            collections.append({"type": name, "state": UNKNOWN, "mode": None, "ruleCount": None})
        elif c is None:  # left out of the effective policy: no rules
            collections.append({"type": name, "state": "off", "mode": None, "ruleCount": 0})
        else:
            rule_count = _int(c.get("ruleCount")) or 0
            mode = _text(c.get("enforcementMode"))
            collections.append({"type": name, "state": _collection_state(mode, rule_count), "mode": mode,
                                "ruleCount": rule_count})

    service = (_text(info.get("appIdSvcStatus")) or "").lower()
    return {
        "collections": collections,
        "appIdSvc": service if service in ("running", "stopped") else UNKNOWN,
        "error": _text(info.get("error")),
    }
