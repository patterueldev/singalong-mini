from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import User
from .security import hash_password


def _strip_legacy_guest_username(username: str) -> str | None:
    if not username.startswith("guest-"):
        return None

    parts = username.split("-")
    if len(parts) < 3:
        return None

    suffix = parts[-1]
    if len(suffix) != 8:
        return None

    if not all(char in "0123456789abcdef" for char in suffix.lower()):
        return None

    nickname = "-".join(parts[1:-1]).strip()
    return nickname or None


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

        db.commit()


def migrate_guest_usernames() -> None:
    with SessionLocal() as db:
        users = db.scalars(select(User).where(User.role == "guest")).all()
        username_index = set(db.scalars(select(User.username)).all())

        changed = False
        for user in users:
            cleaned_username = _strip_legacy_guest_username(user.username)
            if cleaned_username is None or cleaned_username == user.username:
                continue
            if cleaned_username in username_index:
                continue

            username_index.remove(user.username)
            user.username = cleaned_username
            username_index.add(cleaned_username)
            changed = True

        if changed:
            db.commit()
