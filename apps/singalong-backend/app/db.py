from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    # Explicit bounds instead of SQLAlchemy's defaults (pool_size=5, max_overflow=10, i.e. up
    # to 15 sockets with no cap tied to Postgres). A request that can't get a connection now
    # fails fast (10s) instead of hanging for the 30s default, and pool_recycle keeps long-idle
    # connections from going stale. See issue #60 — bounding this is part of keeping the app's
    # resource usage (sockets, and therefore file descriptors on the host) predictable.
    pool_size=5,
    max_overflow=5,
    pool_timeout=10,
    pool_recycle=1800,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
