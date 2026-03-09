import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import settings

def get_database_url() -> str:
    """Return resolved database URL with correct driver prefix."""
    url = settings.database_url
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://") and "+" not in url.split("://")[0]:
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url

_db_url = get_database_url()

# Log which DB backend is in use (mask credentials)
if "postgresql" in _db_url:
    _host = _db_url.split("@")[-1].split("/")[0] if "@" in _db_url else "unknown"
    logging.info("DATABASE: PostgreSQL @ %s", _host)
else:
    logging.warning("DATABASE: SQLite (ephemeral — data will be lost on redeploy!)")

_connect_args = {"check_same_thread": False} if _db_url.startswith("sqlite") else {}
engine = create_engine(_db_url, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()