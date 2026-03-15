import logging
import os
import secrets
from pathlib import Path
from typing import List

log = logging.getLogger(__name__)

# Base directory
BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings:
    # API Metadata
    PROJECT_NAME: str = "Octofleet Inventory API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Security
    API_KEY: str = os.getenv("API_KEY", os.getenv("INVENTORY_API_KEY", ""))
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    DB_POOL_MIN_SIZE: int = 2
    DB_POOL_MAX_SIZE: int = 10
    
    # Service URLs - no LAN IP defaults; must be explicitly configured
    GATEWAY_URL: str = os.getenv("OCTOFLEET_GATEWAY_URL", "")
    GATEWAY_TOKEN: str = os.getenv("OCTOFLEET_GATEWAY_TOKEN", "")
    INVENTORY_API_URL: str = os.getenv("OCTOFLEET_INVENTORY_URL", "")
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["*"]

    def __init__(self):
        # Update JWT secret from persistent file if not provided in env
        if not os.getenv("JWT_SECRET"):
            self.JWT_SECRET = self.load_persistent_jwt_secret()
        
        # Warn about insecure defaults
        if not self.API_KEY:
            log.warning("API_KEY is not set! Set API_KEY or INVENTORY_API_KEY environment variable.")
        if not self.JWT_SECRET:
            log.warning("JWT_SECRET is empty! Set JWT_SECRET environment variable.")
        if not self.DATABASE_URL:
            log.warning("DATABASE_URL is not set! Set DATABASE_URL environment variable.")

    def load_persistent_jwt_secret(self):
        """Ensure JWT_SECRET is loaded from file or persisted if not in env.
        
        ⚠️  SECURITY WARNING: This writes the JWT signing secret to disk in plaintext.
        The file is chmod 600 on Unix, but anyone with root/container access can read it.
        Prefer setting JWT_SECRET via environment variable in production.
        This fallback exists so container restarts don't invalidate all tokens.
        """
        secret_file = BASE_DIR / ".jwt_secret"
        if secret_file.exists():
            try:
                return secret_file.read_text().strip()
            except Exception:
                pass
            
        # Fallback: generate and save
        secret = secrets.token_hex(32)
        try:
            secret_file.write_text(secret)
            if os.name != 'nt':
                secret_file.chmod(0o600)
        except Exception as e:
            print(f"Warning: Could not persist JWT secret: {e}")
        return secret

# Initialize settings
settings = Settings()
