"""Disk rules shared by the hardware overviews.

- Pseudo block devices are not disks: zram (compressed swap in RAM), loop (mounted images),
  ram disks. Older Linux agents report them, so the server leaves them out of every count.
- A Linux file system mounted several times (btrfs subvolumes, bind mounts) is one volume:
  sizes are counted once per device, not once per mount point.
- Disks of a virtual machine without a health status are "virtual": they have no SMART,
  their health belongs to the host's storage, and that is not an unknown/problem state.
"""
import re

_PSEUDO_DISK = re.compile(r"^(?:/dev/)?(?:zram|loop|ram)\d+$")


def is_pseudo_disk(disk: dict) -> bool:
    """True for zram/loop/ram devices, judged by device path or, without one, by the model."""
    device = (disk.get("deviceId") or "").strip()
    model = (disk.get("model") or "").strip()
    return bool(_PSEUDO_DISK.match(device) or (not device and _PSEUDO_DISK.match(model)))


def physical_disks(disks) -> list[dict]:
    """The real disks of one node's disk inventory (a dict with "physical"; anything else → [])."""
    if not isinstance(disks, dict):
        return []
    return [d for d in disks.get("physical") or [] if isinstance(d, dict) and not is_pseudo_disk(d)]


def distinct_volumes(volumes) -> list[dict]:
    """Volumes with each Linux device once (the first reported mount wins).

    Linux reports the device in volumeName (/dev/sda2, /dev/mapper/...); Windows reports a label
    there ("Windows", "data") and the drive letter, so Windows volumes stay one per letter."""
    seen, result = set(), []
    for vol in volumes or []:
        if not isinstance(vol, dict):
            continue
        name = vol.get("volumeName") or ""
        key = name if name.startswith("/dev/") else ("letter", vol.get("driveLetter"), name)
        if key in seen:
            continue
        seen.add(key)
        result.append(vol)
    return result


def health_state(status, is_virtual: bool) -> str:
    """healthy | warning | unhealthy | virtual | unknown for one disk."""
    s = (status or "").strip().lower()
    if s == "healthy":
        return "healthy"
    if s in ("warning", "degraded"):
        return "warning"
    if s in ("unhealthy", "failed"):
        return "unhealthy"
    return "virtual" if is_virtual else "unknown"
