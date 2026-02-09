# Bug Report: Package Installation Fails Without Download URL

## Issue Date
2026-02-09

## Summary
Package installation jobs fail with cryptic error when `download_url` is not set in `package_versions` table.

## Symptoms
- Job status: `failed`
- Exit code: `-1`
- Error message:
```
An error occurred trying to start process 'echo' with working directory 'C:\Program Files\OpenClaw'. 
Das System kann die angegebene Datei nicht finden.
```

## Root Cause
Two issues combined:

### 1. Missing download_url in package_versions
When a package version has no `download_url` set, the backend generates a fallback command:
```python
command_payload = {
    "command": ["echo", "ERROR: Package version not found or missing download URL"],
    "timeout": 30
}
```
(Line 2230-2234 in `main.py`)

### 2. .NET Agent cannot execute `echo` directly
The Windows agent tries to execute `echo` as a standalone process, but `echo` is a CMD built-in command, not an executable. It requires `cmd.exe /c echo ...` to work.

## Affected Components
- Backend: `main.py` - install_package job generation (lines 2165-2240)
- Agent: Command execution without shell wrapper

## Fix Applied
1. Set the correct `download_url` for the LibreOffice package:
```sql
UPDATE package_versions 
SET download_url = 'https://download.documentfoundation.org/libreoffice/stable/26.2.0/win/x86_64/LibreOffice_26.2.0_Win_x86-64.msi'
WHERE id = 'de56070e-6c11-40ba-abed-f0badbad7cef';
```

## Recommended Permanent Fixes

### Option A: Require download_url (Validation)
Add validation in the create package version endpoint to require `download_url`:
```python
if not data.get("downloadUrl"):
    raise HTTPException(status_code=400, detail="download_url is required")
```

### Option B: Better error handling (Backend)
Change the fallback command to use PowerShell instead of echo:
```python
command_payload = {
    "command": ["powershell", "-Command", "Write-Error 'Package version not found or missing download URL'; exit 1"],
    "timeout": 30
}
```

### Option C: Shell wrapper in Agent
Wrap all commands in `cmd.exe /c` or `powershell -Command` in the .NET agent.

## Test Case
1. Create package without download_url
2. Create install job for that package
3. Expected: Clear error message about missing URL
4. Actual (before fix): Cryptic "echo not found" error

## Related Files
- `backend/main.py` - Lines 2165-2240 (install_package handling)
- Agent: Command execution code

## Resolution
Package was successfully installed after setting the correct download_url.
Job ID: `3749b3d3-ec76-4307-b3ad-ad993d4623c0` - Status: success
