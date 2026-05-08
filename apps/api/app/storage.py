"""File storage abstraction.

Two backends:

1. **Cloudflare R2 (preferred for production)** — when env vars are set:
   - R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET
   The presign helpers issue real S3-compatible presigned URLs that the
   client uploads to / downloads from directly, bypassing the API server.

2. **Local filesystem (fallback for dev)** — when R2 env vars are missing:
   `apps/api/uploads/` is the storage dir; the presign helpers point at
   our own /files/upload and /files/download endpoints. Files do NOT
   persist across Railway redeploys in this mode (Railway's local FS is
   ephemeral). Use R2 in production.
"""

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"


def _get_api_base() -> str:
    """Resolve API base URL for file download links (local-fallback only)."""
    explicit = os.getenv("API_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN")
    if railway_domain:
        return f"https://{railway_domain}"
    return "http://127.0.0.1:8000"


API_BASE = _get_api_base()


# ── R2 client (lazy-init) ──────────────────────────────────────────


_r2_client: Any | None = None
_r2_bucket: str | None = None


def _r2_configured() -> bool:
    return all(os.getenv(v) for v in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID", "R2_BUCKET"))


def _get_r2() -> tuple[Any, str] | None:
    """Return (client, bucket) for R2 if env vars are set, else None.

    Cached after first successful init. Failures (e.g. boto3 missing,
    invalid creds at construct time) log and return None — caller falls
    back to local mode.
    """
    global _r2_client, _r2_bucket

    if _r2_client is not None and _r2_bucket is not None:
        return _r2_client, _r2_bucket

    if not _r2_configured():
        return None

    try:
        import boto3  # type: ignore
        from botocore.config import Config  # type: ignore
    except ImportError:
        logger.warning("R2 env vars set but boto3 not installed; falling back to local FS")
        return None

    account_id = os.environ["R2_ACCOUNT_ID"].strip()
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    try:
        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    except Exception as e:
        logger.exception("Failed to construct R2 client: %s — falling back to local FS", e)
        return None

    _r2_client = client
    _r2_bucket = os.environ["R2_BUCKET"].strip()
    logger.info("R2 storage enabled (bucket=%s, endpoint=%s)", _r2_bucket, endpoint)
    return _r2_client, _r2_bucket


# ── Public API ─────────────────────────────────────────────────────


def presign_put_url(object_key: str, content_type: str = "") -> str:
    """Return a URL the client can PUT a file to.

    R2 mode: presigned R2 URL (client uploads direct, ~1hr expiry).
    Local mode: our /files/upload endpoint (proxies to local disk).
    """
    r2 = _get_r2()
    if r2 is not None:
        client, bucket = r2
        params: dict = {"Bucket": bucket, "Key": object_key}
        if content_type:
            params["ContentType"] = content_type
        try:
            return client.generate_presigned_url("put_object", Params=params, ExpiresIn=3600)
        except Exception as e:
            logger.exception("R2 presign PUT failed for %s: %s — falling back to local", object_key, e)
            # fall through to local

    return f"{API_BASE}/files/upload/{object_key}"


def presign_get_url(object_key: str, expires_seconds: int = 3600) -> str:
    """Return a URL the client can GET the file from.

    R2 mode: presigned R2 URL (~1hr expiry, can be navigated to in browser).
    Local mode: our /files/download endpoint.
    """
    r2 = _get_r2()
    if r2 is not None:
        client, bucket = r2
        try:
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": object_key},
                ExpiresIn=expires_seconds,
            )
        except Exception as e:
            logger.exception("R2 presign GET failed for %s: %s — falling back to local", object_key, e)
            # fall through to local

    return f"{API_BASE}/files/download/{object_key}"


def storage_backend() -> str:
    """For health/diagnostics. Returns 'r2' or 'local'."""
    return "r2" if _get_r2() is not None else "local"
