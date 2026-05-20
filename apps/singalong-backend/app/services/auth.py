from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, WebSocket, WebSocketException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import User

bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(user: User) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes,
    )
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "exp": expires_at,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _decode_token(token: str) -> dict[str, object]:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return payload


def _get_user_from_payload(payload: dict[str, object], db: Session) -> User:
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = UUID(subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def authenticate_websocket_user(
    websocket: WebSocket,
    db: Session,
    allowed_roles: set[str],
    token_query: str | None = None,
) -> User:
    token = token_query
    if token is None or token == "":
        authorization = websocket.headers.get("authorization")
        if authorization is not None and authorization.lower().startswith("bearer "):
            token = authorization[7:]

    if token is None or token == "":
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Missing bearer token",
        )

    try:
        user = _get_user_from_payload(_decode_token(token), db)
    except HTTPException as exc:
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason=exc.detail,
        ) from exc

    if user.role not in allowed_roles:
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Role not allowed for this websocket channel",
        )
    return user


def authenticate_websocket_user_optional(
    websocket: WebSocket,
    db: Session,
    allowed_roles: set[str],
    token_query: str | None = None,
) -> User | None:
    token = token_query
    if token is None or token == "":
        authorization = websocket.headers.get("authorization")
        if authorization is not None and authorization.lower().startswith("bearer "):
            token = authorization[7:]

    if token is None or token == "":
        return None

    return authenticate_websocket_user(
        websocket=websocket,
        db=db,
        allowed_roles=allowed_roles,
        token_query=token,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return _get_user_from_payload(_decode_token(credentials.credentials), db)


def require_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user
