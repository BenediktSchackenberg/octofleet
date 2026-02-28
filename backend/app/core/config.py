import os
import secrets
from pathlib import Path
from typing import List, Optional

# Base directory
BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings:
    # API Metadata
    PROJECT_NAME: str = "Octofleet Inventory API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Security
    API_KEY: str = os.getenv("API_KEY", os.getenv("INVENTORY_API_KEY", "octofleet-inventory-dev-key"))
    JWT_SECRET: str = os.getenv("JWT_SECRET", "octofleet-dev-secret-key-2026")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://octofleet:octofleet_inventory_2026@127.0.0.1:5432/inventory"
    )
    DB_POOL_MIN_SIZE: int = 2
    DB_POOL_MAX_SIZE: int = 10
    
    # Service URLs
    GATEWAY_URL: str = os.getenv("OCTOFLEET_GATEWAY_URL", "http://192.168.0.5:18789")
    GATEWAY_TOKEN: str = os.getenv("OCTOFLEET_GATEWAY_TOKEN", "")
    INVENTORY_API_URL: str = os.getenv("OCTOFLEET_INVENTORY_URL", "http://192.168.0.5:8080")
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["*"]

    def __init__(self):
        # Update JWT secret from persistent file if not provided in env
        if not os.getenv("JWT_SECRET"):
            self.JWT_SECRET = self.load_persistent_jwt_secret()

    def load_persistent_jwt_secret(self):
        """Ensure JWT_SECRET is loaded from file or persisted if not in env"""
        secret_file = BASE_DIR / ".jwt_secret"
        if secret_file.exists():
            try:
                return secret_file.read_text().strip()
            except:
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
