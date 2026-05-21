from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import User
from .security import hash_password

PLAYER_SERVICE_USERNAME = "singalong-player"


def seed_admin_user() -> None:
    admin_username = settings.singalong_admin_username.strip()
    admin_password = settings.singalong_admin_password
    if admin_username == "" or admin_password == "":
        raise ValueError("SINGALONG_ADMIN_USERNAME and SINGALONG_ADMIN_PASSWORD must be non-empty")

    with SessionLocal() as db:
        admin_user = db.scalar(select(User).where(User.username == admin_username))
        password_hash = hash_password(admin_password)

        if admin_user is None:
            db.add(User(username=admin_username, password_hash=password_hash, role="admin"))
        else:
            admin_user.password_hash = password_hash
            admin_user.role = "admin"

        # Seed the built-in player service account (no password — uses token endpoint).
        player_user = db.scalar(select(User).where(User.username == PLAYER_SERVICE_USERNAME))
        if player_user is None:
            db.add(User(username=PLAYER_SERVICE_USERNAME, password_hash=None, role="player"))

        db.commit()
