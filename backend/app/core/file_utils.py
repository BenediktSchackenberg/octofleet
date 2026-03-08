"""File utility functions for package repository."""
import hashlib
import os

import aiofiles

REPO_BASE_PATH = os.environ.get("REPO_BASE_PATH", "/data/repo")

def get_repo_storage_path(file_type: str, filename: str) -> str:
    type_dirs = {'msi': 'msi', 'exe': 'exe', 'sql-cu': 'sql-cu', 'script': 'scripts', 'ps1': 'scripts', 'other': 'other'}
    subdir = type_dirs.get(file_type, 'other')
    return os.path.join(REPO_BASE_PATH, subdir, filename)

def detect_repo_file_type(filename: str) -> str:
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    return {'msi': 'msi', 'exe': 'exe', 'zip': 'zip', 'ps1': 'ps1', 'cab': 'cab'}.get(ext, 'other')

async def compute_file_sha256(filepath: str) -> str:
    sha256_hash = hashlib.sha256()
    async with aiofiles.open(filepath, 'rb') as f:
        while chunk := await f.read(8192):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()
