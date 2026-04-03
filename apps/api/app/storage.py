import os
from pathlib import Path

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"

def _get_api_base() -> str:
    """Resolve API base URL for file download links."""
    explicit = os.getenv("API_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    # Use Railway public domain if available
    railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN")
    if railway_domain:
        return f"https://{railway_domain}"
    return "http://127.0.0.1:8000"

API_BASE = _get_api_base()


def presign_put_url(object_key: str, content_type: str = "") -> str:
    return f"{API_BASE}/files/upload/{object_key}"


def presign_get_url(object_key: str, expires_seconds: int = 3600) -> str:
    return f"{API_BASE}/files/download/{object_key}"
